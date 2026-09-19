"""Watchlist Heatmap — Watchlist -> Heatmap.

Per-symbol tiles (price, market cap, multi-period returns) sized/colored
by market cap and performance for a treemap-style view.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Watchlist Heatmap ─────────────────────────────────────────────────────────

_WL_HEAT_TTL = timedelta(minutes=5)

def _fetch_wl_tile(sym: str) -> dict | None:
    cache_key = f"wlheat:{sym}"
    cached = cache_get(cache_key, _WL_HEAT_TTL)
    if cached:
        return cached
    try:
        t = yf.Ticker(sym, session=_session)
        fi = t.fast_info
        info = t.info or {}
        price = _safe_float(fi.last_price)
        prev  = _safe_float(fi.previous_close)
        chg_1d = round((price - prev) / prev * 100, 2) if price and prev else None
        hist = t.history(period="3mo", interval="1d", auto_adjust=True)

        def pct(n: int):
            if hist.empty or len(hist) <= n:
                return None
            c = hist["Close"]
            return round((float(c.iloc[-1]) / float(c.iloc[-(n + 1)]) - 1) * 100, 2)

        mkt_cap = _safe_float(fi.market_cap) or _safe_float(info.get("marketCap"))
        result = {
            "symbol":    sym,
            "name":      info.get("longName") or info.get("shortName") or sym,
            "price":     price,
            "marketCap": mkt_cap,
            "sector":    info.get("sector"),
            "ret1d":     chg_1d,
            "ret5d":     pct(5),
            "ret1m":     pct(21),
            "ret3m":     pct(63),
        }
        cache_set(cache_key, result)
        return result
    except Exception as exc:
        logger.debug("WL heatmap tile %s: %s", sym, exc)
        return None


@router.get("/api/market/watchlist-heatmap")
def get_watchlist_heatmap(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(syms), 12)) as pool:
        futures = {pool.submit(_fetch_wl_tile, sym): sym for sym in syms}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                results.append(r)
    results.sort(key=lambda x: -(x.get("marketCap") or 0))
    return results


