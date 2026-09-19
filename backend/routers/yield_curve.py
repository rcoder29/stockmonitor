"""Yield Curve & Rates — Markets -> Yield Curve.

Treasury yields across maturities plus DXY, and the 10Y-13W spread used
for the inversion signal.
"""
import asyncio
from datetime import timedelta
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _safe_float

router = APIRouter()

# ── Yield Curve & Rates ───────────────────────────────────────────────────────

_RATES_TTL = timedelta(minutes=30)

@router.get("/api/market/rates")
async def get_market_rates():
    cached = cache_get("market:rates", _RATES_TTL)
    if cached:
        return cached

    loop = asyncio.get_event_loop()
    RATE_TICKERS = {"t13w": "^IRX", "t5y": "^FVX", "t10y": "^TNX", "t30y": "^TYX", "dxy": "DX-Y.NYB"}

    async def fetch_one(key, ticker_sym):
        try:
            tk = yf.Ticker(ticker_sym)
            fi = await loop.run_in_executor(None, lambda: tk.fast_info)
            return key, _safe_float(getattr(fi, "last_price", None))
        except Exception:
            return key, None

    import asyncio as _aio
    tasks = [fetch_one(k, v) for k, v in RATE_TICKERS.items()]
    values = dict(await _aio.gather(*tasks))

    # 60-day history for 10Y and 13W for sparklines
    def fetch_hist(sym):
        try:
            df = yf.download(sym, period="60d", interval="1d", progress=False, auto_adjust=True)
            if df.empty:
                return []
            closes = df["Close"].dropna()
            return [round(float(v), 3) for v in closes.values]
        except Exception:
            return []

    hist_10y = await loop.run_in_executor(None, lambda: fetch_hist("^TNX"))
    hist_13w = await loop.run_in_executor(None, lambda: fetch_hist("^IRX"))

    t10y = values.get("t10y")
    t13w = values.get("t13w")
    spread_10y_13w = round(t10y - t13w, 3) if t10y and t13w else None

    result = {
        "yields": {
            "t13w": values.get("t13w"),
            "t5y":  values.get("t5y"),
            "t10y": values.get("t10y"),
            "t30y": values.get("t30y"),
        },
        "dxy": values.get("dxy"),
        "spread_10y_13w": spread_10y_13w,
        "inverted": spread_10y_13w is not None and spread_10y_13w < 0,
        "hist_10y": hist_10y,
        "hist_13w": hist_13w,
    }
    cache_set("market:rates", result)
    return result


