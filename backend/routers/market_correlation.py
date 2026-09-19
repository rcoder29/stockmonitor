"""Market Correlation — Markets -> Correlation (GET /api/market/correlation).

Pairwise return correlation across an arbitrary symbol list, keyed by
query params rather than a POST body.

Distinct from routers/correlation_matrix.py (POST
/api/portfolio/correlation) — same feature name in the original
main.py, different routes and cache-key separators
("corr:{symbols_underscore}:{period}" here vs
"corr:{symbols_pipe}:{period}" there), so no collision despite sharing
the "corr:" prefix.
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import cache_get, cache_set

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Correlation Matrix ────────────────────────────────────────────────────────

_CORR_TTL = timedelta(hours=1)


@router.get("/api/market/correlation")
def get_market_correlation(symbols: str, period: str = "3mo"):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if len(syms) < 2:
        raise HTTPException(400, "Need at least 2 symbols")
    cache_key = f"corr:{'_'.join(sorted(syms))}:{period}"
    cached = cache_get(cache_key, _CORR_TTL)
    if cached:
        return cached

    valid_periods = {"1mo", "3mo", "6mo", "1y", "2y"}
    if period not in valid_periods:
        period = "3mo"

    try:
        price_data: dict[str, pd.Series] = {}
        errors: list[str] = []

        def _fetch_close(sym: str):
            try:
                hist = yf.Ticker(sym).history(period=period)
                if hist.empty:
                    return sym, None
                closes = hist["Close"].dropna()
                if len(closes) < 10:
                    return sym, None
                return sym, closes
            except Exception:
                return sym, None

        with ThreadPoolExecutor(max_workers=min(len(syms), 8)) as pool:
            for sym, closes in pool.map(_fetch_close, syms):
                if closes is not None:
                    price_data[sym] = closes
                else:
                    errors.append(sym)

        if len(price_data) < 2:
            raise HTTPException(400, "Insufficient data for correlation")

        df = pd.DataFrame(price_data).dropna()
        returns = df.pct_change().dropna()
        corr = returns.corr()

        used_syms = list(corr.columns)
        matrix = []
        for sym_a in used_syms:
            row = []
            for sym_b in used_syms:
                val = corr.loc[sym_a, sym_b]
                row.append(round(float(val), 4) if not pd.isna(val) else None)
            matrix.append(row)

        result = {"symbols": used_syms, "matrix": matrix, "period": period, "errors": errors}
        cache_set(cache_key, result)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Correlation: %s", exc)
        raise HTTPException(500, str(exc))


