"""Portfolio — core position CRUD + Home dashboard summary.

_fetch_perf_one lives in main.py's Market performance section (shared by
several other still-unmigrated sections too) — imported with a
function-scoped deferred import since main.py imports this router to
register it, which would otherwise cycle.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import yfinance as yf

from database import db_session, cache_get, cache_set, PortfolioPosition
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

_HOME_TTL = timedelta(minutes=2)

# ── Portfolio ─────────────────────────────────────────────────────────────────

class PositionIn(BaseModel):
    symbol:  str
    shares:  float
    avgCost: float


@router.get("/api/portfolio")
def get_portfolio():
    with db_session() as db:
        rows = db.query(PortfolioPosition).order_by(PortfolioPosition.added_at).all()
        return [
            {"id": r.id, "symbol": r.symbol, "shares": r.shares, "avgCost": r.avg_cost}
            for r in rows
        ]


@router.post("/api/portfolio", status_code=201)
def add_position(body: PositionIn):
    sym = body.symbol.strip().upper()
    if not sym:
        raise HTTPException(400, "Symbol required")
    if body.shares <= 0:
        raise HTTPException(400, "Shares must be positive")
    if body.avgCost <= 0:
        raise HTTPException(400, "Avg cost must be positive")
    with db_session() as db:
        pos = PortfolioPosition(symbol=sym, shares=body.shares, avg_cost=body.avgCost)
        db.add(pos)
        db.flush()
        return {"id": pos.id, "symbol": pos.symbol, "shares": pos.shares, "avgCost": pos.avg_cost}


@router.delete("/api/portfolio/{position_id}", status_code=204)
def remove_position(position_id: int):
    with db_session() as db:
        row = db.query(PortfolioPosition).filter(PortfolioPosition.id == position_id).first()
        if row:
            db.delete(row)


def _fetch_day_quote(sym: str) -> dict:
    """Lightweight price + previous close, no fundamentals — for day P&L math."""
    try:
        fi = yf.Ticker(sym, session=_session).fast_info
        return {
            "symbol":        sym,
            "price":         _safe_float(fi.last_price),
            "previousClose": _safe_float(fi.previous_close),
        }
    except Exception as e:
        logger.warning("day quote failed %s: %s", sym, e)
        return {"symbol": sym, "price": None, "previousClose": None}


_HOME_MARKET_SYMS = ["SPY", "QQQ", "DIA", "^VIX"]


@router.get("/api/home/summary")
def get_home_summary():
    """Aggregate view for the Home dashboard: portfolio day/total P&L + movers,
    plus a market pulse strip (major indices + VIX). One call, no client-side
    re-fetching of data other tabs already compute their own way."""
    from main import _fetch_perf_one

    cached = cache_get("home:summary", _HOME_TTL)
    if cached is not None:
        return cached

    with db_session() as db:
        positions = [{"symbol": p.symbol, "shares": p.shares, "avgCost": p.avg_cost}
                     for p in db.query(PortfolioPosition).all()]

    portfolio = {
        "positionCount": len(positions),
        "totalValue": None, "totalCost": None,
        "dayPnl": None, "dayPnlPct": None,
        "totalPnl": None, "totalPnlPct": None,
        "topDayMovers": [],
    }

    if positions:
        syms = list({p["symbol"] for p in positions})
        quotes = {}
        with ThreadPoolExecutor(max_workers=min(len(syms), 10)) as pool:
            futures = {pool.submit(_fetch_day_quote, s): s for s in syms}
            for fut in as_completed(futures):
                q = fut.result()
                quotes[q["symbol"]] = q

        total_value = total_cost = day_pnl = prior_value = 0.0
        movers = []
        for p in positions:
            q = quotes.get(p["symbol"]) or {}
            price, prev = q.get("price"), q.get("previousClose")
            cost_basis = p["shares"] * p["avgCost"]
            total_cost += cost_basis
            value = p["shares"] * price if price is not None else cost_basis
            total_value += value
            if price is not None and prev is not None:
                pos_day_pnl = (price - prev) * p["shares"]
                day_pnl += pos_day_pnl
                prior_value += prev * p["shares"]
                movers.append({
                    "symbol":    p["symbol"],
                    "value":     round(value, 2),
                    "dayPnl":    round(pos_day_pnl, 2),
                    "dayPnlPct": round((price / prev - 1) * 100, 2) if prev else None,
                })
        movers.sort(key=lambda m: abs(m["dayPnl"]), reverse=True)

        total_pnl = total_value - total_cost
        portfolio.update({
            "totalValue":   round(total_value, 2),
            "totalCost":    round(total_cost, 2),
            "dayPnl":       round(day_pnl, 2),
            "dayPnlPct":    round(day_pnl / prior_value * 100, 2) if prior_value else None,
            "totalPnl":     round(total_pnl, 2),
            "totalPnlPct":  round(total_pnl / total_cost * 100, 2) if total_cost else None,
            "topDayMovers": movers[:4],
        })

    market = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_fetch_perf_one, s): s for s in _HOME_MARKET_SYMS}
        for fut in as_completed(futures):
            d = fut.result()
            market[d["symbol"]] = d

    vix = market.get("^VIX", {})
    vix_price = vix.get("price")
    vix_label = (
        "Low" if vix_price is not None and vix_price < 15 else
        "Elevated" if vix_price is not None and vix_price < 25 else
        "High" if vix_price is not None else None
    )

    result = {
        "portfolio": portfolio,
        "market": {
            "indices": [market[s] for s in ("SPY", "QQQ", "DIA") if market.get(s, {}).get("price") is not None],
            "vix": {**vix, "label": vix_label},
        },
    }
    cache_set("home:summary", result)
    return result
