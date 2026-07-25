from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
import csv
import io
import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import List
import numpy as np
import pandas as pd
import yfinance as yf
import yfinance.screener.screener as yf_screener
import logging
import json
import os
from curl_cffi import requests as curl_requests
from anthropic import Anthropic
from dotenv import load_dotenv
load_dotenv()

from database import (
    init_db, migrate_db, db_session, cache_get, cache_set,
    WatchlistSymbol, WatchlistGroup, PortfolioPosition, PortfolioSnapshot,
    PriceAlert, SmartAlertRule, OptionsPosition, PriceTarget, TradeJournalEntry,
)

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

# Initialise DB tables on startup
init_db()
migrate_db()

# ── TTLs ──────────────────────────────────────────────────────────────────────
_FUND_TTL    = timedelta(minutes=5)
_NEWS_TTL    = timedelta(minutes=5)
_MARKET_TTL  = timedelta(minutes=15)
_PERF_TTL    = timedelta(minutes=15)
_AI_TTL      = timedelta(minutes=15)
_AI_ANLST_TTL = timedelta(minutes=15)
_ANLST_TTL   = timedelta(minutes=10)
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


def _safe_float(val) -> float | None:
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


# ── Fundamentals ──────────────────────────────────────────────────────────────

def _fetch_fundamentals(sym: str) -> dict:
    key = f"fund:{sym}"
    cached = cache_get(key, _FUND_TTL)
    if cached is not None:
        return cached

    try:
        info = yf.Ticker(sym, session=_session).info
        data = {
            "name":          info.get("shortName") or info.get("longName") or sym,
            "peRatio":       _safe_float(info.get("trailingPE")),
            "forwardPE":     _safe_float(info.get("forwardPE")),
            "eps":           _safe_float(info.get("trailingEps")),
            "dividendYield": _safe_float(info.get("dividendYield")),
            "beta":          _safe_float(info.get("beta")),
            "revenue":       _safe_float(info.get("totalRevenue")),
            "profitMargin":  _safe_float(info.get("profitMargins")),
            "roe":           _safe_float(info.get("returnOnEquity")),
            "debtToEquity":  _safe_float(info.get("debtToEquity")),
            "priceToBook":        _safe_float(info.get("priceToBook")),
            "sector":             info.get("sector") or None,
            "industry":           info.get("industry") or None,
            "shortRatio":         _safe_float(info.get("shortRatio")),
            "shortPercentOfFloat":_safe_float(info.get("shortPercentOfFloat")),
            "sharesShort":        _safe_float(info.get("sharesShort")),
            "sharesShortPriorMonth": _safe_float(info.get("sharesShortPriorMonth")),
        }
    except Exception as exc:
        logger.warning("Fundamentals fetch failed for %s: %s", sym, exc)
        data = {"name": sym}

    cache_set(key, data)
    return data


def _fetch_quote(sym: str) -> dict:
    try:
        ticker = yf.Ticker(sym, session=_session)
        fi = ticker.fast_info

        price = _safe_float(fi.last_price)
        prev  = _safe_float(fi.previous_close)
        change     = (price - prev) if price is not None and prev is not None else None
        change_pct = (change / prev * 100) if change is not None and prev else None

        fund = _fetch_fundamentals(sym)

        data = {
            "symbol":        sym,
            "name":          fund.get("name", sym),
            "price":         price,
            "previousClose": prev,
            "change":        change,
            "changePercent": change_pct,
            "dayHigh":       _safe_float(fi.day_high),
            "dayLow":        _safe_float(fi.day_low),
            "volume":        _safe_float(fi.last_volume),
            "avgVolume":     _safe_float(fi.three_month_average_volume),
            "week52High":    _safe_float(fi.year_high),
            "week52Low":     _safe_float(fi.year_low),
            "marketCap":     _safe_float(fi.market_cap),
            "peRatio":       fund.get("peRatio"),
            "forwardPE":     fund.get("forwardPE"),
            "eps":           fund.get("eps"),
            "dividendYield": fund.get("dividendYield"),
            "beta":          fund.get("beta"),
            "revenue":       fund.get("revenue"),
            "profitMargin":  fund.get("profitMargin"),
            "roe":           fund.get("roe"),
            "debtToEquity":  fund.get("debtToEquity"),
            "priceToBook":   fund.get("priceToBook"),
            "sector":        fund.get("sector"),
            "industry":      fund.get("industry"),
            "error":         None,
        }
        cache_set(f"quote:{sym}", data)
        return data
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


# ── Charts ────────────────────────────────────────────────────────────────────

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


@app.get("/api/chart/{symbol}")
def get_chart(symbol: str, period: str = "1d"):
    symbol = symbol.upper()
    if period not in _CHART_CONFIG:
        raise HTTPException(400, f"Invalid period '{period}'")

    cache_key = f"chart:{symbol}:{period}"
    cached = cache_get(cache_key, _CHART_TTL[period])
    if cached is not None:
        return cached

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
        cache_set(cache_key, result)
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
    cache_set(cache_key, result)
    return result


# ── News ──────────────────────────────────────────────────────────────────────

@app.get("/api/news/{symbol}")
def get_news(symbol: str):
    symbol = symbol.upper()
    cached = cache_get(f"news:{symbol}", _NEWS_TTL)
    if cached is not None:
        return cached

    try:
        raw_news = yf.Ticker(symbol, session=_session).news or []
        articles = []
        for item in raw_news:
            content   = item.get("content", {})
            title     = content.get("title") or item.get("title", "")
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
                    "title":       title,
                    "publisher":   publisher,
                    "link":        link,
                    "publishedAt": pub_date or "",
                })
            if len(articles) == 10:
                break
    except Exception as exc:
        logger.warning("News fetch failed for %s: %s", symbol, exc)
        articles = []

    cache_set(f"news:{symbol}", articles)
    return articles


# ── Market performance ────────────────────────────────────────────────────────

_INDICES_LIST = [
    {"symbol": "SPY",  "name": "S&P 500 ETF"},
    {"symbol": "QQQ",  "name": "Nasdaq 100 ETF"},
    {"symbol": "DIA",  "name": "Dow Jones ETF"},
    {"symbol": "IWM",  "name": "Russell 2000 ETF"},
    {"symbol": "VTI",  "name": "Total US Market ETF"},
    {"symbol": "EFA",  "name": "Intl Developed ETF"},
    {"symbol": "EEM",  "name": "Emerging Markets ETF"},
    {"symbol": "TLT",  "name": "20Y Treasury ETF"},
    {"symbol": "AGG",  "name": "Aggregate Bond ETF"},
    {"symbol": "GLD",  "name": "Gold ETF"},
    {"symbol": "USO",  "name": "Oil ETF"},
    {"symbol": "IBIT", "name": "Bitcoin ETF"},
]

_MAG7_LIST = [
    {"symbol": "AAPL",  "name": "Apple"},
    {"symbol": "MSFT",  "name": "Microsoft"},
    {"symbol": "NVDA",  "name": "NVIDIA"},
    {"symbol": "GOOGL", "name": "Alphabet"},
    {"symbol": "AMZN",  "name": "Amazon"},
    {"symbol": "META",  "name": "Meta"},
    {"symbol": "TSLA",  "name": "Tesla"},
]

_SECTORS_LIST = [
    {"symbol": "XLK",  "name": "Technology"},
    {"symbol": "XLF",  "name": "Financials"},
    {"symbol": "XLV",  "name": "Health Care"},
    {"symbol": "XLE",  "name": "Energy"},
    {"symbol": "XLC",  "name": "Comm. Services"},
    {"symbol": "XLI",  "name": "Industrials"},
    {"symbol": "XLY",  "name": "Consumer Discret."},
    {"symbol": "XLP",  "name": "Consumer Staples"},
    {"symbol": "XLU",  "name": "Utilities"},
    {"symbol": "XLRE", "name": "Real Estate"},
    {"symbol": "XLB",  "name": "Materials"},
]


def _fetch_perf_one(sym: str) -> dict:
    try:
        hist = yf.Ticker(sym, session=_session).history(
            period="1y", interval="1d", auto_adjust=True
        )
        if hist.empty or len(hist) < 2:
            return {"symbol": sym}
        closes = hist["Close"]
        today  = closes.index[-1]

        def pct(n: int):
            if len(closes) <= n:
                return None
            return round((float(closes.iloc[-1]) / float(closes.iloc[-(n + 1)]) - 1) * 100, 2)

        ytd_closes = closes[closes.index.year == today.year]
        ytd = (
            round((float(closes.iloc[-1]) / float(ytd_closes.iloc[0]) - 1) * 100, 2)
            if len(ytd_closes) > 0 else None
        )
        return {
            "symbol": sym,
            "price": round(float(closes.iloc[-1]), 4),
            "1d":  pct(1),
            "5d":  pct(5),
            "1m":  pct(21),
            "3m":  pct(63),
            "6m":  pct(126),
            "1y":  pct(252),
            "ytd": ytd,
        }
    except Exception as exc:
        logger.warning("Perf fetch failed for %s: %s", sym, exc)
        return {"symbol": sym}


@app.get("/api/market/performance")
def get_market_performance():
    cached = cache_get("perf:main", _PERF_TTL)
    if cached is not None:
        return cached

    all_meta = _INDICES_LIST + _MAG7_LIST + _SECTORS_LIST
    all_syms = [m["symbol"] for m in all_meta]
    name_map = {m["symbol"]: m["name"] for m in all_meta}

    perf: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        for fut in as_completed({pool.submit(_fetch_perf_one, s): s for s in all_syms}):
            d = fut.result()
            perf[d["symbol"]] = d

    def build(items):
        return [{**perf.get(m["symbol"], {"symbol": m["symbol"]}), "name": name_map[m["symbol"]]}
                for m in items]

    result = {
        "indices": build(_INDICES_LIST),
        "mag7":    build(_MAG7_LIST),
        "sectors": build(_SECTORS_LIST),
    }
    cache_set("perf:main", result)
    return result


# ── Index Constituent Heatmap ─────────────────────────────────────────────────

_INDEX_TTL = timedelta(minutes=15)

_INDEX_CONSTITUENTS: dict[str, list[dict]] = {
    "DOW30": [
        {"symbol": "UNH",  "name": "UnitedHealth Group",   "sector": "Health Care",            "weight": 9.8},
        {"symbol": "GS",   "name": "Goldman Sachs",         "sector": "Financials",             "weight": 9.1},
        {"symbol": "MSFT", "name": "Microsoft",             "sector": "Technology",             "weight": 7.2},
        {"symbol": "V",    "name": "Visa",                  "sector": "Financials",             "weight": 6.1},
        {"symbol": "AMZN", "name": "Amazon",                "sector": "Consumer Discretionary", "weight": 6.0},
        {"symbol": "CAT",  "name": "Caterpillar",           "sector": "Industrials",            "weight": 5.4},
        {"symbol": "HD",   "name": "Home Depot",            "sector": "Consumer Discretionary", "weight": 5.0},
        {"symbol": "SHW",  "name": "Sherwin-Williams",      "sector": "Materials",              "weight": 4.8},
        {"symbol": "JPM",  "name": "JPMorgan Chase",        "sector": "Financials",             "weight": 4.5},
        {"symbol": "HON",  "name": "Honeywell",             "sector": "Industrials",            "weight": 4.2},
        {"symbol": "NVDA", "name": "NVIDIA",                "sector": "Technology",             "weight": 4.0},
        {"symbol": "TRV",  "name": "Travelers",             "sector": "Financials",             "weight": 3.8},
        {"symbol": "MCD",  "name": "McDonald's",            "sector": "Consumer Discretionary", "weight": 3.6},
        {"symbol": "AMGN", "name": "Amgen",                 "sector": "Health Care",            "weight": 3.5},
        {"symbol": "IBM",  "name": "IBM",                   "sector": "Technology",             "weight": 3.3},
        {"symbol": "AAPL", "name": "Apple",                 "sector": "Technology",             "weight": 3.1},
        {"symbol": "CRM",  "name": "Salesforce",            "sector": "Technology",             "weight": 3.0},
        {"symbol": "AXP",  "name": "American Express",      "sector": "Financials",             "weight": 2.9},
        {"symbol": "BA",   "name": "Boeing",                "sector": "Industrials",            "weight": 2.7},
        {"symbol": "MMM",  "name": "3M",                    "sector": "Industrials",            "weight": 2.4},
        {"symbol": "PG",   "name": "Procter & Gamble",      "sector": "Consumer Staples",       "weight": 2.3},
        {"symbol": "JNJ",  "name": "Johnson & Johnson",     "sector": "Health Care",            "weight": 2.2},
        {"symbol": "MRK",  "name": "Merck",                 "sector": "Health Care",            "weight": 2.1},
        {"symbol": "CVX",  "name": "Chevron",               "sector": "Energy",                 "weight": 2.0},
        {"symbol": "WMT",  "name": "Walmart",               "sector": "Consumer Staples",       "weight": 1.9},
        {"symbol": "NKE",  "name": "Nike",                  "sector": "Consumer Discretionary", "weight": 1.8},
        {"symbol": "KO",   "name": "Coca-Cola",             "sector": "Consumer Staples",       "weight": 1.7},
        {"symbol": "DIS",  "name": "Walt Disney",           "sector": "Communication Services", "weight": 1.6},
        {"symbol": "CSCO", "name": "Cisco",                 "sector": "Technology",             "weight": 1.5},
        {"symbol": "VZ",   "name": "Verizon",               "sector": "Communication Services", "weight": 1.4},
    ],
    "NASDAQ100": [
        {"symbol": "MSFT",  "name": "Microsoft",             "sector": "Technology",             "weight": 8.5},
        {"symbol": "AAPL",  "name": "Apple",                 "sector": "Technology",             "weight": 7.5},
        {"symbol": "NVDA",  "name": "NVIDIA",                "sector": "Technology",             "weight": 7.0},
        {"symbol": "AMZN",  "name": "Amazon",                "sector": "Consumer Discretionary", "weight": 5.5},
        {"symbol": "META",  "name": "Meta Platforms",        "sector": "Communication Services", "weight": 4.8},
        {"symbol": "GOOGL", "name": "Alphabet Class A",      "sector": "Communication Services", "weight": 2.5},
        {"symbol": "GOOG",  "name": "Alphabet Class C",      "sector": "Communication Services", "weight": 2.4},
        {"symbol": "TSLA",  "name": "Tesla",                 "sector": "Consumer Discretionary", "weight": 2.8},
        {"symbol": "AVGO",  "name": "Broadcom",              "sector": "Technology",             "weight": 2.5},
        {"symbol": "COST",  "name": "Costco",                "sector": "Consumer Staples",       "weight": 2.0},
        {"symbol": "NFLX",  "name": "Netflix",               "sector": "Communication Services", "weight": 1.6},
        {"symbol": "AMD",   "name": "AMD",                   "sector": "Technology",             "weight": 1.4},
        {"symbol": "ADBE",  "name": "Adobe",                 "sector": "Technology",             "weight": 1.2},
        {"symbol": "PDD",   "name": "PDD Holdings",          "sector": "Consumer Discretionary", "weight": 1.2},
        {"symbol": "QCOM",  "name": "Qualcomm",              "sector": "Technology",             "weight": 1.1},
        {"symbol": "ASML",  "name": "ASML",                  "sector": "Technology",             "weight": 1.1},
        {"symbol": "TXN",   "name": "Texas Instruments",     "sector": "Technology",             "weight": 1.0},
        {"symbol": "CMCSA", "name": "Comcast",               "sector": "Communication Services", "weight": 0.95},
        {"symbol": "INTU",  "name": "Intuit",                "sector": "Technology",             "weight": 0.95},
        {"symbol": "ISRG",  "name": "Intuitive Surgical",    "sector": "Health Care",            "weight": 0.9},
        {"symbol": "BKNG",  "name": "Booking Holdings",      "sector": "Consumer Discretionary", "weight": 0.85},
        {"symbol": "HON",   "name": "Honeywell",             "sector": "Industrials",            "weight": 0.8},
        {"symbol": "AMGN",  "name": "Amgen",                 "sector": "Health Care",            "weight": 0.8},
        {"symbol": "VRTX",  "name": "Vertex Pharmaceuticals","sector": "Health Care",            "weight": 0.75},
        {"symbol": "PANW",  "name": "Palo Alto Networks",    "sector": "Technology",             "weight": 0.7},
        {"symbol": "MU",    "name": "Micron Technology",     "sector": "Technology",             "weight": 0.7},
        {"symbol": "ADP",   "name": "ADP",                   "sector": "Technology",             "weight": 0.65},
        {"symbol": "SBUX",  "name": "Starbucks",             "sector": "Consumer Discretionary", "weight": 0.65},
        {"symbol": "GILD",  "name": "Gilead Sciences",       "sector": "Health Care",            "weight": 0.6},
        {"symbol": "ARM",   "name": "Arm Holdings",          "sector": "Technology",             "weight": 0.6},
        {"symbol": "MDLZ",  "name": "Mondelez",              "sector": "Consumer Staples",       "weight": 0.6},
        {"symbol": "PYPL",  "name": "PayPal",                "sector": "Financials",             "weight": 0.55},
        {"symbol": "ADI",   "name": "Analog Devices",        "sector": "Technology",             "weight": 0.55},
        {"symbol": "REGN",  "name": "Regeneron",             "sector": "Health Care",            "weight": 0.55},
        {"symbol": "NXPI",  "name": "NXP Semiconductors",    "sector": "Technology",             "weight": 0.5},
        {"symbol": "LRCX",  "name": "Lam Research",          "sector": "Technology",             "weight": 0.5},
        {"symbol": "KLAC",  "name": "KLA Corp",              "sector": "Technology",             "weight": 0.5},
        {"symbol": "SNPS",  "name": "Synopsys",              "sector": "Technology",             "weight": 0.5},
        {"symbol": "CDNS",  "name": "Cadence Design",        "sector": "Technology",             "weight": 0.5},
        {"symbol": "MAR",   "name": "Marriott",              "sector": "Consumer Discretionary", "weight": 0.5},
        {"symbol": "MRVL",  "name": "Marvell Technology",    "sector": "Technology",             "weight": 0.45},
        {"symbol": "CSX",   "name": "CSX",                   "sector": "Industrials",            "weight": 0.45},
        {"symbol": "PCAR",  "name": "PACCAR",                "sector": "Industrials",            "weight": 0.45},
        {"symbol": "ORLY",  "name": "O'Reilly Auto",         "sector": "Consumer Discretionary", "weight": 0.45},
        {"symbol": "FTNT",  "name": "Fortinet",              "sector": "Technology",             "weight": 0.45},
        {"symbol": "CPRT",  "name": "Copart",                "sector": "Industrials",            "weight": 0.4},
        {"symbol": "CTAS",  "name": "Cintas",                "sector": "Industrials",            "weight": 0.4},
        {"symbol": "ROP",   "name": "Roper Technologies",    "sector": "Technology",             "weight": 0.4},
        {"symbol": "ABNB",  "name": "Airbnb",                "sector": "Consumer Discretionary", "weight": 0.4},
        {"symbol": "MELI",  "name": "MercadoLibre",          "sector": "Consumer Discretionary", "weight": 0.35},
        {"symbol": "ROST",  "name": "Ross Stores",           "sector": "Consumer Discretionary", "weight": 0.35},
        {"symbol": "MNST",  "name": "Monster Beverage",      "sector": "Consumer Staples",       "weight": 0.35},
        {"symbol": "DXCM",  "name": "DexCom",                "sector": "Health Care",            "weight": 0.35},
        {"symbol": "ODFL",  "name": "Old Dominion Freight",  "sector": "Industrials",            "weight": 0.35},
        {"symbol": "AZN",   "name": "AstraZeneca",           "sector": "Health Care",            "weight": 0.35},
        {"symbol": "APP",   "name": "AppLovin",              "sector": "Technology",             "weight": 0.5},
        {"symbol": "IDXX",  "name": "IDEXX Laboratories",    "sector": "Health Care",            "weight": 0.3},
        {"symbol": "BIIB",  "name": "Biogen",                "sector": "Health Care",            "weight": 0.3},
        {"symbol": "FAST",  "name": "Fastenal",              "sector": "Industrials",            "weight": 0.3},
        {"symbol": "EXC",   "name": "Exelon",                "sector": "Utilities",              "weight": 0.3},
        {"symbol": "CEG",   "name": "Constellation Energy",  "sector": "Utilities",              "weight": 0.3},
        {"symbol": "FANG",  "name": "Diamondback Energy",    "sector": "Energy",                 "weight": 0.3},
        {"symbol": "BKR",   "name": "Baker Hughes",          "sector": "Energy",                 "weight": 0.3},
        {"symbol": "CRWD",  "name": "CrowdStrike",           "sector": "Technology",             "weight": 0.3},
        {"symbol": "TTD",   "name": "Trade Desk",            "sector": "Technology",             "weight": 0.3},
        {"symbol": "VRSK",  "name": "Verisk Analytics",      "sector": "Industrials",            "weight": 0.25},
        {"symbol": "GEHC",  "name": "GE HealthCare",         "sector": "Health Care",            "weight": 0.3},
        {"symbol": "WDAY",  "name": "Workday",               "sector": "Technology",             "weight": 0.3},
        {"symbol": "WBD",   "name": "Warner Bros. Discovery","sector": "Communication Services", "weight": 0.2},
        {"symbol": "ZS",    "name": "Zscaler",               "sector": "Technology",             "weight": 0.2},
        {"symbol": "TEAM",  "name": "Atlassian",             "sector": "Technology",             "weight": 0.2},
        {"symbol": "PLTR",  "name": "Palantir",              "sector": "Technology",             "weight": 0.2},
        {"symbol": "DLTR",  "name": "Dollar Tree",           "sector": "Consumer Staples",       "weight": 0.2},
        {"symbol": "PAYX",  "name": "Paychex",               "sector": "Technology",             "weight": 0.2},
        {"symbol": "TTWO",  "name": "Take-Two Interactive",  "sector": "Communication Services", "weight": 0.2},
        {"symbol": "ANSS",  "name": "ANSYS",                 "sector": "Technology",             "weight": 0.2},
        {"symbol": "XEL",   "name": "Xcel Energy",           "sector": "Utilities",              "weight": 0.2},
        {"symbol": "ON",    "name": "ON Semiconductor",      "sector": "Technology",             "weight": 0.2},
        {"symbol": "ILMN",  "name": "Illumina",              "sector": "Health Care",            "weight": 0.2},
        {"symbol": "LULU",  "name": "Lululemon",             "sector": "Consumer Discretionary", "weight": 0.2},
        {"symbol": "DASH",  "name": "DoorDash",              "sector": "Consumer Discretionary", "weight": 0.3},
        {"symbol": "EA",    "name": "Electronic Arts",       "sector": "Communication Services", "weight": 0.3},
        {"symbol": "SMCI",  "name": "Super Micro Computer",  "sector": "Technology",             "weight": 0.35},
        {"symbol": "MDB",   "name": "MongoDB",               "sector": "Technology",             "weight": 0.2},
        {"symbol": "GEN",   "name": "Gen Digital",           "sector": "Technology",             "weight": 0.2},
        {"symbol": "INTC",  "name": "Intel",                 "sector": "Technology",             "weight": 0.3},
        {"symbol": "ALGN",  "name": "Align Technology",      "sector": "Health Care",            "weight": 0.15},
    ],
    "SP100": [
        {"symbol": "MSFT",  "name": "Microsoft",             "sector": "Technology",             "weight": 7.0},
        {"symbol": "AAPL",  "name": "Apple",                 "sector": "Technology",             "weight": 6.8},
        {"symbol": "NVDA",  "name": "NVIDIA",                "sector": "Technology",             "weight": 6.2},
        {"symbol": "AMZN",  "name": "Amazon",                "sector": "Consumer Discretionary", "weight": 4.2},
        {"symbol": "META",  "name": "Meta Platforms",        "sector": "Communication Services", "weight": 2.8},
        {"symbol": "GOOGL", "name": "Alphabet Class A",      "sector": "Communication Services", "weight": 2.1},
        {"symbol": "GOOG",  "name": "Alphabet Class C",      "sector": "Communication Services", "weight": 1.8},
        {"symbol": "LLY",   "name": "Eli Lilly",             "sector": "Health Care",            "weight": 1.9},
        {"symbol": "AVGO",  "name": "Broadcom",              "sector": "Technology",             "weight": 1.8},
        {"symbol": "TSLA",  "name": "Tesla",                 "sector": "Consumer Discretionary", "weight": 1.7},
        {"symbol": "JPM",   "name": "JPMorgan Chase",        "sector": "Financials",             "weight": 1.6},
        {"symbol": "WMT",   "name": "Walmart",               "sector": "Consumer Staples",       "weight": 1.5},
        {"symbol": "V",     "name": "Visa",                  "sector": "Financials",             "weight": 1.4},
        {"symbol": "UNH",   "name": "UnitedHealth Group",    "sector": "Health Care",            "weight": 1.3},
        {"symbol": "XOM",   "name": "ExxonMobil",            "sector": "Energy",                 "weight": 1.3},
        {"symbol": "ORCL",  "name": "Oracle",                "sector": "Technology",             "weight": 1.2},
        {"symbol": "MA",    "name": "Mastercard",            "sector": "Financials",             "weight": 1.2},
        {"symbol": "COST",  "name": "Costco",                "sector": "Consumer Staples",       "weight": 1.1},
        {"symbol": "NFLX",  "name": "Netflix",               "sector": "Communication Services", "weight": 1.0},
        {"symbol": "JNJ",   "name": "Johnson & Johnson",     "sector": "Health Care",            "weight": 0.9},
        {"symbol": "HD",    "name": "Home Depot",            "sector": "Consumer Discretionary", "weight": 0.9},
        {"symbol": "AMD",   "name": "AMD",                   "sector": "Technology",             "weight": 0.85},
        {"symbol": "ABBV",  "name": "AbbVie",                "sector": "Health Care",            "weight": 0.85},
        {"symbol": "BAC",   "name": "Bank of America",       "sector": "Financials",             "weight": 0.8},
        {"symbol": "PG",    "name": "Procter & Gamble",      "sector": "Consumer Staples",       "weight": 0.8},
        {"symbol": "MRK",   "name": "Merck",                 "sector": "Health Care",            "weight": 0.75},
        {"symbol": "ADBE",  "name": "Adobe",                 "sector": "Technology",             "weight": 0.75},
        {"symbol": "CVX",   "name": "Chevron",               "sector": "Energy",                 "weight": 0.7},
        {"symbol": "KO",    "name": "Coca-Cola",             "sector": "Consumer Staples",       "weight": 0.7},
        {"symbol": "CRM",   "name": "Salesforce",            "sector": "Technology",             "weight": 0.7},
        {"symbol": "ACN",   "name": "Accenture",             "sector": "Technology",             "weight": 0.65},
        {"symbol": "PEP",   "name": "PepsiCo",               "sector": "Consumer Staples",       "weight": 0.65},
        {"symbol": "TMO",   "name": "Thermo Fisher",         "sector": "Health Care",            "weight": 0.65},
        {"symbol": "WFC",   "name": "Wells Fargo",           "sector": "Financials",             "weight": 0.6},
        {"symbol": "LIN",   "name": "Linde",                 "sector": "Materials",              "weight": 0.6},
        {"symbol": "MCD",   "name": "McDonald's",            "sector": "Consumer Discretionary", "weight": 0.6},
        {"symbol": "GE",    "name": "GE Aerospace",          "sector": "Industrials",            "weight": 0.6},
        {"symbol": "IBM",   "name": "IBM",                   "sector": "Technology",             "weight": 0.55},
        {"symbol": "PM",    "name": "Philip Morris",         "sector": "Consumer Staples",       "weight": 0.55},
        {"symbol": "QCOM",  "name": "Qualcomm",              "sector": "Technology",             "weight": 0.55},
        {"symbol": "INTU",  "name": "Intuit",                "sector": "Technology",             "weight": 0.55},
        {"symbol": "NOW",   "name": "ServiceNow",            "sector": "Technology",             "weight": 0.55},
        {"symbol": "AMGN",  "name": "Amgen",                 "sector": "Health Care",            "weight": 0.5},
        {"symbol": "TXN",   "name": "Texas Instruments",     "sector": "Technology",             "weight": 0.5},
        {"symbol": "ISRG",  "name": "Intuitive Surgical",    "sector": "Health Care",            "weight": 0.5},
        {"symbol": "SPGI",  "name": "S&P Global",            "sector": "Financials",             "weight": 0.5},
        {"symbol": "GS",    "name": "Goldman Sachs",         "sector": "Financials",             "weight": 0.5},
        {"symbol": "CAT",   "name": "Caterpillar",           "sector": "Industrials",            "weight": 0.5},
        {"symbol": "AXP",   "name": "American Express",      "sector": "Financials",             "weight": 0.5},
        {"symbol": "BKNG",  "name": "Booking Holdings",      "sector": "Consumer Discretionary", "weight": 0.5},
        {"symbol": "VRTX",  "name": "Vertex Pharmaceuticals","sector": "Health Care",            "weight": 0.45},
        {"symbol": "HON",   "name": "Honeywell",             "sector": "Industrials",            "weight": 0.45},
        {"symbol": "BLK",   "name": "BlackRock",             "sector": "Financials",             "weight": 0.45},
        {"symbol": "UNP",   "name": "Union Pacific",         "sector": "Industrials",            "weight": 0.45},
        {"symbol": "LOW",   "name": "Lowe's",                "sector": "Consumer Discretionary", "weight": 0.45},
        {"symbol": "SYK",   "name": "Stryker",               "sector": "Health Care",            "weight": 0.45},
        {"symbol": "AMAT",  "name": "Applied Materials",     "sector": "Technology",             "weight": 0.45},
        {"symbol": "MS",    "name": "Morgan Stanley",        "sector": "Financials",             "weight": 0.4},
        {"symbol": "NEE",   "name": "NextEra Energy",        "sector": "Utilities",              "weight": 0.4},
        {"symbol": "ETN",   "name": "Eaton",                 "sector": "Industrials",            "weight": 0.4},
        {"symbol": "RTX",   "name": "RTX Corp",              "sector": "Industrials",            "weight": 0.4},
        {"symbol": "SCHW",  "name": "Charles Schwab",        "sector": "Financials",             "weight": 0.4},
        {"symbol": "DE",    "name": "Deere & Company",       "sector": "Industrials",            "weight": 0.4},
        {"symbol": "BSX",   "name": "Boston Scientific",     "sector": "Health Care",            "weight": 0.4},
        {"symbol": "PANW",  "name": "Palo Alto Networks",    "sector": "Technology",             "weight": 0.4},
        {"symbol": "NKE",   "name": "Nike",                  "sector": "Consumer Discretionary", "weight": 0.4},
        {"symbol": "CB",    "name": "Chubb",                 "sector": "Financials",             "weight": 0.4},
        {"symbol": "MMC",   "name": "Marsh McLennan",        "sector": "Financials",             "weight": 0.35},
        {"symbol": "LRCX",  "name": "Lam Research",          "sector": "Technology",             "weight": 0.35},
        {"symbol": "ADI",   "name": "Analog Devices",        "sector": "Technology",             "weight": 0.35},
        {"symbol": "C",     "name": "Citigroup",             "sector": "Financials",             "weight": 0.35},
        {"symbol": "ZTS",   "name": "Zoetis",                "sector": "Health Care",            "weight": 0.35},
        {"symbol": "KLAC",  "name": "KLA Corp",              "sector": "Technology",             "weight": 0.35},
        {"symbol": "PLD",   "name": "Prologis",              "sector": "Real Estate",            "weight": 0.35},
        {"symbol": "COP",   "name": "ConocoPhillips",        "sector": "Energy",                 "weight": 0.35},
        {"symbol": "CI",    "name": "Cigna",                 "sector": "Health Care",            "weight": 0.35},
        {"symbol": "REGN",  "name": "Regeneron",             "sector": "Health Care",            "weight": 0.35},
        {"symbol": "GILD",  "name": "Gilead Sciences",       "sector": "Health Care",            "weight": 0.35},
        {"symbol": "ELV",   "name": "Elevance Health",       "sector": "Health Care",            "weight": 0.35},
        {"symbol": "MU",    "name": "Micron Technology",     "sector": "Technology",             "weight": 0.3},
        {"symbol": "ICE",   "name": "Intercontinental Exchange","sector": "Financials",          "weight": 0.3},
        {"symbol": "SO",    "name": "Southern Company",      "sector": "Utilities",              "weight": 0.3},
        {"symbol": "TGT",   "name": "Target",                "sector": "Consumer Discretionary", "weight": 0.3},
        {"symbol": "CME",   "name": "CME Group",             "sector": "Financials",             "weight": 0.3},
        {"symbol": "AON",   "name": "Aon",                   "sector": "Financials",             "weight": 0.3},
        {"symbol": "MDLZ",  "name": "Mondelez",              "sector": "Consumer Staples",       "weight": 0.3},
        {"symbol": "PNC",   "name": "PNC Financial",         "sector": "Financials",             "weight": 0.3},
        {"symbol": "APH",   "name": "Amphenol",              "sector": "Technology",             "weight": 0.3},
        {"symbol": "FCX",   "name": "Freeport-McMoRan",      "sector": "Materials",              "weight": 0.3},
        {"symbol": "NSC",   "name": "Norfolk Southern",      "sector": "Industrials",            "weight": 0.3},
        {"symbol": "EMR",   "name": "Emerson Electric",      "sector": "Industrials",            "weight": 0.3},
        {"symbol": "TJX",   "name": "TJX Companies",         "sector": "Consumer Discretionary", "weight": 0.3},
        {"symbol": "UBER",  "name": "Uber",                  "sector": "Industrials",            "weight": 0.3},
        {"symbol": "WELL",  "name": "Welltower",             "sector": "Real Estate",            "weight": 0.3},
        {"symbol": "FI",    "name": "Fiserv",                "sector": "Financials",             "weight": 0.3},
        {"symbol": "USB",   "name": "US Bancorp",            "sector": "Financials",             "weight": 0.25},
        {"symbol": "SHW",   "name": "Sherwin-Williams",      "sector": "Materials",              "weight": 0.25},
        {"symbol": "CL",    "name": "Colgate-Palmolive",     "sector": "Consumer Staples",       "weight": 0.25},
        {"symbol": "DUK",   "name": "Duke Energy",           "sector": "Utilities",              "weight": 0.25},
        {"symbol": "APP",   "name": "AppLovin",              "sector": "Technology",             "weight": 0.5},
    ],
    "ARKK": [
        {"symbol": "TSLA",  "name": "Tesla",                  "sector": "Consumer Discretionary", "weight": 7.2},
        {"symbol": "COIN",  "name": "Coinbase",               "sector": "Financials",             "weight": 6.8},
        {"symbol": "RBLX",  "name": "Roblox",                 "sector": "Communication Services", "weight": 5.5},
        {"symbol": "SQ",    "name": "Block (Square)",          "sector": "Financials",             "weight": 5.0},
        {"symbol": "SHOP",  "name": "Shopify",                "sector": "Technology",             "weight": 4.8},
        {"symbol": "ROKU",  "name": "Roku",                   "sector": "Communication Services", "weight": 4.5},
        {"symbol": "PLTR",  "name": "Palantir",               "sector": "Technology",             "weight": 4.2},
        {"symbol": "PATH",  "name": "UiPath",                 "sector": "Technology",             "weight": 3.8},
        {"symbol": "TER",   "name": "Teradyne",               "sector": "Technology",             "weight": 3.5},
        {"symbol": "EXAS",  "name": "Exact Sciences",         "sector": "Health Care",            "weight": 3.2},
        {"symbol": "DKNG",  "name": "DraftKings",             "sector": "Consumer Discretionary", "weight": 3.0},
        {"symbol": "TDOC",  "name": "Teladoc Health",         "sector": "Health Care",            "weight": 2.8},
        {"symbol": "CRSP",  "name": "CRISPR Therapeutics",    "sector": "Health Care",            "weight": 2.8},
        {"symbol": "NTLA",  "name": "Intellia Therapeutics",  "sector": "Health Care",            "weight": 2.5},
        {"symbol": "BEAM",  "name": "Beam Therapeutics",      "sector": "Health Care",            "weight": 2.5},
        {"symbol": "TWST",  "name": "Twist Bioscience",       "sector": "Health Care",            "weight": 2.2},
        {"symbol": "IOVA",  "name": "Iovance Biotherapeutics","sector": "Health Care",            "weight": 2.0},
        {"symbol": "ZM",    "name": "Zoom Video",             "sector": "Technology",             "weight": 2.0},
        {"symbol": "RXRX",  "name": "Recursion Pharmaceuticals","sector": "Health Care",          "weight": 2.0},
        {"symbol": "PSTG",  "name": "Pure Storage",           "sector": "Technology",             "weight": 1.8},
        {"symbol": "FATE",  "name": "Fate Therapeutics",      "sector": "Health Care",            "weight": 1.5},
        {"symbol": "U",     "name": "Unity Software",         "sector": "Technology",             "weight": 1.5},
        {"symbol": "HOOD",  "name": "Robinhood Markets",      "sector": "Financials",             "weight": 1.2},
        {"symbol": "DNA",   "name": "Ginkgo Bioworks",        "sector": "Health Care",            "weight": 1.2},
        {"symbol": "ACMR",  "name": "ACM Research",           "sector": "Technology",             "weight": 1.2},
        {"symbol": "SEER",  "name": "Seer Bio",               "sector": "Health Care",            "weight": 1.0},
        {"symbol": "LCID",  "name": "Lucid Group",            "sector": "Consumer Discretionary", "weight": 1.0},
        {"symbol": "OPEN",  "name": "Opendoor Technologies",  "sector": "Real Estate",            "weight": 0.8},
        {"symbol": "NKLA",  "name": "Nikola",                 "sector": "Consumer Discretionary", "weight": 0.8},
        {"symbol": "CLOV",  "name": "Clover Health",          "sector": "Health Care",            "weight": 0.7},
    ],
}

_INDEX_LABELS = {
    "DOW30":     "Dow Jones 30",
    "NASDAQ100": "Nasdaq 100",
    "SP100":     "S&P Top 100",
    "ARKK":      "ARK Innovation",
}


@app.get("/api/index-constituents")
def get_index_constituents(index: str = "DOW30"):
    index = index.upper()
    if index not in _INDEX_CONSTITUENTS:
        raise HTTPException(400, f"Unknown index '{index}'. Valid: {list(_INDEX_CONSTITUENTS.keys())}")

    cache_key = f"index:constituents:{index}"
    cached = cache_get(cache_key, _INDEX_TTL)
    if cached is not None:
        return cached

    meta = _INDEX_CONSTITUENTS[index]
    symbols = [c["symbol"] for c in meta]
    meta_map = {c["symbol"]: c for c in meta}

    perfs: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=15) as pool:
        for fut in as_completed({pool.submit(_fetch_perf_one, s): s for s in symbols}):
            d = fut.result()
            perfs[d["symbol"]] = d

    result = []
    for sym in symbols:
        d = perfs.get(sym, {"symbol": sym})
        m = meta_map[sym]
        result.append({
            "symbol": sym,
            "name":   m["name"],
            "sector": m["sector"],
            "weight": m["weight"],
            "price":  d.get("price"),
            "1d":     d.get("1d"),
            "5d":     d.get("5d"),
            "1m":     d.get("1m"),
            "3m":     d.get("3m"),
            "6m":     d.get("6m"),
            "1y":     d.get("1y"),
            "ytd":    d.get("ytd"),
        })

    cache_set(cache_key, result)
    return result


# ── Market summary ────────────────────────────────────────────────────────────

_NEWS_FEEDS   = ["^GSPC", "^FTSE", "^N225", "^GDAXI", "GC=F", "CL=F"]
_MAJOR_STOCKS = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO",
    "JPM", "V", "MA", "UNH", "XOM", "WMT", "JNJ", "PG", "HD", "COST",
    "BAC", "NFLX", "AMD", "ORCL", "QCOM", "CRM", "GS", "MS", "CVX",
    "GE", "UBER", "COIN",
]


def _parse_news_items(raw: list) -> list:
    articles = []
    for item in raw:
        content   = item.get("content", {})
        title     = content.get("title") or item.get("title", "")
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


def _fetch_feed(sym: str) -> list:
    try:
        return _parse_news_items(yf.Ticker(sym, session=_session).news or [])
    except Exception as exc:
        logger.warning("News feed %s failed: %s", sym, exc)
        return []


def _fetch_market_headlines() -> list:
    all_articles: list[dict] = []
    seen_links: set[str] = set()
    with ThreadPoolExecutor(max_workers=len(_NEWS_FEEDS)) as pool:
        for articles in pool.map(_fetch_feed, _NEWS_FEEDS):
            for a in articles:
                if a["link"] not in seen_links:
                    seen_links.add(a["link"])
                    all_articles.append(a)
    all_articles.sort(key=lambda a: a.get("publishedAt") or "", reverse=True)
    return all_articles[:20]


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


def _fetch_analyst_actions() -> dict:
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
                    "symbol":      sym,
                    "firm":        str(row.get("Firm", "")),
                    "toGrade":     str(row.get("ToGrade", "")),
                    "fromGrade":   str(row.get("FromGrade", "")),
                    "action":      action,
                    "date":        ts.strftime("%Y-%m-%d"),
                    "priceTarget": _safe_float(row.get("currentPriceTarget")),
                })
            return result
        except Exception:
            return []

    with ThreadPoolExecutor(max_workers=10) as pool:
        for fut in as_completed([pool.submit(_for_sym, s) for s in _MAJOR_STOCKS]):
            actions.extend(fut.result())

    actions.sort(key=lambda x: x["date"], reverse=True)
    return {
        "upgrades":   [a for a in actions if a["action"] in ("up", "init")][:10],
        "downgrades": [a for a in actions if a["action"] == "down"][:10],
    }


@app.get("/api/market/summary")
def get_market_summary():
    cached = cache_get("market:summary", _MARKET_TTL)
    if cached is not None:
        return cached

    with ThreadPoolExecutor(max_workers=4) as pool:
        f_headlines = pool.submit(_fetch_market_headlines)
        f_gainers   = pool.submit(_fetch_screener_quotes, "day_gainers")
        f_losers    = pool.submit(_fetch_screener_quotes, "day_losers")
        f_analyst   = pool.submit(_fetch_analyst_actions)
        analyst = f_analyst.result()
        result = {
            "headlines":         f_headlines.result(),
            "gainers":           f_gainers.result(),
            "losers":            f_losers.result(),
            "analystUpgrades":   analyst["upgrades"],
            "analystDowngrades": analyst["downgrades"],
        }

    cache_set("market:summary", result)
    return result


# ── AI stocks ─────────────────────────────────────────────────────────────────

_AI_STOCKS = [
    # Chips & Compute
    {"symbol": "NVDA",  "name": "NVIDIA",             "layer": "Chips & Compute",  "thesis": "GPU monopoly for AI training & inference"},
    {"symbol": "AMD",   "name": "AMD",                "layer": "Chips & Compute",  "thesis": "AI GPU challenger; EPYC data-center CPUs"},
    {"symbol": "AVGO",  "name": "Broadcom",           "layer": "Chips & Compute",  "thesis": "Custom AI ASICs (XPUs) for Google & Meta"},
    {"symbol": "MRVL",  "name": "Marvell Technology", "layer": "Chips & Compute",  "thesis": "Custom AI silicon & high-speed interconnects"},
    {"symbol": "ARM",   "name": "Arm Holdings",       "layer": "Chips & Compute",  "thesis": "CPU architecture powering AI edge & servers"},
    {"symbol": "INTC",  "name": "Intel",              "layer": "Chips & Compute",  "thesis": "Gaudi AI accelerators; leading-edge foundry"},
    {"symbol": "QCOM",  "name": "Qualcomm",           "layer": "Chips & Compute",  "thesis": "On-device AI inference in mobile & PCs"},
    # Memory & Storage
    {"symbol": "MU",    "name": "Micron",             "layer": "Memory & Storage", "thesis": "HBM3E memory essential for AI accelerators"},
    {"symbol": "SMCI",  "name": "Super Micro",        "layer": "Memory & Storage", "thesis": "AI server systems with direct liquid cooling"},
    {"symbol": "WDC",   "name": "Western Digital",    "layer": "Memory & Storage", "thesis": "Flash storage for AI training datasets"},
    # Semiconductor Equipment
    {"symbol": "AMAT",  "name": "Applied Materials",  "layer": "Semi Equipment",   "thesis": "Deposition equipment for advanced AI chips"},
    {"symbol": "LRCX",  "name": "Lam Research",       "layer": "Semi Equipment",   "thesis": "Etch systems for leading-edge nodes"},
    {"symbol": "KLAC",  "name": "KLA Corp",           "layer": "Semi Equipment",   "thesis": "Process control for high-yield AI chip fabs"},
    {"symbol": "ASML",  "name": "ASML",               "layer": "Semi Equipment",   "thesis": "Only maker of EUV machines — gating AI chips"},
    # Cloud & Infrastructure
    {"symbol": "MSFT",  "name": "Microsoft",          "layer": "Cloud & Infra",    "thesis": "Azure AI, OpenAI partnership, Copilot suite"},
    {"symbol": "GOOGL", "name": "Alphabet",           "layer": "Cloud & Infra",    "thesis": "TPU silicon, Gemini models, Google Cloud AI"},
    {"symbol": "AMZN",  "name": "Amazon",             "layer": "Cloud & Infra",    "thesis": "AWS Trainium/Inferentia, Bedrock AI platform"},
    {"symbol": "META",  "name": "Meta",               "layer": "Cloud & Infra",    "thesis": "Llama open-source; massive AI capex cycle"},
    {"symbol": "ORCL",  "name": "Oracle",             "layer": "Cloud & Infra",    "thesis": "OCI GPU clusters; AI database & applications"},
    # Networking
    {"symbol": "ANET",  "name": "Arista Networks",    "layer": "Networking",       "thesis": "Ethernet switches connecting AI GPU clusters"},
    {"symbol": "CSCO",  "name": "Cisco",              "layer": "Networking",       "thesis": "AI networking fabric, Silicon One ASICs"},
    {"symbol": "CIEN",  "name": "Ciena",              "layer": "Networking",       "thesis": "Optical networking backbone for AI traffic"},
    # Power & Cooling
    {"symbol": "VRT",   "name": "Vertiv",             "layer": "Power & Cooling",  "thesis": "Data-center power & liquid cooling systems"},
    {"symbol": "ETN",   "name": "Eaton",              "layer": "Power & Cooling",  "thesis": "Power management & UPS for AI data centers"},
    {"symbol": "GEV",   "name": "GE Vernova",         "layer": "Power & Cooling",  "thesis": "Gas & renewable generation for AI load growth"},
    {"symbol": "CEG",   "name": "Constellation",      "layer": "Power & Cooling",  "thesis": "Nuclear PPA deals with Microsoft & Google"},
    {"symbol": "VST",   "name": "Vistra",             "layer": "Power & Cooling",  "thesis": "Nuclear & gas baseload for 24/7 data centers"},
    {"symbol": "POWL",  "name": "Powell Industries",  "layer": "Power & Cooling",  "thesis": "Switchgear & electrical gear for data centers"},
    # Data Centers
    {"symbol": "EQIX",  "name": "Equinix",            "layer": "Data Centers",     "thesis": "Global colocation hubs for AI cloud workloads"},
    {"symbol": "DLR",   "name": "Digital Realty",     "layer": "Data Centers",     "thesis": "Hyperscale data center REIT expanding for AI"},
    {"symbol": "IRON",  "name": "Iron Mountain",      "layer": "Data Centers",     "thesis": "Data center & storage REIT pivoting to AI"},
    # Software & Applications
    {"symbol": "PLTR",  "name": "Palantir",           "layer": "Software & Apps",  "thesis": "AIP platform bringing AI to enterprise & govt"},
    {"symbol": "CRM",   "name": "Salesforce",         "layer": "Software & Apps",  "thesis": "Agentforce AI agents across enterprise CRM"},
    {"symbol": "NOW",   "name": "ServiceNow",         "layer": "Software & Apps",  "thesis": "AI-powered enterprise workflow automation"},
    {"symbol": "SNOW",  "name": "Snowflake",          "layer": "Software & Apps",  "thesis": "AI data cloud, Cortex AI for enterprise data"},
    {"symbol": "DDOG",  "name": "Datadog",            "layer": "Software & Apps",  "thesis": "AI observability & monitoring for cloud apps"},
    {"symbol": "MDB",   "name": "MongoDB",            "layer": "Software & Apps",  "thesis": "Document DB powering AI application backends"},
    # Cybersecurity
    {"symbol": "CRWD",  "name": "CrowdStrike",        "layer": "Cybersecurity",    "thesis": "AI-native endpoint & cloud security platform"},
    {"symbol": "PANW",  "name": "Palo Alto Networks", "layer": "Cybersecurity",    "thesis": "AI-powered network, cloud & SOC security"},
    {"symbol": "ZS",    "name": "Zscaler",            "layer": "Cybersecurity",    "thesis": "Zero-trust AI security for distributed infra"},
    {"symbol": "S",     "name": "SentinelOne",        "layer": "Cybersecurity",    "thesis": "AI-driven autonomous threat detection & response"},
    # Quantum Computing
    {"symbol": "IONQ",  "name": "IonQ",               "layer": "Quantum Computing","thesis": "Trapped-ion quantum systems; cloud QaaS leader"},
    {"symbol": "RGTI",  "name": "Rigetti Computing",  "layer": "Quantum Computing","thesis": "Superconducting QPUs on AWS & Azure marketplaces"},
    {"symbol": "QUBT",  "name": "Quantum Computing",  "layer": "Quantum Computing","thesis": "Photonic quantum optimization for logistics & finance"},
    {"symbol": "QBTS",  "name": "D-Wave Quantum",     "layer": "Quantum Computing","thesis": "Annealing QPUs for real-world optimization problems"},
    {"symbol": "IBM",   "name": "IBM",                "layer": "Quantum Computing","thesis": "Eagle/Condor QPUs; Qiskit ecosystem & IBM Quantum Network"},
    {"symbol": "ARQQ",  "name": "Arqit Quantum",      "layer": "Quantum Computing","thesis": "Quantum-safe satellite encryption for enterprise & govt"},
    {"symbol": "MSFT",  "name": "Microsoft",          "layer": "Quantum Computing","thesis": "Azure Quantum, topological qubit research program"},
    # Robotics & Automation
    {"symbol": "ISRG",  "name": "Intuitive Surgical", "layer": "Robotics",         "thesis": "Da Vinci surgical robot monopoly; AI-guided procedures"},
    {"symbol": "TER",   "name": "Teradyne",           "layer": "Robotics",         "thesis": "Universal Robots cobots + semiconductor test equipment"},
    {"symbol": "ROK",   "name": "Rockwell Automation","layer": "Robotics",         "thesis": "Industrial automation & AI-driven smart manufacturing"},
    {"symbol": "CGNX",  "name": "Cognex",             "layer": "Robotics",         "thesis": "Machine vision — the eyes of industrial & warehouse robots"},
    {"symbol": "PATH",  "name": "UiPath",             "layer": "Robotics",         "thesis": "RPA + agentic AI automating enterprise software workflows"},
    {"symbol": "ABB",   "name": "ABB Ltd",            "layer": "Robotics",         "thesis": "Global leader in industrial robots & factory automation"},
    {"symbol": "HON",   "name": "Honeywell",          "layer": "Robotics",         "thesis": "Industrial automation, process control & AI sensors"},
    {"symbol": "TSLA",  "name": "Tesla",              "layer": "Robotics",         "thesis": "Optimus humanoid robot; FSD autonomous driving AI"},
    {"symbol": "NVDA",  "name": "NVIDIA",             "layer": "Robotics",         "thesis": "Isaac robotics platform; Jetson edge AI for robots"},
]


@app.get("/api/ai-stocks")
def get_ai_stocks():
    cached = cache_get("ai:stocks", _AI_TTL)
    if cached is not None:
        return cached

    unique_syms = list({s["symbol"] for s in _AI_STOCKS})
    perf: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        for fut in as_completed({pool.submit(_fetch_perf_one, s): s for s in unique_syms}):
            d = fut.result()
            perf[d["symbol"]] = d

    result = []
    for s in _AI_STOCKS:
        d = perf.get(s["symbol"], {"symbol": s["symbol"]})
        result.append({**d, "name": s["name"], "layer": s["layer"], "thesis": s["thesis"]})

    cache_set("ai:stocks", result)
    return result


# ── AI analyst actions ────────────────────────────────────────────────────────

@app.get("/api/ai-analyst-actions")
def get_ai_analyst_actions():
    cached = cache_get("ai:analyst", _AI_ANLST_TTL)
    if cached is not None:
        return cached

    ai_syms = list({s["symbol"] for s in _AI_STOCKS})
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
                    "symbol":      sym,
                    "firm":        str(row.get("Firm", "")),
                    "toGrade":     str(row.get("ToGrade", "")),
                    "fromGrade":   str(row.get("FromGrade", "")),
                    "action":      action,
                    "date":        ts.strftime("%Y-%m-%d"),
                    "priceTarget": _safe_float(row.get("currentPriceTarget")),
                })
            return result
        except Exception:
            return []

    with ThreadPoolExecutor(max_workers=10) as pool:
        for fut in as_completed([pool.submit(_for_sym, s) for s in ai_syms]):
            actions.extend(fut.result())

    actions.sort(key=lambda x: x["date"], reverse=True)
    result = {
        "upgrades":   [a for a in actions if a["action"] in ("up", "init")][:10],
        "downgrades": [a for a in actions if a["action"] == "down"][:10],
    }
    cache_set("ai:analyst", result)
    return result


# ── Analyst history ───────────────────────────────────────────────────────────

@app.get("/api/analyst-history/{symbol}")
def get_analyst_history(symbol: str):
    symbol = symbol.upper()
    cached = cache_get(f"analyst_hist:{symbol}", _ANLST_TTL)
    if cached is not None:
        return cached

    try:
        ticker     = yf.Ticker(symbol, session=_session)
        df         = ticker.upgrades_downgrades
        fi         = ticker.fast_info
        price      = _safe_float(fi.last_price)
        prev_close = _safe_float(fi.previous_close)
        change_pct = ((price - prev_close) / prev_close * 100) if price and prev_close else None
        info_name  = ticker.info.get("shortName") or ticker.info.get("longName") or symbol
    except Exception as exc:
        logger.warning("Analyst history failed for %s: %s", symbol, exc)
        result = {"symbol": symbol, "name": symbol, "price": None,
                  "changePct": None, "history": []}
        cache_set(f"analyst_hist:{symbol}", result)
        return result

    history = []
    if df is not None and not df.empty:
        cutoff = datetime.utcnow() - timedelta(days=365 * 2)
        recent = df[df.index >= cutoff]
        for ts, row in recent.iterrows():
            history.append({
                "date":      ts.strftime("%Y-%m-%d"),
                "firm":      str(row.get("Firm", "")),
                "toGrade":   str(row.get("ToGrade", "")),
                "fromGrade": str(row.get("FromGrade", "")),
                "action":    str(row.get("Action", "")).lower(),
                "ptAction":  str(row.get("priceTargetAction", "")),
                "currentPT": _safe_float(row.get("currentPriceTarget")),
                "priorPT":   _safe_float(row.get("priorPriceTarget")),
            })

    result = {
        "symbol":    symbol,
        "name":      info_name,
        "price":     price,
        "changePct": round(change_pct, 2) if change_pct is not None else None,
        "history":   history,
    }
    cache_set(f"analyst_hist:{symbol}", result)
    return result


# ── Day Trader scanners ───────────────────────────────────────────────────────

_DAY_TRADER_TTL = timedelta(minutes=5)


@app.get("/api/day-trader/scanners")
def get_day_trader_scanners():
    cached = cache_get("day_trader:scanners", _DAY_TRADER_TTL)
    if cached is not None:
        return cached

    with ThreadPoolExecutor(max_workers=3) as pool:
        f_gainers = pool.submit(_fetch_screener_quotes, "day_gainers")
        f_losers  = pool.submit(_fetch_screener_quotes, "day_losers")
        f_active  = pool.submit(_fetch_screener_quotes, "most_actives")
        result = {
            "gainers":    f_gainers.result(),
            "losers":     f_losers.result(),
            "mostActive": f_active.result(),
        }

    cache_set("day_trader:scanners", result)
    return result


@app.get("/api/day-trader/news")
def get_day_trader_news():
    cached = cache_get("day_trader:news", _DAY_TRADER_TTL)
    if cached is not None:
        return cached

    # Pull symbols from the scanner cache (or fall back to liquid defaults)
    scan = cache_get("day_trader:scanners", _DAY_TRADER_TTL) or {}
    seen_syms: set[str] = set()
    symbols: list[str] = []
    for key in ("gainers", "losers", "mostActive"):
        for s in (scan.get(key) or [])[:4]:
            sym = s.get("symbol", "")
            if sym and sym not in seen_syms:
                seen_syms.add(sym)
                symbols.append(sym)
    if not symbols:
        symbols = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA", "META", "AMZN"]

    def _fetch_sym_news(sym: str) -> list[dict]:
        return [{"symbol": sym, **a} for a in _fetch_feed(sym)[:4]]

    raw: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(symbols), 8)) as pool:
        for articles in pool.map(_fetch_sym_news, symbols):
            raw.extend(articles)

    # Deduplicate by link
    seen_links: set[str] = set()
    articles: list[dict] = []
    for a in raw:
        if a["link"] not in seen_links:
            seen_links.add(a["link"])
            articles.append(a)

    articles.sort(key=lambda a: a.get("publishedAt") or "", reverse=True)
    result = articles[:20]
    cache_set("day_trader:news", result)
    return result


# ── Watchlist ─────────────────────────────────────────────────────────────────

class SymbolIn(BaseModel):
    symbol: str
    list:   str = "default"


@app.get("/api/watchlists")
def list_watchlists():
    """Return all watchlist names with symbol counts."""
    with db_session() as db:
        default_count = db.query(WatchlistSymbol).count()
        groups = db.query(WatchlistGroup.list_name).distinct().all()
    names = ["default"] + [g[0] for g in groups if g[0] != "default"]
    result = [{"name": "default", "count": default_count}]
    with db_session() as db:
        for name in names[1:]:
            cnt = db.query(WatchlistGroup).filter(WatchlistGroup.list_name == name).count()
            result.append({"name": name, "count": cnt})
    return result


@app.post("/api/watchlists", status_code=201)
def create_watchlist(body: dict):
    name = (body.get("name") or "").strip()
    if not name or name == "default":
        raise HTTPException(400, "Invalid list name")
    return {"name": name}


@app.delete("/api/watchlists/{name}", status_code=204)
def delete_watchlist(name: str):
    if name == "default":
        raise HTTPException(400, "Cannot delete default watchlist")
    with db_session() as db:
        db.query(WatchlistGroup).filter(WatchlistGroup.list_name == name).delete()


@app.get("/api/watchlist")
def get_watchlist(list: str = "default"):
    if list == "default":
        with db_session() as db:
            rows = db.query(WatchlistSymbol).order_by(WatchlistSymbol.added_at).all()
            return [r.symbol for r in rows]
    with db_session() as db:
        rows = db.query(WatchlistGroup).filter(WatchlistGroup.list_name == list).order_by(WatchlistGroup.added_at).all()
        return [r.symbol for r in rows]


@app.post("/api/watchlist", status_code=201)
def add_to_watchlist(body: SymbolIn):
    sym = body.symbol.strip().upper()
    if not sym:
        raise HTTPException(400, "Symbol required")
    list_name = body.list or "default"
    if list_name == "default":
        with db_session() as db:
            if not db.query(WatchlistSymbol).filter(WatchlistSymbol.symbol == sym).first():
                db.add(WatchlistSymbol(symbol=sym))
    else:
        with db_session() as db:
            if not db.query(WatchlistGroup).filter(WatchlistGroup.list_name == list_name, WatchlistGroup.symbol == sym).first():
                db.add(WatchlistGroup(list_name=list_name, symbol=sym))
    return {"symbol": sym}


@app.delete("/api/watchlist/{symbol}", status_code=204)
def remove_from_watchlist(symbol: str, list: str = "default"):
    symbol = symbol.upper()
    if list == "default":
        with db_session() as db:
            row = db.query(WatchlistSymbol).filter(WatchlistSymbol.symbol == symbol).first()
            if row:
                db.delete(row)
    else:
        with db_session() as db:
            row = db.query(WatchlistGroup).filter(WatchlistGroup.list_name == list, WatchlistGroup.symbol == symbol).first()
            if row:
                db.delete(row)


# ── Portfolio ─────────────────────────────────────────────────────────────────

class PositionIn(BaseModel):
    symbol:  str
    shares:  float
    avgCost: float


@app.get("/api/portfolio")
def get_portfolio():
    with db_session() as db:
        rows = db.query(PortfolioPosition).order_by(PortfolioPosition.added_at).all()
        return [
            {"id": r.id, "symbol": r.symbol, "shares": r.shares, "avgCost": r.avg_cost}
            for r in rows
        ]


@app.post("/api/portfolio", status_code=201)
def add_position(body: PositionIn):
    sym = body.symbol.strip().upper()
    if not sym:
        raise HTTPException(400, "Symbol required")
    if body.shares <= 0:
        raise HTTPException(400, "Shares must be positive")
    if body.avgCost <= 0:
        raise HTTPException(400, "Avg cost must be positive")
    with db_session() as db:
        pos = PortfolioPosition(symbol=sym, shares=body.shares, avg_cost=body.avgCost)
        db.add(pos)
        db.flush()
        return {"id": pos.id, "symbol": pos.symbol, "shares": pos.shares, "avgCost": pos.avg_cost}


@app.delete("/api/portfolio/{position_id}", status_code=204)
def remove_position(position_id: int):
    with db_session() as db:
        row = db.query(PortfolioPosition).filter(PortfolioPosition.id == position_id).first()
        if row:
            db.delete(row)


# ── Earnings Calendar ─────────────────────────────────────────────────────────

_EARNINGS_TTL = timedelta(hours=4)


def _fetch_earnings(sym: str):
    cache_key = f"earnings:{sym}"
    cached = cache_get(cache_key, _EARNINGS_TTL)
    if cached is not None:
        return cached

    try:
        cal = yf.Ticker(sym, session=_session).calendar
        if not cal or "Earnings Date" not in cal:
            result = None
        else:
            dates = cal["Earnings Date"]
            if not dates:
                result = None
            else:
                # Take the first (soonest) upcoming date
                d = dates[0]
                date_str = d.isoformat() if hasattr(d, "isoformat") else str(d)
                today = datetime.utcnow().date()
                parsed = d if hasattr(d, "year") else None
                days_until = (parsed - today).days if parsed else None
                result = {
                    "symbol":           sym,
                    "date":             date_str,
                    "daysUntil":        days_until,
                    "epsEstimate":      cal.get("Earnings Average"),
                    "epsLow":           cal.get("Earnings Low"),
                    "epsHigh":          cal.get("Earnings High"),
                    "revenueEstimate":  cal.get("Revenue Average"),
                }
    except Exception as e:
        logger.warning("earnings fetch failed %s: %s", sym, e)
        result = None

    cache_set(cache_key, result)
    return result


@app.get("/api/earnings/upcoming")
def get_upcoming_earnings(symbols: str = ""):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []

    results = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(_fetch_earnings, s): s for s in syms}
        for f in as_completed(futures):
            data = f.result()
            if data and data.get("daysUntil") is not None and data["daysUntil"] <= 90:
                results.append(data)

    results.sort(key=lambda x: x["daysUntil"])
    return results


# ── Portfolio Risk Data ───────────────────────────────────────────────────────

@app.get("/api/market/risk-data")
def get_risk_data():
    """Return SPY 90-day volatility and current risk-free rate estimate."""
    try:
        spy = yf.Ticker("SPY")
        hist = spy.history(period="3mo")
        daily_returns = hist["Close"].pct_change().dropna()
        daily_vol    = float(daily_returns.std())
        annual_vol   = daily_vol * (252 ** 0.5)
        spy_1yr_ret  = float((hist["Close"].iloc[-1] / hist["Close"].iloc[0]) - 1) if len(hist) > 1 else 0.0
        return {
            "spy_daily_vol":  daily_vol,
            "spy_annual_vol": annual_vol,
            "spy_1yr_return": spy_1yr_ret,
            "risk_free_rate": 0.045,   # ~4.5% — approximate 3-mo T-bill
            "error": None,
        }
    except Exception as e:
        logger.warning("risk-data fallback: %s", e)
        return {
            "spy_daily_vol":  0.0095,
            "spy_annual_vol": 0.155,
            "spy_1yr_return": 0.12,
            "risk_free_rate": 0.045,
            "error": str(e),
        }


# ── Price Alerts ──────────────────────────────────────────────────────────────

def _alert_row(r):
    return {
        "id":            r.id,
        "symbol":        r.symbol,
        "target_price":  r.target_price,
        "condition":     r.condition,
        "note":          r.note or "",
        "status":        r.status,
        "alert_type":    getattr(r, "alert_type", None) or "price",
        "trigger_value": getattr(r, "trigger_value", None),
        "created_at":    r.created_at.isoformat(),
        "triggered_at":  r.triggered_at.isoformat() if r.triggered_at else None,
    }


@app.get("/api/alerts")
def list_alerts():
    with db_session() as db:
        rows = db.query(PriceAlert).order_by(PriceAlert.created_at.desc()).all()
        return [_alert_row(r) for r in rows]


class AlertCreate(BaseModel):
    symbol:        str
    target_price:  float
    condition:     str         # 'above' | 'below'
    note:          str = ""
    alert_type:    str = "price"   # 'price' | 'pct_change' | 'week52_break' | 'volume_spike'
    trigger_value: float | None = None


@app.post("/api/alerts", status_code=201)
def create_alert(body: AlertCreate):
    body.symbol = body.symbol.upper()
    if body.condition not in ("above", "below"):
        raise HTTPException(400, "condition must be 'above' or 'below'")
    valid_types = {"price", "pct_change", "week52_break", "volume_spike"}
    if body.alert_type not in valid_types:
        body.alert_type = "price"
    with db_session() as db:
        row = PriceAlert(
            symbol=body.symbol,
            target_price=body.target_price,
            condition=body.condition,
            note=body.note,
            alert_type=body.alert_type,
            trigger_value=body.trigger_value,
        )
        db.add(row)
        db.flush()
        return _alert_row(row)


@app.delete("/api/alerts/{alert_id}", status_code=204)
def delete_alert(alert_id: int):
    with db_session() as db:
        row = db.query(PriceAlert).filter(PriceAlert.id == alert_id).first()
        if row:
            db.delete(row)


@app.patch("/api/alerts/{alert_id}/trigger")
def trigger_alert(alert_id: int):
    with db_session() as db:
        row = db.query(PriceAlert).filter(PriceAlert.id == alert_id).first()
        if row and row.status == "active":
            row.status = "triggered"
            row.triggered_at = datetime.utcnow()
    return {"ok": True}


@app.patch("/api/alerts/{alert_id}/dismiss")
def dismiss_alert(alert_id: int):
    with db_session() as db:
        row = db.query(PriceAlert).filter(PriceAlert.id == alert_id).first()
        if row:
            row.status = "dismissed"
    return {"ok": True}


# ── Portfolio Performance vs Benchmark ───────────────────────────────────────

class PerfRequest(BaseModel):
    symbols: List[str]
    weights: List[float]   # fractional weights summing to 1.0
    period:  str = "1y"    # 3mo | 6mo | 1y | 2y


@app.post("/api/portfolio/performance")
def get_portfolio_performance(body: PerfRequest):
    """
    Return daily cumulative returns (%) for the weighted portfolio,
    SPY, and QQQ over the requested lookback period.
    """
    period_map = {"3mo": "3mo", "6mo": "6mo", "1y": "1y", "2y": "2y"}
    yf_period = period_map.get(body.period, "1y")

    all_syms = list(set(body.symbols + ["SPY", "QQQ"]))
    try:
        raw = yf.download(
            all_syms, period=yf_period, interval="1d",
            auto_adjust=True, progress=False,
            session=_session,
        )
        closes = raw["Close"] if "Close" in raw else raw
    except Exception as e:
        raise HTTPException(500, f"yfinance error: {e}")

    if closes.empty:
        raise HTTPException(500, "No price data returned")

    closes = closes.dropna(how="all").ffill()

    # Drop leading rows where all portfolio symbols are still NaN after ffill
    port_cols = [s for s in body.symbols if s in closes.columns]
    closes = closes.dropna(subset=port_cols, how="all")
    if closes.empty:
        raise HTTPException(500, "No overlapping price data for the requested period")

    # Normalise: pct return from day-0 for each symbol
    norm = (closes / closes.iloc[0] - 1) * 100

    # Weighted portfolio return
    port_series = None
    for sym, w in zip(body.symbols, body.weights):
        if sym not in norm.columns:
            continue
        s = norm[sym].ffill() * w
        port_series = s if port_series is None else port_series + s

    if port_series is None:
        raise HTTPException(500, "Could not compute portfolio series")

    dates = [str(d.date()) for d in closes.index]

    def to_list(series):
        return [None if (v is None or v != v) else round(float(v), 4) for v in series]

    spy = norm["SPY"].ffill() if "SPY" in norm.columns else None
    qqq = norm["QQQ"].ffill() if "QQQ" in norm.columns else None

    port_vals = to_list(port_series)
    spy_vals  = to_list(spy)  if spy  is not None else []
    qqq_vals  = to_list(qqq)  if qqq  is not None else []

    # Summary stats (use last valid value)
    def last_valid(lst):
        for v in reversed(lst):
            if v is not None:
                return v
        return 0.0

    port_ret = last_valid(port_vals)
    spy_ret  = last_valid(spy_vals)
    qqq_ret  = last_valid(qqq_vals)
    alpha_spy = port_ret - spy_ret
    alpha_qqq = port_ret - qqq_ret

    # Tracking error vs SPY (annualised std dev of daily return differences)
    if spy is not None and len(port_series) > 2:
        daily_port = port_series.diff().dropna()
        daily_spy  = spy.diff().dropna()
        common_idx = daily_port.index.intersection(daily_spy.index)
        if len(common_idx) > 1:
            diff = daily_port.loc[common_idx].values - daily_spy.loc[common_idx].values
            tracking_error = float(np.std(diff) * (252 ** 0.5))
        else:
            tracking_error = None
    else:
        tracking_error = None

    return {
        "dates":          dates,
        "portfolio":      port_vals,
        "spy":            spy_vals,
        "qqq":            qqq_vals,
        "portfolio_ret":  port_ret,
        "spy_ret":        spy_ret,
        "qqq_ret":        qqq_ret,
        "alpha_spy":      alpha_spy,
        "alpha_qqq":      alpha_qqq,
        "tracking_error": tracking_error,
        "period":         body.period,
    }


# ── AI Chat ───────────────────────────────────────────────────────────────────

_FINANCE_SYSTEM = """You are an expert financial advisor and investment analyst with deep knowledge of:
- Equity markets, stock analysis, and valuation methodologies (DCF, P/E, EV/EBITDA, etc.)
- Options strategies, derivatives, and risk management
- Technical analysis: chart patterns, indicators (RSI, MACD, Bollinger Bands, moving averages)
- Fundamental analysis: earnings, revenue growth, margins, balance sheets, cash flow
- Macro economics: Fed policy, interest rates, inflation, GDP, employment data
- Sector dynamics: technology, healthcare, energy, financials, consumer, industrials
- ETFs, mutual funds, fixed income, REITs, commodities, crypto
- Day trading, swing trading, and long-term investing strategies
- Portfolio construction, diversification, and risk-adjusted returns

Guidelines:
- Provide concrete, actionable analysis grounded in financial data and theory
- Explain your reasoning clearly, referencing relevant metrics and frameworks
- When discussing specific stocks, include key metrics, risks, and catalysts
- Always note that your analysis is informational and not personalized financial advice
- Be direct and specific — avoid vague generalities
- Use markdown formatting: **bold** for key terms, bullet points for lists, tables where helpful"""


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]


@app.post("/api/ai-chat")
def ai_chat(body: ChatRequest):
    def generate():
        try:
            client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                system=[{"type": "text", "text": _FINANCE_SYSTEM,
                          "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": m.role, "content": m.content} for m in body.messages],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            logger.error("AI chat error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Financial Advisor ─────────────────────────────────────────────────────────

_PLANNER_SYSTEM = """You are an expert Certified Financial Planner (CFP) and portfolio manager with 20+ years of experience in asset allocation, retirement planning, tax-efficient investing, and wealth management.

CRITICAL OUTPUT FORMAT — follow exactly:

Your response MUST begin with this allocation JSON block (no text before it):
```allocation
{"Asset Class Name": integer_percentage, ...}
```
All allocation percentages must be whole integers summing to exactly 100.
Use precise asset class names such as: US Large Cap Equities, US Small/Mid Cap, International Developed Markets, Emerging Markets, US Investment Grade Bonds, US Treasuries/TIPS, High Yield Bonds, International Bonds, REITs, Commodities/Gold, Cash & Equivalents, Alternative Investments.

After the block, provide analysis in these EXACT sections with ## headings:

## Strategy Overview
2-3 sentences on the philosophy and rationale for this specific investor profile.

## Asset Class Breakdown
A markdown table with columns: | Asset Class | Allocation | Role in Portfolio | Recommended ETFs (ticker) |
Include 1-2 low-cost ETF tickers per row.

## Projected Portfolio Growth
Show a simple table: | Scenario | Annual Return | Value at End of Horizon | Total Gain |
Include Conservative, Base Case, and Optimistic rows. Use the actual initial amount and monthly contribution provided.

## Bull Market Scenario
Describe performance in sustained favorable conditions: expected annualized return, cumulative gain, peak portfolio value.

## Bear Market Stress Test
Describe worst-case drawdown: peak-to-trough decline (%), approximate recovery time, portfolio value at the trough, and long-term impact.

## Rebalancing Strategy
How often, which triggers (threshold-based vs calendar), and tax-efficient methods.

## Tax Optimization
Account-type-specific recommendations (asset location strategy).

## Key Risks & Mitigations
A table: | Risk | Severity | Mitigation Strategy |
List 4-5 specific risks relevant to this investor profile.

Be specific with numbers. Note this is educational analysis, not personalized financial advice."""


class FinancialPlanRequest(BaseModel):
    goal: str
    horizon_years: int
    initial_amount: float
    monthly_contribution: float
    risk_tolerance: str
    age: int
    tax_situation: str
    geography: str


@app.post("/api/financial-plan")
def financial_plan(req: FinancialPlanRequest):
    goal_labels = {
        "retirement": "Retirement",
        "house": "Home Purchase",
        "education": "Education / College Fund",
        "wealth": "Long-term Wealth Building",
        "income": "Income Generation / Dividends",
        "preservation": "Capital Preservation",
    }
    geo_labels = {
        "us_focused": "US-focused (minimal international exposure)",
        "global": "Globally diversified (US + international)",
        "em_tilt": "Global with emerging markets tilt",
    }
    tax_labels = {
        "taxable": "Taxable brokerage account",
        "roth_ira": "Roth IRA (tax-free growth)",
        "trad_ira": "Traditional IRA (tax-deferred)",
        "401k": "401(k) / 403(b) employer plan",
        "mix": "Mix of taxable and tax-advantaged accounts",
    }

    prompt = f"""Create a comprehensive investment strategy for the following investor profile:

**Goal:** {goal_labels.get(req.goal, req.goal)}
**Investment Horizon:** {req.horizon_years} years
**Starting Capital:** ${req.initial_amount:,.0f}
**Monthly Contribution:** ${req.monthly_contribution:,.0f}/month
**Risk Tolerance:** {req.risk_tolerance.capitalize()}
**Investor Age:** {req.age} years old
**Account Type:** {tax_labels.get(req.tax_situation, req.tax_situation)}
**Geographic Focus:** {geo_labels.get(req.geography, req.geography)}

Total capital deployed over horizon: ${req.initial_amount + req.monthly_contribution * req.horizon_years * 12:,.0f}

Please provide a full investment strategy following the required output format."""

    def generate():
        try:
            client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=3500,
                system=[{"type": "text", "text": _PLANNER_SYSTEM,
                          "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            logger.error("Financial plan error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Screener ─────────────────────────────────────────────────────────────────

_SCREEN_TTL = timedelta(minutes=20)

SCREENER_UNIVERSE = [
    "AAPL","MSFT","GOOGL","AMZN","NVDA","META","TSLA","LLY","V","JPM",
    "XOM","UNH","MA","JNJ","AVGO","PG","MRK","HD","COST","ABBV",
    "CVX","CRM","BAC","NFLX","AMD","KO","PEP","TMO","WMT","ACN",
    "MCD","CSCO","DIS","ADBE","INTC","CMCSA","WFC","IBM","ORCL","INTU",
    "GE","CAT","UBER","BKNG","GS","AXP","SPGI","ISRG","NOW","TXN",
    "NEE","HON","PM","AMGN","SYK","BLK","LOW","UNP","MS","BMY",
    "PLD","RTX","C","SCHW","DE","ADI","VRTX","GILD","AMAT","ZTS",
    "ETN","PANW","BSX","MU","NKE","CB","MDLZ","SO","KLAC","LRCX",
    "SNPS","CDNS","MAR","ELV","TGT","CI","PNC","CME","APH","FCX",
    "NSC","MMC","EMR","TJX","WELL","AON","FTNT","SHW","FICO","SPOT",
]


def _calc_rsi(prices, period=14):
    delta = prices.diff()
    gain  = delta.clip(lower=0).rolling(period).mean()
    loss  = (-delta.clip(upper=0)).rolling(period).mean()
    rs    = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


@app.get("/api/screener/technical")
def technical_screener(scan: str = "52w_high"):
    cache_key = f"screener:tech:{scan}"
    cached = cache_get(cache_key, _SCREEN_TTL)
    if cached is not None:
        return cached

    valid_scans = {"52w_high", "golden_cross", "death_cross", "rsi_oversold", "rsi_overbought", "high_volume", "short_interest"}
    if scan not in valid_scans:
        raise HTTPException(400, f"scan must be one of {valid_scans}")

    try:
        raw = yf.download(SCREENER_UNIVERSE, period="1y", interval="1d",
                          auto_adjust=True, progress=False, session=_session)
        closes  = raw["Close"].dropna(how="all")
        volumes = raw["Volume"].dropna(how="all")
    except Exception as e:
        raise HTTPException(500, str(e))

    results = []
    for sym in SCREENER_UNIVERSE:
        if sym not in closes.columns:
            continue
        prices = closes[sym].dropna()
        vols   = volumes[sym].dropna() if sym in volumes.columns else None
        if len(prices) < 60:
            continue

        price   = float(prices.iloc[-1])
        chg_pct = float((prices.iloc[-1] / prices.iloc[-2] - 1) * 100) if len(prices) >= 2 else 0.0
        vol_today = float(vols.iloc[-1]) if vols is not None and len(vols) > 0 else None

        row = {"symbol": sym, "price": round(price, 2), "changePercent": round(chg_pct, 2),
               "volume": int(vol_today) if vol_today else None}

        if scan == "52w_high":
            high = float(prices.max())
            pct_from_high = round((price / high - 1) * 100, 2)
            if pct_from_high >= -3:
                row.update({"high52w": round(high, 2), "pctFromHigh": pct_from_high})
                results.append(row)

        elif scan in ("golden_cross", "death_cross"):
            if len(prices) < 200:
                continue
            ma50  = prices.rolling(50).mean()
            ma200 = prices.rolling(200).mean()
            # Look for crossover within the last 30 days
            diff = ma50 - ma200
            sign_changes = (diff > 0).astype(int).diff().abs()
            recent = sign_changes.iloc[-30:]
            crossed = recent.sum() > 0
            is_golden = float(ma50.iloc[-1]) > float(ma200.iloc[-1])
            if (scan == "golden_cross" and is_golden and crossed) or \
               (scan == "death_cross"  and not is_golden and crossed):
                row.update({"ma50": round(float(ma50.iloc[-1]), 2),
                            "ma200": round(float(ma200.iloc[-1]), 2)})
                results.append(row)

        elif scan in ("rsi_oversold", "rsi_overbought"):
            rsi_series = _calc_rsi(prices)
            rsi_val    = float(rsi_series.iloc[-1])
            if rsi_val != rsi_val:
                continue
            if (scan == "rsi_oversold"  and rsi_val < 30) or \
               (scan == "rsi_overbought" and rsi_val > 70):
                row.update({"rsi": round(rsi_val, 1)})
                results.append(row)

        elif scan == "high_volume":
            if vols is None or len(vols) < 22:
                continue
            avg_vol_20 = float(vols.iloc[-21:-1].mean())
            if avg_vol_20 > 0 and vol_today and vol_today >= 2 * avg_vol_20:
                row.update({"avgVolume20d": int(avg_vol_20),
                            "volRatio": round(vol_today / avg_vol_20, 1)})
                results.append(row)

    if scan == "short_interest":
        def _fetch_si(sym2):
            f = _fetch_fundamentals(sym2)
            si_pct = f.get("shortPercentOfFloat")
            if si_pct is not None and si_pct > 0.10:
                price2 = None
                try:
                    if sym2 in closes.columns:
                        price2 = round(float(closes[sym2].dropna().iloc[-1]), 2)
                except Exception:
                    pass
                return {
                    "symbol": sym2,
                    "price": price2,
                    "shortPercentOfFloat": round(si_pct * 100, 1),
                    "shortRatio": round(float(f["shortRatio"]), 1) if f.get("shortRatio") else None,
                    "marketCap": f.get("marketCap"),
                    "sector": f.get("sector"),
                }
            return None
        with ThreadPoolExecutor(max_workers=10) as ex2:
            for item in ex2.map(_fetch_si, SCREENER_UNIVERSE):
                if item:
                    results.append(item)
        results.sort(key=lambda x: x.get("shortPercentOfFloat", 0), reverse=True)
        cache_set(cache_key, results)
        return results

    results.sort(key=lambda x: x.get("pctFromHigh", x.get("rsi", x.get("volRatio", 0))),
                 reverse=(scan not in ("rsi_oversold",)))
    cache_set(cache_key, results)
    return results


@app.get("/api/screener/fundamental")
def fundamental_screener(screen: str = "quality_growth"):
    cache_key = f"screener:fund:{screen}"
    cached = cache_get(cache_key, _SCREEN_TTL)
    if cached is not None:
        return cached

    presets = {
        "quality_growth":    lambda f: (f.get("profitMargin") or 0) > 0.15 and (f.get("revenueGrowth") or 0) > 0.08 and (f.get("debtToEquity") or 999) < 150,
        "deep_value":        lambda f: 0 < (f.get("peRatio") or 999) < 15 and 0 < (f.get("priceToBook") or 999) < 2,
        "dividend_income":   lambda f: (f.get("dividendYield") or 0) > 0.02 and 0 < (f.get("peRatio") or 999) < 35,
        "momentum_quality":  lambda f: (f.get("roe") or 0) > 0.15 and (f.get("profitMargin") or 0) > 0.10,
    }
    if screen not in presets:
        raise HTTPException(400, f"screen must be one of {list(presets.keys())}")

    filt = presets[screen]
    results = []

    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(_fetch_fundamentals, sym): sym for sym in SCREENER_UNIVERSE}
        for f in as_completed(futures):
            data = f.result()
            if data and filt(data):
                results.append({
                    "symbol":        data["symbol"],
                    "name":          data.get("name", ""),
                    "price":         data.get("price"),
                    "peRatio":       data.get("peRatio"),
                    "forwardPE":     data.get("forwardPE"),
                    "profitMargin":  round((data.get("profitMargin") or 0) * 100, 1),
                    "revenueGrowth": round((data.get("revenueGrowth") or 0) * 100, 1),
                    "dividendYield": round((data.get("dividendYield") or 0) * 100, 2),
                    "debtToEquity":  data.get("debtToEquity"),
                    "roe":           round((data.get("roe") or 0) * 100, 1),
                    "marketCap":     data.get("marketCap"),
                    "sector":        data.get("sector"),
                })

    results.sort(key=lambda x: x.get("profitMargin") or 0, reverse=True)
    cache_set(cache_key, results)
    return results


# ── Earnings History ──────────────────────────────────────────────────────────

_EARN_HIST_TTL = timedelta(hours=6)


@app.get("/api/earnings/history/{symbol}")
def get_earnings_history(symbol: str):
    symbol = symbol.upper()
    cache_key = f"earnings:history:{symbol}"
    cached = cache_get(cache_key, _EARN_HIST_TTL)
    if cached is not None:
        return cached

    try:
        t  = yf.Ticker(symbol, session=_session)
        eh = t.earnings_history
        qi = t.quarterly_income_stmt

        quarters = []
        if eh is not None and not eh.empty:
            for idx, row in eh.iterrows():
                q_str = str(idx.date()) if hasattr(idx, "date") else str(idx)
                quarters.append({
                    "quarter":         q_str,
                    "epsActual":       _safe_float(row.get("epsActual")),
                    "epsEstimate":     _safe_float(row.get("epsEstimate")),
                    "epsSurprisePct":  _safe_float(row.get("surprisePercent")),
                    "revenueActual":   None,
                    "revenueEstimate": None,
                })

        # Attach revenue from quarterly income statement
        if qi is not None and not qi.empty:
            rev_rows = [r for r in qi.index if r == "Total Revenue"]
            if rev_rows:
                rev = qi.loc[rev_rows[0]]
                for q in quarters:
                    try:
                        q_ts = [c for c in rev.index if str(c.date()) == q["quarter"]]
                        if q_ts:
                            q["revenueActual"] = _safe_float(rev[q_ts[0]])
                    except Exception:
                        pass

        result = {"symbol": symbol, "quarters": list(reversed(quarters[-8:]))}
    except Exception as e:
        logger.warning("earnings history failed %s: %s", symbol, e)
        result = {"symbol": symbol, "quarters": []}

    cache_set(cache_key, result)
    return result


# ── Pre-Market Movers ─────────────────────────────────────────────────────────

_PREMARKET_TTL = timedelta(minutes=5)
_PREMARKET_UNIVERSE = [
    "AAPL","MSFT","GOOGL","AMZN","NVDA","META","TSLA","AMD","NFLX","CRM",
    "ORCL","ADBE","INTC","CSCO","QCOM","AMAT","LRCX","KLAC","MU","PANW",
    "UBER","LYFT","ABNB","SHOP","SNAP","SPOT","RBLX","COIN","HOOD","PLTR",
    "GME","AMC","BBBY","SPCE","RIVN","LCID","NIO","XPEV","LI","SOFI",
]


def _fetch_premarket(sym: str):
    try:
        t  = yf.Ticker(sym, session=_session)
        fi = t.fast_info
        pre  = getattr(fi, "pre_market_price",  None) or getattr(fi, "preMarketPrice",  None)
        post = getattr(fi, "post_market_price", None) or getattr(fi, "postMarketPrice", None)
        prev = getattr(fi, "previous_close", None)    or getattr(fi, "previousClose",   None)
        last = getattr(fi, "last_price", None)        or getattr(fi, "lastPrice",        None)
        mkt_price = pre or post
        base_price = prev or last
        if not mkt_price or not base_price or base_price <= 0:
            return None
        chg_pct = (mkt_price / base_price - 1) * 100
        if abs(chg_pct) < 1.0:  # skip small moves
            return None
        info = t.info
        return {
            "symbol":       sym,
            "name":         info.get("shortName") or info.get("longName") or sym,
            "preMarketPrice": round(float(mkt_price), 2),
            "previousClose":  round(float(base_price), 2),
            "changePercent":  round(float(chg_pct), 2),
            "isPreMarket":    pre is not None,
        }
    except Exception:
        return None


@app.get("/api/market/premarket-movers")
def get_premarket_movers():
    cache_key = "market:premarket"
    cached = cache_get(cache_key, _PREMARKET_TTL)
    if cached is not None:
        return cached

    movers = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(_fetch_premarket, sym): sym for sym in _PREMARKET_UNIVERSE}
        for f in as_completed(futures):
            data = f.result()
            if data:
                movers.append(data)

    movers.sort(key=lambda x: abs(x["changePercent"]), reverse=True)
    result = {"gainers": [m for m in movers if m["changePercent"] > 0][:10],
              "losers":  [m for m in movers if m["changePercent"] < 0][:10]}
    cache_set(cache_key, result)
    return result


# ── Options Chain ─────────────────────────────────────────────────────────────

_OPTIONS_TTL     = timedelta(minutes=15)
_DIVIDEND_TTL    = timedelta(hours=4)
_CORRELATION_TTL = timedelta(minutes=30)


@app.get("/api/options/{symbol}/expirations")
def get_option_expirations(symbol: str):
    sym = symbol.upper()
    key = f"options:exps:{sym}"
    cached = cache_get(key, _OPTIONS_TTL)
    if cached is not None:
        return cached
    try:
        dates = list(yf.Ticker(sym, session=_session).options)
        result = {"symbol": sym, "expirations": dates}
        cache_set(key, result)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/options/{symbol}")
def get_option_chain(symbol: str, expiry: str | None = None):
    sym = symbol.upper()
    key = f"options:chain:{sym}:{expiry}"
    cached = cache_get(key, _OPTIONS_TTL)
    if cached is not None:
        return cached
    try:
        ticker = yf.Ticker(sym, session=_session)
        if not expiry:
            exps = ticker.options
            if not exps:
                return {"calls": [], "puts": [], "putCallRatio": None, "expiry": None}
            expiry = exps[0]
        chain = ticker.option_chain(expiry)

        def process_df(df, side):
            rows = []
            for _, row in df.iterrows():
                vol = int(row.get("volume") or 0)
                oi  = int(row.get("openInterest") or 0)
                iv  = row.get("impliedVolatility")
                rows.append({
                    "strike":          round(float(row["strike"]), 2),
                    "bid":             round(float(row.get("bid") or 0), 2),
                    "ask":             round(float(row.get("ask") or 0), 2),
                    "lastPrice":       round(float(row.get("lastPrice") or 0), 2),
                    "volume":          vol,
                    "openInterest":    oi,
                    "impliedVolatility": round(float(iv) * 100, 1) if iv and not pd.isna(iv) else None,
                    "inTheMoney":      bool(row.get("inTheMoney", False)),
                    "unusual":         vol >= 500 and (oi == 0 or vol > oi * 2),
                })
            return rows

        calls = process_df(chain.calls, "call")
        puts  = process_df(chain.puts,  "put")
        total_call_oi = sum(r["openInterest"] for r in calls)
        total_put_oi  = sum(r["openInterest"] for r in puts)
        result = {
            "symbol": sym, "expiry": expiry,
            "calls": calls, "puts": puts,
            "putCallRatio": round(total_put_oi / total_call_oi, 2) if total_call_oi > 0 else None,
            "totalCallOI": total_call_oi, "totalPutOI": total_put_oi,
        }
        cache_set(key, result)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Trade Journal ─────────────────────────────────────────────────────────────

class JournalEntryIn(BaseModel):
    symbol:     str
    side:       str       # 'buy' | 'sell'
    price:      float
    shares:     float
    strategy:   str | None = None
    trade_date: str       # YYYY-MM-DD
    notes:      str | None = None


def _entry_dict(e) -> dict:
    return {
        "id": e.id, "symbol": e.symbol, "side": e.side,
        "price": e.price, "shares": e.shares, "strategy": e.strategy,
        "trade_date": e.trade_date, "notes": e.notes,
    }


@app.get("/api/journal")
def list_journal():
    with db_session() as db:
        entries = (
            db.query(TradeJournalEntry)
            .order_by(TradeJournalEntry.trade_date.desc(), TradeJournalEntry.created_at.desc())
            .all()
        )
        return [_entry_dict(e) for e in entries]


@app.post("/api/journal", status_code=201)
def add_journal_entry(body: JournalEntryIn):
    with db_session() as db:
        e = TradeJournalEntry(
            symbol=body.symbol.upper(), side=body.side,
            price=body.price, shares=body.shares,
            strategy=body.strategy, trade_date=body.trade_date, notes=body.notes,
        )
        db.add(e)
        db.flush()
        return _entry_dict(e)


@app.delete("/api/journal/{entry_id}", status_code=204)
def delete_journal_entry(entry_id: int):
    with db_session() as db:
        e = db.query(TradeJournalEntry).filter(TradeJournalEntry.id == entry_id).first()
        if not e:
            raise HTTPException(404, "Not found")
        db.delete(e)


@app.get("/api/journal/stats")
def get_journal_stats():
    from collections import defaultdict
    with db_session() as db:
        entries = (
            db.query(TradeJournalEntry)
            .order_by(TradeJournalEntry.trade_date, TradeJournalEntry.created_at)
            .all()
        )
    if not entries:
        return {"totalPnl": 0, "winRate": None, "tradeCount": 0, "closedTrades": 0,
                "wins": 0, "losses": 0, "byStrategy": {}}

    buys = defaultdict(list)  # symbol -> [[price, remaining_shares]]
    closed = []

    for e in entries:
        if e.side == "buy":
            buys[e.symbol].append([e.price, e.shares])
        elif e.side == "sell":
            remaining = e.shares
            realized  = 0.0
            q = buys[e.symbol]
            while remaining > 1e-9 and q:
                bp, bq = q[0]
                matched = min(remaining, bq)
                realized  += matched * (e.price - bp)
                q[0][1]   -= matched
                remaining -= matched
                if q[0][1] < 1e-9:
                    q.pop(0)
            closed.append({"strategy": e.strategy or "Other", "pnl": round(realized, 2)})

    total_pnl = round(sum(t["pnl"] for t in closed), 2)
    wins   = sum(1 for t in closed if t["pnl"] > 0)
    losses = sum(1 for t in closed if t["pnl"] < 0)

    by_strat = defaultdict(lambda: {"pnl": 0.0, "wins": 0, "losses": 0, "trades": 0})
    for t in closed:
        s = t["strategy"]
        by_strat[s]["pnl"]    = round(by_strat[s]["pnl"] + t["pnl"], 2)
        by_strat[s]["trades"] += 1
        if t["pnl"] > 0: by_strat[s]["wins"]   += 1
        elif t["pnl"] < 0: by_strat[s]["losses"] += 1

    return {
        "totalPnl": total_pnl,
        "winRate":  round(wins / len(closed) * 100, 1) if closed else None,
        "tradeCount": len(entries), "closedTrades": len(closed),
        "wins": wins, "losses": losses,
        "byStrategy": dict(by_strat),
    }


# ── Dividends ─────────────────────────────────────────────────────────────────

class DividendRequest(BaseModel):
    symbols: List[str]


@app.post("/api/dividends")
def get_dividends(body: DividendRequest):
    key = f"dividends:{'|'.join(sorted(body.symbols))}"
    cached = cache_get(key, _DIVIDEND_TTL)
    if cached is not None:
        return cached

    def fetch_div(sym: str):
        try:
            ticker = yf.Ticker(sym, session=_session)
            info   = ticker.info
            divs   = ticker.dividends
            history = []
            if len(divs) > 0:
                for ts, amt in divs.tail(8).items():
                    history.append({"date": str(ts.date()), "amount": round(float(amt), 4)})
            ex_ts = info.get("exDividendDate")
            ex_date = None
            if ex_ts:
                try:
                    ex_date = datetime.utcfromtimestamp(int(ex_ts)).strftime("%Y-%m-%d")
                except Exception:
                    pass
            return {
                "symbol":        sym,
                "dividendRate":  _safe_float(info.get("dividendRate")),
                "dividendYield": round(float(info.get("dividendYield") or 0) * 100, 2),
                "exDividendDate": ex_date,
                "payoutRatio":   _safe_float(info.get("payoutRatio")),
                "lastDividend":  round(float(divs.iloc[-1]), 4) if len(divs) > 0 else None,
                "history":       history,
                "paysDividend":  bool((info.get("dividendRate") or 0) > 0),
            }
        except Exception:
            return {"symbol": sym, "error": True, "paysDividend": False, "history": []}

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(fetch_div, body.symbols))

    cache_set(key, results)
    return results


# ── Correlation Matrix ────────────────────────────────────────────────────────

class CorrRequest(BaseModel):
    symbols: List[str]
    period:  str = "3mo"


@app.post("/api/portfolio/correlation")
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


# ── Economic Calendar ─────────────────────────────────────────────────────────

_ECON_EVENTS = [
    # FOMC decisions — 2026
    {"date": "2026-06-17", "event": "FOMC Rate Decision",  "type": "fomc", "description": "Federal Reserve interest rate decision and press conference"},
    {"date": "2026-07-29", "event": "FOMC Rate Decision",  "type": "fomc", "description": "Federal Reserve interest rate decision"},
    {"date": "2026-09-16", "event": "FOMC Rate Decision",  "type": "fomc", "description": "Federal Reserve interest rate decision and press conference"},
    {"date": "2026-10-28", "event": "FOMC Rate Decision",  "type": "fomc", "description": "Federal Reserve interest rate decision"},
    {"date": "2026-12-09", "event": "FOMC Rate Decision",  "type": "fomc", "description": "Federal Reserve interest rate decision and press conference"},
    # CPI — approximate BLS release schedule
    {"date": "2026-06-10", "event": "CPI Release",          "type": "cpi",  "description": "Consumer Price Index — May 2026"},
    {"date": "2026-07-14", "event": "CPI Release",          "type": "cpi",  "description": "Consumer Price Index — June 2026"},
    {"date": "2026-08-12", "event": "CPI Release",          "type": "cpi",  "description": "Consumer Price Index — July 2026"},
    {"date": "2026-09-10", "event": "CPI Release",          "type": "cpi",  "description": "Consumer Price Index — August 2026"},
    {"date": "2026-10-13", "event": "CPI Release",          "type": "cpi",  "description": "Consumer Price Index — September 2026"},
    # PPI
    {"date": "2026-06-11", "event": "PPI Release",          "type": "ppi",  "description": "Producer Price Index — May 2026"},
    {"date": "2026-07-15", "event": "PPI Release",          "type": "ppi",  "description": "Producer Price Index — June 2026"},
    {"date": "2026-08-13", "event": "PPI Release",          "type": "ppi",  "description": "Producer Price Index — July 2026"},
    {"date": "2026-09-11", "event": "PPI Release",          "type": "ppi",  "description": "Producer Price Index — August 2026"},
    # Jobs reports — first Friday of month
    {"date": "2026-06-05", "event": "Jobs Report",          "type": "jobs", "description": "Non-Farm Payrolls — May 2026"},
    {"date": "2026-07-02", "event": "Jobs Report",          "type": "jobs", "description": "Non-Farm Payrolls — June 2026"},
    {"date": "2026-08-07", "event": "Jobs Report",          "type": "jobs", "description": "Non-Farm Payrolls — July 2026"},
    {"date": "2026-09-04", "event": "Jobs Report",          "type": "jobs", "description": "Non-Farm Payrolls — August 2026"},
    {"date": "2026-10-02", "event": "Jobs Report",          "type": "jobs", "description": "Non-Farm Payrolls — September 2026"},
    # PCE inflation
    {"date": "2026-05-29", "event": "PCE Inflation",        "type": "pce",  "description": "Personal Consumption Expenditures — April 2026"},
    {"date": "2026-06-26", "event": "PCE Inflation",        "type": "pce",  "description": "Personal Consumption Expenditures — May 2026"},
    {"date": "2026-07-31", "event": "PCE Inflation",        "type": "pce",  "description": "Personal Consumption Expenditures — June 2026"},
    {"date": "2026-08-28", "event": "PCE Inflation",        "type": "pce",  "description": "Personal Consumption Expenditures — July 2026"},
    # GDP advance estimates
    {"date": "2026-06-25", "event": "GDP (Advance)",        "type": "gdp",  "description": "Q1 2026 GDP advance estimate"},
    {"date": "2026-09-25", "event": "GDP (Advance)",        "type": "gdp",  "description": "Q2 2026 GDP advance estimate"},
]


@app.get("/api/market/economic-calendar")
def get_economic_calendar():
    today = datetime.utcnow().date()
    events = []
    for e in _ECON_EVENTS:
        ev_date = datetime.strptime(e["date"], "%Y-%m-%d").date()
        days_until = (ev_date - today).days
        if -7 <= days_until <= 120:
            events.append({**e, "daysUntil": days_until})
    return sorted(events, key=lambda x: x["daysUntil"])


# ── Insider Transactions ──────────────────────────────────────────────────────

_INSIDER_TTL = timedelta(hours=4)
_ANALYST_TTL = timedelta(hours=4)


@app.get("/api/insider/{symbol}")
def get_insider_transactions(symbol: str):
    sym = symbol.upper()
    key = f"insider:{sym}"
    cached = cache_get(key, _INSIDER_TTL)
    if cached is not None:
        return cached
    try:
        df = yf.Ticker(sym, session=_session).insider_transactions
        if df is None or len(df) == 0:
            result = {"symbol": sym, "transactions": []}
            cache_set(key, result)
            return result

        rows = []
        for _, row in df.iterrows():
            date_val = (row.get("Start Date") or row.get("startDate")
                        or row.get("Date") or row.get("date"))
            date_str = None
            if date_val is not None:
                try:
                    date_str = str(pd.Timestamp(date_val).date())
                except Exception:
                    date_str = str(date_val)

            shares = row.get("Shares") or row.get("shares")
            value  = row.get("Value") or row.get("value")
            text   = (row.get("Text") or row.get("Transaction")
                      or row.get("transaction") or "")
            insider   = row.get("Insider") or row.get("insider")
            position  = row.get("Position") or row.get("Title") or ""

            shares_v = int(shares) if shares is not None and not pd.isna(shares) else None
            value_v  = round(float(value), 0) if value is not None and not pd.isna(value) else None

            rows.append({
                "date":     date_str,
                "insider":  str(insider) if insider else None,
                "position": str(position) if position else None,
                "transaction": str(text),
                "shares":   shares_v,
                "value":    value_v,
            })

        result = {"symbol": sym, "transactions": rows[:40]}
        cache_set(key, result)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Analyst Ratings ───────────────────────────────────────────────────────────

@app.get("/api/analyst/{symbol}")
def get_analyst_data(symbol: str):
    sym = symbol.upper()
    key = f"analyst:{sym}"
    cached = cache_get(key, _ANALYST_TTL)
    if cached is not None:
        return cached
    try:
        ticker = yf.Ticker(sym, session=_session)
        info   = ticker.info

        # Recommendation history (monthly summary)
        rec_hist = []
        try:
            recs = ticker.recommendations
            if recs is not None and len(recs) > 0:
                cols = list(recs.columns)
                if "strongBuy" in cols or "strong_buy" in cols:
                    for _, r in recs.tail(8).iterrows():
                        rec_hist.append({
                            "period":    str(r.get("period", r.name)),
                            "strongBuy": int(r.get("strongBuy", r.get("strong_buy", 0)) or 0),
                            "buy":       int(r.get("buy", 0) or 0),
                            "hold":      int(r.get("hold", 0) or 0),
                            "sell":      int(r.get("sell", 0) or 0),
                            "strongSell":int(r.get("strongSell", r.get("strong_sell", 0)) or 0),
                        })
                else:
                    for _, r in recs.tail(12).iterrows():
                        rec_hist.append({
                            "date":      str(pd.Timestamp(r.name).date()) if hasattr(r.name, "date") else str(r.name),
                            "firm":      str(r.get("Firm", "")),
                            "toGrade":   str(r.get("To Grade", r.get("toGrade", ""))),
                            "fromGrade": str(r.get("From Grade", r.get("fromGrade", ""))),
                            "action":    str(r.get("Action", r.get("action", ""))),
                        })
        except Exception:
            pass

        result = {
            "symbol": sym,
            "recommendationKey":       info.get("recommendationKey"),
            "numberOfAnalystOpinions": info.get("numberOfAnalystOpinions"),
            "targetMeanPrice":   _safe_float(info.get("targetMeanPrice")),
            "targetHighPrice":   _safe_float(info.get("targetHighPrice")),
            "targetLowPrice":    _safe_float(info.get("targetLowPrice")),
            "targetMedianPrice": _safe_float(info.get("targetMedianPrice")),
            "currentPrice":      _safe_float(info.get("currentPrice")),
            "history": rec_hist,
        }
        cache_set(key, result)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Sector Rotation ───────────────────────────────────────────────────────────

_SECTOR_TTL = timedelta(minutes=15)

_SECTOR_ETFS = [
    {"symbol": "XLK",  "name": "Technology"},
    {"symbol": "XLF",  "name": "Financials"},
    {"symbol": "XLE",  "name": "Energy"},
    {"symbol": "XLV",  "name": "Health Care"},
    {"symbol": "XLI",  "name": "Industrials"},
    {"symbol": "XLY",  "name": "Consumer Discr."},
    {"symbol": "XLP",  "name": "Consumer Staples"},
    {"symbol": "XLU",  "name": "Utilities"},
    {"symbol": "XLB",  "name": "Materials"},
    {"symbol": "XLRE", "name": "Real Estate"},
    {"symbol": "XLC",  "name": "Comm. Services"},
]


def _fetch_sector_perf(info: dict) -> dict:
    sym = info["symbol"]
    cache_key = f"sector:{sym}"
    cached = cache_get(cache_key, _SECTOR_TTL)
    if cached is not None:
        return cached

    try:
        t = yf.Ticker(sym, session=_session)
        hist = t.history(period="3mo")
        if hist.empty:
            return {**info, "error": "no data"}
        closes = hist["Close"]
        fi = t.fast_info
        price = _safe_float(fi.last_price) or float(closes.iloc[-1])
        prev  = _safe_float(fi.previous_close) or (float(closes.iloc[-2]) if len(closes) > 1 else price)

        def chg(n):
            return round((float(closes.iloc[-1]) / float(closes.iloc[-1 - n]) - 1) * 100, 2) if len(closes) > n else None

        result = {
            **info,
            "price": round(price, 2),
            "chg1d": round((price - prev) / prev * 100, 2) if prev else None,
            "chg1w": chg(5),
            "chg1m": chg(21),
            "chg3m": chg(63),
        }
    except Exception as e:
        logger.warning("sector perf failed %s: %s", sym, e)
        result = {**info, "error": str(e)}

    cache_set(cache_key, result)
    return result


@app.get("/api/market/sectors")
def get_sector_rotation():
    cache_key = "market:sectors"
    cached = cache_get(cache_key, _SECTOR_TTL)
    if cached is not None:
        return cached

    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = {ex.submit(_fetch_sector_perf, s): s["symbol"] for s in _SECTOR_ETFS}
        perf_map = {}
        for f in as_completed(futures):
            data = f.result()
            perf_map[data["symbol"]] = data

    results = [perf_map.get(s["symbol"], s) for s in _SECTOR_ETFS]
    cache_set(cache_key, results)
    return results


# ── Institutional Ownership ───────────────────────────────────────────────────

_INST_TTL = timedelta(hours=4)


@app.get("/api/institutional/{symbol}")
def get_institutional(symbol: str):
    symbol = symbol.upper()
    cache_key = f"institutional:{symbol}"
    cached = cache_get(cache_key, _INST_TTL)
    if cached is not None:
        return cached

    try:
        t = yf.Ticker(symbol, session=_session)

        major: dict = {}
        try:
            mh = t.major_holders
            if mh is not None and not mh.empty:
                for _, row in mh.iterrows():
                    val = row.iloc[0]
                    lbl = str(row.iloc[1]).lower()
                    try:
                        fval = float(str(val).strip("%")) / 100 if "%" in str(val) else float(val)
                    except (ValueError, TypeError):
                        fval = None
                    if "insider" in lbl and "institution" not in lbl:
                        major["insiderPct"] = fval
                    elif "institution" in lbl and "float" not in lbl:
                        major["institutionPct"] = fval
                    elif "float" in lbl and "institution" in lbl:
                        major["institutionFloatPct"] = fval
        except Exception as e:
            logger.warning("major holders failed %s: %s", symbol, e)

        def parse_holders(df, limit):
            rows = []
            if df is None or df.empty:
                return rows
            for _, row in df.head(limit).iterrows():
                shares = row.get("Shares")
                value  = row.get("Value")
                pct    = row.get("% Out")
                date   = row.get("Date Reported")
                rows.append({
                    "holder":       str(row.get("Holder", "")),
                    "shares":       int(shares) if pd.notna(shares) else None,
                    "value":        int(value)  if pd.notna(value)  else None,
                    "pctHeld":      round(float(pct) * 100, 2) if pd.notna(pct) else None,
                    "dateReported": str(date.date()) if pd.notna(date) and hasattr(date, "date") else str(date) if pd.notna(date) else None,
                })
            return rows

        inst_rows  = []
        fund_rows  = []
        try:
            inst_rows = parse_holders(t.institutional_holders, 15)
        except Exception as e:
            logger.warning("inst holders failed %s: %s", symbol, e)
        try:
            fund_rows = parse_holders(t.mutualfund_holders, 10)
        except Exception as e:
            logger.warning("fund holders failed %s: %s", symbol, e)

        result = {
            "symbol":        symbol,
            "major":         major,
            "institutional": inst_rows,
            "mutualFunds":   fund_rows,
        }
    except Exception as e:
        logger.warning("institutional failed %s: %s", symbol, e)
        result = {"symbol": symbol, "error": str(e), "major": {}, "institutional": [], "mutualFunds": []}

    cache_set(cache_key, result)
    return result


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


@app.post("/api/backtest")
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


# ── AI News Sentiment ─────────────────────────────────────────────────────────

_SENTIMENT_TTL = timedelta(hours=1)


@app.get("/api/sentiment/{symbol}")
def get_sentiment(symbol: str):
    symbol = symbol.upper()
    cache_key = f"sentiment:{symbol}"
    cached = cache_get(cache_key, _SENTIMENT_TTL)
    if cached is not None:
        return cached

    try:
        ticker = yf.Ticker(symbol, session=_session)
        news_items = ticker.news or []
        headlines = []
        for item in news_items[:12]:
            title = (item.get("content") or {}).get("title") or item.get("title", "")
            if title:
                headlines.append(title)

        if not headlines:
            result = {"symbol": symbol, "score": 0.0, "label": "Neutral",
                      "summary": "No recent news available.", "headlines": []}
            cache_set(cache_key, result)
            return result

        headline_text = "\n".join(f"{i+1}. {h}" for i, h in enumerate(headlines))
        client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system="""You are a financial news sentiment analyzer. Return ONLY a JSON object (no markdown fences) with:
- "score": number -1.0 to 1.0 (very bearish to very bullish)
- "label": exactly one of "Very Bearish", "Bearish", "Neutral", "Bullish", "Very Bullish"
- "summary": 1-2 sentences summarizing the overall sentiment
- "headlines": array of {"text": "...", "score": -1.0 to 1.0, "reason": "brief reason"} for each headline""",
            messages=[{"role": "user", "content": f"Stock: {symbol}\n\nHeadlines:\n{headline_text}"}],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:-1])
        result = json.loads(raw)
        result["symbol"] = symbol

    except Exception as e:
        logger.warning("sentiment failed %s: %s", symbol, e)
        result = {"symbol": symbol, "score": 0.0, "label": "Neutral",
                  "summary": "Sentiment analysis unavailable.", "headlines": [], "error": str(e)}

    cache_set(cache_key, result)
    return result


# ── CSV Export / Import ───────────────────────────────────────────────────────

@app.get("/api/portfolio/export")
def export_portfolio():
    with db_session() as db:
        positions = db.query(PortfolioPosition).order_by(PortfolioPosition.symbol).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Symbol", "Shares", "Avg Cost"])
    for p in positions:
        w.writerow([p.symbol, p.shares, p.avg_cost])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=portfolio.csv"})


class CSVImportBody(BaseModel):
    csv_data: str


@app.post("/api/portfolio/import")
def import_portfolio(body: CSVImportBody):
    reader = csv.DictReader(io.StringIO(body.csv_data))
    imported = 0
    errors = []
    for i, row in enumerate(reader):
        try:
            sym    = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
            shares = float(row.get("Shares") or row.get("shares") or row.get("Quantity") or 0)
            cost   = float(row.get("Avg Cost") or row.get("avg_cost") or row.get("Average Price") or row.get("Cost Basis") or 0)
            if not sym or shares <= 0:
                continue
            with db_session() as db:
                existing = db.query(PortfolioPosition).filter(PortfolioPosition.symbol == sym).first()
                if existing:
                    existing.shares = shares; existing.avg_cost = cost
                else:
                    db.add(PortfolioPosition(symbol=sym, shares=shares, avg_cost=cost))
            imported += 1
        except Exception as e:
            errors.append(f"Row {i+1}: {e}")
    return {"imported": imported, "errors": errors}


@app.get("/api/journal/export")
def export_journal():
    with db_session() as db:
        entries = db.query(TradeJournalEntry).order_by(TradeJournalEntry.trade_date.desc()).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Symbol", "Side", "Price", "Shares", "Strategy", "Notes"])
    for e in entries:
        w.writerow([e.trade_date, e.symbol, e.side, e.price, e.shares, e.strategy or "", e.notes or ""])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=trade_journal.csv"})


# ── WebSocket live quotes ─────────────────────────────────────────────────────

@app.websocket("/ws/quotes")
async def ws_quotes(websocket: WebSocket, symbols: str = ""):
    await websocket.accept()
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        await websocket.close()
        return
    loop = asyncio.get_event_loop()
    try:
        while True:
            results = await loop.run_in_executor(
                None,
                lambda: [_fetch_quote(s) for s in syms],
            )
            await websocket.send_json(results)
            await asyncio.sleep(4)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("WS quotes error: %s", e)


# ── SEC Filings ───────────────────────────────────────────────────────────────

_EDGAR_TTL       = timedelta(hours=12)
_TICKER_CIK_MAP: dict[str, str] = {}


def _get_cik(ticker: str) -> str | None:
    global _TICKER_CIK_MAP
    if not _TICKER_CIK_MAP:
        try:
            r = _session.get(
                "https://www.sec.gov/files/company_tickers.json",
                headers={"User-Agent": "StockMonitor raghuravuri@gmail.com"},
            )
            data = r.json()
            _TICKER_CIK_MAP = {
                v["ticker"]: str(v["cik_str"]).zfill(10) for v in data.values()
            }
        except Exception as e:
            logger.warning("Failed to load EDGAR ticker map: %s", e)
            return None
    return _TICKER_CIK_MAP.get(ticker.upper())


@app.get("/api/filings/{symbol}")
def get_filings(symbol: str):
    symbol = symbol.upper()
    cache_key = f"filings:{symbol}"
    cached = cache_get(cache_key, _EDGAR_TTL)
    if cached is not None:
        return cached

    cik = _get_cik(symbol)
    if not cik:
        result = {"symbol": symbol, "filings": [], "error": "Ticker not found in EDGAR"}
        cache_set(cache_key, result)
        return result

    try:
        url = f"https://data.sec.gov/submissions/CIK{cik}.json"
        r = _session.get(url, headers={"User-Agent": "StockMonitor raghuravuri@gmail.com"})
        data = r.json()

        recent   = data.get("filings", {}).get("recent", {})
        forms    = recent.get("form", [])
        dates    = recent.get("filingDate", [])
        accnums  = recent.get("accessionNumber", [])
        docs     = recent.get("primaryDocument", [])
        descs    = recent.get("primaryDocDescription", [])

        target = {"10-K", "10-Q", "8-K", "10-K/A", "10-Q/A"}
        filings = []
        cik_int = int(cik)
        for form, date, acc, doc, desc in zip(forms, dates, accnums, docs, descs):
            if form not in target:
                continue
            acc_clean = acc.replace("-", "")
            filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_clean}/{doc}"
            filings.append({
                "form":   form,
                "date":   date,
                "url":    filing_url,
                "desc":   desc or doc,
                "acc":    acc,
            })
            if len(filings) >= 25:
                break

        result = {
            "symbol":      symbol,
            "companyName": data.get("name", symbol),
            "cik":         cik,
            "filings":     filings,
        }
    except Exception as e:
        logger.warning("EDGAR filings failed %s: %s", symbol, e)
        result = {"symbol": symbol, "filings": [], "error": str(e)}

    cache_set(cache_key, result)
    return result


# ── Custom Screener ───────────────────────────────────────────────────────────

_SP100 = [
    "AAPL","MSFT","AMZN","GOOGL","META","NVDA","TSLA","JPM","V","UNH",
    "JNJ","WMT","XOM","MA","PG","HD","CVX","LLY","ABBV","MRK",
    "PEP","KO","AVGO","COST","TMO","MCD","ABT","CSCO","DHR","ACN",
    "NEE","WFC","TXN","CMCSA","VZ","INTC","BMY","AMGN","RTX","HON",
    "PM","IBM","GE","LOW","CAT","BA","UPS","GS","MS","BLK",
    "SPGI","ISRG","MDT","SYK","GILD","CRM","ADBE","QCOM","AMAT","NOW",
    "LRCX","MU","PANW","PYPL","UBER","AMD","NFLX","DIS","SBUX","NKE",
    "T","F","GM","BAC","C","WBA","PFE","AXP","MMM","MO",
]

_CUSTOM_SCREEN_FIELDS = {
    "peRatio":             "P/E Ratio",
    "forwardPE":           "Forward P/E",
    "priceToBook":         "P/B Ratio",
    "beta":                "Beta",
    "dividendYield":       "Dividend Yield",
    "marketCap":           "Market Cap ($B)",
    "profitMargin":        "Profit Margin",
    "roe":                 "ROE",
    "debtToEquity":        "Debt/Equity",
    "shortPercentOfFloat": "Short Float %",
}


class FilterCondition(BaseModel):
    field:  str
    op:     str    # 'lt' | 'gt' | 'lte' | 'gte' | 'between'
    value:  float
    value2: float | None = None


class CustomScreenRequest(BaseModel):
    filters: list[FilterCondition]
    symbols: list[str] = []   # empty → use SP100


def _apply_filter(fund: dict, f: FilterCondition) -> bool:
    raw = fund.get(f.field)
    if raw is None:
        return False
    # dividendYield and related are stored as fractions (0.02 = 2%)
    val = raw
    if f.field in ("dividendYield", "profitMargin", "roe", "shortPercentOfFloat"):
        val = raw * 100
    if f.field == "marketCap":
        val = raw / 1e9
    if f.op == "lt":   return val < f.value
    if f.op == "gt":   return val > f.value
    if f.op == "lte":  return val <= f.value
    if f.op == "gte":  return val >= f.value
    if f.op == "between" and f.value2 is not None:
        return f.value <= val <= f.value2
    return False


@app.post("/api/screener/custom")
def run_custom_screener(body: CustomScreenRequest):
    universe = [s.upper() for s in body.symbols] if body.symbols else _SP100
    if not body.filters:
        raise HTTPException(400, "At least one filter required")

    results = []
    with ThreadPoolExecutor(max_workers=12) as ex:
        futures = {ex.submit(_fetch_fundamentals, s): s for s in universe}
        for f in as_completed(futures):
            sym = futures[f]
            try:
                fund = f.result()
                q_cached = cache_get(f"quote:{sym}", timedelta(minutes=10))
                price = q_cached.get("price") if q_cached else None
                if all(_apply_filter(fund, filt) for filt in body.filters):
                    results.append({
                        "symbol":        sym,
                        "name":          fund.get("name", sym),
                        "price":         price,
                        "peRatio":       fund.get("peRatio"),
                        "forwardPE":     fund.get("forwardPE"),
                        "priceToBook":   fund.get("priceToBook"),
                        "beta":          fund.get("beta"),
                        "dividendYield": fund.get("dividendYield"),
                        "marketCap":     fund.get("marketCap") or (q_cached.get("marketCap") if q_cached else None),
                        "profitMargin":  fund.get("profitMargin"),
                        "roe":           fund.get("roe"),
                        "debtToEquity":  fund.get("debtToEquity"),
                        "shortPercentOfFloat": fund.get("shortPercentOfFloat"),
                        "sector":        fund.get("sector"),
                    })
            except Exception as e:
                logger.warning("custom screen %s: %s", sym, e)

    results.sort(key=lambda x: x.get("marketCap") or 0, reverse=True)
    return results[:50]


# ── Options Unusual Activity Feed ─────────────────────────────────────────────

_UOA_TTL = timedelta(minutes=10)


def _fetch_uoa_for(sym: str) -> list:
    cache_key = f"uoa:{sym}"
    cached = cache_get(cache_key, _UOA_TTL)
    if cached is not None:
        return cached

    results = []
    try:
        t = yf.Ticker(sym, session=_session)
        exps = t.options
        if not exps:
            cache_set(cache_key, results)
            return results

        # Check nearest two expiries for more coverage
        for exp in exps[:2]:
            try:
                chain = t.option_chain(exp)
                for c_type, df in [("call", chain.calls), ("put", chain.puts)]:
                    for _, row in df.iterrows():
                        volume = int(row.get("volume") or 0)
                        oi     = int(row.get("openInterest") or 0)
                        if volume >= 500 and (oi == 0 or volume > 2 * oi):
                            results.append({
                                "symbol":        sym,
                                "type":          c_type,
                                "strike":        round(float(row.get("strike") or 0), 2),
                                "expiry":        exp,
                                "volume":        volume,
                                "openInterest":  oi,
                                "lastPrice":     round(float(row.get("lastPrice") or 0), 2),
                                "impliedVol":    round(float(row.get("impliedVolatility") or 0) * 100, 1),
                                "inTheMoney":    bool(row.get("inTheMoney", False)),
                            })
            except Exception:
                pass
    except Exception as e:
        logger.warning("UOA fetch failed %s: %s", sym, e)

    cache_set(cache_key, results)
    return results


@app.get("/api/market/options-uoa")
def get_options_uoa(symbols: str = ""):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []

    all_uoa = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = [ex.submit(_fetch_uoa_for, s) for s in syms]
        for f in as_completed(futures):
            all_uoa.extend(f.result())

    all_uoa.sort(key=lambda x: x["volume"], reverse=True)
    return all_uoa[:60]


# ── Portfolio Equity Curve ────────────────────────────────────────────────────

@app.get("/api/portfolio/snapshots")
def get_portfolio_snapshots():
    with db_session() as db:
        rows = db.query(PortfolioSnapshot).order_by(PortfolioSnapshot.date).all()
        return [{"date": r.date, "total_value": r.total_value, "total_cost": r.total_cost} for r in rows]


@app.post("/api/portfolio/snapshot")
async def save_portfolio_snapshot():
    loop = asyncio.get_event_loop()

    with db_session() as db:
        entries = db.query(PortfolioPosition).all()
        positions_data = [
            {"symbol": e.symbol, "shares": e.shares, "avg_cost": e.avg_cost}
            for e in entries
        ]

    if not positions_data:
        return {"date": datetime.utcnow().strftime("%Y-%m-%d"), "total_value": 0,
                "total_cost": 0, "total_pl": 0, "total_pl_pct": 0, "holdings": []}

    syms = [p["symbol"] for p in positions_data]
    quotes_list = await loop.run_in_executor(None, lambda: [_fetch_quote(s) for s in syms])
    quote_map = {q["symbol"]: q for q in quotes_list if q}

    holdings, total_value, total_cost = [], 0.0, 0.0
    for p in positions_data:
        q = quote_map.get(p["symbol"], {})
        price  = q.get("price") or p["avg_cost"]
        cur_val = p["shares"] * price
        cost    = p["shares"] * p["avg_cost"]
        pl      = cur_val - cost
        total_value += cur_val
        total_cost  += cost
        holdings.append({
            "symbol":   p["symbol"],
            "shares":   p["shares"],
            "avg_cost": p["avg_cost"],
            "price":    price,
            "cur_val":  round(cur_val, 2),
            "cost":     round(cost, 2),
            "pl":       round(pl, 2),
            "pl_pct":   round((pl / cost * 100) if cost > 0 else 0, 2),
            "changePercent": q.get("changePercent"),
        })

    today = datetime.utcnow().strftime("%Y-%m-%d")
    with db_session() as db:
        existing = db.query(PortfolioSnapshot).filter_by(date=today).first()
        if existing:
            existing.total_value = total_value
            existing.total_cost  = total_cost
        else:
            db.add(PortfolioSnapshot(date=today, total_value=total_value, total_cost=total_cost))

    for h in holdings:
        h["pct_of_portfolio"] = round((h["cur_val"] / total_value * 100) if total_value > 0 else 0, 2)
    holdings.sort(key=lambda x: x["cur_val"], reverse=True)

    return {
        "date":         today,
        "total_value":  round(total_value, 2),
        "total_cost":   round(total_cost, 2),
        "total_pl":     round(total_value - total_cost, 2),
        "total_pl_pct": round(((total_value - total_cost) / total_cost * 100) if total_cost > 0 else 0, 2),
        "holdings":     holdings,
    }


# ── Earnings Play Calculator ──────────────────────────────────────────────────

_PLAY_TTL = timedelta(hours=4)


def _compute_earnings_play(symbol: str) -> dict:
    try:
        t     = yf.Ticker(symbol, session=_session)
        info  = t.info or {}
        price = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))

        # Upcoming earnings date
        next_earnings = None
        try:
            cal = t.calendar
            if cal and "Earnings Date" in cal:
                dates = cal["Earnings Date"]
                iterable = dates if hasattr(dates, "__iter__") and not isinstance(dates, str) else [dates]
                for d in iterable:
                    try:
                        next_earnings = str(d.date()) if hasattr(d, "date") else str(d)
                        break
                    except Exception:
                        pass
        except Exception:
            pass

        # ATM straddle from nearest expiry
        straddle_strike = straddle_call = straddle_put = straddle_cost = None
        expected_move_pct = expiry_used = None
        if price:
            try:
                exps = t.options
                if exps:
                    expiry = exps[0]
                    chain  = t.option_chain(expiry)
                    calls, puts = chain.calls, chain.puts
                    if not calls.empty and not puts.empty:
                        strikes  = calls["strike"].values
                        atm_idx  = int(abs(strikes - price).argmin())
                        atm_strike = float(strikes[atm_idx])
                        c_row = calls[calls["strike"] == atm_strike]
                        p_row = puts [puts ["strike"] == atm_strike]
                        if not c_row.empty and not p_row.empty:
                            cp = _safe_float(c_row["lastPrice"].values[0])
                            pp = _safe_float(p_row["lastPrice"].values[0])
                            if cp is not None and pp is not None:
                                straddle_strike    = atm_strike
                                straddle_call      = round(cp, 2)
                                straddle_put       = round(pp, 2)
                                straddle_cost      = round(cp + pp, 2)
                                expected_move_pct  = round((straddle_cost / price) * 100, 2)
                                expiry_used        = expiry
            except Exception as e:
                logger.warning("straddle calc %s: %s", symbol, e)

        # Historical EPS (last 8 quarters)
        history = []
        try:
            eh = t.earnings_history
            if eh is not None and not eh.empty:
                for idx, row in eh.tail(8).iterrows():
                    try:
                        history.append({
                            "date":        str(idx.date()) if hasattr(idx, "date") else str(idx),
                            "epsEstimate": _safe_float(row.get("epsEstimate")),
                            "epsActual":   _safe_float(row.get("epsActual")),
                            "surprisePct": _safe_float(row.get("surprisePct") or row.get("surprisePercent")),
                        })
                    except Exception:
                        pass
        except Exception:
            pass

        return {
            "symbol":           symbol,
            "price":            price,
            "next_earnings":    next_earnings,
            "straddle_strike":  straddle_strike,
            "straddle_call":    straddle_call,
            "straddle_put":     straddle_put,
            "straddle_cost":    straddle_cost,
            "expected_move_pct": expected_move_pct,
            "expiry":           expiry_used,
            "history":          list(reversed(history)),
        }
    except Exception as e:
        logger.warning("earnings play %s: %s", symbol, e)
        return {"symbol": symbol, "error": str(e)}


@app.get("/api/earnings/play/{symbol}")
async def get_earnings_play(symbol: str):
    sym = symbol.upper()
    cache_key = f"earnings:play:{sym}"
    cached = cache_get(cache_key, _PLAY_TTL)
    if cached is not None:
        return cached
    loop   = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, lambda: _compute_earnings_play(sym))
    cache_set(cache_key, result)
    return result


# ── NLP Screener (Claude-powered) ────────────────────────────────────────────

_NLP_SYSTEM = """You are a stock screener assistant. Convert the user's natural language query into filter conditions.

Available fields and their units:
- price: stock price ($)
- changePercent: today's % change
- marketCap: market cap in $B (e.g. 100 = $100B)
- peRatio: trailing P/E ratio
- forwardPE: forward P/E ratio
- profitMargin: profit margin % (e.g. 15 = 15%)
- revenueGrowth: revenue growth % (e.g. 10 = 10%)
- roe: return on equity % (e.g. 20 = 20%)
- beta: beta vs S&P 500
- dividendYield: dividend yield % (e.g. 2 = 2%)
- debtToEquity: debt-to-equity ratio
- volume: daily volume (raw number)
- week52High: 52-week high price ($)
- week52Low: 52-week low price ($)

Available operators: gt (>), lt (<), gte (>=), lte (<=), between (value to value2)

Return ONLY a valid JSON object with NO markdown fences:
{"filters":[{"field":"...","op":"...","value":number},...], "description":"one sentence"}"""


class NLPScreenRequest(BaseModel):
    query: str


@app.post("/api/screener/nlp")
async def screener_nlp(req: NLPScreenRequest):
    try:
        client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            system=_NLP_SYSTEM,
            messages=[{"role": "user", "content": req.query}],
        )
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            lines = raw.splitlines()
            raw = "\n".join(lines[1:len(lines) - (1 if lines[-1].strip() == "```" else 0)])

        parsed      = json.loads(raw)
        description = parsed.get("description", "")
        filters     = [FilterCondition(**f) for f in parsed.get("filters", [])]

        if not filters:
            return {"description": description, "filters": [], "results": []}

        results = run_custom_screener(CustomScreenRequest(filters=filters))
        return {
            "description": description,
            "filters":     [{"field": f.field, "op": f.op, "value": f.value, "value2": f.value2} for f in filters],
            "results":     results,
        }
    except Exception as e:
        logger.warning("NLP screener failed: %s", e)
        raise HTTPException(500, f"NLP screener error: {e}")


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


@app.post("/api/screener/signals")
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


# ── Options Strategy Builder ───────────────────────────────────────────────────

_STRATEGY_TTL = timedelta(hours=1)


def _compute_strategies(symbol: str, view: str) -> dict:
    cache_key = f"strategies:{symbol}:{view}"
    cached = cache_get(cache_key, _STRATEGY_TTL)
    if cached is not None:
        return cached

    try:
        t    = yf.Ticker(symbol, session=_session)
        info = t.fast_info
        price = float(info.last_price)
        if not price:
            raise ValueError("no price")

        exps = t.options
        if not exps:
            raise ValueError("no options")
        expiry = exps[0]
        chain  = t.option_chain(expiry)
        calls  = chain.calls
        puts   = chain.puts

        def nearest_strike(df, target):
            idx = (df["strike"] - target).abs().idxmin()
            return df.loc[idx]

        def next_strike_above(df, target):
            above = df[df["strike"] > target]
            return above.iloc[0] if not above.empty else None

        def next_strike_below(df, target):
            below = df[df["strike"] < target]
            return below.iloc[-1] if not below.empty else None

        atm_call = nearest_strike(calls, price)
        atm_put  = nearest_strike(puts,  price)
        atm_strike = float(atm_call["strike"])

        otm_call = next_strike_above(calls, atm_strike)
        otm_put  = next_strike_below(puts,  atm_strike)

        def mid(row):
            b, a = float(row.get("bid", 0) or 0), float(row.get("ask", 0) or 0)
            lp   = float(row.get("lastPrice", 0) or 0)
            return round((b + a) / 2 if a > b > 0 else lp, 2)

        strategies = []

        if view in ("bullish", "neutral"):
            # Long Call
            c_mid = mid(atm_call)
            strategies.append({
                "name": "Long Call",
                "legs": [{"type": "call", "strike": atm_strike, "action": "buy", "cost": c_mid}],
                "max_profit": "unlimited",
                "max_loss": round(c_mid * 100, 2),
                "breakeven": round(atm_strike + c_mid, 2),
                "cost_debit": round(c_mid * 100, 2),
                "pop_pct": round(float(atm_call.get("inTheMoney", False)) * 0 + (1 - float(atm_call.get("delta", 0.5) or 0.5)) * 100, 1),
            })

        if view == "bullish" and otm_call is not None:
            # Bull Call Spread
            buy_cost  = mid(atm_call)
            sell_cost = mid(otm_call)
            net_debit = round(buy_cost - sell_cost, 2)
            width     = round(float(otm_call["strike"]) - atm_strike, 2)
            strategies.append({
                "name": "Bull Call Spread",
                "legs": [
                    {"type": "call", "strike": atm_strike, "action": "buy",  "cost": buy_cost},
                    {"type": "call", "strike": float(otm_call["strike"]), "action": "sell", "cost": sell_cost},
                ],
                "max_profit": round((width - net_debit) * 100, 2),
                "max_loss":   round(net_debit * 100, 2),
                "breakeven":  round(atm_strike + net_debit, 2),
                "cost_debit": round(net_debit * 100, 2),
                "pop_pct":    None,
            })

        if view in ("bearish", "neutral"):
            # Long Put
            p_mid = mid(atm_put)
            strategies.append({
                "name": "Long Put",
                "legs": [{"type": "put", "strike": atm_strike, "action": "buy", "cost": p_mid}],
                "max_profit": round((atm_strike - p_mid) * 100, 2),
                "max_loss":   round(p_mid * 100, 2),
                "breakeven":  round(atm_strike - p_mid, 2),
                "cost_debit": round(p_mid * 100, 2),
                "pop_pct":    None,
            })

        if view == "bearish" and otm_put is not None:
            # Bear Put Spread
            buy_cost  = mid(atm_put)
            sell_cost = mid(otm_put)
            net_debit = round(buy_cost - sell_cost, 2)
            width     = round(atm_strike - float(otm_put["strike"]), 2)
            strategies.append({
                "name": "Bear Put Spread",
                "legs": [
                    {"type": "put", "strike": atm_strike, "action": "buy",  "cost": buy_cost},
                    {"type": "put", "strike": float(otm_put["strike"]), "action": "sell", "cost": sell_cost},
                ],
                "max_profit": round((width - net_debit) * 100, 2),
                "max_loss":   round(net_debit * 100, 2),
                "breakeven":  round(atm_strike - net_debit, 2),
                "cost_debit": round(net_debit * 100, 2),
                "pop_pct":    None,
            })

        if view == "neutral":
            # Long Straddle
            c_mid = mid(atm_call)
            p_mid = mid(atm_put)
            total = round(c_mid + p_mid, 2)
            strategies.append({
                "name": "Long Straddle",
                "legs": [
                    {"type": "call", "strike": atm_strike, "action": "buy", "cost": c_mid},
                    {"type": "put",  "strike": atm_strike, "action": "buy", "cost": p_mid},
                ],
                "max_profit": "unlimited",
                "max_loss":   round(total * 100, 2),
                "breakeven":  f"${round(atm_strike - total, 2)} / ${round(atm_strike + total, 2)}",
                "cost_debit": round(total * 100, 2),
                "pop_pct":    None,
            })

        if view in ("bullish", "neutral"):
            # Cash-Secured Put (sell ATM put)
            p_mid = mid(atm_put)
            strategies.append({
                "name": "Cash-Secured Put",
                "legs": [{"type": "put", "strike": atm_strike, "action": "sell", "cost": p_mid}],
                "max_profit": round(p_mid * 100, 2),
                "max_loss":   round((atm_strike - p_mid) * 100, 2),
                "breakeven":  round(atm_strike - p_mid, 2),
                "cost_debit": round(-p_mid * 100, 2),
                "pop_pct":    None,
            })

        result = {
            "symbol": symbol,
            "price":  round(price, 2),
            "expiry": expiry,
            "view":   view,
            "strategies": strategies,
        }
        cache_set(cache_key, result)
        return result
    except Exception as e:
        logger.warning("strategies failed for %s: %s", symbol, e)
        raise HTTPException(500, f"Strategy computation failed: {e}")


@app.get("/api/options/strategies/{symbol}")
async def get_options_strategies(symbol: str, view: str = "bullish"):
    sym = symbol.upper().strip()
    if view not in ("bullish", "bearish", "neutral"):
        raise HTTPException(400, "view must be bullish, bearish, or neutral")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: _compute_strategies(sym, view))


# ── Claude Trade Idea Generator ───────────────────────────────────────────────

_TRADE_IDEA_SYSTEM = """You are a professional equity and options trader generating specific, actionable trade ideas.
Given a watchlist snapshot and any triggered price alerts, produce 3–5 trade ideas.

For each idea output EXACTLY this markdown format (no deviations):

## [TICKER] — [Strategy Name]

**Thesis:** One sentence on why this trade makes sense right now.

**Entry:** $XX.XX  |  **Stop:** $XX.XX  |  **Target:** $XX.XX  |  **R/R:** X:X

**Catalyst:** What could drive the move (earnings, breakout, mean-reversion, etc.)

---

Rules:
- Base ideas on the data provided — price levels, change %, technicals implied by proximity to 52W high/low
- Mix directional and income strategies where appropriate
- Each idea must have a concrete entry, stop, and target
- Keep each idea under 6 lines
- Do not add disclaimers or preamble — go straight to ideas"""


class TradeIdeaRequest(BaseModel):
    watchlist: List[str]
    quotes: dict = {}
    alerts: List[dict] = []


@app.post("/api/trade-ideas")
def get_trade_ideas(req: TradeIdeaRequest):
    lines = ["# Watchlist Snapshot\n"]
    for sym in req.watchlist:
        q = req.quotes.get(sym, {})
        price   = q.get("price")
        chg_pct = q.get("changePercent")
        pe      = q.get("pe")
        w52h    = q.get("week52High")
        w52l    = q.get("week52Low")

        parts = [sym]
        if price:
            parts.append(f"${price:.2f}")
        if chg_pct is not None:
            sign = "+" if chg_pct >= 0 else ""
            parts.append(f"{sign}{chg_pct:.2f}%")
        if pe:
            parts.append(f"P/E {pe:.1f}")
        if price and w52h:
            pct_from_high = (price / w52h - 1) * 100
            parts.append(f"{pct_from_high:+.1f}% from 52W high")
        if price and w52l:
            pct_from_low  = (price / w52l - 1) * 100
            parts.append(f"+{pct_from_low:.1f}% from 52W low")
        lines.append("  ".join(parts))

    if req.alerts:
        lines.append("\n# Triggered Alerts")
        for a in req.alerts[:10]:
            lines.append(f"- {a.get('symbol')} {a.get('type','').upper()} alert at ${a.get('price','')} (target ${a.get('target','')})")

    user_msg = "\n".join(lines)

    def generate():
        try:
            client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                system=_TRADE_IDEA_SYSTEM,
                messages=[{"role": "user", "content": user_msg}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            logger.error("trade ideas error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Portfolio Risk Dashboard ───────────────────────────────────────────────────

_RISK_TTL = timedelta(minutes=30)


def _compute_portfolio_risk() -> dict:
    cache_key = "portfolio:risk"
    cached = cache_get(cache_key, _RISK_TTL)
    if cached is not None:
        return cached

    with db_session() as db:
        positions = db.query(PortfolioPosition).all()
        holdings  = [{"symbol": p.symbol, "shares": p.shares, "avg_cost": p.avg_cost} for p in positions]

    if not holdings:
        return {"error": "No portfolio positions"}

    symbols = [h["symbol"] for h in holdings]

    try:
        raw = yf.download(symbols + ["SPY"], period="1y", interval="1d",
                          auto_adjust=True, progress=False, session=_session)
        closes = raw["Close"].dropna(how="all")
    except Exception as e:
        raise ValueError(f"Data fetch failed: {e}")

    rets = closes.pct_change().dropna()
    spy_ret = rets.get("SPY", pd.Series(dtype=float))

    # Per-holding metrics
    holdings_out = []
    port_prices  = {}
    for h in holdings:
        sym = h["symbol"]
        if sym not in closes.columns:
            continue
        price = float(closes[sym].dropna().iloc[-1])
        port_prices[sym] = price
        mkt_val = price * h["shares"]

        if sym in rets.columns and len(spy_ret) > 10:
            s_ret = rets[sym].dropna()
            cov   = s_ret.cov(spy_ret.reindex(s_ret.index).dropna())
            var_spy = spy_ret.var()
            beta  = round(cov / var_spy, 2) if var_spy > 0 else None
        else:
            beta = None

        holdings_out.append({
            "symbol":   sym,
            "shares":   h["shares"],
            "avg_cost": h["avg_cost"],
            "price":    round(price, 2),
            "mkt_val":  round(mkt_val, 2),
            "beta":     beta,
        })

    total_val = sum(h["mkt_val"] for h in holdings_out) or 1.0
    for h in holdings_out:
        h["weight"]        = round(h["mkt_val"] / total_val * 100, 1)
        h["beta_adj_exp"]  = round(h["beta"] * h["weight"] / 100, 3) if h["beta"] is not None else None

    # Portfolio return series (value-weighted)
    port_ret = pd.Series(0.0, index=rets.index)
    for h in holdings_out:
        sym = h["symbol"]
        if sym in rets.columns:
            w = h["mkt_val"] / total_val
            port_ret = port_ret.add(rets[sym].reindex(port_ret.index).fillna(0) * w)

    port_ret = port_ret.dropna()

    # Sharpe (annualised, rf=0)
    sharpe  = round(float(port_ret.mean() / port_ret.std() * np.sqrt(252)), 2) if port_ret.std() > 0 else None

    # Sortino (downside std)
    down    = port_ret[port_ret < 0]
    sortino = round(float(port_ret.mean() / down.std() * np.sqrt(252)), 2) if len(down) > 1 and down.std() > 0 else None

    # Max drawdown
    cum   = (1 + port_ret).cumprod()
    roll_max = cum.cummax()
    dd    = (cum - roll_max) / roll_max
    max_dd = round(float(dd.min()) * 100, 2)

    # VaR (historical, 1-day)
    var95 = round(-float(np.percentile(port_ret, 5)) * total_val, 2)
    var99 = round(-float(np.percentile(port_ret, 1)) * total_val, 2)

    # Weighted portfolio beta
    port_beta = round(sum(
        h["beta_adj_exp"] for h in holdings_out if h["beta_adj_exp"] is not None
    ), 2)

    # Correlation matrix (symbols with enough data)
    valid_syms = [h["symbol"] for h in holdings_out if h["symbol"] in rets.columns]
    corr_matrix = {}
    if len(valid_syms) > 1:
        corr_df = rets[valid_syms].corr().round(2)
        corr_matrix = corr_df.to_dict()

    result = {
        "total_value":  round(total_val, 2),
        "portfolio_beta": port_beta,
        "sharpe":       sharpe,
        "sortino":      sortino,
        "max_drawdown_pct": max_dd,
        "var95":        var95,
        "var99":        var99,
        "holdings":     holdings_out,
        "correlation":  corr_matrix,
    }
    cache_set(cache_key, result)
    return result


@app.get("/api/portfolio/risk")
async def get_portfolio_risk():
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, _compute_portfolio_risk)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Smart Alerts 2.0 ──────────────────────────────────────────────────────────

SMART_ALERT_TYPES = {
    "volume_spike":       {"param": "multiplier",  "default": 2.0,  "label": "Volume Spike"},
    "gap_up":             {"param": "pct",          "default": 2.0,  "label": "Gap Up"},
    "gap_down":           {"param": "pct",          "default": 2.0,  "label": "Gap Down"},
    "rsi_overbought":     {"param": "threshold",    "default": 70.0, "label": "RSI Overbought"},
    "rsi_oversold":       {"param": "threshold",    "default": 30.0, "label": "RSI Oversold"},
    "golden_cross":       {"param": None,           "default": None, "label": "Golden Cross (MA50/200)"},
    "death_cross":        {"param": None,           "default": None, "label": "Death Cross (MA50/200)"},
    "earnings_proximity": {"param": "days",         "default": 5,    "label": "Earnings Proximity"},
}


class SmartAlertCreate(BaseModel):
    symbol:     str
    alert_type: str
    params:     dict = {}


@app.get("/api/alerts/smart")
def list_smart_alerts():
    with db_session() as db:
        rules = db.query(SmartAlertRule).filter(SmartAlertRule.active == 1).order_by(SmartAlertRule.created_at.desc()).all()
        return [{"id": r.id, "symbol": r.symbol, "alert_type": r.alert_type,
                 "params": json.loads(r.params), "created_at": str(r.created_at)} for r in rules]


@app.post("/api/alerts/smart")
def create_smart_alert(req: SmartAlertCreate):
    sym = req.symbol.upper().strip()
    if req.alert_type not in SMART_ALERT_TYPES:
        raise HTTPException(400, f"Unknown alert_type. Valid: {list(SMART_ALERT_TYPES)}")
    with db_session() as db:
        rule = SmartAlertRule(symbol=sym, alert_type=req.alert_type, params=json.dumps(req.params))
        db.add(rule)
        db.flush()
        return {"id": rule.id, "symbol": sym, "alert_type": req.alert_type}


@app.delete("/api/alerts/smart/{rule_id}")
def delete_smart_alert(rule_id: int):
    with db_session() as db:
        rule = db.query(SmartAlertRule).filter(SmartAlertRule.id == rule_id).first()
        if not rule:
            raise HTTPException(404, "Rule not found")
        rule.active = 0
    return {"ok": True}


def _check_smart_rule(rule: dict) -> dict | None:
    sym        = rule["symbol"]
    atype      = rule["alert_type"]
    params     = rule["params"]

    try:
        t = yf.Ticker(sym, session=_session)
        hist = t.history(period="1y", interval="1d", auto_adjust=True)
        if len(hist) < 5:
            return None
        closes  = hist["Close"].dropna().values.astype(float)
        volumes = hist["Volume"].dropna().values.astype(float)

        if atype == "volume_spike":
            mult   = params.get("multiplier", 2.0)
            avg20  = float(np.mean(volumes[-21:-1])) if len(volumes) >= 21 else float(np.mean(volumes[:-1]))
            today  = float(volumes[-1])
            if avg20 > 0 and today >= mult * avg20:
                return {"triggered": True, "detail": f"Volume {today/avg20:.1f}× avg20 ({int(today):,} vs {int(avg20):,})"}

        elif atype in ("gap_up", "gap_down"):
            pct_thresh = params.get("pct", 2.0)
            prev_close = float(hist["Close"].dropna().iloc[-2])
            today_open = float(hist["Open"].dropna().iloc[-1])
            gap_pct    = (today_open / prev_close - 1) * 100
            if atype == "gap_up"   and gap_pct >= pct_thresh:
                return {"triggered": True, "detail": f"Gapped up {gap_pct:+.2f}% at open"}
            if atype == "gap_down" and gap_pct <= -pct_thresh:
                return {"triggered": True, "detail": f"Gapped down {gap_pct:+.2f}% at open"}

        elif atype in ("rsi_overbought", "rsi_oversold"):
            thresh = params.get("threshold", 70 if atype == "rsi_overbought" else 30)
            rsi    = float(_calc_rsi(pd.Series(closes), 14).iloc[-1])
            if atype == "rsi_overbought" and rsi >= thresh:
                return {"triggered": True, "detail": f"RSI(14) = {rsi:.1f} ≥ {thresh}"}
            if atype == "rsi_oversold"   and rsi <= thresh:
                return {"triggered": True, "detail": f"RSI(14) = {rsi:.1f} ≤ {thresh}"}

        elif atype in ("golden_cross", "death_cross"):
            if len(closes) < 201:
                return None
            ma50_today  = float(np.mean(closes[-50:]))
            ma200_today = float(np.mean(closes[-200:]))
            ma50_prev   = float(np.mean(closes[-51:-1]))
            ma200_prev  = float(np.mean(closes[-201:-1]))
            if atype == "golden_cross" and ma50_prev <= ma200_prev and ma50_today > ma200_today:
                return {"triggered": True, "detail": f"MA50 ({ma50_today:.2f}) crossed above MA200 ({ma200_today:.2f})"}
            if atype == "death_cross"  and ma50_prev >= ma200_prev and ma50_today < ma200_today:
                return {"triggered": True, "detail": f"MA50 ({ma50_today:.2f}) crossed below MA200 ({ma200_today:.2f})"}

        elif atype == "earnings_proximity":
            days_thresh = int(params.get("days", 5))
            cal = t.calendar
            if cal is not None and not cal.empty:
                ed_col = [c for c in cal.columns if "Earnings" in c]
                if ed_col:
                    ed = cal[ed_col[0]].dropna()
                    if not ed.empty:
                        next_date = pd.to_datetime(ed.iloc[0]).date()
                        days_away = (next_date - datetime.utcnow().date()).days
                        if 0 <= days_away <= days_thresh:
                            return {"triggered": True, "detail": f"Earnings in {days_away} day(s) ({next_date})"}

    except Exception as e:
        logger.debug("smart alert check failed %s/%s: %s", sym, atype, e)

    return None


@app.post("/api/alerts/smart/scan")
async def scan_smart_alerts():
    with db_session() as db:
        rules = db.query(SmartAlertRule).filter(SmartAlertRule.active == 1).all()
        rule_dicts = [{"id": r.id, "symbol": r.symbol, "alert_type": r.alert_type,
                       "params": json.loads(r.params)} for r in rules]

    if not rule_dicts:
        return []

    loop    = asyncio.get_event_loop()
    futures = {loop.run_in_executor(None, _check_smart_rule, r): r for r in rule_dicts}
    results = []
    for fut, rule in futures.items():
        outcome = await fut
        if outcome and outcome.get("triggered"):
            results.append({
                "id":         rule["id"],
                "symbol":     rule["symbol"],
                "alert_type": rule["alert_type"],
                "label":      SMART_ALERT_TYPES.get(rule["alert_type"], {}).get("label", rule["alert_type"]),
                "detail":     outcome.get("detail", ""),
            })
    return results


# ── Position Sizing Calculator ─────────────────────────────────────────────────

class PositionSizeRequest(BaseModel):
    symbol:       str
    account_size: float
    risk_pct:     float        # e.g. 1.0 for 1%
    entry_price:  float
    stop_price:   float


@app.post("/api/position-sizing")
async def calc_position_size(req: PositionSizeRequest):
    sym        = req.symbol.upper().strip()
    risk_amt   = req.account_size * (req.risk_pct / 100)
    risk_per_share = abs(req.entry_price - req.stop_price)

    if risk_per_share <= 0:
        raise HTTPException(400, "entry_price and stop_price must differ")

    # Fixed fractional
    ff_shares  = risk_amt / risk_per_share
    ff_dollars = ff_shares * req.entry_price
    ff_acct_pct = ff_dollars / req.account_size * 100

    # ATR-based (use 14-day ATR as the risk unit; size so that 1 ATR = risk_amt)
    atr_shares = atr_val = None
    try:
        loop = asyncio.get_event_loop()
        hist = await loop.run_in_executor(
            None, lambda: yf.Ticker(sym, session=_session).history(period="60d", interval="1d", auto_adjust=True)
        )
        if len(hist) >= 15:
            high = hist["High"].values.astype(float)
            low  = hist["Low"].values.astype(float)
            prev = hist["Close"].shift(1).values.astype(float)
            tr   = np.maximum(high - low, np.maximum(np.abs(high - prev), np.abs(low - prev)))
            atr_val   = round(float(np.mean(tr[-14:])), 4)
            if atr_val > 0:
                atr_shares = risk_amt / atr_val
    except Exception:
        pass

    # Kelly (simplified: use last 252d win rate of daily moves)
    kelly_shares = kelly_pct = None
    try:
        loop = asyncio.get_event_loop()
        hist2 = await loop.run_in_executor(
            None, lambda: yf.Ticker(sym, session=_session).history(period="1y", interval="1d", auto_adjust=True)
        )
        if len(hist2) >= 30:
            daily = hist2["Close"].pct_change().dropna()
            wins  = daily[daily > 0]
            losses= daily[daily < 0]
            if len(wins) > 0 and len(losses) > 0:
                win_rate = len(wins) / len(daily)
                avg_win  = float(wins.mean())
                avg_loss = abs(float(losses.mean()))
                kelly_f  = win_rate - (1 - win_rate) / (avg_win / avg_loss) if avg_loss > 0 else 0
                half_kelly = max(0.0, kelly_f / 2)          # half-Kelly for safety
                kelly_dollars = req.account_size * half_kelly
                kelly_shares  = kelly_dollars / req.entry_price
                kelly_pct     = round(half_kelly * 100, 2)
    except Exception:
        pass

    def fmt_row(shares, label, note=""):
        if shares is None or shares <= 0:
            return None
        dollars  = shares * req.entry_price
        acct_pct = dollars / req.account_size * 100
        return {
            "method":   label,
            "shares":   round(shares, 2),
            "dollars":  round(dollars, 2),
            "acct_pct": round(acct_pct, 1),
            "note":     note,
        }

    return {
        "symbol":        sym,
        "account_size":  req.account_size,
        "risk_pct":      req.risk_pct,
        "risk_amount":   round(risk_amt, 2),
        "entry":         req.entry_price,
        "stop":          req.stop_price,
        "risk_per_share": round(risk_per_share, 4),
        "atr":           atr_val,
        "methods": [r for r in [
            fmt_row(ff_shares,    "Fixed Fractional",
                    f"Risk ${risk_amt:.0f} / ${risk_per_share:.2f} per share"),
            fmt_row(atr_shares,   "ATR-based (14)",
                    f"ATR = ${atr_val:.2f}" if atr_val else "ATR unavailable"),
            fmt_row(kelly_shares, "Half-Kelly",
                    f"Kelly% = {kelly_pct:.1f}% of account" if kelly_pct else ""),
        ] if r is not None],
    }


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


@app.get("/api/portfolio/optimize")
async def get_portfolio_optimize():
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, _compute_efficient_frontier)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Rich Earnings Calendar ─────────────────────────────────────────────────────

_RICH_EARN_TTL = timedelta(hours=2)


def _enrich_earnings(symbol: str) -> dict | None:
    cache_key = f"rich_earn:{symbol}"
    cached = cache_get(cache_key, _RICH_EARN_TTL)
    if cached is not None:
        return cached

    try:
        t = yf.Ticker(symbol, session=_session)

        # Next earnings date
        next_date = None
        eps_estimate = None
        try:
            cal = t.calendar
            if cal is not None and not cal.empty:
                for col in cal.columns:
                    if "Earnings" in col and next_date is None:
                        vals = cal[col].dropna()
                        if not vals.empty:
                            next_date = str(pd.to_datetime(vals.iloc[0]).date())
                    if "EPS" in col and "Estimate" in col and eps_estimate is None:
                        vals = cal[col].dropna()
                        if not vals.empty:
                            eps_estimate = _safe_float(vals.iloc[0])
        except Exception:
            pass

        if not next_date:
            return None

        days_away = (pd.to_datetime(next_date).date() - datetime.utcnow().date()).days

        # Historical beat rate + earnings dates for pre-drift
        beat_count = total_count = 0
        earn_dates = []
        try:
            eh = t.earnings_history
            if eh is not None and not eh.empty:
                for idx, row in eh.iterrows():
                    est = _safe_float(row.get("epsEstimate"))
                    act = _safe_float(row.get("epsActual"))
                    if est is not None and act is not None:
                        total_count += 1
                        if act >= est:
                            beat_count += 1
                    dt = idx.date() if hasattr(idx, "date") else None
                    if dt:
                        earn_dates.append(dt)
        except Exception:
            pass

        beat_rate = round(beat_count / total_count * 100) if total_count > 0 else None

        # Pre-earnings drift: avg return 5 days before each historical earnings date
        pre_drift_pct = None
        try:
            hist = t.history(period="2y", interval="1d", auto_adjust=True)
            if not hist.empty and earn_dates:
                drifts = []
                for ed in earn_dates:
                    idx_pos = hist.index.searchsorted(pd.Timestamp(ed))
                    if idx_pos >= 5:
                        pre  = float(hist["Close"].iloc[idx_pos - 5])
                        eve  = float(hist["Close"].iloc[idx_pos - 1])
                        if pre > 0:
                            drifts.append((eve / pre - 1) * 100)
                if drifts:
                    pre_drift_pct = round(float(np.mean(drifts)), 2)
        except Exception:
            pass

        # Expected move from nearest expiry ATM straddle
        expected_move_pct = straddle_cost = None
        try:
            price = float(t.fast_info.last_price)
            exps  = t.options
            if exps and price:
                chain = t.option_chain(exps[0])
                calls, puts = chain.calls, chain.puts
                def _mid(row):
                    b = float(row.get("bid", 0) or 0)
                    a = float(row.get("ask", 0) or 0)
                    lp = float(row.get("lastPrice", 0) or 0)
                    return (b + a) / 2 if a > b > 0 else lp
                atm_c = calls.loc[(calls["strike"] - price).abs().idxmin()]
                atm_p = puts.loc[(puts["strike"] - price).abs().idxmin()]
                cost  = _mid(atm_c) + _mid(atm_p)
                if cost > 0:
                    straddle_cost      = round(cost, 2)
                    expected_move_pct  = round(cost / price * 100, 1)
        except Exception:
            pass

        result = {
            "symbol":            symbol,
            "next_date":         next_date,
            "days_away":         days_away,
            "eps_estimate":      eps_estimate,
            "beat_rate":         beat_rate,
            "beat_count":        beat_count,
            "total_count":       total_count,
            "expected_move_pct": expected_move_pct,
            "straddle_cost":     straddle_cost,
            "pre_drift_pct":     pre_drift_pct,
        }
        cache_set(cache_key, result)
        return result
    except Exception as e:
        logger.debug("rich earnings %s: %s", symbol, e)
        return None


class RichCalendarRequest(BaseModel):
    symbols: List[str]


@app.post("/api/earnings/rich-calendar")
async def get_rich_calendar(req: RichCalendarRequest):
    symbols = [s.upper().strip() for s in req.symbols[:60]]
    loop    = asyncio.get_event_loop()
    results = await asyncio.gather(*[loop.run_in_executor(None, _enrich_earnings, s) for s in symbols])
    out = [r for r in results if r is not None]
    out.sort(key=lambda r: r.get("days_away", 9999))
    return out


# ── News Sentiment Engine ──────────────────────────────────────────────────────

_SENTIMENT_TTL = timedelta(hours=2)

_SENTIMENT_SYSTEM = (
    "You are a financial news sentiment analyzer. "
    "Given headlines grouped by ticker, return ONLY a JSON object (no markdown, no explanation) in this shape:\n"
    '{"TICKER": {"score": <float -1 to 1>, "label": "bullish"|"bearish"|"neutral", '
    '"summary": "<1 sentence>", "top_story": "<most impactful headline>"}}\n'
    "score: -1=very bearish, 0=neutral, +1=very bullish. "
    "Include only tickers that appear in the input."
)


def _fetch_headlines(symbol: str, max_items: int = 6) -> list[str]:
    try:
        news = yf.Ticker(symbol, session=_session).news or []
        titles = []
        for item in news[:max_items]:
            t = (item.get("content") or {}).get("title") or item.get("title", "")
            if t:
                titles.append(t)
        return titles
    except Exception:
        return []


class SentimentRequest(BaseModel):
    symbols: List[str]


@app.post("/api/news/sentiment")
async def get_news_sentiment(req: SentimentRequest):
    symbols   = [s.upper().strip() for s in req.symbols[:20]]
    cache_key = f"sentiment:{','.join(sorted(symbols))}"
    cached    = cache_get(cache_key, _SENTIMENT_TTL)
    if cached is not None:
        return cached

    loop         = asyncio.get_event_loop()
    news_results = await asyncio.gather(*[loop.run_in_executor(None, _fetch_headlines, s) for s in symbols])

    prompt_lines = []
    for sym, headlines in zip(symbols, news_results):
        if headlines:
            prompt_lines.append(f"{sym}:")
            for h in headlines:
                prompt_lines.append(f"  - {h}")

    if not prompt_lines:
        return {}

    try:
        client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
        msg    = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=_SENTIMENT_SYSTEM,
            messages=[{"role": "user", "content": "\n".join(prompt_lines)}],
        )
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            lines = raw.splitlines()
            raw   = "\n".join(lines[1: len(lines) - (1 if lines[-1].strip() == "```" else 0)])
        result = json.loads(raw)
        cache_set(cache_key, result)
        return result
    except Exception as e:
        logger.warning("sentiment failed: %s", e)
        raise HTTPException(500, f"Sentiment analysis failed: {e}")


# ── Options P&L Tracker ───────────────────────────────────────────────────────

class OptionsPositionCreate(BaseModel):
    symbol:        str
    option_type:   str    # call | put
    strike:        float
    expiry:        str    # YYYY-MM-DD
    quantity:      int    # negative = short
    entry_premium: float
    note:          str = ""


@app.get("/api/options-positions")
def list_options_positions():
    with db_session() as db:
        rows = db.query(OptionsPosition).order_by(OptionsPosition.created_at.desc()).all()
        return [{"id": r.id, "symbol": r.symbol, "option_type": r.option_type,
                 "strike": r.strike, "expiry": r.expiry, "quantity": r.quantity,
                 "entry_premium": r.entry_premium, "note": r.note,
                 "created_at": str(r.created_at)} for r in rows]


@app.post("/api/options-positions")
def add_options_position(req: OptionsPositionCreate):
    if req.option_type.lower() not in ("call", "put"):
        raise HTTPException(400, "option_type must be 'call' or 'put'")
    with db_session() as db:
        pos = OptionsPosition(
            symbol=req.symbol.upper().strip(),
            option_type=req.option_type.lower(),
            strike=req.strike,
            expiry=req.expiry,
            quantity=req.quantity,
            entry_premium=req.entry_premium,
            note=req.note,
        )
        db.add(pos)
        db.flush()
        return {"id": pos.id, "symbol": pos.symbol}


@app.delete("/api/options-positions/{pos_id}")
def delete_options_position(pos_id: int):
    with db_session() as db:
        pos = db.query(OptionsPosition).filter(OptionsPosition.id == pos_id).first()
        if not pos:
            raise HTTPException(404, "Position not found")
        db.delete(pos)
    return {"ok": True}


def _live_option_price(symbol: str, option_type: str, strike: float, expiry: str) -> dict:
    """Fetch current mid-price and Greeks from yfinance option chain."""
    try:
        t     = yf.Ticker(symbol, session=_session)
        chain = t.option_chain(expiry)
        df    = chain.calls if option_type == "call" else chain.puts
        row   = df.loc[(df["strike"] - strike).abs().idxmin()]
        bid   = float(row.get("bid", 0) or 0)
        ask   = float(row.get("ask", 0) or 0)
        lp    = float(row.get("lastPrice", 0) or 0)
        mid   = (bid + ask) / 2 if ask > bid > 0 else lp
        delta = _safe_float(row.get("delta"))
        theta = _safe_float(row.get("theta"))
        iv    = _safe_float(row.get("impliedVolatility"))
        return {"mid": round(mid, 4), "delta": delta, "theta": theta, "iv": iv, "ok": True}
    except Exception:
        return {"mid": None, "delta": None, "theta": None, "iv": None, "ok": False}


@app.get("/api/options-positions/pnl")
async def get_options_pnl():
    with db_session() as db:
        rows = db.query(OptionsPosition).order_by(OptionsPosition.created_at.desc()).all()
        positions = [{"id": r.id, "symbol": r.symbol, "option_type": r.option_type,
                      "strike": r.strike, "expiry": r.expiry, "quantity": r.quantity,
                      "entry_premium": r.entry_premium, "note": r.note} for r in rows]

    if not positions:
        return []

    today = datetime.utcnow().date()
    loop  = asyncio.get_event_loop()

    async def enrich(pos):
        dte  = (pd.to_datetime(pos["expiry"]).date() - today).days
        live = await loop.run_in_executor(
            None, lambda p=pos: _live_option_price(p["symbol"], p["option_type"], p["strike"], p["expiry"])
        )
        mid       = live["mid"]
        entry     = pos["entry_premium"]
        qty       = pos["quantity"]
        direction = 1 if qty > 0 else -1   # long = +1, short = -1
        pnl       = round((mid - entry) * abs(qty) * 100 * direction, 2) if mid is not None else None
        pnl_pct   = round((mid / entry - 1) * 100 * direction, 2) if mid and entry else None
        return {
            **pos,
            "current_mid": mid,
            "pnl":         pnl,
            "pnl_pct":     pnl_pct,
            "dte":         dte,
            "delta":       live["delta"],
            "theta":       live["theta"],
            "iv_pct":      round(live["iv"] * 100, 1) if live["iv"] else None,
            "cost_basis":  round(entry * abs(qty) * 100, 2),
            "expired":     dte < 0,
        }

    return await asyncio.gather(*[enrich(p) for p in positions])


# ── Portfolio X-Ray ────────────────────────────────────────────────────────────

_XRAY_TTL = timedelta(hours=1)

_CAP_BUCKETS = [
    (200e9, "Mega Cap (>$200B)"),
    (10e9,  "Large Cap ($10–200B)"),
    (2e9,   "Mid Cap ($2–10B)"),
    (300e6, "Small Cap ($300M–2B)"),
    (0,     "Micro Cap (<$300M)"),
]


def _compute_xray() -> dict:
    cache_key = "portfolio:xray"
    cached = cache_get(cache_key, _XRAY_TTL)
    if cached is not None:
        return cached

    with db_session() as db:
        positions = db.query(PortfolioPosition).all()
        holdings  = [{"symbol": p.symbol, "shares": p.shares, "avg_cost": p.avg_cost} for p in positions]

    if not holdings:
        raise ValueError("No portfolio positions")

    symbols = [h["symbol"] for h in holdings]

    # Fetch prices for market values
    try:
        prices_raw = yf.download(symbols, period="2d", interval="1d", auto_adjust=True, progress=False, session=_session)
        closes     = prices_raw["Close"].dropna(how="all") if isinstance(prices_raw.columns, pd.MultiIndex) else prices_raw.dropna(how="all")
        price_map  = {s: float(closes[s].dropna().iloc[-1]) for s in symbols if s in closes.columns}
    except Exception:
        price_map = {}

    vals = {h["symbol"]: price_map.get(h["symbol"], h["avg_cost"]) * h["shares"] for h in holdings}
    total_val = sum(vals.values()) or 1.0

    # Fetch fundamentals per symbol
    sector_weights: dict[str, float] = {}
    cap_weights:    dict[str, float] = {}
    country_weights:dict[str, float] = {}
    pe_sum = pe_weight = 0.0
    beta_sum = beta_weight = 0.0
    holding_details = []

    for sym in symbols:
        w = vals.get(sym, 0) / total_val
        try:
            info = yf.Ticker(sym, session=_session).info
            sector  = info.get("sector") or info.get("sectorDisp") or "Unknown"
            country = info.get("country") or "Unknown"
            mktcap  = _safe_float(info.get("marketCap"))
            pe      = _safe_float(info.get("trailingPE"))
            beta    = _safe_float(info.get("beta"))

            sector_weights[sector]   = sector_weights.get(sector, 0) + w
            country_weights[country] = country_weights.get(country, 0) + w

            cap_label = _CAP_BUCKETS[-1][1]
            if mktcap:
                for threshold, label in _CAP_BUCKETS:
                    if mktcap >= threshold:
                        cap_label = label
                        break
            cap_weights[cap_label] = cap_weights.get(cap_label, 0) + w

            if pe and 0 < pe < 500:
                pe_sum    += pe * w
                pe_weight += w
            if beta:
                beta_sum    += beta * w
                beta_weight += w

            holding_details.append({
                "symbol":   sym,
                "weight":   round(w * 100, 1),
                "sector":   sector,
                "country":  country,
                "mktcap":   mktcap,
                "cap_label": cap_label,
                "pe":        round(pe, 1) if pe else None,
                "beta":      round(beta, 2) if beta else None,
            })
        except Exception:
            holding_details.append({"symbol": sym, "weight": round(w * 100, 1), "sector": "Unknown"})

    def top_sorted(d: dict) -> list:
        total = sum(d.values()) or 1
        return sorted([{"label": k, "pct": round(v / total * 100, 1)} for k, v in d.items()],
                      key=lambda x: -x["pct"])

    result = {
        "total_value":       round(total_val, 2),
        "weighted_pe":       round(pe_sum / pe_weight, 1) if pe_weight > 0 else None,
        "weighted_beta":     round(beta_sum / beta_weight, 2) if beta_weight > 0 else None,
        "sector_breakdown":  top_sorted(sector_weights),
        "cap_breakdown":     top_sorted(cap_weights),
        "country_breakdown": top_sorted(country_weights),
        "holdings":          sorted(holding_details, key=lambda h: -h["weight"]),
        "concentration_top3": round(sum(h["weight"] for h in sorted(holding_details, key=lambda h: -h["weight"])[:3]), 1),
    }
    cache_set(cache_key, result)
    return result


@app.get("/api/portfolio/xray")
async def get_portfolio_xray():
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, _compute_xray)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Sector Momentum Ranker ─────────────────────────────────────────────────────

_MOMENTUM_TTL = timedelta(minutes=30)


@app.get("/api/sectors/momentum")
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


# ── Market Breadth Dashboard ──────────────────────────────────────────────────

_BREADTH_TTL = timedelta(minutes=30)


@app.get("/api/market/breadth")
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


# ── Fundamental Comparison Tool ───────────────────────────────────────────────

_FUNDC_TTL = timedelta(hours=2)

_COMPARE_METRICS = [
    ("Market Cap",         "marketCap",           "B",    lambda v: f"${v/1e9:.1f}B"),
    ("Price",              "currentPrice",         "$",    lambda v: f"${v:.2f}"),
    ("P/E (Trailing)",     "trailingPE",           "x",    lambda v: f"{v:.1f}x"),
    ("P/E (Forward)",      "forwardPE",            "x",    lambda v: f"{v:.1f}x"),
    ("P/S",                "priceToSalesTrailing12Months", "x", lambda v: f"{v:.1f}x"),
    ("P/B",                "priceToBook",          "x",    lambda v: f"{v:.1f}x"),
    ("EV/EBITDA",          "enterpriseToEbitda",   "x",    lambda v: f"{v:.1f}x"),
    ("Rev Growth (YoY)",   "revenueGrowth",        "%",    lambda v: f"{v*100:.1f}%"),
    ("Gross Margin",       "grossMargins",         "%",    lambda v: f"{v*100:.1f}%"),
    ("Op Margin",          "operatingMargins",     "%",    lambda v: f"{v*100:.1f}%"),
    ("Net Margin",         "profitMargins",        "%",    lambda v: f"{v*100:.1f}%"),
    ("ROE",                "returnOnEquity",       "%",    lambda v: f"{v*100:.1f}%"),
    ("ROA",                "returnOnAssets",       "%",    lambda v: f"{v*100:.1f}%"),
    ("Debt/Equity",        "debtToEquity",         "x",    lambda v: f"{v:.2f}x"),
    ("Current Ratio",      "currentRatio",         "x",    lambda v: f"{v:.2f}x"),
    ("Dividend Yield",     "dividendYield",        "%",    lambda v: f"{v*100:.2f}%"),
    ("Beta",               "beta",                 "",     lambda v: f"{v:.2f}"),
    ("Short % Float",      "shortPercentOfFloat",  "%",    lambda v: f"{v*100:.1f}%"),
    ("Insider Own%",       "heldPercentInsiders",  "%",    lambda v: f"{v*100:.1f}%"),
    ("52W High",           "fiftyTwoWeekHigh",     "$",    lambda v: f"${v:.2f}"),
    ("52W Low",            "fiftyTwoWeekLow",      "$",    lambda v: f"${v:.2f}"),
]

# Metrics where lower = better (for color-coding)
_LOWER_BETTER = {"P/E (Trailing)", "P/E (Forward)", "P/S", "P/B", "EV/EBITDA", "Debt/Equity", "Short % Float"}
# Metrics where direction doesn't clearly apply
_NEUTRAL_METRICS = {"Price", "Market Cap", "52W High", "52W Low", "Beta", "Dividend Yield"}


def _fetch_compare_symbol(symbol: str) -> dict:
    cache_key = f"fundc:{symbol}"
    cached = cache_get(cache_key, _FUNDC_TTL)
    if cached is not None:
        return cached

    try:
        info = yf.Ticker(symbol, session=_session).info
        row  = {"symbol": symbol, "name": info.get("shortName", symbol)}
        for label, key, _, _ in _COMPARE_METRICS:
            row[label] = _safe_float(info.get(key))
        cache_set(cache_key, row)
        return row
    except Exception as e:
        return {"symbol": symbol, "error": str(e)}


@app.get("/api/compare/fundamentals")
async def compare_fundamentals(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()][:5]
    if not syms:
        raise HTTPException(400, "Provide at least one symbol")
    loop    = asyncio.get_event_loop()
    results = await asyncio.gather(*[loop.run_in_executor(None, _fetch_compare_symbol, s) for s in syms])

    # Compute per-metric best/worst for highlighting
    metrics_meta = []
    for label, _, unit, fmt_fn in _COMPARE_METRICS:
        vals = {r["symbol"]: r.get(label) for r in results if r.get(label) is not None}
        if not vals:
            metrics_meta.append({"label": label, "unit": unit, "best": None, "worst": None})
            continue
        if label in _NEUTRAL_METRICS:
            metrics_meta.append({"label": label, "unit": unit, "best": None, "worst": None})
            continue
        lower_better = label in _LOWER_BETTER
        best  = min(vals, key=vals.get) if lower_better else max(vals, key=vals.get)
        worst = max(vals, key=vals.get) if lower_better else min(vals, key=vals.get)
        metrics_meta.append({"label": label, "unit": unit, "best": best, "worst": worst})

    return {"symbols": syms, "rows": list(results), "metrics": metrics_meta}


# ── Price Target Tracker ──────────────────────────────────────────────────────

class PriceTargetCreate(BaseModel):
    symbol:       str
    target_price: float
    target_date:  str = ""
    note:         str = ""


@app.get("/api/price-targets")
async def list_price_targets():
    with db_session() as db:
        targets = db.query(PriceTarget).order_by(PriceTarget.created_at.desc()).all()
        items   = [{"id": t.id, "symbol": t.symbol, "target_price": t.target_price,
                    "target_date": t.target_date, "note": t.note, "created_at": str(t.created_at)}
                   for t in targets]

    if not items:
        return []

    # Enrich with live prices + analyst consensus
    syms = list({i["symbol"] for i in items})
    loop = asyncio.get_event_loop()

    def _fetch_price_and_consensus(sym):
        try:
            t     = yf.Ticker(sym, session=_session)
            fi    = t.fast_info
            price = _safe_float(fi.last_price)
            info  = t.info
            consensus = _safe_float(info.get("targetMeanPrice"))
            return sym, price, consensus
        except Exception:
            return sym, None, None

    price_results = await asyncio.gather(*[loop.run_in_executor(None, _fetch_price_and_consensus, s) for s in syms])
    price_map = {sym: (price, consensus) for sym, price, consensus in price_results}

    today = datetime.utcnow().date()
    enriched = []
    for item in items:
        price, consensus = price_map.get(item["symbol"], (None, None))
        pct_to_target = None
        if price and price > 0:
            pct_to_target = round((item["target_price"] / price - 1) * 100, 2)
        days_remaining = None
        if item["target_date"]:
            try:
                days_remaining = (pd.to_datetime(item["target_date"]).date() - today).days
            except Exception:
                pass
        enriched.append({
            **item,
            "current_price":    round(price, 2) if price else None,
            "pct_to_target":    pct_to_target,
            "analyst_consensus": round(consensus, 2) if consensus else None,
            "days_remaining":   days_remaining,
        })
    return enriched


@app.post("/api/price-targets")
def create_price_target(req: PriceTargetCreate):
    with db_session() as db:
        pt = PriceTarget(
            symbol=req.symbol.upper().strip(),
            target_price=req.target_price,
            target_date=req.target_date or None,
            note=req.note or None,
        )
        db.add(pt)
        db.flush()
        return {"id": pt.id, "symbol": pt.symbol}


@app.delete("/api/price-targets/{target_id}")
def delete_price_target(target_id: int):
    with db_session() as db:
        pt = db.query(PriceTarget).filter(PriceTarget.id == target_id).first()
        if not pt:
            raise HTTPException(404, "Target not found")
        db.delete(pt)
    return {"ok": True}


# ── Earnings Call Summarizer ──────────────────────────────────────────────────

_TRANSCRIPT_TTL = timedelta(hours=24)

_TRANSCRIPT_SYSTEM = """You are a financial analyst summarizing an earnings press release or 8-K filing.
Extract key information and return a JSON object with exactly these fields:
{
  "quarter": "Q1 2025",
  "beat_miss": "Beat EPS by $0.12, revenue in-line",
  "guidance": "Full-year EPS guided to $7.20-7.40, above consensus $7.15",
  "tone": "bullish",
  "tone_reason": "Management expressed strong confidence citing pipeline growth",
  "key_themes": ["AI adoption", "margin expansion", "international growth"],
  "risks": ["macro uncertainty", "supply chain pressure"],
  "notable_quote": "Most impactful verbatim quote from management"
}
tone must be one of: bullish, neutral, cautious, bearish.
If data is missing for a field, use null. Return ONLY valid JSON, no other text."""


@app.get("/api/earnings/transcript-summary/{symbol}")
async def get_transcript_summary(symbol: str):
    sym = symbol.upper().strip()
    cache_key = f"transcript:{sym}"
    cached = cache_get(cache_key, _TRANSCRIPT_TTL)
    if cached is not None:
        return cached

    cik = _get_cik(sym)
    if not cik:
        raise HTTPException(404, "Ticker not found in EDGAR")

    cik_int = int(cik)
    headers = {"User-Agent": "StockMonitor raghuravuri@gmail.com"}

    # Fetch recent filings to find the most recent 8-K (earnings announcement)
    loop = asyncio.get_event_loop()
    try:
        sub_url = f"https://data.sec.gov/submissions/CIK{cik}.json"
        r = await loop.run_in_executor(None, lambda: _session.get(sub_url, headers=headers))
        sub_data = r.json()
    except Exception as e:
        raise HTTPException(502, f"EDGAR fetch failed: {e}")

    recent  = sub_data.get("filings", {}).get("recent", {})
    forms   = recent.get("form", [])
    dates   = recent.get("filingDate", [])
    accnums = recent.get("accessionNumber", [])
    docs    = recent.get("primaryDocument", [])
    descs   = recent.get("primaryDocDescription", [])
    company = sub_data.get("name", sym)

    # Find most recent 8-K (likely earnings press release)
    target_acc = target_doc = target_date = None
    for form, date, acc, doc, desc in zip(forms, dates, accnums, docs, descs):
        if form == "8-K":
            target_acc = acc.replace("-", "")
            target_doc = doc
            target_date = date
            break

    if not target_acc:
        raise HTTPException(404, "No recent 8-K filing found for this ticker")

    filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{target_acc}/{target_doc}"

    try:
        r2 = await loop.run_in_executor(None, lambda: _session.get(filing_url, headers=headers))
        raw_html = r2.text
    except Exception as e:
        raise HTTPException(502, f"Filing fetch failed: {e}")

    # Strip HTML tags and collapse whitespace
    import re as _re
    text = _re.sub(r"<[^>]+>", " ", raw_html)
    text = _re.sub(r"&nbsp;", " ", text)
    text = _re.sub(r"&amp;", "&", text)
    text = _re.sub(r"&lt;", "<", text)
    text = _re.sub(r"&gt;", ">", text)
    text = _re.sub(r"\s+", " ", text).strip()
    text = text[:7000]  # limit tokens

    # Send to Claude for structured summary
    try:
        _ac = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
        claude_resp = await loop.run_in_executor(None, lambda: _ac.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=800,
            system=_TRANSCRIPT_SYSTEM,
            messages=[{"role": "user", "content": f"Symbol: {sym}\nFiling date: {target_date}\nFiling text:\n{text}"}],
        ))
        raw = claude_resp.content[0].text.strip()
        import json as _json
        summary = _json.loads(raw)
    except Exception as e:
        logger.warning("Transcript summary LLM failed %s: %s", sym, e)
        raise HTTPException(502, f"Summary generation failed: {e}")

    result = {
        "symbol":      sym,
        "company":     company,
        "filing_date": target_date,
        "filing_url":  filing_url,
        "summary":     summary,
    }
    cache_set(cache_key, result)
    return result


# ── DCF Valuation ─────────────────────────────────────────────────────────────

@app.get("/api/dcf/prefill/{symbol}")
async def dcf_prefill(symbol: str):
    """Return yfinance fundamentals to pre-fill the DCF form."""
    sym = symbol.upper().strip()
    cache_key = f"dcf_prefill:{sym}"
    cached = cache_get(cache_key, timedelta(hours=2))
    if cached: return cached

    loop = asyncio.get_event_loop()
    try:
        ticker = yf.Ticker(sym)
        info = await loop.run_in_executor(None, lambda: ticker.info)
        result = {
            "symbol": sym,
            "eps_ttm":        _safe_float(info.get("trailingEps")),
            "eps_forward":    _safe_float(info.get("forwardEps")),
            "growth_rate":    _safe_float(info.get("earningsGrowth") or info.get("revenueGrowth")),
            "beta":           _safe_float(info.get("beta")),
            "price":          _safe_float(info.get("currentPrice") or info.get("regularMarketPrice")),
            "shares_out":     _safe_float(info.get("sharesOutstanding")),
            "name":           info.get("shortName", sym),
        }
    except Exception as e:
        result = {"symbol": sym, "error": str(e)}

    cache_set(cache_key, result)
    return result


# ── Yield Curve & Rates ───────────────────────────────────────────────────────

_RATES_TTL = timedelta(minutes=30)

@app.get("/api/market/rates")
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


_SCANNER_UOA_TTL = timedelta(minutes=30)

@app.get("/api/options/unusual")
async def unusual_options_activity(symbols: str = Query(...)):
    """
    Scan options chains for unusual activity.
    symbols: comma-separated list (max 10)
    Returns contracts where volume >= 2× open_interest OR volume > 500 AND volume > open_interest.
    """
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()][:10]
    cache_key = f"uoa:{','.join(sorted(syms))}"
    cached = cache_get(cache_key, _SCANNER_UOA_TTL)
    if cached: return cached

    loop = asyncio.get_event_loop()
    results = []

    def fetch_uoa(sym):
        try:
            tk = yf.Ticker(sym)
            expiries = tk.options
            if not expiries:
                return []
            # Only scan nearest 3 expiries to keep it fast
            hits = []
            for exp in expiries[:3]:
                try:
                    chain = tk.option_chain(exp)
                    for df, opt_type in [(chain.calls, "call"), (chain.puts, "put")]:
                        for _, row in df.iterrows():
                            vol = int(row.get("volume", 0) or 0)
                            oi  = int(row.get("openInterest", 0) or 0)
                            if vol < 100:
                                continue
                            if oi > 0 and vol >= 2 * oi:
                                ratio = round(vol / max(oi, 1), 1)
                            elif vol >= 1000 and oi == 0:
                                ratio = None  # fresh contract
                            else:
                                continue
                            bid  = _safe_float(row.get("bid"))
                            ask  = _safe_float(row.get("ask"))
                            iv   = _safe_float(row.get("impliedVolatility"))
                            hits.append({
                                "symbol":     sym,
                                "type":       opt_type,
                                "strike":     _safe_float(row.get("strike")),
                                "expiry":     exp,
                                "volume":     vol,
                                "open_interest": oi,
                                "vol_oi_ratio":  ratio,
                                "bid":        bid,
                                "ask":        ask,
                                "mid":        round((bid + ask) / 2, 2) if bid and ask else None,
                                "iv_pct":     round(iv * 100, 1) if iv else None,
                                "in_the_money": bool(row.get("inTheMoney", False)),
                            })
                except Exception:
                    continue
            # Sort by volume desc, cap at 20 per symbol
            hits.sort(key=lambda x: x["volume"], reverse=True)
            return hits[:20]
        except Exception:
            return []

    tasks = [loop.run_in_executor(None, fetch_uoa, sym) for sym in syms]
    all_results = await asyncio.gather(*tasks)
    for hits in all_results:
        results.extend(hits)

    # Global sort by volume, cap at 100
    results.sort(key=lambda x: x["volume"], reverse=True)
    results = results[:100]

    result = {"items": results, "scanned": syms}
    cache_set(cache_key, result)
    return result


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}
