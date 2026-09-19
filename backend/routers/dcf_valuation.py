"""DCF Valuation — Research -> DCF Valuation.

Pre-fills the DCF form with live EPS, growth, beta, price, and shares
outstanding.
"""
import asyncio
from datetime import timedelta
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _safe_float

router = APIRouter()

# ── DCF Valuation ─────────────────────────────────────────────────────────────

@router.get("/api/dcf/prefill/{symbol}")
async def dcf_prefill(symbol: str):
    """Return yfinance fundamentals to pre-fill the DCF form."""
    sym = symbol.upper().strip()
    cache_key = f"dcf_prefill:{sym}"
    cached = cache_get(cache_key, timedelta(hours=2))
    if cached: return cached

    loop = asyncio.get_event_loop()
    try:
        ticker = yf.Ticker(sym)
        info = await loop.run_in_executor(None, lambda: ticker.info)
        result = {
            "symbol": sym,
            "eps_ttm":        _safe_float(info.get("trailingEps")),
            "eps_forward":    _safe_float(info.get("forwardEps")),
            "growth_rate":    _safe_float(info.get("earningsGrowth") or info.get("revenueGrowth")),
            "beta":           _safe_float(info.get("beta")),
            "price":          _safe_float(info.get("currentPrice") or info.get("regularMarketPrice")),
            "shares_out":     _safe_float(info.get("sharesOutstanding")),
            "name":           info.get("shortName", sym),
        }
    except Exception as e:
        result = {"symbol": sym, "error": str(e)}

    cache_set(cache_key, result)
    return result


