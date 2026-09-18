"""Earnings Calendar — inline earnings countdown (Watchlist).

Upcoming earnings dates (within 90 days) for a set of symbols, with EPS/
revenue estimates.
"""
import logging
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _session

logger = logging.getLogger(__name__)
router = APIRouter()

_EARNINGS_TTL = timedelta(hours=4)


def _fetch_earnings(sym: str):
    cache_key = f"earnings:{sym}"
    cached = cache_get(cache_key, _EARNINGS_TTL)
    if cached is not None:
        return cached

    try:
        cal = yf.Ticker(sym, session=_session).calendar
        if not cal or "Earnings Date" not in cal:
            result = None
        else:
            dates = cal["Earnings Date"]
            if not dates:
                result = None
            else:
                # Take the first (soonest) upcoming date
                d = dates[0]
                date_str = d.isoformat() if hasattr(d, "isoformat") else str(d)
                today = datetime.utcnow().date()
                parsed = d if hasattr(d, "year") else None
                days_until = (parsed - today).days if parsed else None
                result = {
                    "symbol":           sym,
                    "date":             date_str,
                    "daysUntil":        days_until,
                    "epsEstimate":      cal.get("Earnings Average"),
                    "epsLow":           cal.get("Earnings Low"),
                    "epsHigh":          cal.get("Earnings High"),
                    "revenueEstimate":  cal.get("Revenue Average"),
                }
    except Exception as e:
        logger.warning("earnings fetch failed %s: %s", sym, e)
        result = None

    cache_set(cache_key, result)
    return result


@router.get("/api/earnings/upcoming")
def get_upcoming_earnings(symbols: str = ""):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []

    results = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(_fetch_earnings, s): s for s in syms}
        for f in as_completed(futures):
            data = f.result()
            if data and data.get("daysUntil") is not None and data["daysUntil"] <= 90:
                results.append(data)

    results.sort(key=lambda x: x["daysUntil"])
    return results


