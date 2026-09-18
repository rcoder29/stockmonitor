"""Earnings History — Chart Modal (Earnings tab, historical chart).

Last 8 quarters of EPS actual/estimate and revenue actual, via yfinance.
"""
import logging
from datetime import timedelta
from fastapi import APIRouter
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

_EARN_HIST_TTL = timedelta(hours=6)

# ── Earnings History ──────────────────────────────────────────────────────────

_EARN_HIST_TTL = timedelta(hours=6)


@router.get("/api/earnings/history/{symbol}")
def get_earnings_history(symbol: str):
    symbol = symbol.upper()
    cache_key = f"earnings:history:{symbol}"
    cached = cache_get(cache_key, _EARN_HIST_TTL)
    if cached is not None:
        return cached

    try:
        t  = yf.Ticker(symbol, session=_session)
        eh = t.earnings_history
        qi = t.quarterly_income_stmt

        quarters = []
        if eh is not None and not eh.empty:
            for idx, row in eh.iterrows():
                q_str = str(idx.date()) if hasattr(idx, "date") else str(idx)
                quarters.append({
                    "quarter":         q_str,
                    "epsActual":       _safe_float(row.get("epsActual")),
                    "epsEstimate":     _safe_float(row.get("epsEstimate")),
                    "epsSurprisePct":  _safe_float(row.get("surprisePercent")),
                    "revenueActual":   None,
                    "revenueEstimate": None,
                })

        # Attach revenue from quarterly income statement
        if qi is not None and not qi.empty:
            rev_rows = [r for r in qi.index if r == "Total Revenue"]
            if rev_rows:
                rev = qi.loc[rev_rows[0]]
                for q in quarters:
                    try:
                        q_ts = [c for c in rev.index if str(c.date()) == q["quarter"]]
                        if q_ts:
                            q["revenueActual"] = _safe_float(rev[q_ts[0]])
                    except Exception:
                        pass

        result = {"symbol": symbol, "quarters": list(reversed(quarters[-8:]))}
    except Exception as e:
        logger.warning("earnings history failed %s: %s", symbol, e)
        result = {"symbol": symbol, "quarters": []}

    cache_set(cache_key, result)
    return result

