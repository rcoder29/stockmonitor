from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import yfinance as yf
import yfinance.screener.screener as yf_screener
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


_news_cache: dict[str, tuple[list, datetime]] = {}
_NEWS_TTL = timedelta(minutes=5)

_market_cache: dict[str, tuple[dict, datetime]] = {}
_MARKET_TTL  = timedelta(minutes=15)

_MAJOR_STOCKS = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO",
    "JPM", "V", "MA", "UNH", "XOM", "WMT", "JNJ", "PG", "HD", "COST",
    "BAC", "NFLX", "AMD", "ORCL", "QCOM", "CRM", "GS", "MS", "CVX",
    "GE", "UBER", "COIN",
]


@app.get("/api/news/{symbol}")
def get_news(symbol: str):
    symbol = symbol.upper()
    now = datetime.utcnow()
    cached = _news_cache.get(symbol)
    if cached and (now - cached[1]) < _NEWS_TTL:
        return cached[0]

    try:
        raw_news = yf.Ticker(symbol, session=_session).news or []
        articles = []
        for item in raw_news:
            # yfinance 1.x wraps items under a "content" key
            content = item.get("content", {})
            title = content.get("title") or item.get("title", "")
            publisher = (
                content.get("provider", {}).get("displayName")
                or item.get("publisher", "")
            )
            link = (
                content.get("canonicalUrl", {}).get("url")
                or item.get("link", "")
            )
            pub_date = content.get("pubDate") or item.get("providerPublishTime")
            if isinstance(pub_date, (int, float)):
                pub_date = datetime.utcfromtimestamp(pub_date).strftime("%Y-%m-%dT%H:%M:%SZ")
            if title and link:
                articles.append({
                    "title": title,
                    "publisher": publisher,
                    "link": link,
                    "publishedAt": pub_date or "",
                })
            if len(articles) == 10:
                break
    except Exception as exc:
        logger.warning("News fetch failed for %s: %s", symbol, exc)
        articles = []

    _news_cache[symbol] = (articles, now)
    return articles


def _fetch_market_headlines() -> list:
    try:
        raw_news = yf.Ticker("^GSPC", session=_session).news or []
        articles = []
        for item in raw_news[:10]:
            content = item.get("content", {})
            title = content.get("title") or item.get("title", "")
            publisher = (
                content.get("provider", {}).get("displayName")
                or item.get("publisher", "")
            )
            link = (
                content.get("canonicalUrl", {}).get("url")
                or item.get("link", "")
            )
            pub_date = content.get("pubDate") or item.get("providerPublishTime")
            if isinstance(pub_date, (int, float)):
                pub_date = datetime.utcfromtimestamp(pub_date).strftime("%Y-%m-%dT%H:%M:%SZ")
            if title and link:
                articles.append({"title": title, "publisher": publisher,
                                  "link": link, "publishedAt": pub_date or ""})
        return articles
    except Exception as exc:
        logger.warning("Market headlines failed: %s", exc)
        return []


def _fetch_screener_quotes(predefined_body: str) -> list:
    try:
        result = yf_screener.screen(predefined_body)
        quotes = (result or {}).get("quotes", [])[:10]
        return [
            {
                "symbol":        q.get("symbol", ""),
                "name":          q.get("shortName") or q.get("longName") or q.get("symbol", ""),
                "price":         _safe_float(q.get("regularMarketPrice")),
                "change":        _safe_float(q.get("regularMarketChange")),
                "changePercent": _safe_float(q.get("regularMarketChangePercent")),
                "volume":        _safe_float(q.get("regularMarketVolume")),
                "marketCap":     _safe_float(q.get("marketCap")),
            }
            for q in quotes if q.get("symbol")
        ]
    except Exception as exc:
        logger.warning("Screener %s failed: %s", predefined_body, exc)
        return []


def _fetch_analyst_actions() -> list:
    actions: list[dict] = []
    cutoff = datetime.utcnow() - timedelta(days=14)

    def _for_sym(sym: str) -> list:
        try:
            df = yf.Ticker(sym, session=_session).upgrades_downgrades
            if df is None or df.empty:
                return []
            recent = df[df.index >= cutoff]
            result = []
            for ts, row in recent.iterrows():
                action = str(row.get("Action", "")).lower()
                result.append({
                    "symbol":    sym,
                    "firm":      str(row.get("Firm", "")),
                    "toGrade":   str(row.get("ToGrade", "")),
                    "fromGrade": str(row.get("FromGrade", "")),
                    "action":    action,
                    "date":      ts.strftime("%Y-%m-%d"),
                    "priceTarget": _safe_float(row.get("currentPriceTarget")),
                })
            return result
        except Exception:
            return []

    with ThreadPoolExecutor(max_workers=10) as pool:
        for fut in as_completed([pool.submit(_for_sym, s) for s in _MAJOR_STOCKS]):
            actions.extend(fut.result())

    actions.sort(key=lambda x: x["date"], reverse=True)
    return actions[:10]


@app.get("/api/market/summary")
def get_market_summary():
    now = datetime.utcnow()
    cached = _market_cache.get("summary")
    if cached and (now - cached[1]) < _MARKET_TTL:
        return cached[0]

    with ThreadPoolExecutor(max_workers=4) as pool:
        f_headlines = pool.submit(_fetch_market_headlines)
        f_gainers   = pool.submit(_fetch_screener_quotes, "day_gainers")
        f_losers    = pool.submit(_fetch_screener_quotes, "day_losers")
        f_analyst   = pool.submit(_fetch_analyst_actions)
        result = {
            "headlines":      f_headlines.result(),
            "gainers":        f_gainers.result(),
            "losers":         f_losers.result(),
            "analystActions": f_analyst.result(),
        }

    _market_cache["summary"] = (result, now)
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
