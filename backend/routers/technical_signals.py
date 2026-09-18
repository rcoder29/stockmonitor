"""Multi-timeframe Technical Signals — Research → Screener (Signals tab).

Trend/RSI/MACD/Bollinger %B across four rolling windows (1D/1W/1M/3M).
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
from typing import List
import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import APIRouter
from pydantic import BaseModel

from database import cache_get, cache_set
from edgar_utils import _session, _calc_rsi

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Multi-timeframe Technical Signals ─────────────────────────────────────────

_SIGNAL_TTL = timedelta(minutes=30)

def _ema_np(arr: np.ndarray, period: int) -> np.ndarray:
    k = 2.0 / (period + 1)
    out = np.full(len(arr), np.nan)
    if len(arr) < period:
        return out
    out[period - 1] = float(arr[:period].mean())
    for i in range(period, len(arr)):
        out[i] = arr[i] * k + out[i - 1] * (1 - k)
    return out


def _signal_for(closes: np.ndarray, short_ma: int, long_ma: int, rsi_period: int) -> dict:
    n = len(closes)
    if n < long_ma + 1:
        return {"trend": "neutral", "rsi": None, "macd": "neutral", "bb_pct": None}

    sma_short = float(np.mean(closes[-short_ma:]))
    sma_long  = float(np.mean(closes[-long_ma:]))
    last      = float(closes[-1])

    if last > sma_short > sma_long:
        trend = "bullish"
    elif last < sma_short < sma_long:
        trend = "bearish"
    else:
        trend = "neutral"

    # RSI
    ser   = pd.Series(closes)
    rsi_s = _calc_rsi(ser, rsi_period)
    rsi_v = None if rsi_s.empty else float(rsi_s.iloc[-1])

    # MACD (12/26 EMA crossover direction)
    ema12 = _ema_np(closes, 12)
    ema26 = _ema_np(closes, 26)
    macd_line = ema12 - ema26
    macd = "neutral"
    if not np.isnan(macd_line[-1]) and not np.isnan(macd_line[-2]):
        if macd_line[-1] > 0 and macd_line[-1] > macd_line[-2]:
            macd = "bullish"
        elif macd_line[-1] < 0 and macd_line[-1] < macd_line[-2]:
            macd = "bearish"

    # Bollinger %B (20-period)
    bb_pct = None
    if n >= 20:
        roll   = pd.Series(closes).rolling(20)
        mid    = float(roll.mean().iloc[-1])
        std    = float(roll.std().iloc[-1])
        if std > 0:
            bb_pct = round((last - (mid - 2 * std)) / (4 * std) * 100, 1)

    return {
        "trend":  trend,
        "rsi":    round(rsi_v, 1) if rsi_v is not None else None,
        "macd":   macd,
        "bb_pct": bb_pct,
    }


def _compute_signals(symbol: str) -> dict:
    cache_key = f"signals:{symbol}"
    cached = cache_get(cache_key, _SIGNAL_TTL)
    if cached is not None:
        return cached

    try:
        t = yf.Ticker(symbol, session=_session)
        hist = t.history(period="1y", interval="1d", auto_adjust=True)
        if hist.empty:
            return {"symbol": symbol, "error": "no data"}
        closes = hist["Close"].dropna().values.astype(float)

        result = {
            "symbol": symbol,
            "1D":  _signal_for(closes[-20:],  5,  10, 5)  if len(closes) >= 10 else None,
            "1W":  _signal_for(closes[-63:],  10, 20, 9)  if len(closes) >= 20 else None,
            "1M":  _signal_for(closes,        20, 50, 14) if len(closes) >= 50 else None,
            "3M":  _signal_for(closes,        50, 200, 14) if len(closes) >= 200 else None,
        }
        cache_set(cache_key, result)
        return result
    except Exception as e:
        logger.warning("signals failed for %s: %s", symbol, e)
        return {"symbol": symbol, "error": str(e)}


class SignalsRequest(BaseModel):
    symbols: List[str]


@router.post("/api/screener/signals")
def get_signals(req: SignalsRequest):
    symbols = [s.upper().strip() for s in req.symbols[:25]]
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_compute_signals, s): s for s in symbols}
        results = []
        for f in as_completed(futures):
            try:
                results.append(f.result())
            except Exception as e:
                results.append({"symbol": futures[f], "error": str(e)})
    results.sort(key=lambda r: symbols.index(r["symbol"]) if r["symbol"] in symbols else 999)
    return results
