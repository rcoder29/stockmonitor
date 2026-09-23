"""Range-Bound Screener — Research → Range Screener.

Finds US-listed names trading sideways between a defined support/resistance
band over the last 30, 60, or 90 calendar days, and flags whether the current
price sits near either edge of that band — a potential entry (near support)
or exit/short (near resistance) for a range-trading strategy.

"Range-bound" is quantified two ways, both computed from the same window:
  - Efficiency ratio (Kaufman): net price change over the window divided by
    the sum of every day's absolute move. A stock that ends where it started
    despite churning daily has ER near 0 (range-bound); a stock that trends
    steadily has ER near 1. rangeScore = (1 - ER) * 100, so higher = choppier.
  - Touch counts: how many days the low came within 15% of the window's low
    (support) and the high came within 15% of the window's high (resistance).
    Requiring at least a couple of touches on each side rules out a "range"
    that's really just one outlier spike plus one outlier dip.

Each window also carries `series`: the closing price for every bar in that
same window (oldest first), so the frontend can draw an inline sparkline that
shows exactly the price action the metrics above were computed from — not an
approximation from a separately-fetched chart period.

Universe is the union of three curated lists already in this codebase
(SCREENER_UNIVERSE, the Short Squeeze Scanner's, and the Insider Trading
Feed's) — mega-caps trend too much to range often, so a screener aimed at
finding genuine ranges benefits from the broader small/mid-cap coverage the
other two lists add. A caller can pass their own `symbols` instead.
"""
import logging
from datetime import timedelta

import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import cache_get, cache_set
from edgar_utils import _session, SCREENER_UNIVERSE
from routers.short_squeeze_scanner import _SQUEEZE_UNIVERSE
from routers.insider_trading_feed import _INSIDER_UNIVERSE

logger = logging.getLogger(__name__)
router = APIRouter()

_RANGE_TTL = timedelta(minutes=30)
_WINDOWS = (30, 60, 90)
_TOUCH_ZONE_FRACTION = 0.15   # fraction of the range width counted as "near" an edge
_EDGE_ZONE_PCT = 20.0         # position within bottom/top 20% of the range = near support/resistance
_MAX_UNIVERSE = 400           # guards a caller-supplied `symbols` list from an oversized yf.download

_DEFAULT_UNIVERSE = list(dict.fromkeys(SCREENER_UNIVERSE + _SQUEEZE_UNIVERSE + _INSIDER_UNIVERSE))


def _min_bars_for(days: int) -> int:
    # ~3 trading days/calendar week, floored to stay usable for a recent IPO.
    return max(6, round(days / 7 * 3))


def _window_metrics(h_sub: pd.Series, l_sub: pd.Series, c_sub: pd.Series, price: float, days: int) -> dict | None:
    if len(c_sub) < _min_bars_for(days) or h_sub.empty or l_sub.empty:
        return None

    hi, lo = float(h_sub.max()), float(l_sub.min())
    if hi <= lo or lo <= 0:
        return None

    width_pct = (hi - lo) / lo * 100
    pos_pct = max(0.0, min(100.0, (price - lo) / (hi - lo) * 100))

    closes = c_sub.values.astype(float)
    net = abs(closes[-1] - closes[0])
    path = float(np.abs(np.diff(closes)).sum())
    efficiency_ratio = (net / path) if path > 0 else 1.0
    range_score = round((1 - efficiency_ratio) * 100, 1)

    tol = (hi - lo) * _TOUCH_ZONE_FRACTION
    touches_low = int((l_sub <= lo + tol).sum())
    touches_high = int((h_sub >= hi - tol).sum())

    if pos_pct <= _EDGE_ZONE_PCT:
        signal = "near_support"
    elif pos_pct >= 100 - _EDGE_ZONE_PCT:
        signal = "near_resistance"
    else:
        signal = "neutral"

    entry = target = stop = risk_reward = None
    if signal == "near_support":
        entry, target, stop = price, hi, lo - tol * 0.5
        if entry > stop:
            risk_reward = round((target - entry) / (entry - stop), 2)
    elif signal == "near_resistance":
        entry, target, stop = price, lo, hi + tol * 0.5
        if stop > entry:
            risk_reward = round((entry - target) / (stop - entry), 2)

    return {
        "high": round(hi, 2), "low": round(lo, 2),
        "widthPct": round(width_pct, 1), "positionPct": round(pos_pct, 1),
        "rangeScore": range_score, "touchesLow": touches_low, "touchesHigh": touches_high,
        "signal": signal,
        "entry": round(entry, 2) if entry is not None else None,
        "target": round(target, 2) if target is not None else None,
        "stop": round(stop, 2) if stop is not None else None,
        "riskReward": risk_reward,
        "series": [round(v, 2) for v in closes.tolist()],
    }


def _compute_range_data(universe: list[str]) -> list[dict]:
    try:
        raw = yf.download(universe, period="7mo", interval="1d", auto_adjust=True,
                          progress=False, session=_session, group_by="column")
    except Exception as e:
        raise HTTPException(500, str(e))

    if "Close" not in raw or raw.empty:
        return []
    highs, lows, closes = raw["High"], raw["Low"], raw["Close"]

    results = []
    for sym in universe:
        if sym not in closes.columns:
            continue
        h, l, c = highs[sym].dropna(), lows[sym].dropna(), closes[sym].dropna()
        if len(c) < _min_bars_for(_WINDOWS[0]) or c.empty:
            continue

        last_date, price = c.index[-1], float(c.iloc[-1])
        windows = {}
        for days in _WINDOWS:
            cutoff = last_date - pd.Timedelta(days=days)
            metrics = _window_metrics(h[h.index >= cutoff], l[l.index >= cutoff], c[c.index >= cutoff], price, days)
            if metrics:
                windows[str(days)] = metrics

        if windows:
            name = None
            q = cache_get(f"quote:{sym}", timedelta(hours=6))
            if q:
                name = q.get("name")
            results.append({"symbol": sym, "name": name, "price": round(price, 2), "windows": windows})

    return results


def _default_universe_data() -> list[dict]:
    cache_key = "range_screen:universe"
    cached = cache_get(cache_key, _RANGE_TTL)
    if cached is not None:
        return cached
    data = _compute_range_data(_DEFAULT_UNIVERSE)
    cache_set(cache_key, data)
    return data


@router.get("/api/screener/range-bound")
def range_bound_screener(
    window: int = 60,
    min_width: float = 8.0,
    max_width: float = 100.0,
    min_touches: int = 2,
    min_score: float = 40.0,
    signal: str = "any",
    symbols: str = "",
):
    if window not in _WINDOWS:
        raise HTTPException(400, f"window must be one of {_WINDOWS}")
    valid_signals = {"any", "near_support", "near_resistance", "neutral"}
    if signal not in valid_signals:
        raise HTTPException(400, f"signal must be one of {sorted(valid_signals)}")

    if symbols.strip():
        universe = [s.strip().upper() for s in symbols.split(",") if s.strip()][:_MAX_UNIVERSE]
        if not universe:
            raise HTTPException(400, "symbols must contain at least one ticker")
        data = _compute_range_data(universe)     # small/custom list — not worth caching
    else:
        data = _default_universe_data()

    key = str(window)
    rows = []
    for row in data:
        w = row["windows"].get(key)
        if not w:
            continue
        if not (min_width <= w["widthPct"] <= max_width):
            continue
        if w["touchesLow"] < min_touches or w["touchesHigh"] < min_touches:
            continue
        if w["rangeScore"] < min_score:
            continue
        if signal != "any" and w["signal"] != signal:
            continue
        rows.append({
            "symbol": row["symbol"], "name": row["name"], "price": row["price"],
            "windowDays": window, **w,
        })

    rows.sort(key=lambda r: r["rangeScore"], reverse=True)
    return rows[:200]
