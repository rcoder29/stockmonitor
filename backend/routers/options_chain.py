"""Options Chain — Chart Modal (Options tab, full chain view).

Expirations list and full call/put chain with unusual-activity flags per
strike.
"""
from datetime import timedelta
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

router = APIRouter()

_OPTIONS_TTL = timedelta(minutes=15)



@router.get("/api/options/{symbol}/expirations")
def get_option_expirations(symbol: str):
    sym = symbol.upper()
    key = f"options:exps:{sym}"
    cached = cache_get(key, _OPTIONS_TTL)
    if cached is not None:
        return cached
    try:
        dates = list(yf.Ticker(sym, session=_session).options)
        result = {"symbol": sym, "expirations": dates}
        cache_set(key, result)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/api/options/{symbol}")
def get_option_chain(symbol: str, expiry: str | None = None):
    sym = symbol.upper()
    key = f"options:chain:{sym}:{expiry}"
    cached = cache_get(key, _OPTIONS_TTL)
    if cached is not None:
        return cached
    try:
        ticker = yf.Ticker(sym, session=_session)
        if not expiry:
            exps = ticker.options
            if not exps:
                return {"calls": [], "puts": [], "putCallRatio": None, "expiry": None}
            expiry = exps[0]
        chain = ticker.option_chain(expiry)

        def process_df(df, side):
            rows = []
            for _, row in df.iterrows():
                # yfinance leaves volume/OI/IV/bid/ask as NaN (not None) for
                # illiquid strikes — `x or 0` doesn't catch that since NaN is
                # truthy, so int(NaN) used to blow up. _safe_float catches it.
                vol = int(_safe_float(row.get("volume")) or 0)
                oi  = int(_safe_float(row.get("openInterest")) or 0)
                iv  = _safe_float(row.get("impliedVolatility"))
                rows.append({
                    "strike":          round(float(row["strike"]), 2),
                    "bid":             round(_safe_float(row.get("bid")) or 0, 2),
                    "ask":             round(_safe_float(row.get("ask")) or 0, 2),
                    "lastPrice":       round(_safe_float(row.get("lastPrice")) or 0, 2),
                    "volume":          vol,
                    "openInterest":    oi,
                    "impliedVolatility": round(iv * 100, 1) if iv else None,
                    "inTheMoney":      bool(row.get("inTheMoney", False)),
                    "unusual":         vol >= 500 and (oi == 0 or vol > oi * 2),
                })
            return rows

        calls = process_df(chain.calls, "call")
        puts  = process_df(chain.puts,  "put")
        total_call_oi = sum(r["openInterest"] for r in calls)
        total_put_oi  = sum(r["openInterest"] for r in puts)
        result = {
            "symbol": sym, "expiry": expiry,
            "calls": calls, "puts": puts,
            "putCallRatio": round(total_put_oi / total_call_oi, 2) if total_call_oi > 0 else None,
            "totalCallOI": total_call_oi, "totalPutOI": total_put_oi,
        }
        cache_set(key, result)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


