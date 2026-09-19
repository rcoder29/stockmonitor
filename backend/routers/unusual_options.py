"""Options Unusual Activity Feed — Research → Unusual Options.

Two scanners: a per-symbol-list feed (nearest two expiries, volume >= 500
and volume > 2x open interest) and an explicit-symbols scan (nearest three
expiries, volume >= 2x OI or a fresh high-volume contract) used by the
Unusual Options tab's "scanned symbols" view.
"""
import asyncio
import logging
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, Query
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

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


_SCANNER_UOA_TTL = timedelta(minutes=30)

@router.get("/api/options/unusual")
async def unusual_options_activity(symbols: str = Query(...)):
    """
    Scan options chains for unusual activity.
    symbols: comma-separated list (max 10)
    Returns contracts where volume >= 2× open_interest OR volume > 500 AND volume > open_interest.
    """
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()][:10]
    cache_key = f"uoa:{','.join(sorted(syms))}"
    cached = cache_get(cache_key, _SCANNER_UOA_TTL)
    if cached: return cached

    loop = asyncio.get_event_loop()
    results = []

    def fetch_uoa(sym):
        try:
            tk = yf.Ticker(sym)
            expiries = tk.options
            if not expiries:
                return []
            # Only scan nearest 3 expiries to keep it fast
            hits = []
            for exp in expiries[:3]:
                try:
                    chain = tk.option_chain(exp)
                    for df, opt_type in [(chain.calls, "call"), (chain.puts, "put")]:
                        for _, row in df.iterrows():
                            vol = int(row.get("volume", 0) or 0)
                            oi  = int(row.get("openInterest", 0) or 0)
                            if vol < 100:
                                continue
                            if oi > 0 and vol >= 2 * oi:
                                ratio = round(vol / max(oi, 1), 1)
                            elif vol >= 1000 and oi == 0:
                                ratio = None  # fresh contract
                            else:
                                continue
                            bid  = _safe_float(row.get("bid"))
                            ask  = _safe_float(row.get("ask"))
                            iv   = _safe_float(row.get("impliedVolatility"))
                            hits.append({
                                "symbol":     sym,
                                "type":       opt_type,
                                "strike":     _safe_float(row.get("strike")),
                                "expiry":     exp,
                                "volume":     vol,
                                "open_interest": oi,
                                "vol_oi_ratio":  ratio,
                                "bid":        bid,
                                "ask":        ask,
                                "mid":        round((bid + ask) / 2, 2) if bid and ask else None,
                                "iv_pct":     round(iv * 100, 1) if iv else None,
                                "in_the_money": bool(row.get("inTheMoney", False)),
                            })
                except Exception:
                    continue
            # Sort by volume desc, cap at 20 per symbol
            hits.sort(key=lambda x: x["volume"], reverse=True)
            return hits[:20]
        except Exception:
            return []

    tasks = [loop.run_in_executor(None, fetch_uoa, sym) for sym in syms]
    all_results = await asyncio.gather(*tasks)
    for hits in all_results:
        results.extend(hits)

    # Global sort by volume, cap at 100
    results.sort(key=lambda x: x["volume"], reverse=True)
    results = results[:100]

    result = {"items": results, "scanned": syms}
    cache_set(cache_key, result)
    return result

