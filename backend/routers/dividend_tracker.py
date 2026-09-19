"""Dividend Tracker — Portfolio -> Dividend Tracker.

Dividend rate/yield, ex-dividend date, inferred payout frequency, and
recent payment history across a list of symbols.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import yfinance as yf
from fastapi import APIRouter
from pydantic import BaseModel

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Dividend Tracker ──────────────────────────────────────────────────────────

_DIV_TTL = timedelta(hours=6)


class DivDataRequest(BaseModel):
    symbols: list[str]


def _fetch_div_info(sym: str) -> dict | None:
    cache_key = f"div:{sym}"
    cached = cache_get(cache_key, _DIV_TTL)
    if cached:
        return cached

    try:
        t = yf.Ticker(sym, session=_session)
        info = t.info or {}

        price     = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
        div_rate  = _safe_float(info.get("dividendRate"))
        div_yield = _safe_float(info.get("dividendYield"))

        # exDividendDate is a Unix timestamp in yfinance info
        ex_ts  = info.get("exDividendDate")
        ex_date = None
        if ex_ts and isinstance(ex_ts, (int, float)) and ex_ts > 0:
            from datetime import timezone
            ex_date = datetime.fromtimestamp(ex_ts, tz=timezone.utc).strftime("%Y-%m-%d")

        # Payout frequency from dividend history spacing
        freq    = "quarterly"
        history = []
        try:
            divs = t.dividends
            if len(divs) >= 2:
                tail  = divs.tail(5)
                dates = tail.index
                span  = (dates[-1] - dates[0]).days
                n     = len(dates) - 1
                avg   = span / n if n else 90
                if avg < 40:   freq = "monthly"
                elif avg < 100: freq = "quarterly"
                elif avg < 200: freq = "semi-annual"
                else:           freq = "annual"
            for dt, val in divs.tail(8).items():
                history.append({"date": str(dt.date()), "amount": round(float(val), 4)})
        except Exception:
            pass

        result = {
            "symbol":            sym,
            "name":              info.get("longName") or info.get("shortName") or sym,
            "price":             price,
            "dividendRate":      div_rate,
            "dividendYield":     round(div_yield * 100, 2) if div_yield else None,
            "exDividendDate":    ex_date,
            "lastDividendValue": _safe_float(info.get("lastDividendValue")),
            "payoutFrequency":   freq,
            "sector":            info.get("sector"),
            "history":           history,
        }
        cache_set(cache_key, result)
        return result
    except Exception as exc:
        logger.debug("Div info %s: %s", sym, exc)
        return None


@router.post("/api/market/dividend-data")
def get_dividend_data(body: DivDataRequest):
    syms = [s.upper().strip() for s in body.symbols if s.strip()]
    if not syms:
        return []
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(syms), 10)) as pool:
        futures = {pool.submit(_fetch_div_info, sym): sym for sym in syms}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                results.append(r)
    return results


