"""Portfolio Risk Dashboard — Portfolio → Risk view.

Beta, Sharpe/Sortino, max drawdown, historical VaR, and a correlation
matrix across current holdings.

_compute_portfolio_risk and _sanitize_nan are also used by
routers/net_exposure.py (imported there directly — no circularity,
since this module doesn't depend on net_exposure.py).
"""
import asyncio
import logging
import math
from datetime import timedelta
import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import db_session, cache_get, cache_set, PortfolioPosition
from edgar_utils import _session

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Portfolio Risk Dashboard ───────────────────────────────────────────────────

_RISK_TTL = timedelta(minutes=30)


def _sanitize_nan(obj):
    """Recursively replace NaN/Infinity floats with None — pandas .cov()/.corr()
    on sparse, gappy data readily produces NaN, which json.dumps (allow_nan=False
    under Starlette) refuses to serialize."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _sanitize_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_nan(v) for v in obj]
    return obj


def _compute_portfolio_risk() -> dict:
    cache_key = "portfolio:risk"
    cached = cache_get(cache_key, _RISK_TTL)
    if cached is not None:
        return cached

    with db_session() as db:
        positions = db.query(PortfolioPosition).all()
        holdings  = [{"symbol": p.symbol, "shares": p.shares, "avg_cost": p.avg_cost} for p in positions]

    if not holdings:
        return {"error": "No portfolio positions"}

    symbols = [h["symbol"] for h in holdings]

    try:
        raw = yf.download(symbols + ["SPY"], period="1y", interval="1d",
                          auto_adjust=True, progress=False, session=_session)
        closes = raw["Close"].dropna(how="all")
    except Exception as e:
        raise ValueError(f"Data fetch failed: {e}")

    # how="all" (not the default "any") — a single illiquid/gappy symbol among
    # many holdings shouldn't wipe out every row just because it has one NaN.
    rets = closes.pct_change().dropna(how="all")
    spy_ret = rets.get("SPY", pd.Series(dtype=float))

    # Per-holding metrics
    holdings_out = []
    port_prices  = {}
    for h in holdings:
        sym = h["symbol"]
        if sym not in closes.columns:
            continue
        sym_closes = closes[sym].dropna()
        if sym_closes.empty:
            continue
        price = float(sym_closes.iloc[-1])
        port_prices[sym] = price
        mkt_val = price * h["shares"]

        if sym in rets.columns and len(spy_ret) > 10:
            s_ret = rets[sym].dropna()
            cov   = s_ret.cov(spy_ret.reindex(s_ret.index).dropna())
            var_spy = spy_ret.var()
            beta  = round(cov / var_spy, 2) if var_spy > 0 and math.isfinite(cov) else None
        else:
            beta = None

        holdings_out.append({
            "symbol":   sym,
            "shares":   h["shares"],
            "avg_cost": h["avg_cost"],
            "price":    round(price, 2),
            "mkt_val":  round(mkt_val, 2),
            "beta":     beta,
        })

    total_val = sum(h["mkt_val"] for h in holdings_out) or 1.0
    for h in holdings_out:
        h["weight"]        = round(h["mkt_val"] / total_val * 100, 1)
        h["beta_adj_exp"]  = round(h["beta"] * h["weight"] / 100, 3) if h["beta"] is not None else None

    # Portfolio return series (value-weighted)
    port_ret = pd.Series(0.0, index=rets.index)
    for h in holdings_out:
        sym = h["symbol"]
        if sym in rets.columns:
            w = h["mkt_val"] / total_val
            port_ret = port_ret.add(rets[sym].reindex(port_ret.index).fillna(0) * w)

    port_ret = port_ret.dropna()
    if port_ret.empty:
        raise ValueError("Not enough overlapping price history across holdings to compute risk")

    # Sharpe (annualised, rf=0)
    sharpe  = round(float(port_ret.mean() / port_ret.std() * np.sqrt(252)), 2) if port_ret.std() > 0 else None

    # Sortino (downside std)
    down    = port_ret[port_ret < 0]
    sortino = round(float(port_ret.mean() / down.std() * np.sqrt(252)), 2) if len(down) > 1 and down.std() > 0 else None

    # Max drawdown
    cum   = (1 + port_ret).cumprod()
    roll_max = cum.cummax()
    dd    = (cum - roll_max) / roll_max
    max_dd = round(float(dd.min()) * 100, 2)

    # VaR (historical, 1-day)
    var95 = round(-float(np.percentile(port_ret, 5)) * total_val, 2)
    var99 = round(-float(np.percentile(port_ret, 1)) * total_val, 2)

    # Weighted portfolio beta
    port_beta = round(sum(
        h["beta_adj_exp"] for h in holdings_out if h["beta_adj_exp"] is not None
    ), 2)

    # Correlation matrix (symbols with enough data)
    valid_syms = [h["symbol"] for h in holdings_out if h["symbol"] in rets.columns]
    corr_matrix = {}
    if len(valid_syms) > 1:
        corr_df = rets[valid_syms].corr().round(2)
        corr_matrix = corr_df.to_dict()

    result = {
        "total_value":  round(total_val, 2),
        "portfolio_beta": port_beta,
        "sharpe":       sharpe,
        "sortino":      sortino,
        "max_drawdown_pct": max_dd,
        "var95":        var95,
        "var99":        var99,
        "holdings":     holdings_out,
        "correlation":  corr_matrix,
    }
    result = _sanitize_nan(result)
    cache_set(cache_key, result)
    return result


@router.get("/api/portfolio/risk")
async def get_portfolio_risk():
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, _compute_portfolio_risk)
    except ValueError as e:
        raise HTTPException(400, str(e))



