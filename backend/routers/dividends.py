"""Dividends — Chart Modal / Portfolio (Dividend info).

Dividend rate/yield, ex-dividend date, payout ratio, and recent payment
history per symbol.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import List
import yfinance as yf
from fastapi import APIRouter
from pydantic import BaseModel

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

router = APIRouter()

_DIVIDEND_TTL = timedelta(hours=4)

# ── Dividends ─────────────────────────────────────────────────────────────────

class DividendRequest(BaseModel):
    symbols: List[str]


@router.post("/api/dividends")
def get_dividends(body: DividendRequest):
    key = f"dividends:{'|'.join(sorted(body.symbols))}"
    cached = cache_get(key, _DIVIDEND_TTL)
    if cached is not None:
        return cached

    def fetch_div(sym: str):
        try:
            ticker = yf.Ticker(sym, session=_session)
            info   = ticker.info
            divs   = ticker.dividends
            history = []
            if len(divs) > 0:
                for ts, amt in divs.tail(8).items():
                    history.append({"date": str(ts.date()), "amount": round(float(amt), 4)})
            ex_ts = info.get("exDividendDate")
            ex_date = None
            if ex_ts:
                try:
                    ex_date = datetime.utcfromtimestamp(int(ex_ts)).strftime("%Y-%m-%d")
                except Exception:
                    pass
            return {
                "symbol":        sym,
                "dividendRate":  _safe_float(info.get("dividendRate")),
                "dividendYield": round(float(info.get("dividendYield") or 0) * 100, 2),
                "exDividendDate": ex_date,
                "payoutRatio":   _safe_float(info.get("payoutRatio")),
                "lastDividend":  round(float(divs.iloc[-1]), 4) if len(divs) > 0 else None,
                "history":       history,
                "paysDividend":  bool((info.get("dividendRate") or 0) > 0),
            }
        except Exception:
            return {"symbol": sym, "error": True, "paysDividend": False, "history": []}

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(fetch_div, body.symbols))

    cache_set(key, results)
    return results


