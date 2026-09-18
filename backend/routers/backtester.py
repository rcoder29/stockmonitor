"""Backtester — Research → Backtester.

Simple single-symbol strategy backtests (MA Crossover, RSI Reversal,
Bollinger Bands) vs. buy & hold, with trade log and summary stats.
"""
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import yfinance as yf

from edgar_utils import _session

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Backtester ────────────────────────────────────────────────────────────────

class BacktestRequest(BaseModel):
    symbol:          str
    strategy:        str   = "ma_cross"  # 'ma_cross' | 'rsi' | 'bb'
    period:          str   = "1y"
    fast_period:     int   = 20
    slow_period:     int   = 50
    rsi_period:      int   = 14
    rsi_oversold:    float = 30.0
    rsi_overbought:  float = 70.0
    bb_period:       int   = 20
    bb_std:          float = 2.0
    initial_capital: float = 10000.0


def _bt_sma(closes, period):
    out = [None] * len(closes)
    for i in range(period - 1, len(closes)):
        out[i] = sum(closes[i - period + 1:i + 1]) / period
    return out


def _bt_rsi(closes, period=14):
    out = [None] * len(closes)
    if len(closes) <= period:
        return out
    gains  = [max(closes[i] - closes[i-1], 0) for i in range(1, len(closes))]
    losses = [max(closes[i-1] - closes[i], 0) for i in range(1, len(closes))]
    ag = sum(gains[:period]) / period
    al = sum(losses[:period]) / period
    out[period] = 100 - 100 / (1 + ag / al) if al > 0 else 100
    for i in range(period + 1, len(closes)):
        ag = (ag * (period - 1) + gains[i - 1]) / period
        al = (al * (period - 1) + losses[i - 1]) / period
        out[i] = 100 - 100 / (1 + ag / al) if al > 0 else 100
    return out


def _bt_bb(closes, period=20, mult=2.0):
    upper = [None] * len(closes)
    lower = [None] * len(closes)
    for i in range(period - 1, len(closes)):
        w = closes[i - period + 1:i + 1]
        sma = sum(w) / period
        std = (sum((x - sma) ** 2 for x in w) / period) ** 0.5
        upper[i] = sma + mult * std
        lower[i] = sma - mult * std
    return upper, lower


@router.post("/api/backtest")
def run_backtest(body: BacktestRequest):
    symbol = body.symbol.upper()
    period_map = {"6mo": "6mo", "1y": "1y", "2y": "2y", "5y": "5y"}
    yf_period = period_map.get(body.period, "1y")

    try:
        hist = yf.Ticker(symbol, session=_session).history(period=yf_period)
        if hist.empty or len(hist) < 60:
            raise HTTPException(400, "Insufficient price history")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Data fetch failed: {e}")

    closes = [float(v) for v in hist["Close"].tolist()]
    dates  = [str(d.date()) for d in hist.index]
    n = len(closes)

    signals = [0] * n  # 1=buy, -1=sell

    if body.strategy == "ma_cross":
        fast = _bt_sma(closes, body.fast_period)
        slow = _bt_sma(closes, body.slow_period)
        in_pos = False
        for i in range(1, n):
            if None in (fast[i], slow[i], fast[i-1], slow[i-1]):
                continue
            if not in_pos and fast[i] > slow[i] and fast[i-1] <= slow[i-1]:
                signals[i] = 1; in_pos = True
            elif in_pos and fast[i] < slow[i] and fast[i-1] >= slow[i-1]:
                signals[i] = -1; in_pos = False

    elif body.strategy == "rsi":
        rsi = _bt_rsi(closes, body.rsi_period)
        in_pos = False
        for i in range(1, n):
            if None in (rsi[i], rsi[i-1]):
                continue
            if not in_pos and rsi[i-1] < body.rsi_oversold <= rsi[i]:
                signals[i] = 1; in_pos = True
            elif in_pos and rsi[i-1] < body.rsi_overbought <= rsi[i]:
                signals[i] = -1; in_pos = False

    elif body.strategy == "bb":
        upper, lower = _bt_bb(closes, body.bb_period, body.bb_std)
        in_pos = False
        for i in range(1, n):
            if None in (lower[i], upper[i], lower[i-1], upper[i-1]):
                continue
            if not in_pos and closes[i] < lower[i] and closes[i-1] >= lower[i-1]:
                signals[i] = 1; in_pos = True
            elif in_pos and closes[i] > upper[i] and closes[i-1] <= upper[i-1]:
                signals[i] = -1; in_pos = False

    # Simulate
    capital = body.initial_capital
    shares = 0.0
    equity = [0.0] * n
    trades = []
    last_buy_value = capital

    for i in range(n):
        if signals[i] == 1 and shares == 0:
            shares = capital / closes[i]
            last_buy_value = capital
            trades.append({"date": dates[i], "action": "BUY",
                           "price": round(closes[i], 2), "value": round(capital, 2)})
            capital = 0
        elif signals[i] == -1 and shares > 0:
            sell_val = shares * closes[i]
            pnl = sell_val - last_buy_value
            trades.append({"date": dates[i], "action": "SELL",
                           "price": round(closes[i], 2), "value": round(sell_val, 2),
                           "pnl": round(pnl, 2), "pnl_pct": round(pnl / last_buy_value * 100, 2)})
            capital = sell_val; shares = 0
        equity[i] = round(capital + shares * closes[i], 2)

    bh_shares = body.initial_capital / closes[0]
    benchmark = [round(bh_shares * c, 2) for c in closes]

    final_eq = equity[-1]
    total_ret = (final_eq / body.initial_capital - 1) * 100
    bh_ret    = (benchmark[-1] / body.initial_capital - 1) * 100

    peak = equity[0]; max_dd = 0.0
    for e in equity:
        if e > peak: peak = e
        dd = (e - peak) / peak * 100 if peak > 0 else 0
        if dd < max_dd: max_dd = dd

    daily_rets = [(equity[i] / equity[i-1] - 1) for i in range(1, n) if equity[i-1] > 0]
    if len(daily_rets) > 1:
        avg_r = sum(daily_rets) / len(daily_rets)
        std_r = (sum((r - avg_r) ** 2 for r in daily_rets) / len(daily_rets)) ** 0.5
        sharpe = (avg_r - 0.045 / 252) / std_r * (252 ** 0.5) if std_r > 0 else 0
    else:
        sharpe = 0.0

    sells = [t for t in trades if t["action"] == "SELL"]
    win_rate = sum(1 for t in sells if t.get("pnl", 0) > 0) / len(sells) * 100 if sells else 0

    return {
        "dates":     dates,
        "equity":    equity,
        "benchmark": benchmark,
        "trades":    trades,
        "stats": {
            "total_return":  round(total_ret, 2),
            "bh_return":     round(bh_ret, 2),
            "alpha":         round(total_ret - bh_ret, 2),
            "max_drawdown":  round(max_dd, 2),
            "sharpe":        round(sharpe, 2),
            "win_rate":      round(win_rate, 1),
            "num_trades":    len(sells),
            "final_equity":  round(final_eq, 2),
        },
    }

