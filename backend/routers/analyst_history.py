"""Analyst History — Research → Analyst Ratings (per-symbol upgrade/downgrade history).

2-year upgrade/downgrade history for a single symbol, with current price and
day change for context.
"""
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

_ANLST_TTL = timedelta(minutes=10)

# ── Analyst history ───────────────────────────────────────────────────────────

@router.get("/api/analyst-history/{symbol}")
def get_analyst_history(symbol: str):
    symbol = symbol.upper()
    cached = cache_get(f"analyst_hist:{symbol}", _ANLST_TTL)
    if cached is not None:
        return cached

    try:
        ticker     = yf.Ticker(symbol, session=_session)
        df         = ticker.upgrades_downgrades
        fi         = ticker.fast_info
        price      = _safe_float(fi.last_price)
        prev_close = _safe_float(fi.previous_close)
        change_pct = ((price - prev_close) / prev_close * 100) if price and prev_close else None
        info_name  = ticker.info.get("shortName") or ticker.info.get("longName") or symbol
    except Exception as exc:
        logger.warning("Analyst history failed for %s: %s", symbol, exc)
        result = {"symbol": symbol, "name": symbol, "price": None,
                  "changePct": None, "history": []}
        cache_set(f"analyst_hist:{symbol}", result)
        return result

    history = []
    if df is not None and not df.empty:
        cutoff = datetime.utcnow() - timedelta(days=365 * 2)
        recent = df[df.index >= cutoff]
        for ts, row in recent.iterrows():
            history.append({
                "date":      ts.strftime("%Y-%m-%d"),
                "firm":      str(row.get("Firm", "")),
                "toGrade":   str(row.get("ToGrade", "")),
                "fromGrade": str(row.get("FromGrade", "")),
                "action":    str(row.get("Action", "")).lower(),
                "ptAction":  str(row.get("priceTargetAction", "")),
                "currentPT": _safe_float(row.get("currentPriceTarget")),
                "priorPT":   _safe_float(row.get("priorPriceTarget")),
            })

    result = {
        "symbol":    symbol,
        "name":      info_name,
        "price":     price,
        "changePct": round(change_pct, 2) if change_pct is not None else None,
        "history":   history,
    }
    cache_set(f"analyst_hist:{symbol}", result)
    return result

