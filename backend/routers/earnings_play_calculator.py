"""Earnings Play Calculator — Chart Modal (Earnings tab, play calculator).

Expected move (ATM straddle from the nearest options expiry) plus historical
EPS surprise history, for sizing an earnings trade.
"""
import logging
import asyncio
from datetime import timedelta
from fastapi import APIRouter
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

_PLAY_TTL = timedelta(hours=4)


def _compute_earnings_play(symbol: str) -> dict:
    try:
        t     = yf.Ticker(symbol, session=_session)
        info  = t.info or {}
        price = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))

        # Upcoming earnings date
        next_earnings = None
        try:
            cal = t.calendar
            if cal and "Earnings Date" in cal:
                dates = cal["Earnings Date"]
                iterable = dates if hasattr(dates, "__iter__") and not isinstance(dates, str) else [dates]
                for d in iterable:
                    try:
                        next_earnings = str(d.date()) if hasattr(d, "date") else str(d)
                        break
                    except Exception:
                        pass
        except Exception:
            pass

        # ATM straddle from nearest expiry
        straddle_strike = straddle_call = straddle_put = straddle_cost = None
        expected_move_pct = expiry_used = None
        if price:
            try:
                exps = t.options
                if exps:
                    expiry = exps[0]
                    chain  = t.option_chain(expiry)
                    calls, puts = chain.calls, chain.puts
                    if not calls.empty and not puts.empty:
                        strikes  = calls["strike"].values
                        atm_idx  = int(abs(strikes - price).argmin())
                        atm_strike = float(strikes[atm_idx])
                        c_row = calls[calls["strike"] == atm_strike]
                        p_row = puts [puts ["strike"] == atm_strike]
                        if not c_row.empty and not p_row.empty:
                            cp = _safe_float(c_row["lastPrice"].values[0])
                            pp = _safe_float(p_row["lastPrice"].values[0])
                            if cp is not None and pp is not None:
                                straddle_strike    = atm_strike
                                straddle_call      = round(cp, 2)
                                straddle_put       = round(pp, 2)
                                straddle_cost      = round(cp + pp, 2)
                                expected_move_pct  = round((straddle_cost / price) * 100, 2)
                                expiry_used        = expiry
            except Exception as e:
                logger.warning("straddle calc %s: %s", symbol, e)

        # Historical EPS (last 8 quarters)
        history = []
        try:
            eh = t.earnings_history
            if eh is not None and not eh.empty:
                for idx, row in eh.tail(8).iterrows():
                    try:
                        history.append({
                            "date":        str(idx.date()) if hasattr(idx, "date") else str(idx),
                            "epsEstimate": _safe_float(row.get("epsEstimate")),
                            "epsActual":   _safe_float(row.get("epsActual")),
                            "surprisePct": _safe_float(row.get("surprisePct") or row.get("surprisePercent")),
                        })
                    except Exception:
                        pass
        except Exception:
            pass

        return {
            "symbol":           symbol,
            "price":            price,
            "next_earnings":    next_earnings,
            "straddle_strike":  straddle_strike,
            "straddle_call":    straddle_call,
            "straddle_put":     straddle_put,
            "straddle_cost":    straddle_cost,
            "expected_move_pct": expected_move_pct,
            "expiry":           expiry_used,
            "history":          list(reversed(history)),
        }
    except Exception as e:
        logger.warning("earnings play %s: %s", symbol, e)
        return {"symbol": symbol, "error": str(e)}


@router.get("/api/earnings/play/{symbol}")
async def get_earnings_play(symbol: str):
    sym = symbol.upper()
    cache_key = f"earnings:play:{sym}"
    cached = cache_get(cache_key, _PLAY_TTL)
    if cached is not None:
        return cached
    loop   = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, lambda: _compute_earnings_play(sym))
    cache_set(cache_key, result)
    return result

