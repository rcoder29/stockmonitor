from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import yfinance as yf
import logging
from curl_cffi import requests as curl_requests

# Corporate proxy uses a self-signed cert — reuse one session with SSL disabled
_session = curl_requests.Session(verify=False, impersonate="chrome")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Stock Monitor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache fundamentals for 5 minutes — they change slowly
_fund_cache: dict[str, tuple[dict, datetime]] = {}
_CACHE_TTL = timedelta(minutes=5)


def _safe_float(val) -> float | None:
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _fetch_fundamentals(sym: str) -> dict:
    now = datetime.utcnow()
    cached = _fund_cache.get(sym)
    if cached and (now - cached[1]) < _CACHE_TTL:
        return cached[0]

    try:
        info = yf.Ticker(sym, session=_session).info
        data = {
            "name": info.get("shortName") or info.get("longName") or sym,
            "peRatio": _safe_float(info.get("trailingPE")),
            "forwardPE": _safe_float(info.get("forwardPE")),
            "eps": _safe_float(info.get("trailingEps")),
            "dividendYield": _safe_float(info.get("dividendYield")),
            "beta": _safe_float(info.get("beta")),
            "revenue": _safe_float(info.get("totalRevenue")),
            "profitMargin": _safe_float(info.get("profitMargins")),
            "roe": _safe_float(info.get("returnOnEquity")),
            "debtToEquity": _safe_float(info.get("debtToEquity")),
            "priceToBook": _safe_float(info.get("priceToBook")),
        }
    except Exception as exc:
        logger.warning("Fundamentals fetch failed for %s: %s", sym, exc)
        data = {"name": sym}

    _fund_cache[sym] = (data, now)
    return data


def _fetch_quote(sym: str) -> dict:
    try:
        ticker = yf.Ticker(sym, session=_session)
        fi = ticker.fast_info

        price = _safe_float(fi.last_price)
        prev = _safe_float(fi.previous_close)
        change = (price - prev) if price is not None and prev is not None else None
        change_pct = (change / prev * 100) if change is not None and prev else None

        fund = _fetch_fundamentals(sym)

        return {
            "symbol": sym,
            "name": fund.get("name", sym),
            "price": price,
            "previousClose": prev,
            "change": change,
            "changePercent": change_pct,
            "dayHigh": _safe_float(fi.day_high),
            "dayLow": _safe_float(fi.day_low),
            "volume": _safe_float(fi.last_volume),
            "week52High": _safe_float(fi.year_high),
            "week52Low": _safe_float(fi.year_low),
            "marketCap": _safe_float(fi.market_cap),
            "peRatio": fund.get("peRatio"),
            "forwardPE": fund.get("forwardPE"),
            "eps": fund.get("eps"),
            "dividendYield": fund.get("dividendYield"),
            "beta": fund.get("beta"),
            "revenue": fund.get("revenue"),
            "profitMargin": fund.get("profitMargin"),
            "roe": fund.get("roe"),
            "debtToEquity": fund.get("debtToEquity"),
            "priceToBook": fund.get("priceToBook"),
            "error": None,
        }
    except Exception as exc:
        logger.warning("Error fetching %s: %s", sym, exc)
        return {"symbol": sym, "error": str(exc)}


@app.get("/api/quotes")
def get_quotes(symbols: str):
    tickers = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not tickers:
        return []

    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=min(len(tickers), 10)) as pool:
        futures = {pool.submit(_fetch_quote, sym): sym for sym in tickers}
        for future in as_completed(futures):
            data = future.result()
            results[data["symbol"]] = data

    return [results.get(sym, {"symbol": sym, "error": "Not found"}) for sym in tickers]


_CHART_CONFIG: dict[str, tuple[str, str]] = {
    "1d":  ("1d",  "5m"),
    "5d":  ("5d",  "30m"),
    "1mo": ("1mo", "1d"),
    "3mo": ("3mo", "1d"),
    "6mo": ("6mo", "1d"),
    "1y":  ("1y",  "1wk"),
    "2y":  ("2y",  "1wk"),
    "5y":  ("5y",  "1mo"),
}
_CHART_TTL: dict[str, timedelta] = {
    "1d":  timedelta(minutes=1),
    "5d":  timedelta(minutes=5),
    "1mo": timedelta(minutes=30),
    "3mo": timedelta(minutes=30),
    "6mo": timedelta(hours=1),
    "1y":  timedelta(hours=4),
    "2y":  timedelta(hours=4),
    "5y":  timedelta(hours=24),
}
_chart_cache: dict[str, tuple[dict, datetime]] = {}


@app.get("/api/chart/{symbol}")
def get_chart(symbol: str, period: str = "1d"):
    from fastapi import HTTPException
    symbol = symbol.upper()
    if period not in _CHART_CONFIG:
        raise HTTPException(400, f"Invalid period '{period}'")

    cache_key = f"{symbol}:{period}"
    now = datetime.utcnow()
    cached = _chart_cache.get(cache_key)
    if cached and (now - cached[1]) < _CHART_TTL[period]:
        return cached[0]

    yf_period, yf_interval = _CHART_CONFIG[period]
    try:
        hist = yf.Ticker(symbol, session=_session).history(
            period=yf_period, interval=yf_interval
        )
    except Exception as exc:
        logger.warning("Chart fetch failed %s %s: %s", symbol, period, exc)
        raise HTTPException(500, str(exc))

    if hist.empty:
        result = {"symbol": symbol, "period": period, "data": []}
        _chart_cache[cache_key] = (result, now)
        return result

    data = []
    seen: set[int] = set()
    for ts, row in hist.iterrows():
        unix_ts = int(ts.timestamp())
        if unix_ts in seen:
            continue
        seen.add(unix_ts)
        data.append({
            "time":   unix_ts,
            "open":   round(float(row["Open"]),  4),
            "high":   round(float(row["High"]),  4),
            "low":    round(float(row["Low"]),   4),
            "close":  round(float(row["Close"]), 4),
            "volume": int(row["Volume"]),
        })

    result = {"symbol": symbol, "period": period, "data": data}
    _chart_cache[cache_key] = (result, now)
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
