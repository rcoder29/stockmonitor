"""Rich Earnings Calendar — Watchlist -> Earnings+.

Next earnings date, historical EPS beat rate, pre-earnings price drift,
and expected move from the nearest ATM straddle.
"""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import List
import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import APIRouter
from pydantic import BaseModel

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Rich Earnings Calendar ─────────────────────────────────────────────────────

_RICH_EARN_TTL = timedelta(hours=2)


def _enrich_earnings(symbol: str) -> dict | None:
    cache_key = f"rich_earn:{symbol}"
    cached = cache_get(cache_key, _RICH_EARN_TTL)
    if cached is not None:
        return cached

    try:
        t = yf.Ticker(symbol, session=_session)

        # Next earnings date — current yfinance returns .calendar as a plain
        # dict (not a DataFrame); "Earnings Average" is the EPS consensus.
        next_date = None
        eps_estimate = None
        try:
            cal = t.calendar
            if cal and "Earnings Date" in cal:
                dates = cal["Earnings Date"]
                iterable = dates if hasattr(dates, "__iter__") and not isinstance(dates, str) else [dates]
                for d in iterable:
                    try:
                        next_date = str(d.date()) if hasattr(d, "date") else str(d)
                        break
                    except Exception:
                        pass
            if cal and "Earnings Average" in cal:
                eps_estimate = _safe_float(cal.get("Earnings Average"))
        except Exception:
            pass

        if not next_date:
            return None

        days_away = (pd.to_datetime(next_date).date() - datetime.utcnow().date()).days

        # Historical beat rate + earnings dates for pre-drift
        beat_count = total_count = 0
        earn_dates = []
        try:
            eh = t.earnings_history
            if eh is not None and not eh.empty:
                for idx, row in eh.iterrows():
                    est = _safe_float(row.get("epsEstimate"))
                    act = _safe_float(row.get("epsActual"))
                    if est is not None and act is not None:
                        total_count += 1
                        if act >= est:
                            beat_count += 1
                    dt = idx.date() if hasattr(idx, "date") else None
                    if dt:
                        earn_dates.append(dt)
        except Exception:
            pass

        beat_rate = round(beat_count / total_count * 100) if total_count > 0 else None

        # Pre-earnings drift: avg return 5 days before each historical earnings date
        pre_drift_pct = None
        try:
            hist = t.history(period="2y", interval="1d", auto_adjust=True)
            if not hist.empty and earn_dates:
                drifts = []
                for ed in earn_dates:
                    idx_pos = hist.index.searchsorted(pd.Timestamp(ed))
                    if idx_pos >= 5:
                        pre  = float(hist["Close"].iloc[idx_pos - 5])
                        eve  = float(hist["Close"].iloc[idx_pos - 1])
                        if pre > 0:
                            drifts.append((eve / pre - 1) * 100)
                if drifts:
                    pre_drift_pct = round(float(np.mean(drifts)), 2)
        except Exception:
            pass

        # Expected move from nearest expiry ATM straddle
        expected_move_pct = straddle_cost = None
        try:
            price = float(t.fast_info.last_price)
            exps  = t.options
            if exps and price:
                chain = t.option_chain(exps[0])
                calls, puts = chain.calls, chain.puts
                def _mid(row):
                    b = float(row.get("bid", 0) or 0)
                    a = float(row.get("ask", 0) or 0)
                    lp = float(row.get("lastPrice", 0) or 0)
                    return (b + a) / 2 if a > b > 0 else lp
                atm_c = calls.loc[(calls["strike"] - price).abs().idxmin()]
                atm_p = puts.loc[(puts["strike"] - price).abs().idxmin()]
                cost  = _mid(atm_c) + _mid(atm_p)
                if cost > 0:
                    straddle_cost      = round(cost, 2)
                    expected_move_pct  = round(cost / price * 100, 1)
        except Exception:
            pass

        result = {
            "symbol":            symbol,
            "next_date":         next_date,
            "days_away":         days_away,
            "eps_estimate":      eps_estimate,
            "beat_rate":         beat_rate,
            "beat_count":        beat_count,
            "total_count":       total_count,
            "expected_move_pct": expected_move_pct,
            "straddle_cost":     straddle_cost,
            "pre_drift_pct":     pre_drift_pct,
        }
        cache_set(cache_key, result)
        return result
    except Exception as e:
        logger.debug("rich earnings %s: %s", symbol, e)
        return None


class RichCalendarRequest(BaseModel):
    symbols: List[str]


@router.post("/api/earnings/rich-calendar")
async def get_rich_calendar(req: RichCalendarRequest):
    symbols = [s.upper().strip() for s in req.symbols[:60]]
    loop    = asyncio.get_event_loop()
    results = await asyncio.gather(*[loop.run_in_executor(None, _enrich_earnings, s) for s in symbols])
    out = [r for r in results if r is not None]
    out.sort(key=lambda r: r.get("days_away", 9999))
    return out


