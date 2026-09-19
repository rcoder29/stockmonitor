"""Market Breadth Dashboard — Markets -> Breadth.

Advance/decline, % above 50/200-day MA, new highs/lows, VIX, and a SPY
options put/call ratio proxy across the screener universe.
"""
import asyncio
from datetime import timedelta
import pandas as pd
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float, SCREENER_UNIVERSE

router = APIRouter()

# ── Market Breadth Dashboard ──────────────────────────────────────────────────

_BREADTH_TTL = timedelta(minutes=30)


@router.get("/api/market/breadth")
async def get_market_breadth():
    cache_key = "market:breadth"
    cached = cache_get(cache_key, _BREADTH_TTL)
    if cached is not None:
        return cached

    loop = asyncio.get_event_loop()

    # Download universe + VIX in parallel
    def _fetch_universe():
        return yf.download(
            SCREENER_UNIVERSE, period="1y", interval="1d",
            auto_adjust=True, progress=False, session=_session,
        )

    def _fetch_vix():
        try:
            v = yf.Ticker("^VIX", session=_session)
            fi = v.fast_info
            price = _safe_float(fi.last_price)
            prev  = _safe_float(fi.previous_close)
            hist  = v.history(period="1y", interval="1d", auto_adjust=True)
            hist_vals = hist["Close"].dropna().values.tolist()[-252:]
            return {"price": round(price, 2), "chg1d": round((price/prev-1)*100, 2) if prev else None,
                    "history": [round(x, 2) for x in hist_vals[-60:]]}
        except Exception:
            return {"price": None}

    def _fetch_pcratio():
        try:
            # Use SPY options put/call volume ratio as proxy
            spy = yf.Ticker("SPY", session=_session)
            exps = spy.options
            if not exps:
                return None
            chain = spy.option_chain(exps[0])
            call_vol = float(chain.calls["volume"].sum())
            put_vol  = float(chain.puts["volume"].sum())
            return round(put_vol / call_vol, 2) if call_vol > 0 else None
        except Exception:
            return None

    raw_data, vix_data, pc_ratio = await asyncio.gather(
        loop.run_in_executor(None, _fetch_universe),
        loop.run_in_executor(None, _fetch_vix),
        loop.run_in_executor(None, _fetch_pcratio),
    )

    closes = raw_data["Close"].dropna(how="all") if isinstance(raw_data.columns, pd.MultiIndex) else raw_data.dropna(how="all")

    above_50 = above_200 = new_highs = new_lows = advances = declines = 0
    total = 0

    for sym in SCREENER_UNIVERSE:
        if sym not in closes.columns:
            continue
        c = closes[sym].dropna()
        if len(c) < 10:
            continue
        total += 1
        last = float(c.iloc[-1])
        prev_close = float(c.iloc[-2]) if len(c) >= 2 else last

        if last > prev_close:
            advances += 1
        elif last < prev_close:
            declines += 1

        if len(c) >= 50:
            ma50 = float(c.iloc[-50:].mean())
            if last > ma50:
                above_50 += 1

        if len(c) >= 200:
            ma200 = float(c.iloc[-200:].mean())
            if last > ma200:
                above_200 += 1

        if len(c) >= 252:
            hi52 = float(c.iloc[-252:].max())
            lo52 = float(c.iloc[-252:].min())
            if last >= hi52 * 0.98:
                new_highs += 1
            if last <= lo52 * 1.02:
                new_lows += 1

    # Rolling A/D line (last 60 days using daily net advances across universe)
    ad_line = []
    ad_cum  = 0
    for i in range(max(0, len(closes) - 60), len(closes)):
        row  = closes.iloc[i]
        prev = closes.iloc[i - 1] if i > 0 else row
        net  = int((row > prev).sum()) - int((row < prev).sum())
        ad_cum += net
        ad_line.append({"date": str(closes.index[i].date()), "value": ad_cum})

    result = {
        "universe_size":   total,
        "advances":        advances,
        "declines":        declines,
        "unchanged":       total - advances - declines,
        "ad_ratio":        round(advances / declines, 2) if declines > 0 else None,
        "above_50ma_pct":  round(above_50  / total * 100, 1) if total else None,
        "above_200ma_pct": round(above_200 / total * 100, 1) if total else None,
        "new_highs":       new_highs,
        "new_lows":        new_lows,
        "hl_ratio":        round(new_highs / (new_highs + new_lows), 2) if (new_highs + new_lows) > 0 else None,
        "vix":             vix_data,
        "put_call_ratio":  pc_ratio,
        "ad_line":         ad_line,
    }
    cache_set(cache_key, result)
    return result


