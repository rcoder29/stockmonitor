"""Portfolio Equity Curve — Portfolio (Equity Curve view).

Daily portfolio value snapshots, and an endpoint to record today's snapshot
using live quotes.

_fetch_quote lives in main.py's Fundamentals section (too widely shared to
move in this pass) — imported with a function-scoped deferred import since
main.py imports this router to register it, which would otherwise cycle.
"""
import asyncio
from datetime import datetime
from fastapi import APIRouter

from database import db_session, PortfolioPosition, PortfolioSnapshot

router = APIRouter()

# ── Portfolio Equity Curve ────────────────────────────────────────────────────

@router.get("/api/portfolio/snapshots")
def get_portfolio_snapshots():
    with db_session() as db:
        rows = db.query(PortfolioSnapshot).order_by(PortfolioSnapshot.date).all()
        return [{"date": r.date, "total_value": r.total_value, "total_cost": r.total_cost} for r in rows]


@router.post("/api/portfolio/snapshot")
async def save_portfolio_snapshot():
    from main import _fetch_quote

    loop = asyncio.get_event_loop()

    with db_session() as db:
        entries = db.query(PortfolioPosition).all()
        positions_data = [
            {"symbol": e.symbol, "shares": e.shares, "avg_cost": e.avg_cost}
            for e in entries
        ]

    if not positions_data:
        return {"date": datetime.utcnow().strftime("%Y-%m-%d"), "total_value": 0,
                "total_cost": 0, "total_pl": 0, "total_pl_pct": 0, "holdings": []}

    syms = [p["symbol"] for p in positions_data]
    quotes_list = await loop.run_in_executor(None, lambda: [_fetch_quote(s) for s in syms])
    quote_map = {q["symbol"]: q for q in quotes_list if q}

    holdings, total_value, total_cost = [], 0.0, 0.0
    for p in positions_data:
        q = quote_map.get(p["symbol"], {})
        price  = q.get("price") or p["avg_cost"]
        cur_val = p["shares"] * price
        cost    = p["shares"] * p["avg_cost"]
        pl      = cur_val - cost
        total_value += cur_val
        total_cost  += cost
        holdings.append({
            "symbol":   p["symbol"],
            "shares":   p["shares"],
            "avg_cost": p["avg_cost"],
            "price":    price,
            "cur_val":  round(cur_val, 2),
            "cost":     round(cost, 2),
            "pl":       round(pl, 2),
            "pl_pct":   round((pl / cost * 100) if cost > 0 else 0, 2),
            "changePercent": q.get("changePercent"),
        })

    today = datetime.utcnow().strftime("%Y-%m-%d")
    with db_session() as db:
        existing = db.query(PortfolioSnapshot).filter_by(date=today).first()
        if existing:
            existing.total_value = total_value
            existing.total_cost  = total_cost
        else:
            db.add(PortfolioSnapshot(date=today, total_value=total_value, total_cost=total_cost))

    for h in holdings:
        h["pct_of_portfolio"] = round((h["cur_val"] / total_value * 100) if total_value > 0 else 0, 2)
    holdings.sort(key=lambda x: x["cur_val"], reverse=True)

    return {
        "date":         today,
        "total_value":  round(total_value, 2),
        "total_cost":   round(total_cost, 2),
        "total_pl":     round(total_value - total_cost, 2),
        "total_pl_pct": round(((total_value - total_cost) / total_cost * 100) if total_cost > 0 else 0, 2),
        "holdings":     holdings,
    }

