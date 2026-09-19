"""Options P&L Tracker — Portfolio -> Options P&L.

CRUD for option positions plus a live P&L endpoint that fetches current
mid-price and Greeks from the option chain.

_live_option_price is also consumed directly by routers/net_exposure.py
(no circularity, since this module doesn't depend on net_exposure.py).
"""
import asyncio
from datetime import datetime
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import db_session, OptionsPosition
from edgar_utils import _session, _safe_float

router = APIRouter()

# ── Options P&L Tracker ───────────────────────────────────────────────────────

class OptionsPositionCreate(BaseModel):
    symbol:        str
    option_type:   str    # call | put
    strike:        float
    expiry:        str    # YYYY-MM-DD
    quantity:      int    # negative = short
    entry_premium: float
    note:          str = ""


@router.get("/api/options-positions")
def list_options_positions():
    with db_session() as db:
        rows = db.query(OptionsPosition).order_by(OptionsPosition.created_at.desc()).all()
        return [{"id": r.id, "symbol": r.symbol, "option_type": r.option_type,
                 "strike": r.strike, "expiry": r.expiry, "quantity": r.quantity,
                 "entry_premium": r.entry_premium, "note": r.note,
                 "created_at": str(r.created_at)} for r in rows]


@router.post("/api/options-positions")
def add_options_position(req: OptionsPositionCreate):
    if req.option_type.lower() not in ("call", "put"):
        raise HTTPException(400, "option_type must be 'call' or 'put'")
    with db_session() as db:
        pos = OptionsPosition(
            symbol=req.symbol.upper().strip(),
            option_type=req.option_type.lower(),
            strike=req.strike,
            expiry=req.expiry,
            quantity=req.quantity,
            entry_premium=req.entry_premium,
            note=req.note,
        )
        db.add(pos)
        db.flush()
        return {"id": pos.id, "symbol": pos.symbol}


@router.delete("/api/options-positions/{pos_id}")
def delete_options_position(pos_id: int):
    with db_session() as db:
        pos = db.query(OptionsPosition).filter(OptionsPosition.id == pos_id).first()
        if not pos:
            raise HTTPException(404, "Position not found")
        db.delete(pos)
    return {"ok": True}


def _live_option_price(symbol: str, option_type: str, strike: float, expiry: str) -> dict:
    """Fetch current mid-price and Greeks from yfinance option chain."""
    try:
        t     = yf.Ticker(symbol, session=_session)
        chain = t.option_chain(expiry)
        df    = chain.calls if option_type == "call" else chain.puts
        row   = df.loc[(df["strike"] - strike).abs().idxmin()]
        bid   = float(row.get("bid", 0) or 0)
        ask   = float(row.get("ask", 0) or 0)
        lp    = float(row.get("lastPrice", 0) or 0)
        mid   = (bid + ask) / 2 if ask > bid > 0 else lp
        delta = _safe_float(row.get("delta"))
        theta = _safe_float(row.get("theta"))
        iv    = _safe_float(row.get("impliedVolatility"))
        return {"mid": round(mid, 4), "delta": delta, "theta": theta, "iv": iv, "ok": True}
    except Exception:
        return {"mid": None, "delta": None, "theta": None, "iv": None, "ok": False}


@router.get("/api/options-positions/pnl")
async def get_options_pnl():
    with db_session() as db:
        rows = db.query(OptionsPosition).order_by(OptionsPosition.created_at.desc()).all()
        positions = [{"id": r.id, "symbol": r.symbol, "option_type": r.option_type,
                      "strike": r.strike, "expiry": r.expiry, "quantity": r.quantity,
                      "entry_premium": r.entry_premium, "note": r.note} for r in rows]

    if not positions:
        return []

    today = datetime.utcnow().date()
    loop  = asyncio.get_event_loop()

    async def enrich(pos):
        dte  = (pd.to_datetime(pos["expiry"]).date() - today).days
        live = await loop.run_in_executor(
            None, lambda p=pos: _live_option_price(p["symbol"], p["option_type"], p["strike"], p["expiry"])
        )
        mid       = live["mid"]
        entry     = pos["entry_premium"]
        qty       = pos["quantity"]
        direction = 1 if qty > 0 else -1   # long = +1, short = -1
        pnl       = round((mid - entry) * abs(qty) * 100 * direction, 2) if mid is not None else None
        pnl_pct   = round((mid / entry - 1) * 100 * direction, 2) if mid and entry else None
        return {
            **pos,
            "current_mid": mid,
            "pnl":         pnl,
            "pnl_pct":     pnl_pct,
            "dte":         dte,
            "delta":       live["delta"],
            "theta":       live["theta"],
            "iv_pct":      round(live["iv"] * 100, 1) if live["iv"] else None,
            "cost_basis":  round(entry * abs(qty) * 100, 2),
            "expired":     dte < 0,
        }

    return await asyncio.gather(*[enrich(p) for p in positions])


