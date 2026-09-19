"""Portfolio Optimizer (Efficient Frontier) — Portfolio -> Optimizer.

Monte Carlo + gradient-based max-Sharpe / min-vol portfolios and an
efficient frontier for current holdings.
"""
import asyncio
from datetime import timedelta
import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import db_session, cache_get, cache_set, PortfolioPosition
from edgar_utils import _session

router = APIRouter()

# ── Portfolio Optimizer (Efficient Frontier) ───────────────────────────────────

_OPTIMIZE_TTL = timedelta(minutes=30)


def _min_vol_weights(ann_cov: np.ndarray, n: int) -> np.ndarray | None:
    """Minimum-variance portfolio via analytical Lagrange (long-only clamped via 200 SLSQP-free iterations)."""
    # Use gradient descent projection (simple, no scipy needed)
    w = np.ones(n) / n
    lr = 0.01
    for _ in range(2000):
        grad = 2 * ann_cov @ w
        w = w - lr * grad
        w = np.maximum(w, 0)
        s = w.sum()
        if s > 0:
            w /= s
        else:
            w = np.ones(n) / n
    return w


def _max_sharpe_weights(ann_rets: np.ndarray, ann_cov: np.ndarray, n: int) -> np.ndarray | None:
    """Max-Sharpe portfolio via gradient ascent on Sharpe."""
    w = np.ones(n) / n
    lr = 0.005
    for _ in range(3000):
        port_r = float(np.dot(w, ann_rets))
        port_v = float(np.sqrt(w @ ann_cov @ w))
        if port_v < 1e-8:
            break
        grad_r = ann_rets
        grad_v = (ann_cov @ w) / port_v
        grad_sharpe = (grad_r * port_v - port_r * grad_v) / (port_v ** 2)
        w = w + lr * grad_sharpe
        w = np.maximum(w, 0)
        s = w.sum()
        if s > 0:
            w /= s
    return w


def _compute_efficient_frontier() -> dict:
    cache_key = "portfolio:frontier"
    cached = cache_get(cache_key, _OPTIMIZE_TTL)
    if cached is not None:
        return cached

    with db_session() as db:
        positions = db.query(PortfolioPosition).all()
        holdings  = [{"symbol": p.symbol, "shares": p.shares} for p in positions]

    if len(holdings) < 2:
        raise ValueError("Need at least 2 portfolio positions to optimize")

    symbols = [h["symbol"] for h in holdings]
    raw = yf.download(symbols, period="1y", interval="1d", auto_adjust=True, progress=False, session=_session)
    closes = raw["Close"].dropna(how="all") if isinstance(raw.columns, pd.MultiIndex) else raw.dropna(how="all")

    rets = closes.pct_change().dropna()
    valid = [s for s in symbols if s in rets.columns and rets[s].count() >= 100]
    if len(valid) < 2:
        raise ValueError("Insufficient price history for optimization (need ≥2 symbols with 100+ days)")

    rets     = rets[valid]
    n        = len(valid)
    ann_rets = rets.mean().values * 252
    ann_cov  = rets.cov().values  * 252

    # Current weights by market value
    prices    = {s: float(closes[s].dropna().iloc[-1]) for s in valid}
    vals      = {h["symbol"]: prices[h["symbol"]] * h["shares"] for h in holdings if h["symbol"] in prices}
    total_val = sum(vals.values()) or 1.0
    cur_w     = np.array([vals.get(s, 0) / total_val for s in valid])
    cur_r     = float(np.dot(cur_w, ann_rets))
    cur_v     = float(np.sqrt(cur_w @ ann_cov @ cur_w))

    # Monte Carlo
    rng      = np.random.default_rng(42)
    mc_w     = rng.dirichlet(np.ones(n), size=4000)
    mc_r     = mc_w @ ann_rets
    mc_v     = np.sqrt(np.einsum("ij,jk,ik->i", mc_w, ann_cov, mc_w))
    mc_sh    = np.where(mc_v > 0, mc_r / mc_v, 0)
    mc_points = [{"r": round(float(mc_r[i])*100, 2), "v": round(float(mc_v[i])*100, 2), "sh": round(float(mc_sh[i]), 2)}
                 for i in range(len(mc_r))]

    # Optimized portfolios
    ms_w  = _max_sharpe_weights(ann_rets, ann_cov, n)
    mv_w  = _min_vol_weights(ann_cov, n)

    def port_stats(w):
        r = float(np.dot(w, ann_rets))
        v = float(np.sqrt(w @ ann_cov @ w))
        return round(r * 100, 2), round(v * 100, 2), round(r / v if v > 0 else 0, 2)

    ms_r, ms_v, ms_sh = port_stats(ms_w)
    mv_r, mv_v, mv_sh = port_stats(mv_w)

    # Frontier: vary target return, find min-vol portfolio at each level
    frontier = []
    r_min = float(np.min(ann_rets))
    r_max = float(np.max(ann_rets))
    for target in np.linspace(r_min, r_max, 30):
        # Constrained descent: minimize vol subject to return = target (soft constraint)
        w = np.ones(n) / n
        lr = 0.008
        for _ in range(1500):
            port_r = float(np.dot(w, ann_rets))
            port_v = float(np.sqrt(w @ ann_cov @ w))
            grad_v = (ann_cov @ w) / (port_v + 1e-10)
            penalty_grad = 2 * 50 * (port_r - target) * ann_rets
            w = w - lr * (grad_v - penalty_grad)
            w = np.maximum(w, 0)
            s = w.sum()
            if s > 0:
                w /= s
        r, v, _ = port_stats(w)
        if abs(r - target * 100) < 5:
            frontier.append({"r": r, "v": v})

    # Deduplicate and sort frontier
    seen = set()
    clean_frontier = []
    for pt in sorted(frontier, key=lambda p: p["r"]):
        key = round(pt["r"])
        if key not in seen:
            seen.add(key)
            clean_frontier.append(pt)

    result = {
        "symbols": valid,
        "current": {
            "weights":     {valid[i]: round(float(cur_w[i]), 3) for i in range(n)},
            "return_pct":  round(cur_r * 100, 2),
            "vol_pct":     round(cur_v * 100, 2),
            "sharpe":      round(cur_r / cur_v if cur_v > 0 else 0, 2),
        },
        "max_sharpe": {
            "weights":    {valid[i]: round(float(ms_w[i]), 3) for i in range(n)},
            "return_pct": ms_r, "vol_pct": ms_v, "sharpe": ms_sh,
        },
        "min_vol": {
            "weights":    {valid[i]: round(float(mv_w[i]), 3) for i in range(n)},
            "return_pct": mv_r, "vol_pct": mv_v, "sharpe": mv_sh,
        },
        "frontier":     clean_frontier,
        "monte_carlo":  mc_points[:600],
    }
    cache_set(cache_key, result)
    return result


@router.get("/api/portfolio/optimize")
async def get_portfolio_optimize():
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, _compute_efficient_frontier)
    except ValueError as e:
        raise HTTPException(400, str(e))


