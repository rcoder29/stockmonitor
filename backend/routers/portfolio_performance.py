"""Portfolio Performance vs Benchmark — Portfolio (Performance view).

Weighted portfolio cumulative return vs. SPY/QQQ over a lookback period,
with alpha and tracking error.
"""
from typing import List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import numpy as np
import yfinance as yf

from edgar_utils import _session

router = APIRouter()

# ── Portfolio Performance vs Benchmark ───────────────────────────────────────

class PerfRequest(BaseModel):
    symbols: List[str]
    weights: List[float]   # fractional weights summing to 1.0
    period:  str = "1y"    # 3mo | 6mo | 1y | 2y


@router.post("/api/portfolio/performance")
def get_portfolio_performance(body: PerfRequest):
    """
    Return daily cumulative returns (%) for the weighted portfolio,
    SPY, and QQQ over the requested lookback period.
    """
    period_map = {"3mo": "3mo", "6mo": "6mo", "1y": "1y", "2y": "2y"}
    yf_period = period_map.get(body.period, "1y")

    all_syms = list(set(body.symbols + ["SPY", "QQQ"]))
    try:
        raw = yf.download(
            all_syms, period=yf_period, interval="1d",
            auto_adjust=True, progress=False,
            session=_session,
        )
        closes = raw["Close"] if "Close" in raw else raw
    except Exception as e:
        raise HTTPException(500, f"yfinance error: {e}")

    if closes.empty:
        raise HTTPException(500, "No price data returned")

    closes = closes.dropna(how="all").ffill()

    # Drop leading rows where all portfolio symbols are still NaN after ffill
    port_cols = [s for s in body.symbols if s in closes.columns]
    closes = closes.dropna(subset=port_cols, how="all")
    if closes.empty:
        raise HTTPException(500, "No overlapping price data for the requested period")

    # Normalise: pct return from day-0 for each symbol
    norm = (closes / closes.iloc[0] - 1) * 100

    # Weighted portfolio return
    port_series = None
    for sym, w in zip(body.symbols, body.weights):
        if sym not in norm.columns:
            continue
        s = norm[sym].ffill() * w
        port_series = s if port_series is None else port_series + s

    if port_series is None:
        raise HTTPException(500, "Could not compute portfolio series")

    dates = [str(d.date()) for d in closes.index]

    def to_list(series):
        return [None if (v is None or v != v) else round(float(v), 4) for v in series]

    spy = norm["SPY"].ffill() if "SPY" in norm.columns else None
    qqq = norm["QQQ"].ffill() if "QQQ" in norm.columns else None

    port_vals = to_list(port_series)
    spy_vals  = to_list(spy)  if spy  is not None else []
    qqq_vals  = to_list(qqq)  if qqq  is not None else []

    # Summary stats (use last valid value)
    def last_valid(lst):
        for v in reversed(lst):
            if v is not None:
                return v
        return 0.0

    port_ret = last_valid(port_vals)
    spy_ret  = last_valid(spy_vals)
    qqq_ret  = last_valid(qqq_vals)
    alpha_spy = port_ret - spy_ret
    alpha_qqq = port_ret - qqq_ret

    # Tracking error vs SPY (annualised std dev of daily return differences)
    if spy is not None and len(port_series) > 2:
        daily_port = port_series.diff().dropna()
        daily_spy  = spy.diff().dropna()
        common_idx = daily_port.index.intersection(daily_spy.index)
        if len(common_idx) > 1:
            diff = daily_port.loc[common_idx].values - daily_spy.loc[common_idx].values
            tracking_error = float(np.std(diff) * (252 ** 0.5))
        else:
            tracking_error = None
    else:
        tracking_error = None

    return {
        "dates":          dates,
        "portfolio":      port_vals,
        "spy":            spy_vals,
        "qqq":            qqq_vals,
        "portfolio_ret":  port_ret,
        "spy_ret":        spy_ret,
        "qqq_ret":        qqq_ret,
        "alpha_spy":      alpha_spy,
        "alpha_qqq":      alpha_qqq,
        "tracking_error": tracking_error,
        "period":         body.period,
    }

