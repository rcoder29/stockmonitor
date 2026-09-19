"""Sector Rotation — Markets -> Sector Rotation.

Live performance (1D/1W/1M/3M) across the 11 SPDR sector ETFs.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float, _SECTOR_ETFS

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Sector Rotation ───────────────────────────────────────────────────────────

_SECTOR_TTL = timedelta(minutes=15)


def _fetch_sector_perf(info: dict) -> dict:
    sym = info["symbol"]
    cache_key = f"sector:{sym}"
    cached = cache_get(cache_key, _SECTOR_TTL)
    if cached is not None:
        return cached

    try:
        t = yf.Ticker(sym, session=_session)
        hist = t.history(period="3mo")
        if hist.empty:
            return {**info, "error": "no data"}
        # An in-progress/incomplete session can leave today's Close as NaN —
        # drop it so .iloc[-1] never lands on NaN and leaks into JSON
        # (Starlette rejects a bare NaN).
        closes = hist["Close"].dropna()
        if closes.empty:
            return {**info, "error": "no data"}
        fi = t.fast_info
        price = _safe_float(fi.last_price) or float(closes.iloc[-1])
        prev  = _safe_float(fi.previous_close) or (float(closes.iloc[-2]) if len(closes) > 1 else price)

        def chg(n):
            return round((float(closes.iloc[-1]) / float(closes.iloc[-1 - n]) - 1) * 100, 2) if len(closes) > n else None

        result = {
            **info,
            "price": round(price, 2),
            "chg1d": round((price - prev) / prev * 100, 2) if prev else None,
            "chg1w": chg(5),
            "chg1m": chg(21),
            "chg3m": chg(63),
        }
    except Exception as e:
        logger.warning("sector perf failed %s: %s", sym, e)
        result = {**info, "error": str(e)}

    cache_set(cache_key, result)
    return result


@router.get("/api/market/sectors")
def get_sector_rotation():
    cache_key = "market:sectors"
    cached = cache_get(cache_key, _SECTOR_TTL)
    if cached is not None:
        return cached

    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = {ex.submit(_fetch_sector_perf, s): s["symbol"] for s in _SECTOR_ETFS}
        perf_map = {}
        for f in as_completed(futures):
            data = f.result()
            perf_map[data["symbol"]] = data

    results = [perf_map.get(s["symbol"], s) for s in _SECTOR_ETFS]
    cache_set(cache_key, results)
    return results


