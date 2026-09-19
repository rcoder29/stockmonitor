"""Sector Momentum Ranker — Markets -> Sector Momentum.

Multi-timeframe relative strength vs. SPY, momentum acceleration, and a
composite rank across the 11 SPDR sector ETFs.
"""
import asyncio
from datetime import datetime, timedelta
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import cache_get, cache_set
from edgar_utils import _session, _SECTOR_ETFS

router = APIRouter()

# ── Sector Momentum Ranker ─────────────────────────────────────────────────────

_MOMENTUM_TTL = timedelta(minutes=30)


@router.get("/api/sectors/momentum")
async def get_sector_momentum():
    cache_key = "sectors:momentum"
    cached = cache_get(cache_key, _MOMENTUM_TTL)
    if cached is not None:
        return cached

    syms = [s["symbol"] for s in _SECTOR_ETFS] + ["SPY"]
    loop = asyncio.get_event_loop()

    try:
        raw = await loop.run_in_executor(
            None, lambda: yf.download(syms, period="1y", interval="1d",
                                      auto_adjust=True, progress=False, session=_session)
        )
        closes = raw["Close"].dropna(how="all") if isinstance(raw.columns, pd.MultiIndex) else raw.dropna(how="all")
    except Exception as e:
        raise HTTPException(500, f"Data fetch failed: {e}")

    today = datetime.utcnow()
    ytd_start = datetime(today.year, 1, 1)

    def pct(sym, days):
        if sym not in closes.columns or len(closes[sym].dropna()) <= days:
            return None
        c = closes[sym].dropna()
        return round((float(c.iloc[-1]) / float(c.iloc[-1 - days]) - 1) * 100, 2)

    def ytd(sym):
        if sym not in closes.columns:
            return None
        c = closes[sym].dropna()
        start_idx = c.index.searchsorted(ytd_start)
        if start_idx >= len(c):
            return None
        return round((float(c.iloc[-1]) / float(c.iloc[start_idx]) - 1) * 100, 2)

    spy_1m  = pct("SPY", 21)  or 0
    spy_3m  = pct("SPY", 63)  or 0
    spy_6m  = pct("SPY", 126) or 0
    spy_ytd = ytd("SPY")      or 0

    results = []
    for s in _SECTOR_ETFS:
        sym  = s["symbol"]
        m1   = pct(sym, 21)
        m3   = pct(sym, 63)
        m6   = pct(sym, 126)
        mYTD = ytd(sym)
        m1w  = pct(sym, 5)

        # Relative strength vs SPY
        rs_1m  = round(m1  - spy_1m,  2) if m1  is not None else None
        rs_3m  = round(m3  - spy_3m,  2) if m3  is not None else None
        rs_6m  = round(m6  - spy_6m,  2) if m6  is not None else None
        rs_ytd = round(mYTD - spy_ytd, 2) if mYTD is not None else None

        # Momentum acceleration: 1M vs 3M (positive = accelerating)
        accel = round((m1 or 0) - ((m3 or 0) / 3), 2) if m1 is not None and m3 is not None else None

        # Composite score: rank across multiple periods
        composite = round(
            0.35 * (m1 or 0) + 0.30 * (m3 or 0) / 3 + 0.20 * (m6 or 0) / 6 + 0.15 * (mYTD or 0),
            2,
        )

        results.append({
            **s,
            "chg1w":    m1w,
            "chg1m":    m1,
            "chg3m":    m3,
            "chg6m":    m6,
            "chgYTD":   mYTD,
            "rs_1m":    rs_1m,
            "rs_3m":    rs_3m,
            "rs_6m":    rs_6m,
            "rs_ytd":   rs_ytd,
            "accel":    accel,
            "composite": composite,
        })

    # Add ranks (1 = best) for each period
    for period in ("chg1m", "chg3m", "chg6m", "chgYTD", "composite"):
        valid = sorted([r for r in results if r.get(period) is not None], key=lambda x: -x[period])
        for rank, r in enumerate(valid, 1):
            r[f"rank_{period}"] = rank

    results.sort(key=lambda r: -(r.get("composite") or -999))
    cache_set(cache_key, results)
    return results


