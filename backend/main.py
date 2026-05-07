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


@app.get("/health")
def health():
    return {"status": "ok"}
