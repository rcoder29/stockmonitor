"""Price Target Tracker — Watchlist -> Price Targets.

Personal price targets with live current price, % to target, analyst
consensus, and days remaining.
"""
import asyncio
from datetime import datetime
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import db_session, PriceTarget
from edgar_utils import _session, _safe_float

router = APIRouter()

# ── Price Target Tracker ──────────────────────────────────────────────────────

class PriceTargetCreate(BaseModel):
    symbol:       str
    target_price: float
    target_date:  str = ""
    note:         str = ""


@router.get("/api/price-targets")
async def list_price_targets():
    with db_session() as db:
        targets = db.query(PriceTarget).order_by(PriceTarget.created_at.desc()).all()
        items   = [{"id": t.id, "symbol": t.symbol, "target_price": t.target_price,
                    "target_date": t.target_date, "note": t.note, "created_at": str(t.created_at)}
                   for t in targets]

    if not items:
        return []

    # Enrich with live prices + analyst consensus
    syms = list({i["symbol"] for i in items})
    loop = asyncio.get_event_loop()

    def _fetch_price_and_consensus(sym):
        try:
            t     = yf.Ticker(sym, session=_session)
            fi    = t.fast_info
            price = _safe_float(fi.last_price)
            info  = t.info
            consensus = _safe_float(info.get("targetMeanPrice"))
            return sym, price, consensus
        except Exception:
            return sym, None, None

    price_results = await asyncio.gather(*[loop.run_in_executor(None, _fetch_price_and_consensus, s) for s in syms])
    price_map = {sym: (price, consensus) for sym, price, consensus in price_results}

    today = datetime.utcnow().date()
    enriched = []
    for item in items:
        price, consensus = price_map.get(item["symbol"], (None, None))
        pct_to_target = None
        if price and price > 0:
            pct_to_target = round((item["target_price"] / price - 1) * 100, 2)
        days_remaining = None
        if item["target_date"]:
            try:
                days_remaining = (pd.to_datetime(item["target_date"]).date() - today).days
            except Exception:
                pass
        enriched.append({
            **item,
            "current_price":    round(price, 2) if price else None,
            "pct_to_target":    pct_to_target,
            "analyst_consensus": round(consensus, 2) if consensus else None,
            "days_remaining":   days_remaining,
        })
    return enriched


@router.post("/api/price-targets")
def create_price_target(req: PriceTargetCreate):
    with db_session() as db:
        pt = PriceTarget(
            symbol=req.symbol.upper().strip(),
            target_price=req.target_price,
            target_date=req.target_date or None,
            note=req.note or None,
        )
        db.add(pt)
        db.flush()
        return {"id": pt.id, "symbol": pt.symbol}


@router.delete("/api/price-targets/{target_id}")
def delete_price_target(target_id: int):
    with db_session() as db:
        pt = db.query(PriceTarget).filter(PriceTarget.id == target_id).first()
        if not pt:
            raise HTTPException(404, "Target not found")
        db.delete(pt)
    return {"ok": True}


