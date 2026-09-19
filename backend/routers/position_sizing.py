"""Position Sizing Calculator — Trading -> Position Sizer.

Fixed-fractional, ATR-based, and half-Kelly position sizing given account
size, risk tolerance, entry, and stop.
"""
import asyncio
import numpy as np
import yfinance as yf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from edgar_utils import _session, _finite_or_none

router = APIRouter()

# ── Position Sizing Calculator ─────────────────────────────────────────────────

class PositionSizeRequest(BaseModel):
    symbol:       str
    account_size: float
    risk_pct:     float        # e.g. 1.0 for 1%
    entry_price:  float
    stop_price:   float


@router.post("/api/position-sizing")
async def calc_position_size(req: PositionSizeRequest):
    sym        = req.symbol.upper().strip()
    risk_amt   = req.account_size * (req.risk_pct / 100)
    risk_per_share = abs(req.entry_price - req.stop_price)

    if risk_per_share <= 0:
        raise HTTPException(400, "entry_price and stop_price must differ")

    # Fixed fractional
    ff_shares  = risk_amt / risk_per_share

    # ATR-based (use 14-day ATR as the risk unit; size so that 1 ATR = risk_amt)
    atr_shares = atr_val = None
    try:
        loop = asyncio.get_event_loop()
        hist = await loop.run_in_executor(
            None, lambda: yf.Ticker(sym, session=_session).history(period="60d", interval="1d", auto_adjust=True)
        )
        if len(hist) >= 15:
            high = hist["High"].values.astype(float)
            low  = hist["Low"].values.astype(float)
            prev = hist["Close"].shift(1).values.astype(float)
            tr   = np.maximum(high - low, np.maximum(np.abs(high - prev), np.abs(low - prev)))
            # A NaN in the most recent row (e.g. an incomplete in-progress
            # session) propagates through np.maximum/np.mean — guard it here
            # so it never reaches JSON serialization (Starlette rejects NaN).
            atr_val = _finite_or_none(round(float(np.mean(tr[-14:])), 4))
            if atr_val is not None and atr_val > 0:
                atr_shares = risk_amt / atr_val
    except Exception:
        pass

    # Kelly (simplified: use last 252d win rate of daily moves)
    kelly_shares = kelly_pct = None
    try:
        loop = asyncio.get_event_loop()
        hist2 = await loop.run_in_executor(
            None, lambda: yf.Ticker(sym, session=_session).history(period="1y", interval="1d", auto_adjust=True)
        )
        if len(hist2) >= 30:
            daily = hist2["Close"].pct_change().dropna()
            wins  = daily[daily > 0]
            losses= daily[daily < 0]
            if len(wins) > 0 and len(losses) > 0:
                win_rate = len(wins) / len(daily)
                avg_win  = float(wins.mean())
                avg_loss = abs(float(losses.mean()))
                kelly_f  = win_rate - (1 - win_rate) / (avg_win / avg_loss) if avg_loss > 0 else 0
                half_kelly = max(0.0, kelly_f / 2)          # half-Kelly for safety
                kelly_dollars = req.account_size * half_kelly
                kelly_shares  = kelly_dollars / req.entry_price
                kelly_pct     = round(half_kelly * 100, 2)
    except Exception:
        pass

    def fmt_row(shares, label, note=""):
        if shares is None or shares <= 0:
            return None
        dollars  = shares * req.entry_price
        acct_pct = dollars / req.account_size * 100
        return {
            "method":   label,
            "shares":   round(shares, 2),
            "dollars":  round(dollars, 2),
            "acct_pct": round(acct_pct, 1),
            "note":     note,
        }

    return {
        "symbol":        sym,
        "account_size":  req.account_size,
        "risk_pct":      req.risk_pct,
        "risk_amount":   round(risk_amt, 2),
        "entry":         req.entry_price,
        "stop":          req.stop_price,
        "risk_per_share": round(risk_per_share, 4),
        "atr":           atr_val,
        "methods": [r for r in [
            fmt_row(ff_shares,    "Fixed Fractional",
                    f"Risk ${risk_amt:.0f} / ${risk_per_share:.2f} per share"),
            fmt_row(atr_shares,   "ATR-based (14)",
                    f"ATR = ${atr_val:.2f}" if atr_val else "ATR unavailable"),
            fmt_row(kelly_shares, "Half-Kelly",
                    f"Kelly% = {kelly_pct:.1f}% of account" if kelly_pct else ""),
        ] if r is not None],
    }


