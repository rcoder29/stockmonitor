"""Correlation Matrix — Watchlist -> Correlation.

Pairwise return correlation across a chosen symbol list and lookback
period (POST /api/portfolio/correlation).

main.py has a second, differently-named "Correlation Matrix" section
further down (GET /api/market/correlation, a distinct endpoint/route) —
that one will land in routers/market_correlation.py when extracted.
"""
from datetime import timedelta
from typing import List
import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import cache_get, cache_set

router = APIRouter()

_CORRELATION_TTL = timedelta(minutes=30)

# ── Correlation Matrix ────────────────────────────────────────────────────────

class CorrRequest(BaseModel):
    symbols: List[str]
    period:  str = "3mo"


@router.post("/api/portfolio/correlation")
def get_correlation(body: CorrRequest):
    if len(body.symbols) < 2:
        raise HTTPException(400, "Need at least 2 symbols")
    key = f"corr:{'|'.join(sorted(body.symbols))}:{body.period}"
    cached = cache_get(key, _CORRELATION_TTL)
    if cached is not None:
        return cached
    try:
        raw = yf.download(body.symbols, period=body.period, auto_adjust=True, progress=False)["Close"]
        closes = raw.to_frame(body.symbols[0]) if isinstance(raw, pd.Series) else raw
        closes = closes.ffill().dropna(how="all")
        returns = closes.pct_change().dropna()
        syms = [s for s in body.symbols if s in returns.columns]
        if len(syms) < 2:
            raise HTTPException(400, "Insufficient price data")
        corr = returns[syms].corr()
        matrix = [
            [round(float(corr.loc[s1, s2]), 3) if not np.isnan(corr.loc[s1, s2]) else None
             for s2 in syms]
            for s1 in syms
        ]
        result = {"symbols": syms, "matrix": matrix}
        cache_set(key, result)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


