"""Options Unusual Activity Feed — Research → Unusual Options.

Scans the nearest two expiries per symbol for contracts with volume >= 500
and volume > 2x open interest.
"""
import logging
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _session

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Options Unusual Activity Feed ─────────────────────────────────────────────

_UOA_TTL = timedelta(minutes=10)


def _fetch_uoa_for(sym: str) -> list:
    cache_key = f"uoa:{sym}"
    cached = cache_get(cache_key, _UOA_TTL)
    if cached is not None:
        return cached

    results = []
    try:
        t = yf.Ticker(sym, session=_session)
        exps = t.options
        if not exps:
            cache_set(cache_key, results)
            return results

        # Check nearest two expiries for more coverage
        for exp in exps[:2]:
            try:
                chain = t.option_chain(exp)
                for c_type, df in [("call", chain.calls), ("put", chain.puts)]:
                    for _, row in df.iterrows():
                        volume = int(row.get("volume") or 0)
                        oi     = int(row.get("openInterest") or 0)
                        if volume >= 500 and (oi == 0 or volume > 2 * oi):
                            results.append({
                                "symbol":        sym,
                                "type":          c_type,
                                "strike":        round(float(row.get("strike") or 0), 2),
                                "expiry":        exp,
                                "volume":        volume,
                                "openInterest":  oi,
                                "lastPrice":     round(float(row.get("lastPrice") or 0), 2),
                                "impliedVol":    round(float(row.get("impliedVolatility") or 0) * 100, 1),
                                "inTheMoney":    bool(row.get("inTheMoney", False)),
                            })
            except Exception:
                pass
    except Exception as e:
        logger.warning("UOA fetch failed %s: %s", sym, e)

    cache_set(cache_key, results)
    return results


@router.get("/api/market/options-uoa")
def get_options_uoa(symbols: str = ""):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []

    all_uoa = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = [ex.submit(_fetch_uoa_for, s) for s in syms]
        for f in as_completed(futures):
            all_uoa.extend(f.result())

    all_uoa.sort(key=lambda x: x["volume"], reverse=True)
    return all_uoa[:60]

