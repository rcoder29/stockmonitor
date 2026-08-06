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
import xml.etree.ElementTree as ET
import re
from anthropic import Anthropic
from dotenv import load_dotenv
load_dotenv()

try:
    from google import genai as _genai_module
    _genai_available = True
except ImportError:
    _genai_available = False

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
        f = float(val) if val is not None else None
        return None if (f is None or f != f) else f  # f != f catches NaN
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


def _fetch_market_cap(sym: str) -> tuple[str, float | None]:
    try:
        fi = yf.Ticker(sym, session=_session).fast_info
        return sym, _safe_float(fi.market_cap)
    except Exception:
        return sym, None


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
    market_caps: dict[str, float | None] = {}

    with ThreadPoolExecutor(max_workers=20) as pool:
        perf_futs  = {pool.submit(_fetch_perf_one,    s): ("perf", s) for s in symbols}
        cap_futs   = {pool.submit(_fetch_market_cap,  s): ("cap",  s) for s in symbols}
        all_futs   = {**perf_futs, **cap_futs}
        for fut in as_completed(all_futs):
            kind, _ = all_futs[fut]
            if kind == "perf":
                d = fut.result()
                perfs[d["symbol"]] = d
            else:
                sym, cap = fut.result()
                market_caps[sym] = cap

    # Compute actual market-cap weights as % of the index universe
    total_cap = sum(v for v in market_caps.values() if v)

    result = []
    for sym in symbols:
        d   = perfs.get(sym, {"symbol": sym})
        m   = meta_map[sym]
        cap = market_caps.get(sym)
        actual_weight = round(cap / total_cap * 100, 2) if cap and total_cap else None
        ret_1d        = d.get("1d")
        # Weighted contribution to the index's 1D return (weight × return / 100)
        wt_contribution = round(actual_weight * ret_1d / 100, 4) if actual_weight and ret_1d is not None else None
        result.append({
            "symbol":        sym,
            "name":          m["name"],
            "sector":        m["sector"],
            "indexWeight":   m["weight"],        # hardcoded approx (fallback)
            "actualWeight":  actual_weight,      # live market-cap weight
            "marketCap":     cap,
            "wtContribution": wt_contribution,   # weight × 1D return (basis pts style)
            "price":         d.get("price"),
            "1d":            ret_1d,
            "5d":            d.get("5d"),
            "1m":            d.get("1m"),
            "3m":            d.get("3m"),
            "6m":            d.get("6m"),
            "1y":            d.get("1y"),
            "ytd":           d.get("ytd"),
        })

    cache_set(cache_key, result)
    return result


@app.get("/api/search-etf")
def search_etf(q: str):
    """Search Yahoo Finance for ETFs/indices matching a query string."""
    q = q.strip()
    if len(q) < 1:
        return []
    try:
        url = "https://query1.finance.yahoo.com/v1/finance/search"
        params = {
            "q": q,
            "quotesCount": 20,
            "enableFuzzyQuery": True,
            "quotesQueryId": "tss_match_phrase_query",
        }
        resp = _session.get(url, params=params, timeout=6)
        data = resp.json()
        quotes = data.get("quotes", [])
        results = []
        for item in quotes:
            qt = item.get("quoteType", "")
            if qt not in ("ETF", "INDEX", "MUTUALFUND"):
                continue
            results.append({
                "symbol":   item.get("symbol", ""),
                "name":     item.get("longname") or item.get("shortname") or "",
                "type":     qt,
                "exchange": item.get("exchange", ""),
            })
        return results[:12]
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/etf-holdings")
def get_etf_holdings(etf: str):
    """Fetch constituent holdings for any ETF/fund via yfinance funds_data."""
    etf = etf.upper().strip()
    cache_key = f"etf:holdings:{etf}"
    cached = cache_get(cache_key, _INDEX_TTL)
    if cached is not None:
        return cached

    try:
        ticker = yf.Ticker(etf, session=_session)
        fd = ticker.funds_data
        holdings_df = fd.top_holdings
    except Exception as e:
        raise HTTPException(400, f"Could not fetch holdings for '{etf}': {e}")

    if holdings_df is None or holdings_df.empty:
        raise HTTPException(404, f"No holdings data found for '{etf}'")

    # top_holdings index = symbol; columns include holdingName, holdingPercent
    symbols = [s for s in holdings_df.index.tolist() if isinstance(s, str) and s]
    name_map   = {}
    weight_map = {}
    for sym in symbols:
        row = holdings_df.loc[sym]
        name_map[sym]   = row.get("holdingName", sym) if hasattr(row, "get") else sym
        pct = row.get("holdingPercent") if hasattr(row, "get") else None
        weight_map[sym] = float(pct) * 100 if pct is not None else None

    if not symbols:
        raise HTTPException(404, f"No holdings data found for '{etf}'")

    perfs: dict[str, dict] = {}
    market_caps: dict[str, float | None] = {}

    with ThreadPoolExecutor(max_workers=20) as pool:
        perf_futs = {pool.submit(_fetch_perf_one,   s): ("perf", s) for s in symbols}
        cap_futs  = {pool.submit(_fetch_market_cap, s): ("cap",  s) for s in symbols}
        all_futs  = {**perf_futs, **cap_futs}
        for fut in as_completed(all_futs):
            kind, _ = all_futs[fut]
            if kind == "perf":
                d = fut.result()
                perfs[d["symbol"]] = d
            else:
                sym, cap = fut.result()
                market_caps[sym] = cap

    total_cap = sum(v for v in market_caps.values() if v)
    # Prefer reported fund weight; fall back to market-cap weight
    total_reported = sum(v for v in weight_map.values() if v is not None)

    result = []
    for sym in symbols:
        d   = perfs.get(sym, {"symbol": sym})
        cap = market_caps.get(sym)

        # Actual weight: use fund-reported percent if available, else derive from mkt cap
        reported_wt = weight_map.get(sym)
        if reported_wt is not None:
            actual_weight = round(reported_wt, 2)
        elif cap and total_cap:
            actual_weight = round(cap / total_cap * 100, 2)
        else:
            actual_weight = None

        ret_1d = d.get("1d")
        wt_contribution = round(actual_weight * ret_1d / 100, 4) if actual_weight and ret_1d is not None else None

        result.append({
            "symbol":         sym,
            "name":           name_map.get(sym, sym),
            "sector":         d.get("sector", ""),
            "indexWeight":    actual_weight,   # reported fund weight %
            "actualWeight":   actual_weight,
            "marketCap":      cap,
            "wtContribution": wt_contribution,
            "price":          d.get("price"),
            "1d":             ret_1d,
            "5d":             d.get("5d"),
            "1m":             d.get("1m"),
            "3m":             d.get("3m"),
            "6m":             d.get("6m"),
            "1y":             d.get("1y"),
            "ytd":            d.get("ytd"),
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
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    use_gemini = bool(gemini_key) and _genai_available

    def generate_gemini():
        try:
            gc = _genai_module.Client(api_key=gemini_key)
            # Build contents list: map "assistant" → "model" role
            contents = []
            for m in body.messages:
                role = "model" if m.role == "assistant" else "user"
                contents.append({"role": role, "parts": [{"text": m.content}]})
            from google.genai import types as _genai_types
            cfg = _genai_types.GenerateContentConfig(
                system_instruction=_FINANCE_SYSTEM,
                max_output_tokens=2048,
            )
            response = gc.models.generate_content_stream(
                model="gemini-2.0-flash",
                contents=contents,
                config=cfg,
            )
            for chunk in response:
                if chunk.text:
                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            logger.error("AI chat (Gemini) error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    def generate_anthropic():
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
            logger.error("AI chat (Anthropic) error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        generate_gemini() if use_gemini else generate_anthropic(),
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


# ── Custom news feed ─────────────────────────────────────────────────────────

_TOPIC_SYMBOLS: dict[str, str] = {
    "sp500":          "^GSPC",
    "nasdaq":         "^IXIC",
    "dowjones":       "^DJI",
    "tech":           "QQQ",
    "energy":         "XLE",
    "healthcare":     "XLV",
    "financials":     "XLF",
    "consumer":       "XLY",
    "industrials":    "XLI",
    "materials":      "XLB",
    "utilities":      "XLU",
    "realestate":     "VNQ",
    "communications": "XLC",
    "rates":          "^TNX",
    "gold":           "GC=F",
    "oil":            "CL=F",
    "crypto":         "BTC-USD",
}

@app.get("/api/news-feed")
async def get_custom_news_feed(topics: str = Query(...)):
    topic_list = [t.strip() for t in topics.split(",") if t.strip()]
    if not topic_list:
        return []

    # Map preset keys to yfinance symbols; fall back to treating as ticker
    def resolve(topic: str) -> str:
        return _TOPIC_SYMBOLS.get(topic.lower(), topic.upper())

    symbols = [resolve(t) for t in topic_list]

    def fetch_with_tag(args: tuple) -> list:
        sym, topic = args
        arts = _fetch_feed(sym)
        for a in arts:
            a["topic"] = topic
        return arts

    all_articles: list[dict] = []
    seen_links: set[str] = set()
    pairs = list(zip(symbols, topic_list))
    with ThreadPoolExecutor(max_workers=min(len(pairs), 10)) as pool:
        for batch in pool.map(fetch_with_tag, pairs):
            for a in batch:
                if a["link"] not in seen_links:
                    seen_links.add(a["link"])
                    all_articles.append(a)

    all_articles.sort(key=lambda a: a.get("publishedAt") or "", reverse=True)
    return all_articles[:60]


# ── Tax Advisor ───────────────────────────────────────────────────────────────

# 2025 state income tax rates (top marginal rate for MFJ; 0 = no income tax)
_STATE_TAX: dict[str, float] = {
    "AL": 5.0,  "AK": 0.0,  "AZ": 2.5,  "AR": 4.4,  "CA": 13.3, "CO": 4.4,
    "CT": 6.99, "DE": 6.6,  "FL": 0.0,  "GA": 5.39, "HI": 11.0, "ID": 5.8,
    "IL": 4.95, "IN": 3.05, "IA": 5.7,  "KS": 5.7,  "KY": 4.0,  "LA": 4.25,
    "ME": 7.15, "MD": 5.75, "MA": 5.0,  "MI": 4.05, "MN": 9.85, "MS": 4.7,
    "MO": 4.95, "MT": 5.9,  "NE": 5.84, "NV": 0.0,  "NH": 3.0,  "NJ": 10.75,
    "NM": 5.9,  "NY": 10.9, "NC": 4.5,  "ND": 2.5,  "OH": 3.99, "OK": 4.75,
    "OR": 9.9,  "PA": 3.07, "RI": 5.99, "SC": 6.4,  "SD": 0.0,  "TN": 0.0,
    "TX": 0.0,  "UT": 4.65, "VT": 8.75, "VA": 5.75, "WA": 0.0,  "WV": 5.12,
    "WI": 7.65, "WY": 0.0,  "DC": 10.75,
}

_STATE_NAMES: dict[str, str] = {
    "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California",
    "CO":"Colorado","CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia",
    "HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas",
    "KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts",
    "MI":"Michigan","MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana",
    "NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico",
    "NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma",
    "OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina",
    "SD":"South Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont",
    "VA":"Virginia","WA":"Washington","WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming",
    "DC":"Washington D.C.",
}

_TAX_ADVISOR_SYSTEM = """You are an expert US tax strategist specialising in tax optimisation for married-filing-jointly (MFJ) households. You have deep knowledge of:
- 2025 federal income tax brackets, deductions, and credits for MFJ filers
- All 50 state income tax systems and their quirks (community property states, special deductions, credits)
- Tax-advantaged accounts: Traditional 401(k), Roth 401(k), IRA, Roth IRA, HSA, FSA, 529, SEP-IRA, Solo 401(k)
- Investment tax strategy: long-term capital gains rates, qualified dividends, tax-loss harvesting, asset location
- Above-the-line deductions: student loan interest, educator expenses, alimony (pre-2019), HSA contributions, self-employed health insurance, SE tax deduction, QBI (Section 199A)
- Itemised deductions: mortgage interest (SALT cap), charitable giving (bunching, DAF, QCD), medical expenses
- Credits: Child Tax Credit, Child and Dependent Care Credit, Earned Income Credit, Saver's Credit, American Opportunity Credit
- SECURE 2.0: RMD age 73, catch-up contribution changes, Roth 401k RMD elimination
- Backdoor Roth and Mega Backdoor Roth strategies
- Self-employment tax strategies: QBI deduction, S-Corp election considerations
- AMT, NIIT (3.8% net investment income tax on income above $250k MFJ)

Output format — always use exactly these section headers with markdown:
## 📊 Your 2025 Tax Snapshot
## 🎯 Priority Actions (Biggest Impact First)
## 💼 Retirement Account Optimisation
## 📉 Deduction Strategy
## 💰 Investment Tax Efficiency
## 🏠 {State} State Tax Tips
## ⚠️ Watch-Out Situations
## 📅 Year-End Checklist

Be specific with dollar amounts. Rank actions by estimated tax savings. Note when advice requires verification with a CPA."""


class TaxAdvisorRequest(BaseModel):
    state: str
    wages: float = 0
    self_emp_income: float = 0
    short_term_gains: float = 0
    long_term_gains: float = 0
    qualified_dividends: float = 0
    rental_income: float = 0
    other_income: float = 0
    trad_401k_contrib: float = 0
    roth_401k_contrib: float = 0
    ira_contrib: float = 0
    hsa_contrib: float = 0
    fsa_contrib: float = 0
    mortgage_interest: float = 0
    property_taxes: float = 0
    charitable: float = 0
    student_loan_interest: float = 0
    childcare_expenses: float = 0
    num_children: int = 0
    ages_over_50: int = 0          # 0, 1, or 2 spouses aged 50+
    has_employer_health: bool = True
    is_self_employed: bool = False
    has_hsa_eligible_plan: bool = False


@app.post("/api/tax/advisor")
def tax_advisor(req: TaxAdvisorRequest):
    state_abbr = req.state.upper()
    state_name = _STATE_NAMES.get(state_abbr, state_abbr)
    state_rate = _STATE_TAX.get(state_abbr, 0.0)

    gross_income = (req.wages + req.self_emp_income + req.short_term_gains +
                    req.long_term_gains + req.qualified_dividends +
                    req.rental_income + req.other_income)

    # 401k limits 2025
    limit_401k = 23500
    catchup_401k = 7500
    limit_ira = 7000
    catchup_ira = 1000
    limit_hsa_family = 8300

    # Rough AGI estimate
    se_deduction = req.self_emp_income * 0.5 * 0.1530 if req.is_self_employed else 0
    agi_est = gross_income - req.trad_401k_contrib - se_deduction - req.student_loan_interest

    # 2025 MFJ federal brackets
    brackets = [
        (23850, 0.10), (96950, 0.12), (206700, 0.22),
        (394600, 0.24), (501050, 0.32), (751600, 0.35), (float('inf'), 0.37)
    ]
    std_ded = 30000
    taxable = max(0, agi_est - std_ded)
    fed_tax = 0.0
    prev = 0.0
    for cap, rate in brackets:
        if taxable <= prev:
            break
        fed_tax += min(taxable, cap) * rate - prev * rate
        prev = cap

    # LTCG rate
    ltcg_rate = 0.0 if agi_est <= 94050 else (0.15 if agi_est <= 583750 else 0.20)
    niit = 0.038 * max(0, req.long_term_gains + req.qualified_dividends) if agi_est > 250000 else 0.0
    state_tax_est = agi_est * (state_rate / 100)

    prompt = f"""Analyse this married-filing-jointly household's 2025 tax situation and provide a comprehensive, actionable tax-saving plan.

## HOUSEHOLD PROFILE

**State:** {state_name} ({state_abbr}) — top marginal state rate: {state_rate}%{"  (no state income tax)" if state_rate == 0 else ""}

### Income
- W-2 / Salary wages: ${req.wages:,.0f}
- Self-employment income: ${req.self_emp_income:,.0f}{"  (self-employed)" if req.is_self_employed else ""}
- Short-term capital gains: ${req.short_term_gains:,.0f}
- Long-term capital gains: ${req.long_term_gains:,.0f}
- Qualified dividends: ${req.qualified_dividends:,.0f}
- Rental income: ${req.rental_income:,.0f}
- Other income: ${req.other_income:,.0f}
- **Gross Income Total: ${gross_income:,.0f}**

### Current Retirement Contributions
- Traditional 401(k): ${req.trad_401k_contrib:,.0f} (2025 limit: ${limit_401k:,} per person{f", + ${catchup_401k:,} catch-up if 50+" if req.ages_over_50 > 0 else ""})
- Roth 401(k): ${req.roth_401k_contrib:,.0f}
- IRA contributions: ${req.ira_contrib:,.0f} (2025 limit: ${limit_ira:,} per person{f", + ${catchup_ira:,} catch-up if 50+" if req.ages_over_50 > 0 else ""})
- HSA contributions: ${req.hsa_contrib:,.0f} (2025 family limit: ${limit_hsa_family:,})
- FSA contributions: ${req.fsa_contrib:,.0f}
- Spouses aged 50+: {req.ages_over_50}

### Deductions Paid
- Mortgage interest: ${req.mortgage_interest:,.0f}
- Property taxes: ${req.property_taxes:,.0f}
- Charitable contributions: ${req.charitable:,.0f}
- Student loan interest: ${req.student_loan_interest:,.0f}
- Child/dependent care expenses: ${req.childcare_expenses:,.0f}
- Number of qualifying children: {req.num_children}

### Other Factors
- Employer-sponsored health insurance: {"Yes" if req.has_employer_health else "No"}
- HSA-eligible high-deductible health plan: {"Yes" if req.has_hsa_eligible_plan else "No"}
- Self-employed: {"Yes" if req.is_self_employed else "No"}

## QUICK ESTIMATES (pre-optimisation)
- Estimated AGI: ${agi_est:,.0f}
- Estimated Federal Tax: ${fed_tax:,.0f} (before credits)
- Long-term capital gains rate: {ltcg_rate*100:.0f}%{" + 3.8% NIIT" if niit > 0 else ""}
- Estimated {state_name} State Tax: ${state_tax_est:,.0f}
- Combined Estimated Tax Burden: ${fed_tax + niit + state_tax_est:,.0f}
- Estimated Effective Rate: {(fed_tax + niit + state_tax_est) / gross_income * 100:.1f}% of gross income

Now provide a comprehensive, specific, dollar-quantified tax savings plan. Follow the required output format with all 8 section headers. Replace {{State}} in the header with "{state_name}". Focus on actions with the highest dollar impact. Be precise — use the actual 2025 limits and bracket numbers."""

    def generate():
        try:
            client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=4000,
                system=[{"type": "text", "text": _TAX_ADVISOR_SYSTEM,
                         "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            logger.error("Tax advisor error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Short Squeeze Scanner ─────────────────────────────────────────────────────

_SQUEEZE_TTL = timedelta(minutes=30)

_SQUEEZE_UNIVERSE = [
    # Meme / high retail interest
    "GME","AMC","BBBY","MVIS","CLOV","WKHS","GOEV","NKLA","SPCE","SDC",
    # EV / clean energy
    "RIVN","LCID","NKLA","GOEV","FFIE","PSNY","ARVL","SOLO","CIIC","EVGO",
    "PLUG","FCEL","BE","BLDP","RUN","NOVA","ENPH","ARRY","SPWR","STEM",
    # Biotech volatility
    "NVAX","SAVA","VKTX","ACAD","SAGE","SRPT","MDGL","RVNC","ARWR","KRYS",
    # High-growth tech
    "COIN","HOOD","SOFI","AFRM","UPST","LC","OPEN","RDFN","CPNG","DDOG",
    "SNAP","PINS","RDDT","LYFT","DASH","ABNB","RBLX","MTTR","AI","PATH",
    # Retail / consumer
    "CVNA","M","KSS","JWN","GPS","EXPR","ANF","BBWI","PRTY","CATO",
    # Crypto / blockchain
    "MARA","RIOT","HUT","CLSK","BTBT","CIFR","IREN","WULF","SMLR","MSTR",
    # Cannabis
    "SNDL","ACB","TLRY","CGC","CRON","HEXO","OGI","GRWG","IIPR","APHA",
    # China ADR
    "BABA","NIO","XPEV","LI","FUTU","TIGR","GRAB","SE","BILI","PDD",
    # Speculative / special situation
    "BYND","PTON","HTZ","PARA","WBD","DISH","AMC","VTRS","MP","UWMC",
    "DKNG","PENN","RDFN","WYNN","MGM","CZR","NCLH","CCL","RCL","UAL",
]
_SQUEEZE_UNIVERSE = list(dict.fromkeys(_SQUEEZE_UNIVERSE))  # dedupe, preserve order


def _fetch_squeeze_data(sym: str) -> dict | None:
    try:
        info = yf.Ticker(sym, session=_session).info
        short_pct = _safe_float(info.get("shortPercentOfFloat"))
        short_ratio = _safe_float(info.get("shortRatio"))       # days to cover
        shares_short = _safe_float(info.get("sharesShort"))
        shares_short_prior = _safe_float(info.get("sharesShortPriorMonth"))
        price = _safe_float(info.get("regularMarketPrice"))
        chg_pct = _safe_float(info.get("regularMarketChangePercent"))
        w52_chg = _safe_float(info.get("52WeekChange"))
        name = info.get("shortName") or info.get("longName") or sym
        mkt_cap = _safe_float(info.get("marketCap"))

        if not short_pct or short_pct < 0.05:   # skip < 5% short interest
            return None

        # Short interest change (MoM)
        si_change = None
        if shares_short and shares_short_prior and shares_short_prior > 0:
            si_change = (shares_short - shares_short_prior) / shares_short_prior * 100

        # Squeeze score (0–100)
        score_si   = min(short_pct / 0.40, 1.0) * 40   # 40 pts: short % of float (capped at 40%)
        score_dtc  = min((short_ratio or 0) / 10.0, 1.0) * 30  # 30 pts: days to cover (capped at 10)
        score_mom  = max(0, min((chg_pct or 0) / 20.0, 1.0)) * 20  # 20 pts: positive momentum
        score_acc  = max(0, min((si_change or 0) / 50.0, 1.0)) * 10  # 10 pts: SI increasing
        score = round(score_si + score_dtc + score_mom + score_acc, 1)

        if score < 10:
            return None

        if score >= 70:
            level = "EXTREME"
        elif score >= 50:
            level = "HIGH"
        elif score >= 30:
            level = "MEDIUM"
        else:
            level = "LOW"

        return {
            "symbol":          sym,
            "name":            name,
            "price":           price,
            "changePercent":   chg_pct,
            "shortPctFloat":   round(short_pct * 100, 1) if short_pct else None,
            "daysToCover":     round(short_ratio, 1) if short_ratio else None,
            "siChangePct":     round(si_change, 1) if si_change is not None else None,
            "w52Change":       round((w52_chg or 0) * 100, 1),
            "marketCap":       mkt_cap,
            "squeezeScore":    score,
            "squeezeLevel":    level,
        }
    except Exception as exc:
        logger.debug("Squeeze fetch %s: %s", sym, exc)
        return None


@app.get("/api/market/short-squeeze")
async def short_squeeze(extra: str = ""):
    cache_key = "market:short-squeeze"
    cached = cache_get(cache_key, _SQUEEZE_TTL)
    if cached is not None:
        return cached

    universe = list(_SQUEEZE_UNIVERSE)
    if extra:
        universe = list(dict.fromkeys([s.strip().upper() for s in extra.split(",") if s.strip()] + universe))

    results = []
    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = {pool.submit(_fetch_squeeze_data, sym): sym for sym in universe}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                results.append(r)

    results.sort(key=lambda x: x["squeezeScore"], reverse=True)
    results = results[:50]
    cache_set(cache_key, results)
    return results


# ── IPO & Lockup Calendar ─────────────────────────────────────────────────────

_IPO_TTL = timedelta(hours=1)

# (symbol, company, ipo_date, ipo_price, lockup_days, sector)
_IPO_LIST = [
    ("RDDT",  "Reddit",            "2024-03-21", 34.00,  180, "Technology"),
    ("ALAB",  "Astera Labs",        "2024-03-20", 36.00,  180, "Semiconductors"),
    ("RBRK",  "Rubrik",             "2024-04-25", 32.00,  180, "Cybersecurity"),
    ("VIK",   "Viking Holdings",    "2024-05-01", 24.00,  180, "Leisure"),
    ("WAY",   "Waystar",            "2024-06-06", 21.50,  180, "Healthcare IT"),
    ("TEM",   "Tempus AI",          "2024-06-14", 37.00,  180, "AI / Healthcare"),
    ("OS",    "OneStream",          "2024-07-25", 20.00,  180, "Enterprise SaaS"),
    ("LINE",  "Lineage",            "2024-07-25", 78.00,  180, "REITs"),
    ("TTAN",  "ServiceTitan",       "2024-12-12", 71.00,  180, "Field Service SaaS"),
    ("SEZL",  "Sezzle",             "2024-01-10", 8.00,   180, "Fintech"),
    ("MDGL",  "Madrigal Pharma",    "2023-06-01", 100.00, 180, "Biotech"),
    ("KVYO",  "Klaviyo",            "2023-09-20", 30.00,  180, "MarTech SaaS"),
    ("ARM",   "Arm Holdings",       "2023-09-14", 51.00,  180, "Semiconductors"),
    ("BIRK",  "Birkenstock",        "2023-10-11", 46.00,  180, "Consumer"),
    ("CART",  "Instacart (Maplebear)","2023-09-19",30.00, 180, "E-commerce"),
    ("KKWB",  "Kenvue",             "2023-05-04", 22.00,  180, "Consumer Health"),
    # 2025 IPOs
    ("KLAR",  "Klarna",             "2025-07-01", 68.00,  180, "Fintech"),
    ("MNDY",  "Monday.com (2025)",  "2021-06-11", 155.00, 180, "SaaS"),
    ("SOUN",  "SoundHound AI",      "2024-02-12", 5.00,   365, "AI / Audio"),
    ("SMCI",  "Super Micro Comp.",  "2007-03-29", 14.00,  180, "Servers"),
    ("GRAB",  "Grab Holdings",      "2021-12-02", 8.75,   180, "Super App"),
    ("IONQ",  "IonQ",               "2021-10-01", 10.00,  180, "Quantum"),
    ("ACHR",  "Archer Aviation",    "2021-09-17", 9.00,   180, "eVTOL"),
    ("JOBY",  "Joby Aviation",      "2021-08-10", 10.00,  180, "eVTOL"),
    ("RKLB",  "Rocket Lab",         "2021-08-25", 10.00,  180, "Space"),
    ("ASTS",  "AST SpaceMobile",    "2021-04-07", 10.00,  180, "Space Telecom"),
]


@app.get("/api/market/ipo-calendar")
async def ipo_calendar():
    cache_key = "market:ipo-calendar"
    cached = cache_get(cache_key, _IPO_TTL)
    if cached is not None:
        return cached

    today = datetime.utcnow().date()
    syms = [row[0] for row in _IPO_LIST]

    def fetch_price(sym: str) -> tuple[str, float | None]:
        try:
            info = yf.Ticker(sym, session=_session).info
            return sym, _safe_float(info.get("regularMarketPrice"))
        except Exception:
            return sym, None

    prices: dict[str, float | None] = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        for sym, price in pool.map(fetch_price, syms):
            prices[sym] = price

    results = []
    for sym, company, ipo_date_str, ipo_price, lockup_days, sector in _IPO_LIST:
        ipo_date = datetime.strptime(ipo_date_str, "%Y-%m-%d").date()
        lockup_date = ipo_date + timedelta(days=lockup_days)
        days_since_ipo = (today - ipo_date).days
        days_to_lockup = (lockup_date - today).days
        current_price = prices.get(sym)
        perf_pct = None
        if current_price and ipo_price:
            perf_pct = round((current_price - ipo_price) / ipo_price * 100, 1)

        results.append({
            "symbol":          sym,
            "company":         company,
            "sector":          sector,
            "ipoDate":         ipo_date_str,
            "ipoPrice":        ipo_price,
            "currentPrice":    current_price,
            "perfPct":         perf_pct,
            "lockupDate":      lockup_date.isoformat(),
            "daysSinceIpo":    days_since_ipo,
            "daysToLockup":    days_to_lockup,
            "lockupExpired":   days_to_lockup < 0,
        })

    results.sort(key=lambda x: x["daysToLockup"] if x["daysToLockup"] >= 0 else 999999)
    cache_set(cache_key, results)
    return results


# ── Fed Watch ─────────────────────────────────────────────────────────────────

_FEDWATCH_TTL = timedelta(minutes=30)

# FOMC meeting dates — 2025 + 2026 schedule (decision day)
_FOMC_MEETINGS = [
    {"date": "2025-01-29", "nickname": "Jan '25"},
    {"date": "2025-03-19", "nickname": "Mar '25"},
    {"date": "2025-05-07", "nickname": "May '25"},
    {"date": "2025-06-18", "nickname": "Jun '25"},
    {"date": "2025-07-30", "nickname": "Jul '25"},
    {"date": "2025-09-17", "nickname": "Sep '25"},
    {"date": "2025-10-29", "nickname": "Oct '25"},
    {"date": "2025-12-10", "nickname": "Dec '25"},
    {"date": "2026-01-28", "nickname": "Jan '26"},
    {"date": "2026-03-18", "nickname": "Mar '26"},
    {"date": "2026-04-29", "nickname": "Apr '26"},
    {"date": "2026-06-17", "nickname": "Jun '26"},
    {"date": "2026-07-29", "nickname": "Jul '26"},
    {"date": "2026-09-16", "nickname": "Sep '26"},
    {"date": "2026-10-28", "nickname": "Oct '26"},
    {"date": "2026-12-09", "nickname": "Dec '26"},
]

# 30-day Fed Funds futures (ZQ) — month code map
_ZQ_MONTHS = {
    1:"F",2:"G",3:"H",4:"J",5:"K",6:"M",7:"N",8:"Q",9:"U",10:"V",11:"X",12:"Z"
}

# Current Fed Funds target — derived from live ^IRX (13-week T-bill) at startup
def _fetch_current_fed_rate() -> tuple[float, float, float]:
    """Return (low, high, mid) for the current Fed Funds target range.
    Derived from the 13-week T-bill (^IRX), which tracks the fed funds rate closely.
    FOMC targets are always in 25bps increments (e.g. 3.75-4.00%)."""
    try:
        hist = yf.Ticker("^IRX", session=_session).history(period="5d")
        if not hist.empty:
            irx = float(hist["Close"].iloc[-1])
            # T-bills trade ~12-20bps below fed funds; add 15bps adjustment
            adjusted = irx + 0.15
            # Round down to nearest 25bps for the lower bound of the target range
            low = round(int(adjusted / 0.25) * 0.25, 2)
            high = round(low + 0.25, 2)
            mid = round((low + high) / 2, 4)
            return low, high, mid
    except Exception:
        pass
    return 3.75, 4.00, 3.875   # fallback

_FED_TARGET_LOW, _FED_TARGET_HIGH, _FED_TARGET_MID = _fetch_current_fed_rate()


def _zq_ticker(year: int, month: int) -> str:
    return f"ZQ{_ZQ_MONTHS[month]}{str(year)[-2:]}.CBT"


def _fetch_zq_rate(year: int, month: int) -> float | None:
    ticker = _zq_ticker(year, month)
    try:
        data = yf.Ticker(ticker, session=_session).history(period="5d")
        if data.empty:
            return None
        price = float(data["Close"].iloc[-1])
        return round(100.0 - price, 4)   # implied rate %
    except Exception:
        return None


@app.get("/api/market/fed-watch")
async def fed_watch():
    cache_key = "market:fed-watch"
    cached = cache_get(cache_key, _FEDWATCH_TTL)
    if cached is not None:
        return cached

    today = datetime.utcnow().date()

    # Fetch 30-day futures for next 8 months
    futures_data: dict[str, float | None] = {}
    month_keys = []
    for i in range(9):
        dt = today.replace(day=1)
        month = (dt.month - 1 + i) % 12 + 1
        year = dt.year + (dt.month - 1 + i) // 12
        key = f"{year}-{month:02d}"
        month_keys.append((year, month, key))

    with ThreadPoolExecutor(max_workers=9) as pool:
        futures_map = {pool.submit(_fetch_zq_rate, y, m): k for y, m, k in month_keys}
        for fut, key in futures_map.items():
            futures_data[key] = fut.result()

    # Build meeting-level probabilities
    meetings = []
    for mtg in _FOMC_MEETINGS:
        mtg_date = datetime.strptime(mtg["date"], "%Y-%m-%d").date()
        days_to = (mtg_date - today).days
        status = "past" if days_to < 0 else ("upcoming" if days_to <= 90 else "future")

        # Find the futures month that best captures this meeting
        key = f"{mtg_date.year}-{mtg_date.month:02d}"
        implied_rate = futures_data.get(key)

        cut_prob = hold_prob = hike_prob = None
        if implied_rate is not None:
            diff = _FED_TARGET_MID - implied_rate    # positive = market pricing cuts
            cut_prob  = max(0, min(100, round(diff / 0.25 * 100)))
            hike_prob = max(0, min(100, round(-diff / 0.25 * 100)))
            hold_prob = max(0, 100 - cut_prob - hike_prob)

        meetings.append({
            **mtg,
            "daysTo":      days_to,
            "status":      status,
            "impliedRate": implied_rate,
            "cutProb":     cut_prob,
            "holdProb":    hold_prob,
            "hikeProb":    hike_prob,
        })

    # Rate history — fetch EFFR proxy (^IRX = 13-week T-bill annualised / 100 * some scaling)
    rate_history = []
    try:
        hist = yf.Ticker("^IRX", session=_session).history(period="1y")
        if not hist.empty:
            hist = hist.resample("W").last().dropna()
            rate_history = [
                {"date": str(d.date()), "rate": round(float(v), 3)}
                for d, v in zip(hist.index, hist["Close"])
            ]
    except Exception:
        pass

    result = {
        "currentTarget":    f"{_FED_TARGET_LOW}%–{_FED_TARGET_HIGH}%",
        "currentMidpoint":  _FED_TARGET_MID,
        "meetings":         meetings,
        "rateHistory":      rate_history,
        "futuresData":      futures_data,
        "asOf":             today.isoformat(),
    }
    cache_set(cache_key, result)
    return result


# ── AI Morning Briefing ───────────────────────────────────────────────────────

_MORNING_BRIEFING_SYSTEM = """You are a seasoned institutional equity analyst delivering a personalized morning market briefing. Be precise, data-driven, and actionable.

Produce the briefing in exactly this format (use the ## headers as written):

## Market Pulse
One sharp paragraph (3-4 sentences) summarizing today's market environment: risk-on or risk-off tone, the macro regime, and the single most important theme investors should carry into the session.

## Index & Sector Breakdown
Interpret the index and sector data as a narrative — not a list. What is the rotation signaling? What is outperforming and what does that tell us about investor positioning?

## Watchlist Spotlight
For each watchlist stock provided: a focused paragraph on momentum, key technical levels, and any news catalysts. Be specific — mention price levels and what a break above/below them would signal. If no watchlist is provided, highlight 2-3 individual names from the broader market data worth watching.

## Key News & Market Implications
The 4-5 most market-relevant headlines from the data, each with 1-2 sentences on the trading implication.

## Risk Radar
2-3 specific risks or wildcards that could catch the market off-guard today. Name the trigger and the scenario.

## Today's Action Checklist
5 bullet points — concrete things to watch or do today. Mention specific tickers, levels, or catalyst events where possible.

Write with conviction. Be direct and specific. Use the actual numbers from the data. No filler phrases."""


_MB_INDEX_NAMES = {
    "^GSPC": "S&P 500",
    "^IXIC": "Nasdaq Composite",
    "^DJI":  "Dow Jones",
    "^RUT":  "Russell 2000",
    "^VIX":  "CBOE VIX",
    "^TNX":  "10-Yr Treasury Yield",
}

_MB_SECTOR_MAP = {
    "XLK": "Technology",
    "XLF": "Financials",
    "XLE": "Energy",
    "XLV": "Health Care",
    "XLC": "Comm Services",
    "XLI": "Industrials",
    "XLRE": "Real Estate",
    "XLY": "Consumer Disc",
    "XLP": "Consumer Staples",
    "XLU": "Utilities",
    "XLB": "Materials",
}


class MorningBriefingRequest(BaseModel):
    symbols: list[str] = []


@app.post("/api/ai/morning-briefing")
def ai_morning_briefing(req: MorningBriefingRequest):
    from datetime import datetime as _dt
    today_str = _dt.now().strftime("%A, %B %d, %Y")

    watchlist   = [s.strip().upper() for s in req.symbols if s.strip()][:15]
    index_syms  = list(_MB_INDEX_NAMES.keys())
    sector_syms = list(_MB_SECTOR_MAP.keys())

    def _fetch_ohlc(sym):
        try:
            hist = yf.Ticker(sym).history(period="2d")
            if len(hist) >= 2:
                prev = float(hist["Close"].iloc[-2])
                curr = float(hist["Close"].iloc[-1])
                return sym, {"price": curr, "prev": prev, "chg_pct": (curr - prev) / prev * 100}
            elif len(hist) == 1:
                curr = float(hist["Close"].iloc[-1])
                return sym, {"price": curr, "prev": None, "chg_pct": None}
        except Exception:
            pass
        return sym, None

    def _fetch_news_items(sym):
        try:
            articles = yf.Ticker(sym).news or []
            return sym, [
                {"title": a.get("title", ""), "pub": a.get("publisher", "")}
                for a in articles[:4] if a.get("title")
            ]
        except Exception:
            return sym, []

    all_price_syms = index_syms + sector_syms + watchlist
    news_syms      = ["^GSPC", "^IXIC"] + watchlist[:6]

    with ThreadPoolExecutor(max_workers=30) as ex:
        price_map = dict(ex.map(_fetch_ohlc, all_price_syms))
        news_map  = dict(ex.map(_fetch_news_items, news_syms))

    def fmt_chg(chg):
        if chg is None:
            return "N/A"
        return f"{'▲' if chg >= 0 else '▼'}{abs(chg):.2f}%"

    def fmt_line(sym, name):
        d = price_map.get(sym)
        if not d:
            return f"- {name}: data unavailable"
        price_str = f"{d['price']:.2f}" if sym in ("^VIX", "^TNX") else f"${d['price']:,.2f}"
        return f"- {name}: {price_str} ({fmt_chg(d.get('chg_pct'))})"

    indices_text = "\n".join(fmt_line(s, n) for s, n in _MB_INDEX_NAMES.items())

    sectors_sorted = sorted(
        _MB_SECTOR_MAP.items(),
        key=lambda x: (price_map.get(x[0]) or {}).get("chg_pct") or 0,
        reverse=True,
    )
    sectors_text = "\n".join(
        f"- {name} ({sym}): {fmt_chg((price_map.get(sym) or {}).get('chg_pct'))}"
        for sym, name in sectors_sorted
    )

    watchlist_section = (
        "## Watchlist\n" + "\n".join(fmt_line(s, s) for s in watchlist)
        if watchlist else "## Watchlist\nNone provided — include 2-3 notable individual movers instead."
    )

    all_news: list[str] = []
    seen: set[str] = set()
    for sym in news_syms:
        for item in news_map.get(sym, []):
            t = item["title"]
            if t and t not in seen:
                seen.add(t)
                all_news.append(f"- [{item['pub']}] {t}")
    news_text = "\n".join(all_news[:12]) or "No recent headlines available."

    prompt = f"""Today is {today_str}.

## Market Indices
{indices_text}

## Sector Performance (best → worst today)
{sectors_text}

{watchlist_section}

## Recent Headlines
{news_text}

Generate the morning briefing now."""

    def generate():
        try:
            client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=3000,
                system=[{"type": "text", "text": _MORNING_BRIEFING_SYSTEM,
                         "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            logger.error("Morning briefing error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Crypto Dashboard ─────────────────────────────────────────────────────────

_CRYPTO_TTL = timedelta(minutes=5)

_CRYPTO_SYMBOLS = [
    "BTC-USD","ETH-USD","BNB-USD","SOL-USD","XRP-USD",
    "ADA-USD","AVAX-USD","DOGE-USD","DOT-USD","LINK-USD",
    "LTC-USD","BCH-USD","ATOM-USD","FIL-USD","ALGO-USD",
    "XLM-USD","NEAR-USD","TRX-USD","TON11419-USD","SUI20947-USD",
]

_CRYPTO_NAMES = {
    "BTC-USD":"Bitcoin","ETH-USD":"Ethereum","BNB-USD":"BNB",
    "SOL-USD":"Solana","XRP-USD":"XRP","ADA-USD":"Cardano",
    "AVAX-USD":"Avalanche","DOGE-USD":"Dogecoin","DOT-USD":"Polkadot",
    "LINK-USD":"Chainlink","LTC-USD":"Litecoin","BCH-USD":"Bitcoin Cash",
    "ATOM-USD":"Cosmos","FIL-USD":"Filecoin","ALGO-USD":"Algorand",
    "XLM-USD":"Stellar","NEAR-USD":"NEAR Protocol","TRX-USD":"TRON",
    "TON11419-USD":"Toncoin","SUI20947-USD":"Sui",
}


def _fetch_crypto(sym: str) -> dict | None:
    try:
        t = yf.Ticker(sym, session=_session)
        fi = t.fast_info
        price = _safe_float(fi.last_price)
        prev  = _safe_float(fi.previous_close)
        if price is None:
            return None
        chg_pct = (price - prev) / prev * 100 if prev else None
        mkt_cap = _safe_float(fi.market_cap)
        volume  = _safe_float(fi.last_volume)
        # fast_info.market_cap is often None for crypto; fall back to info dict
        if mkt_cap is None:
            try:
                mkt_cap = _safe_float(t.info.get("marketCap"))
            except Exception:
                pass

        # 7-day performance
        try:
            hist = t.history(period="8d")
            week_ago = float(hist["Close"].iloc[0]) if len(hist) >= 7 else None
            chg_7d = (price - week_ago) / week_ago * 100 if week_ago else None
        except Exception:
            chg_7d = None

        return {
            "symbol":   sym,
            "name":     _CRYPTO_NAMES.get(sym, sym.replace("-USD", "")),
            "price":    price,
            "change24h": round(chg_pct, 2) if chg_pct is not None else None,
            "change7d":  round(chg_7d,  2) if chg_7d  is not None else None,
            "marketCap": mkt_cap,
            "volume24h": volume,
        }
    except Exception as exc:
        logger.debug("Crypto fetch %s: %s", sym, exc)
        return None


def _fetch_fear_greed() -> dict | None:
    try:
        import urllib.request
        url = "https://api.alternative.me/fng/?limit=1&format=json"
        with urllib.request.urlopen(url, timeout=5) as r:
            data = json.loads(r.read())
        entry = data["data"][0]
        return {"value": int(entry["value"]), "label": entry["value_classification"]}
    except Exception:
        return None


@app.get("/api/market/crypto")
def get_crypto_dashboard():
    cache_key = "market:crypto"
    cached = cache_get(cache_key, _CRYPTO_TTL)
    if cached is not None:
        return cached

    coins: list[dict] = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(_fetch_crypto, sym): sym for sym in _CRYPTO_SYMBOLS}
        fg_future = pool.submit(_fetch_fear_greed)
        for fut in as_completed(futures):
            c = fut.result()
            if c:
                coins.append(c)
        fear_greed = fg_future.result()

    sym_order = {s: i for i, s in enumerate(_CRYPTO_SYMBOLS)}
    coins.sort(key=lambda c: (-(c.get("marketCap") or 0), sym_order.get(c["symbol"], 99)))

    total_cap = sum(c["marketCap"] or 0 for c in coins)
    btc_cap   = next((c["marketCap"] or 0 for c in coins if c["symbol"] == "BTC-USD"), 0)
    eth_cap   = next((c["marketCap"] or 0 for c in coins if c["symbol"] == "ETH-USD"), 0)
    btc_dom   = round(btc_cap / total_cap * 100, 1) if total_cap else None
    eth_dom   = round(eth_cap / total_cap * 100, 1) if total_cap else None

    result = {
        "coins":        coins,
        "totalMarketCap": total_cap,
        "btcDominance":   btc_dom,
        "ethDominance":   eth_dom,
        "fearGreed":      fear_greed,
        "asOf":           datetime.now().strftime("%H:%M"),
    }
    cache_set(cache_key, result)
    return result


# ── AI Portfolio Review ───────────────────────────────────────────────────────

_PORTFOLIO_REVIEW_SYSTEM = """You are a senior portfolio strategist at a top wealth management firm. Your job is to analyse a client's stock portfolio and deliver a clear, specific, actionable review.

Produce your review using exactly these section headers:

## Portfolio Overview
2-3 sentences: total value, number of positions, overall character of the portfolio (growth/value/balanced/concentrated/diversified). Mention the single largest position and its weight.

## Concentration & Risk Assessment
Identify concentration risks: any single stock >20% of portfolio, sector overweight vs S&P 500 benchmark, correlation risks (e.g. multiple semiconductor stocks), and market-cap skew. Be specific — name the stocks and percentages.

## Sector & Style Analysis
Break down sector exposure and compare to S&P 500 sector weights. Call out what's overweight and underweight. Comment on growth vs value tilt, large vs small cap mix, and domestic vs international exposure.

## Performance & Valuation Snapshot
Using the P/E, beta, and YTD data provided: flag any overvalued or undervalued positions, high-beta names that increase portfolio volatility, and any positions significantly underperforming. Name specific tickers.

## Rebalancing Recommendations
3-5 specific, actionable recommendations with rationale. Example: "Trim NVDA from 32% to 15% — it's driving excessive single-stock risk. Redeploy into [specific suggestion]." Be direct and name dollar amounts or percentages.

## Action Checklist
5 bullet points the investor should do this week or month. Be concrete — mention specific tickers, price levels, or events where relevant.

Write with conviction. Use the actual numbers from the data. Avoid generic advice that could apply to any portfolio."""


@app.post("/api/ai/portfolio-review")
def ai_portfolio_review():
    # Read portfolio from DB
    with db_session() as db:
        rows = db.query(PortfolioPosition).order_by(PortfolioPosition.added_at).all()
        positions = [{"symbol": r.symbol, "shares": r.shares, "avgCost": r.avg_cost} for r in rows]

    if not positions:
        def empty_gen():
            yield f"data: {json.dumps({'error': 'No portfolio positions found. Add positions in Portfolio → Portfolio first.'})}\n\n"
        return StreamingResponse(empty_gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # Fetch live quotes for all positions
    symbols = [p["symbol"] for p in positions]
    quote_map: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=min(len(symbols), 10)) as pool:
        futures = {pool.submit(_fetch_quote, sym): sym for sym in symbols}
        for fut in as_completed(futures):
            q = fut.result()
            quote_map[q["symbol"]] = q

    # Build enriched positions
    enriched = []
    total_value = 0.0
    for p in positions:
        q = quote_map.get(p["symbol"], {})
        price    = q.get("price") or p["avgCost"]
        value    = price * p["shares"]
        cost     = p["avgCost"] * p["shares"]
        unrealised_pct = (value - cost) / cost * 100 if cost else 0
        total_value += value
        enriched.append({
            **p,
            "currentPrice": price,
            "value":        value,
            "unrealisedPct": round(unrealised_pct, 1),
            "peRatio":   q.get("peRatio"),
            "beta":      q.get("beta"),
            "sector":    q.get("sector") or "Unknown",
            "changePercent": q.get("changePercent"),
        })

    # Sort by value desc, compute weights
    enriched.sort(key=lambda x: x["value"], reverse=True)
    for p in enriched:
        p["weight"] = round(p["value"] / total_value * 100, 1) if total_value else 0

    # Sector breakdown
    from collections import defaultdict
    sector_map: dict[str, float] = defaultdict(float)
    for p in enriched:
        sector_map[p["sector"]] += p["weight"]

    # Build prompt
    pos_lines = "\n".join(
        f"- {p['symbol']:6s} {p['shares']:8.1f} shares  "
        f"avg cost ${p['avgCost']:.2f}  "
        f"current ${p['currentPrice']:.2f}  "
        f"value ${p['value']:,.0f}  "
        f"weight {p['weight']:.1f}%  "
        f"P&L {p['unrealisedPct']:+.1f}%  "
        f"P/E {p['peRatio'] or 'N/A'}  "
        f"Beta {p['beta'] or 'N/A'}  "
        f"Sector: {p['sector']}"
        for p in enriched
    )

    sector_lines = "\n".join(
        f"- {sector}: {weight:.1f}%"
        for sector, weight in sorted(sector_map.items(), key=lambda x: -x[1])
    )

    prompt = f"""## Portfolio Summary
Total Value: ${total_value:,.0f}
Positions: {len(enriched)}

## Holdings (sorted by weight)
{pos_lines}

## Sector Breakdown
{sector_lines}

Please provide a comprehensive portfolio review following the required format."""

    def generate():
        try:
            client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=3000,
                system=[{"type": "text", "text": _PORTFOLIO_REVIEW_SYSTEM,
                         "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield f"data: {json.dumps({'done': True, 'totalValue': total_value, 'positions': len(enriched)})}\n\n"
        except Exception as exc:
            logger.error("Portfolio review error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Insider Trading Feed ──────────────────────────────────────────────────────

_INSIDER_TTL = timedelta(hours=4)

_INSIDER_UNIVERSE = [
    # Mega-cap tech
    "AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","AVGO","ORCL","AMD",
    "INTC","QCOM","TXN","MU","AMAT","LRCX","KLAC","CRM","NOW","SNOW",
    "DDOG","CRWD","NET","MDB","PLTR","SMCI","MSTR","COIN","HOOD","SOFI",
    "AFRM","UPST","PYPL","SHOP","SQ","UBER","LYFT","ABNB","DASH","SNAP",
    "PINS","RDDT","RBLX","ZM","PATH","AI","SOUN","IONQ","RKLB","ASTS",
    # Financials
    "JPM","BAC","GS","MS","WFC","C","BLK","V","MA","AXP","SCHW",
    "COF","USB","PNC","TFC","SPGI","MCO","ICE","CME","CB","MET",
    # Healthcare
    "UNH","LLY","JNJ","ABBV","MRK","PFE","TMO","ABT","DHR","AMGN",
    "GILD","REGN","BIIB","VRTX","MRNA","BMY","ISRG","BSX","MDT","SYK",
    # Consumer
    "COST","WMT","TGT","HD","LOW","MCD","SBUX","NKE","AMZN","CMG",
    "YUM","DPZ","DKNG","PENN","WYNN","MGM","CZR","F","GM","RIVN","LCID",
    # Industrials & Energy
    "CAT","DE","HON","UPS","FDX","RTX","GE","BA","LMT","NOC","GD",
    "XOM","CVX","COP","EOG","SLB","OXY","MPC","VLO","PSX","HAL",
    "UNP","CSX","NSC","CP","CNI",
    # Biotech / small-cap (most insider activity)
    "NVAX","SAVA","ACAD","SRPT","MDGL","VKTX","ARWR","KRYS","SAGE","RVNC",
    "NKTR","RXRX","NTLA","BEAM","EDIT","CRSP","FATE","KYMR","IMVT","TMDX",
    # Other notable
    "DIS","NFLX","CMCSA","T","VZ","TMUS","CHTR","PARA","WBD",
    "AMT","PLD","CCI","EQIX","SPG","O","VICI",
    "BRK-B","V","MA","BRKR","ROP","IDXX","PODD","INSP",
]
_INSIDER_UNIVERSE = list(dict.fromkeys(_INSIDER_UNIVERSE))

_CSUITE_TITLES = {
    "ceo","chief executive","president","cfo","chief financial",
    "coo","chief operating","cto","chief technology","chairman",
    "vice chairman","exec","executive vice",
}

def _is_csuite(title: str) -> bool:
    t = (title or "").lower()
    return any(k in t for k in _CSUITE_TITLES)

def _parse_insider_tx(sym: str) -> list[dict]:
    try:
        ticker = yf.Ticker(sym, session=_session)
        df = ticker.insider_transactions
        if df is None or df.empty:
            return []

        df.columns = [c.strip() for c in df.columns]

        # yfinance uses "Start Date" for the transaction date
        date_col = next(
            (c for c in df.columns if "start date" in c.lower() or c.lower() == "date"),
            None
        )
        if date_col is None:
            return []

        # Get company name
        try:
            name = ticker.fast_info.company_name or sym
        except Exception:
            name = sym

        rows = []
        for _, row in df.iterrows():
            text     = str(row.get("Text", "")).strip()
            insider  = str(row.get("Insider", "")).strip()
            position = str(row.get("Position", "")).strip()
            shares   = _safe_float(row.get("Shares")) or 0
            value    = _safe_float(row.get("Value"))
            date_raw = row.get(date_col, "")

            if not insider or insider.lower() in ("nan", "none", ""):
                continue

            text_lower = text.lower()

            # Classify by the Text description (most reliable)
            is_buy  = "purchase" in text_lower or "acquired" in text_lower
            is_sale = "sale" in text_lower or "sold" in text_lower

            # Exclude non-discretionary events
            if any(x in text_lower for x in ["gift", "grant", "award", "option", "automatic", "disposition", "return", "transfer"]):
                continue
            if not is_buy and not is_sale:
                continue

            # Normalise date
            try:
                date_str = pd.to_datetime(date_raw).strftime("%Y-%m-%d")
            except Exception:
                date_str = str(date_raw)[:10] if date_raw else ""

            if not date_str:
                continue

            # Extract per-share price from Text when Value is missing
            price = None
            if value and shares and shares > 0:
                price = value / shares
            else:
                import re
                m = re.search(r"price\s+([\d,.]+)", text_lower)
                if m:
                    try:
                        price = float(m.group(1).replace(",", ""))
                        if not value and shares:
                            value = price * shares
                    except Exception:
                        pass

            rows.append({
                "symbol":   sym,
                "company":  name,
                "insider":  insider,
                "title":    position,
                "type":     "Buy" if is_buy else "Sale",
                "isBuy":    is_buy,
                "isCsuite": _is_csuite(position),
                "shares":   int(shares),
                "value":    int(value) if value else None,
                "price":    round(price, 2) if price else None,
                "date":     date_str,
            })
        return rows
    except Exception as exc:
        logger.debug("Insider fetch %s: %s", sym, exc)
        return []


@app.get("/api/market/insider-feed")
def get_insider_feed(days: int = 30):
    cache_key = f"market:insider-feed:{days}"
    cached = cache_get(cache_key, _INSIDER_TTL)
    if cached is not None:
        return cached

    all_tx: list[dict] = []
    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = {pool.submit(_parse_insider_tx, sym): sym for sym in _INSIDER_UNIVERSE}
        for fut in as_completed(futures):
            all_tx.extend(fut.result())

    # Filter to requested window
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    all_tx = [t for t in all_tx if t["date"] >= cutoff]

    # Cluster detection: count unique insiders buying per symbol in window
    from collections import Counter
    buy_counts  = Counter(t["symbol"] for t in all_tx if t["isBuy"])
    sale_counts = Counter(t["symbol"] for t in all_tx if not t["isBuy"])

    for t in all_tx:
        t["clusterCount"] = buy_counts[t["symbol"]] if t["isBuy"] else sale_counts[t["symbol"]]

    # Sort: most recent first, then by value
    all_tx.sort(key=lambda t: (t["date"], t["value"] or 0), reverse=True)

    buys  = [t for t in all_tx if t["isBuy"]]
    sales = [t for t in all_tx if not t["isBuy"]]
    total_buy_value = sum(t["value"] or 0 for t in buys)
    cluster_syms = {sym for sym, cnt in buy_counts.items() if cnt >= 2}
    largest = max(buys, key=lambda t: t["value"] or 0) if buys else None

    result = {
        "transactions": all_tx[:300],
        "summary": {
            "totalBuys":      len(buys),
            "totalSales":     len(sales),
            "totalBuyValue":  total_buy_value,
            "clusterSymbols": len(cluster_syms),
            "largestBuy":     largest,
        },
        "days":  days,
        "asOf":  datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    cache_set(cache_key, result)
    return result


# ── Economic Dashboard ────────────────────────────────────────────────────────

_ECON_TTL = timedelta(minutes=30)

_MACRO_TICKERS: list[dict] = [
    {"sym": "^IRX",     "name": "3M T-Bill",     "unit": "%",       "group": "yields"},
    {"sym": "^FVX",     "name": "5Y Yield",       "unit": "%",       "group": "yields"},
    {"sym": "^TNX",     "name": "10Y Yield",      "unit": "%",       "group": "yields"},
    {"sym": "^TYX",     "name": "30Y Yield",      "unit": "%",       "group": "yields"},
    {"sym": "DX-Y.NYB", "name": "Dollar Index",   "unit": "",        "group": "macro"},
    {"sym": "^VIX",     "name": "VIX",            "unit": "",        "group": "macro"},
    {"sym": "GC=F",     "name": "Gold",           "unit": "$/oz",    "group": "commodities"},
    {"sym": "CL=F",     "name": "WTI Oil",        "unit": "$/bbl",   "group": "commodities"},
    {"sym": "HG=F",     "name": "Copper",         "unit": "$/lb",    "group": "commodities"},
    {"sym": "NG=F",     "name": "Nat Gas",        "unit": "$/MMBtu", "group": "commodities"},
]

_FRED_SERIES: dict[str, dict] = {
    "FEDFUNDS": {"name": "Fed Funds Rate",       "unit": "%",   "freq": "M", "mode": "level",   "hib": None},
    "CPIAUCSL": {"name": "CPI Inflation",        "unit": "%",   "freq": "M", "mode": "yoy",     "hib": False},
    "CPILFESL": {"name": "Core CPI",             "unit": "%",   "freq": "M", "mode": "yoy",     "hib": False},
    "PCEPILFE": {"name": "Core PCE",             "unit": "%",   "freq": "M", "mode": "yoy",     "hib": False},
    "UNRATE":   {"name": "Unemployment Rate",    "unit": "%",   "freq": "M", "mode": "level",   "hib": False},
    "PAYEMS":   {"name": "Nonfarm Payrolls",     "unit": "K",   "freq": "M", "mode": "mom_abs", "hib": True},
    "ICSA":     {"name": "Initial Claims",       "unit": "K",   "freq": "W", "mode": "level",   "hib": False},
    "GDPC1":    {"name": "Real GDP Growth",      "unit": "%",   "freq": "Q", "mode": "yoy",     "hib": True},
    "UMCSENT":  {"name": "Consumer Sentiment",   "unit": "",    "freq": "M", "mode": "level",   "hib": True},
    "HOUST":    {"name": "Housing Starts",       "unit": "K",   "freq": "M", "mode": "level",   "hib": True},
    "RSXFS":    {"name": "Retail Sales",         "unit": "%",   "freq": "M", "mode": "yoy",     "hib": True},
    "INDPRO":   {"name": "Indust. Production",   "unit": "%",   "freq": "M", "mode": "yoy",     "hib": True},
}


def _fetch_macro_ticker(item: dict) -> dict | None:
    try:
        sym = item["sym"]
        t = yf.Ticker(sym, session=_session)
        fi = t.fast_info
        price = _safe_float(fi.last_price)
        prev  = _safe_float(fi.previous_close)
        if price is None:
            return None
        chg_pct = (price - prev) / prev * 100 if prev else None
        return {
            "sym":       sym,
            "name":      item["name"],
            "unit":      item["unit"],
            "group":     item["group"],
            "price":     round(price, 4),
            "changePct": round(chg_pct, 2) if chg_pct is not None else None,
        }
    except Exception:
        return None


def _fetch_fred_obs(api_key: str, sid: str, limit: int = 26) -> list[dict]:
    import urllib.request as _ur
    url = (
        f"https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={sid}&api_key={api_key}&limit={limit}"
        f"&sort_order=desc&file_type=json"
    )
    try:
        with _ur.urlopen(url, timeout=10) as r:
            data = json.loads(r.read())
        return [o for o in data.get("observations", []) if o.get("value") not in (".", None, "")]
    except Exception as e:
        logger.warning("FRED %s: %s", sid, e)
        return []


def _process_fred(sid: str, obs: list[dict], meta: dict) -> dict:
    base = {"sid": sid, "name": meta["name"], "unit": meta["unit"],
            "freq": meta["freq"], "mode": meta["mode"], "hib": meta["hib"]}
    if not obs:
        return {**base, "error": "no data"}

    vals  = [float(o["value"]) for o in obs]
    dates = [o["date"] for o in obs]
    mode  = meta["mode"]
    freq  = meta["freq"]

    # periods for YoY comparison
    yoy_n = {"M": 12, "Q": 4, "W": 52}.get(freq, 12)

    if mode == "yoy":
        # compute rolling YoY % change series
        yoy_series = []
        for i in range(len(vals)):
            j = i + yoy_n
            if j < len(vals) and vals[j] != 0:
                yoy_series.append(round((vals[i] / vals[j] - 1) * 100, 2))
            else:
                break
        display  = yoy_series[0] if yoy_series else None
        prev_val = yoy_series[1] if len(yoy_series) > 1 else None
        change   = round(display - prev_val, 2) if display is not None and prev_val is not None else None
        spark    = list(reversed(yoy_series[:12]))

    elif mode == "mom_abs":
        # absolute MoM change (payrolls: jobs added in K)
        changes = [round(vals[i] - vals[i + 1], 0) for i in range(len(vals) - 1)]
        display  = changes[0] if changes else None
        prev_val = changes[1] if len(changes) > 1 else None
        change   = None
        spark    = list(reversed(changes[:12]))

    else:  # level
        display  = round(vals[0], 2)
        prev_val = round(vals[1], 2) if len(vals) > 1 else None
        change   = round(display - prev_val, 2) if prev_val is not None else None
        spark    = list(reversed([round(v, 2) for v in vals[:12]]))

    return {
        **base,
        "value":     display,
        "prev":      prev_val,
        "change":    change,
        "date":      dates[0],
        "sparkline": spark,
    }


@app.get("/api/market/economic")
def get_economic_dashboard():
    cache_key = "market:economic"
    cached = cache_get(cache_key, _ECON_TTL)
    if cached is not None:
        return cached

    # Market macro from yfinance (parallel)
    macro: list[dict] = []
    with ThreadPoolExecutor(max_workers=len(_MACRO_TICKERS)) as pool:
        futures = {pool.submit(_fetch_macro_ticker, item): item["sym"] for item in _MACRO_TICKERS}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                macro.append(r)
    sym_order = [item["sym"] for item in _MACRO_TICKERS]
    macro.sort(key=lambda x: sym_order.index(x["sym"]) if x["sym"] in sym_order else 99)

    # Yield curve
    ym = {m["sym"]: m["price"] for m in macro}
    y3m, y5y, y10y, y30y = ym.get("^IRX"), ym.get("^FVX"), ym.get("^TNX"), ym.get("^TYX")
    spread_10_3 = round(y10y - y3m, 2) if y10y and y3m else None

    # FRED economic series (optional)
    fred_key = os.getenv("FRED_API_KEY", "").strip()
    fred: dict[str, dict] = {}
    if fred_key:
        limits = {"Q": 10, "W": 18, "M": 26}
        with ThreadPoolExecutor(max_workers=6) as pool:
            futs = {pool.submit(_fetch_fred_obs, fred_key, sid,
                                limits.get(meta["freq"], 26)): sid
                    for sid, meta in _FRED_SERIES.items()}
            for fut in as_completed(futs):
                sid = futs[fut]
                obs = fut.result()
                fred[sid] = _process_fred(sid, obs, _FRED_SERIES[sid])

    result = {
        "macro":   macro,
        "fred":    fred,
        "hasFred": bool(fred_key),
        "yields": {
            "3M": y3m, "5Y": y5y, "10Y": y10y, "30Y": y30y,
            "spread10y3m": spread_10_3,
            "inverted": spread_10_3 is not None and spread_10_3 < 0,
        },
        "asOf": datetime.now().strftime("%H:%M"),
    }
    cache_set(cache_key, result)
    return result


# ── AI Stock Analyzer ─────────────────────────────────────────────────────────

_SNAPSHOT_TTL = timedelta(minutes=15)

_STOCK_ANALYZE_SYSTEM = """You are a senior equity research analyst at a bulge-bracket investment bank. Produce a concise, data-driven single-stock analysis that a sophisticated investor can act on.

Use ONLY the data provided. Use the actual numbers — name the metrics, dollar amounts, percentages. Do NOT give generic statements that could apply to any stock.

Use exactly these section headers:

## Business Overview
2–3 sentences: what the company does, its primary revenue model, and what differentiates it in its industry. Include sector and industry context.

## Competitive Position & Moat
Assess competitive advantages (pricing power, switching costs, network effects, cost advantages, regulatory moats). Name specific competitors. Be direct about how wide or narrow the moat is.

## Financial Snapshot
Revenue trajectory, margin trends, balance sheet (cash vs debt), and free cash flow. Flag red flags or standout positives using the actual numbers. Mention ROE and what it implies about capital efficiency.

## Valuation
Analyse P/E, forward P/E, P/S, EV/EBITDA vs typical sector norms. Estimate or discuss PEG ratio. Is the stock cheap, fairly valued, or expensive? Take a clear stance.

## Bull Case
3 specific reasons to own this stock. Reference actual metrics or upcoming catalysts. Include a timeframe (6–12 months or 2–3 years).

## Bear Case & Key Risks
3 most significant risks: valuation risk, competitive threats, macro sensitivity, or company-specific risks. State what would break the bull thesis.

## Verdict
One paragraph: Bullish / Neutral / Bearish with conviction (high/medium/low). Name the single most important catalyst to watch and the price level or metric that would change your view.

Write with conviction. Good research takes a clear stance."""


def _build_snapshot(symbol: str) -> dict:
    """Fetch comprehensive stock data. Called by both snapshot endpoint and AI analyzer."""
    t = yf.Ticker(symbol, session=_session)
    info = t.info or {}

    price = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
    if price is None:
        price = _safe_float(t.fast_info.last_price)
    if price is None:
        raise HTTPException(status_code=404, detail=f"Ticker '{symbol}' not found or has no price data.")

    prev = _safe_float(info.get("previousClose") or info.get("regularMarketPreviousClose"))
    change     = round(price - prev, 2)         if price and prev else None
    change_pct = round(change / prev * 100, 2)  if change and prev else None

    # Technicals from 1-year history
    ma50 = ma200 = ytd_ret = r1m = r3m = rsi14 = None
    try:
        hist = t.history(period="1y")
        if len(hist) > 0:
            closes = hist["Close"]
            if len(closes) >= 50:
                ma50  = round(float(closes.rolling(50).mean().iloc[-1]),  2)
            if len(closes) >= 200:
                ma200 = round(float(closes.rolling(200).mean().iloc[-1]), 2)
            this_year = datetime.now().year
            ytd_hist = hist[hist.index.year == this_year]
            if len(ytd_hist) > 0 and price:
                ytd_ret = round((price - float(ytd_hist["Close"].iloc[0]))
                                / float(ytd_hist["Close"].iloc[0]) * 100, 2)
            if len(closes) >= 21 and price:
                r1m = round((price - float(closes.iloc[-21])) / float(closes.iloc[-21]) * 100, 2)
            if len(closes) >= 63 and price:
                r3m = round((price - float(closes.iloc[-63])) / float(closes.iloc[-63]) * 100, 2)
            if len(closes) >= 15:
                delta = closes.diff()
                gain  = delta.clip(lower=0).rolling(14).mean()
                loss  = (-delta.clip(upper=0)).rolling(14).mean()
                rs    = gain / loss
                rsi14 = round(float((100 - 100 / (1 + rs)).iloc[-1]), 1)
    except Exception as exc:
        logger.debug("Technicals %s: %s", symbol, exc)

    # Next earnings date
    earnings_date = None
    try:
        cal = t.calendar
        if cal is not None and not getattr(cal, "empty", True):
            ed = cal.get("Earnings Date")
            if ed is not None and len(ed) > 0:
                earnings_date = str(ed.iloc[0].date())
    except Exception:
        pass

    def sp(v):
        return round(v * 100, 2) if v is not None else None

    return {
        "symbol":         symbol,
        "name":           info.get("longName") or info.get("shortName") or symbol,
        "exchange":       info.get("exchange") or info.get("fullExchangeName"),
        "sector":         info.get("sector"),
        "industry":       info.get("industry"),
        "price":          price,
        "change":         change,
        "changePct":      change_pct,
        "week52High":     _safe_float(info.get("fiftyTwoWeekHigh")),
        "week52Low":      _safe_float(info.get("fiftyTwoWeekLow")),
        "marketCap":      _safe_float(info.get("marketCap")),
        "beta":           _safe_float(info.get("beta")),
        "peRatio":        _safe_float(info.get("trailingPE")),
        "forwardPE":      _safe_float(info.get("forwardPE")),
        "priceToBook":    _safe_float(info.get("priceToBook")),
        "priceToSales":   _safe_float(info.get("priceToSalesTrailingTwelveMonths")),
        "evEbitda":       _safe_float(info.get("enterpriseToEbitda")),
        "revenue":        _safe_float(info.get("totalRevenue")),
        "revenueGrowth":  sp(info.get("revenueGrowth")),
        "earningsGrowth": sp(info.get("earningsGrowth")),
        "profitMargin":   sp(info.get("profitMargins")),
        "grossMargin":    sp(info.get("grossMargins")),
        "operatingMargin":sp(info.get("operatingMargins")),
        "roe":            sp(info.get("returnOnEquity")),
        "roa":            sp(info.get("returnOnAssets")),
        "debtToEquity":   _safe_float(info.get("debtToEquity")),
        "totalCash":      _safe_float(info.get("totalCash")),
        "totalDebt":      _safe_float(info.get("totalDebt")),
        "freeCashflow":   _safe_float(info.get("freeCashflow")),
        "dividendYield":  sp(info.get("dividendYield")),
        "targetMeanPrice":_safe_float(info.get("targetMeanPrice")),
        "targetHighPrice":_safe_float(info.get("targetHighPrice")),
        "targetLowPrice": _safe_float(info.get("targetLowPrice")),
        "analystCount":   info.get("numberOfAnalystOpinions"),
        "recommendation": info.get("recommendationKey"),
        "shortPct":       sp(info.get("shortPercentOfFloat")),
        "employees":      info.get("fullTimeEmployees"),
        "description":    (info.get("longBusinessSummary") or "")[:600],
        "descriptionFull":info.get("longBusinessSummary") or "",
        "ma50":           ma50,
        "ma200":          ma200,
        "ytdReturn":      ytd_ret,
        "return1m":       r1m,
        "return3m":       r3m,
        "rsi14":          rsi14,
        "earningsDate":   earnings_date,
    }


@app.get("/api/market/stock-snapshot/{symbol}")
def get_stock_snapshot(symbol: str):
    symbol = symbol.upper().strip()
    cache_key = f"snapshot:{symbol}"
    cached = cache_get(cache_key, _SNAPSHOT_TTL)
    if cached is not None:
        return cached
    result = _build_snapshot(symbol)
    cache_set(cache_key, result)
    return result


class StockAnalyzeRequest(BaseModel):
    symbol: str

@app.post("/api/ai/stock-analyze")
def ai_stock_analyze(body: StockAnalyzeRequest):
    symbol = (body.symbol or "").upper().strip()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol required")

    # Use cached snapshot if available, otherwise fetch fresh
    cache_key = f"snapshot:{symbol}"
    snap = cache_get(cache_key, _SNAPSHOT_TTL)
    if snap is None:
        snap = _build_snapshot(symbol)
        cache_set(cache_key, snap)

    def fc(v, suffix=""):
        if v is None: return "N/A"
        if suffix == "$":
            if abs(v) >= 1e12: return f"${v/1e12:.2f}T"
            if abs(v) >= 1e9:  return f"${v/1e9:.2f}B"
            if abs(v) >= 1e6:  return f"${v/1e6:.2f}M"
            return f"${v:,.0f}"
        if suffix == "%": return f"{v:.2f}%"
        if suffix == "x": return f"{v:.1f}x"
        return str(round(v, 2))

    price = snap.get("price") or 0
    ma50  = snap.get("ma50")
    ma200 = snap.get("ma200")
    above50  = "above" if ma50  and price > ma50  else "below" if ma50  else "N/A"
    above200 = "above" if ma200 and price > ma200 else "below" if ma200 else "N/A"

    tgt_mean = snap.get("targetMeanPrice")
    upside = round((tgt_mean - price) / price * 100, 1) if tgt_mean and price else None

    user_msg = f"""Analyse {symbol} — {snap.get('name', symbol)}.

PRICE & TECHNICALS
Current: ${price:,.2f}  |  Change today: {fc(snap.get('changePct'), '%')}
52-week range: ${fc(snap.get('week52Low'))} – ${fc(snap.get('week52High'))}
YTD return: {fc(snap.get('ytdReturn'), '%')}  |  1M: {fc(snap.get('return1m'), '%')}  |  3M: {fc(snap.get('return3m'), '%')}
Beta: {fc(snap.get('beta'))}  |  RSI (14): {fc(snap.get('rsi14'))}
50-day MA: ${fc(snap.get('ma50'))} ({above50})  |  200-day MA: ${fc(snap.get('ma200'))} ({above200})
Short interest: {fc(snap.get('shortPct'), '%')} of float

FUNDAMENTALS
Market cap: {fc(snap.get('marketCap'), '$')}  |  Sector: {snap.get('sector') or 'N/A'}  |  Industry: {snap.get('industry') or 'N/A'}
Revenue (TTM): {fc(snap.get('revenue'), '$')}  |  Revenue growth YoY: {fc(snap.get('revenueGrowth'), '%')}
Earnings growth YoY: {fc(snap.get('earningsGrowth'), '%')}
Gross margin: {fc(snap.get('grossMargin'), '%')}  |  Operating margin: {fc(snap.get('operatingMargin'), '%')}  |  Net margin: {fc(snap.get('profitMargin'), '%')}
Return on equity: {fc(snap.get('roe'), '%')}  |  Return on assets: {fc(snap.get('roa'), '%')}
Free cash flow: {fc(snap.get('freeCashflow'), '$')}
Cash: {fc(snap.get('totalCash'), '$')}  |  Total debt: {fc(snap.get('totalDebt'), '$')}  |  Debt/Equity: {fc(snap.get('debtToEquity'))}
Dividend yield: {fc(snap.get('dividendYield'), '%')}
Employees: {f"{snap['employees']:,}" if snap.get('employees') else 'N/A'}
Next earnings: {snap.get('earningsDate') or 'N/A'}

VALUATION MULTIPLES
P/E (TTM): {fc(snap.get('peRatio'), 'x')}  |  Forward P/E: {fc(snap.get('forwardPE'), 'x')}
Price/Sales: {fc(snap.get('priceToSales'), 'x')}  |  Price/Book: {fc(snap.get('priceToBook'), 'x')}  |  EV/EBITDA: {fc(snap.get('evEbitda'), 'x')}

ANALYST CONSENSUS
Rating: {(snap.get('recommendation') or 'N/A').upper()}  |  Analysts covering: {snap.get('analystCount') or 'N/A'}
Price targets — Low: ${fc(snap.get('targetLowPrice'))}  |  Mean: ${fc(tgt_mean)}  |  High: ${fc(snap.get('targetHighPrice'))}
Upside to mean target: {f'{upside}%' if upside is not None else 'N/A'}

BUSINESS DESCRIPTION
{snap.get('descriptionFull') or 'Not available.'}"""

    anthropic_client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

    def generate():
        try:
            with anthropic_client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=2000,
                system=[{"type": "text", "text": _STOCK_ANALYZE_SYSTEM,
                          "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user_msg}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {text}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            yield f"data: [ERROR] {exc}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Dividend Tracker ──────────────────────────────────────────────────────────

_DIV_TTL = timedelta(hours=6)


class DivDataRequest(BaseModel):
    symbols: list[str]


def _fetch_div_info(sym: str) -> dict | None:
    cache_key = f"div:{sym}"
    cached = cache_get(cache_key, _DIV_TTL)
    if cached:
        return cached

    try:
        t = yf.Ticker(sym, session=_session)
        info = t.info or {}

        price     = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
        div_rate  = _safe_float(info.get("dividendRate"))
        div_yield = _safe_float(info.get("dividendYield"))

        # exDividendDate is a Unix timestamp in yfinance info
        ex_ts  = info.get("exDividendDate")
        ex_date = None
        if ex_ts and isinstance(ex_ts, (int, float)) and ex_ts > 0:
            from datetime import timezone
            ex_date = datetime.fromtimestamp(ex_ts, tz=timezone.utc).strftime("%Y-%m-%d")

        # Payout frequency from dividend history spacing
        freq    = "quarterly"
        history = []
        try:
            divs = t.dividends
            if len(divs) >= 2:
                tail  = divs.tail(5)
                dates = tail.index
                span  = (dates[-1] - dates[0]).days
                n     = len(dates) - 1
                avg   = span / n if n else 90
                if avg < 40:   freq = "monthly"
                elif avg < 100: freq = "quarterly"
                elif avg < 200: freq = "semi-annual"
                else:           freq = "annual"
            for dt, val in divs.tail(8).items():
                history.append({"date": str(dt.date()), "amount": round(float(val), 4)})
        except Exception:
            pass

        result = {
            "symbol":            sym,
            "name":              info.get("longName") or info.get("shortName") or sym,
            "price":             price,
            "dividendRate":      div_rate,
            "dividendYield":     round(div_yield * 100, 2) if div_yield else None,
            "exDividendDate":    ex_date,
            "lastDividendValue": _safe_float(info.get("lastDividendValue")),
            "payoutFrequency":   freq,
            "sector":            info.get("sector"),
            "history":           history,
        }
        cache_set(cache_key, result)
        return result
    except Exception as exc:
        logger.debug("Div info %s: %s", sym, exc)
        return None


@app.post("/api/market/dividend-data")
def get_dividend_data(body: DivDataRequest):
    syms = [s.upper().strip() for s in body.symbols if s.strip()]
    if not syms:
        return []
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(syms), 10)) as pool:
        futures = {pool.submit(_fetch_div_info, sym): sym for sym in syms}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                results.append(r)
    return results


# ── Watchlist Heatmap ─────────────────────────────────────────────────────────

_WL_HEAT_TTL = timedelta(minutes=5)

def _fetch_wl_tile(sym: str) -> dict | None:
    cache_key = f"wlheat:{sym}"
    cached = cache_get(cache_key, _WL_HEAT_TTL)
    if cached:
        return cached
    try:
        t = yf.Ticker(sym, session=_session)
        fi = t.fast_info
        info = t.info or {}
        price = _safe_float(fi.last_price)
        prev  = _safe_float(fi.previous_close)
        chg_1d = round((price - prev) / prev * 100, 2) if price and prev else None
        hist = t.history(period="3mo", interval="1d", auto_adjust=True)

        def pct(n: int):
            if hist.empty or len(hist) <= n:
                return None
            c = hist["Close"]
            return round((float(c.iloc[-1]) / float(c.iloc[-(n + 1)]) - 1) * 100, 2)

        mkt_cap = _safe_float(fi.market_cap) or _safe_float(info.get("marketCap"))
        result = {
            "symbol":    sym,
            "name":      info.get("longName") or info.get("shortName") or sym,
            "price":     price,
            "marketCap": mkt_cap,
            "sector":    info.get("sector"),
            "ret1d":     chg_1d,
            "ret5d":     pct(5),
            "ret1m":     pct(21),
            "ret3m":     pct(63),
        }
        cache_set(cache_key, result)
        return result
    except Exception as exc:
        logger.debug("WL heatmap tile %s: %s", sym, exc)
        return None


@app.get("/api/market/watchlist-heatmap")
def get_watchlist_heatmap(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(syms), 12)) as pool:
        futures = {pool.submit(_fetch_wl_tile, sym): sym for sym in syms}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                results.append(r)
    results.sort(key=lambda x: -(x.get("marketCap") or 0))
    return results


# ── Earnings Surprise Tracker ─────────────────────────────────────────────────

_EARN_SURP_TTL = timedelta(hours=12)


def _calc_drift(hist: pd.DataFrame, earn_date_str: str, days: int):
    try:
        earn_dt = pd.Timestamp(earn_date_str, tz="UTC")
        future = hist.index[hist.index >= earn_dt]
        if len(future) < days + 1:
            return None
        c0 = float(hist.loc[future[0], "Close"])
        cn = float(hist.loc[future[days], "Close"])
        return round((cn / c0 - 1) * 100, 2) if c0 else None
    except Exception:
        return None


def _fetch_earn_surprise(sym: str) -> dict | None:
    cache_key = f"earnsurp:{sym}"
    cached = cache_get(cache_key, _EARN_SURP_TTL)
    if cached:
        return cached
    try:
        t    = yf.Ticker(sym, session=_session)
        info = t.info or {}

        eh = None
        try:
            eh = t.earnings_history
        except Exception:
            pass

        if eh is None or eh.empty:
            return {"symbol": sym, "name": info.get("longName") or sym, "quarters": [], "noData": True}

        hist = None
        try:
            hist = t.history(period="2y", interval="1d", auto_adjust=True)
            if hist.index.tz is None:
                hist.index = hist.index.tz_localize("UTC")
        except Exception:
            pass

        quarters = []
        for idx, row in eh.iterrows():
            try:
                eps_est = _safe_float(row.get("epsEstimate"))
                eps_act = _safe_float(row.get("epsActual"))
                if eps_est is None and eps_act is None:
                    continue

                # Calculate surprise % from raw values (avoids yfinance fraction/pct ambiguity)
                surp_pct = None
                if eps_est is not None and eps_act is not None and eps_est != 0:
                    surp_pct = round((eps_act - eps_est) / abs(eps_est) * 100, 2)

                beat = (eps_act >= eps_est) if (eps_est is not None and eps_act is not None) else None
                date_str = str(idx.date()) if hasattr(idx, "date") else str(idx)[:10]

                quarters.append({
                    "date":        date_str,
                    "epsEstimate": round(eps_est, 4) if eps_est is not None else None,
                    "epsActual":   round(eps_act, 4) if eps_act is not None else None,
                    "surprisePct": surp_pct,
                    "beat":        beat,
                    "drift1d":     _calc_drift(hist, date_str, 1) if hist is not None else None,
                    "drift5d":     _calc_drift(hist, date_str, 5) if hist is not None else None,
                })
            except Exception as e:
                logger.debug("Quarter parse %s: %s", sym, e)

        # Most-recent first, cap at 8
        quarters.sort(key=lambda q: q["date"], reverse=True)
        quarters = quarters[:8]

        with_eps = [q for q in quarters if q["beat"] is not None]
        beat_ct  = sum(1 for q in with_eps if q["beat"])
        beat_rate = round(beat_ct / len(with_eps) * 100) if with_eps else None

        surps = [q["surprisePct"] for q in quarters if q["surprisePct"] is not None]
        avg_surp = round(sum(surps) / len(surps), 2) if surps else None

        streak = 0
        for q in quarters:
            if q["beat"] is True:
                streak += 1
            else:
                break

        d1s = [q["drift1d"] for q in quarters if q["drift1d"] is not None]
        d5s = [q["drift5d"] for q in quarters if q["drift5d"] is not None]

        result = {
            "symbol":        sym,
            "name":          info.get("longName") or info.get("shortName") or sym,
            "sector":        info.get("sector"),
            "quarters":      quarters,
            "beatRate":      beat_rate,
            "beatCount":     beat_ct,
            "totalQuarters": len(with_eps),
            "avgSurprisePct": avg_surp,
            "beatStreak":    streak,
            "avgDrift1d":    round(sum(d1s) / len(d1s), 2) if d1s else None,
            "avgDrift5d":    round(sum(d5s) / len(d5s), 2) if d5s else None,
        }
        cache_set(cache_key, result)
        return result
    except Exception as exc:
        logger.warning("Earnings surprise %s: %s", sym, exc)
        return None


@app.get("/api/market/earnings-surprise")
def get_earnings_surprise(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(syms), 6)) as pool:
        futures = {pool.submit(_fetch_earn_surprise, sym): sym for sym in syms}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                results.append(r)
    results.sort(key=lambda x: -(x.get("beatRate") or 0))
    return results


# ── Earnings Strategy Analyzer ───────────────────────────────────────────────

_EARN_STRAT_TTL = timedelta(hours=6)


def _nearest_trading_idx(price_idx: pd.DatetimeIndex, target: pd.Timestamp, after: bool = False) -> int | None:
    if after:
        pos = price_idx.searchsorted(target, side="left")
    else:
        pos = price_idx.searchsorted(target, side="right") - 1
    if 0 <= pos < len(price_idx):
        return int(pos)
    return None


def _period_ret(closes: pd.Series, start_idx: int, offset: int) -> float | None:
    end_idx = start_idx + offset
    if start_idx < 0 or end_idx < 0 or end_idx >= len(closes):
        return None
    s = float(closes.iloc[start_idx])
    e = float(closes.iloc[end_idx])
    return round((e / s - 1) * 100, 2) if s else None


def _analyze_earnings_strategy(sym: str) -> dict | None:
    cache_key = f"earnstrat:{sym}"
    cached = cache_get(cache_key, _EARN_STRAT_TTL)
    if cached:
        return cached

    try:
        t = yf.Ticker(sym)

        hist = t.history(period="3y")
        if hist.empty or len(hist) < 60:
            return None
        hist.index = hist.index.tz_localize(None) if hist.index.tzinfo else hist.index
        closes = hist["Close"].dropna()
        price_idx = closes.index

        info = {}
        try:
            info = t.info or {}
        except Exception:
            pass
        name   = info.get("longName") or info.get("shortName") or sym
        sector = info.get("sector")
        try:
            cur_price = float(closes.iloc[-1])
        except Exception:
            cur_price = None

        # Next earnings date
        next_earn_date = None
        days_to_earn   = None
        try:
            cal = t.calendar
            if cal is not None:
                if isinstance(cal, dict):
                    ed = cal.get("Earnings Date")
                    if isinstance(ed, (list, tuple)) and len(ed) > 0:
                        next_earn_date = str(ed[0])[:10]
                    elif ed is not None:
                        next_earn_date = str(ed)[:10]
                elif hasattr(cal, "iloc"):
                    try:
                        ed_row = cal.loc["Earnings Date"] if "Earnings Date" in cal.index else None
                        if ed_row is not None:
                            next_earn_date = str(ed_row.iloc[0])[:10]
                    except Exception:
                        pass
        except Exception:
            pass

        if next_earn_date:
            try:
                ndt = pd.Timestamp(next_earn_date)
                days_to_earn = (ndt - pd.Timestamp.now()).days
            except Exception:
                pass

        # EPS history
        eps_history: list[dict] = []
        try:
            eh = t.earnings_history
            if eh is not None and not eh.empty:
                for idx_val, row in eh.iterrows():
                    try:
                        dt  = pd.Timestamp(idx_val).normalize()
                        est = _safe_float(row.get("epsEstimate"))
                        act = _safe_float(row.get("epsActual"))
                        beat = (act >= est) if (est is not None and act is not None) else None
                        surp = round((act - est) / abs(est) * 100, 2) if (est and act and abs(est) > 1e-6) else None
                        eps_history.append({"date": str(dt.date()), "epsEstimate": est, "epsActual": act, "beat": beat, "surprisePct": surp})
                    except Exception:
                        pass
        except Exception:
            pass

        eps_history.sort(key=lambda x: x["date"], reverse=True)

        events: list[dict] = []
        for ep in eps_history:
            try:
                earn_dt = pd.Timestamp(ep["date"])
                ei = _nearest_trading_idx(price_idx, earn_dt, after=True)
                if ei is None or ei < 22:
                    continue
                pre1_idx    = ei - 1
                pre5d       = _period_ret(closes, pre1_idx - 4,  4)
                pre10d      = _period_ret(closes, pre1_idx - 9,  9)
                pre20d      = _period_ret(closes, pre1_idx - 19, 19)
                earn_react  = _period_ret(closes, pre1_idx,      2)   # day-before to day-after
                post_ref    = ei + 1
                if post_ref >= len(closes):
                    continue
                post1d      = _period_ret(closes, post_ref, 1)
                post5d      = _period_ret(closes, post_ref, 5)
                post10d     = _period_ret(closes, post_ref, 10)
                events.append({**ep, "pre5d": pre5d, "pre10d": pre10d, "pre20d": pre20d,
                                "earningsReaction": earn_react, "post1d": post1d,
                                "post5d": post5d, "post10d": post10d})
            except Exception:
                continue

        if len(events) < 3:
            return None

        def _strat_stats(returns: list) -> dict:
            if not returns:
                return {"n": 0, "winRate": None, "avgReturn": None, "bestReturn": None,
                        "worstReturn": None, "signal": "INSUFFICIENT_DATA", "expectedValue": None}
            wins  = sum(1 for r in returns if r > 0)
            n     = len(returns)
            avg   = round(sum(returns) / n, 2)
            wr    = round(wins / n * 100)
            ev    = round(wr / 100 * avg, 2)
            if n < 3:
                signal = "INSUFFICIENT_DATA"
            elif wr >= 70 and avg >= 2.0:
                signal = "STRONG_BUY"
            elif wr >= 60 and avg >= 1.0:
                signal = "BUY"
            elif wr <= 35 or avg <= -1.5:
                signal = "AVOID"
            elif wr <= 45 or avg <= 0:
                signal = "WEAK"
            else:
                signal = "NEUTRAL"
            return {"n": n, "winRate": wr, "avgReturn": avg,
                    "bestReturn": round(max(returns), 2), "worstReturn": round(min(returns), 2),
                    "signal": signal, "expectedValue": ev}

        pre10_rets = [e["pre10d"]  for e in events if e["pre10d"]  is not None]
        s_pre = _strat_stats(pre10_rets)
        s_pre["name"] = "Pre-Earnings Run"
        s_pre["description"] = "Enter 10 trading days before earnings, exit 1 day before. Captures the pre-earnings run-up without holding through the announcement."

        beat_post10 = [e["post10d"] for e in events if e["beat"] is True and e["post10d"] is not None]
        s_beat = _strat_stats(beat_post10)
        s_beat["name"] = "Buy the Beat"
        s_beat["description"] = "Enter 1 day after earnings ONLY on an EPS beat, hold 10 days. Captures post-beat continuation momentum."

        dip_post10 = [e["post10d"] for e in events if e.get("earningsReaction") is not None and e["earningsReaction"] < -3 and e["post10d"] is not None]
        s_dip = _strat_stats(dip_post10)
        s_dip["name"] = "Buy the Dip"
        s_dip["description"] = "Enter 1 day after earnings when stock dropped ≥3% on the announcement, hold 10 days. Mean-reversion play on over-reaction selling."

        hold_rets = []
        for e in events:
            if e["pre5d"] is not None and e["post5d"] is not None:
                total = round(e["pre5d"] + e["post5d"] * (1 + e["pre5d"] / 100), 2)
                hold_rets.append(total)
        s_hold = _strat_stats(hold_rets)
        s_hold["name"] = "Hold Through Earnings"
        s_hold["description"] = "Enter 5 days before, hold through announcement, exit 5 days after. Full earnings-window exposure."

        strategies = {"preRun": s_pre, "buyTheBeat": s_beat, "buyTheDip": s_dip, "holdThrough": s_hold}

        best_k = max(
            ["preRun", "buyTheBeat", "buyTheDip", "holdThrough"],
            key=lambda k: (strategies[k].get("expectedValue") or -99) if (strategies[k].get("n") or 0) >= 3 else -99
        )

        beats_with_data = [e for e in events if e["beat"] is not None]
        beat_rate  = round(sum(1 for e in beats_with_data if e["beat"]) / len(beats_with_data) * 100) if beats_with_data else None
        abs_moves  = [abs(e["earningsReaction"]) for e in events if e["earningsReaction"] is not None]
        avg_abs_move = round(sum(abs_moves) / len(abs_moves), 2) if abs_moves else None
        avg_pre10    = round(sum(pre10_rets) / len(pre10_rets), 2) if pre10_rets else None

        result = {
            "symbol": sym, "name": name, "sector": sector, "currentPrice": cur_price,
            "nextEarningsDate": next_earn_date, "daysToEarnings": days_to_earn,
            "events": events, "strategies": strategies, "bestStrategy": best_k,
            "beatRate": beat_rate, "avgAbsMove": avg_abs_move, "avgPre10d": avg_pre10,
            "totalEvents": len(events),
        }
        cache_set(cache_key, result)
        return result
    except Exception as exc:
        logger.warning("Earnings strategy %s: %s", sym, exc)
        return None


@app.get("/api/market/earnings-strategy")
def get_earnings_strategy(symbol: str):
    sym = symbol.strip().upper()
    result = _analyze_earnings_strategy(sym)
    if result is None:
        raise HTTPException(404, f"Insufficient earnings history for {sym}")
    return result


@app.get("/api/market/earnings-strategy-scan")
def get_earnings_strategy_scan(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(syms), 6)) as pool:
        futures = {pool.submit(_analyze_earnings_strategy, sym): sym for sym in syms}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                strats = r.get("strategies", {})
                best_k = r.get("bestStrategy", "preRun")
                best_s = strats.get(best_k, {})
                results.append({
                    "symbol": r["symbol"], "name": r["name"], "sector": r["sector"],
                    "currentPrice": r["currentPrice"],
                    "nextEarningsDate": r.get("nextEarningsDate"),
                    "daysToEarnings":   r.get("daysToEarnings"),
                    "beatRate":         r.get("beatRate"),
                    "avgAbsMove":       r.get("avgAbsMove"),
                    "avgPre10d":        r.get("avgPre10d"),
                    "bestStrategy":     best_k,
                    "bestSignal":       best_s.get("signal"),
                    "bestWinRate":      best_s.get("winRate"),
                    "bestAvgReturn":    best_s.get("avgReturn"),
                    "totalEvents":      r.get("totalEvents"),
                })
    results.sort(key=lambda x: (x.get("daysToEarnings") or 9999))
    return results


# ── Market Sentiment Dashboard ────────────────────────────────────────────────

_SENTIMENT_TTL = timedelta(minutes=30)

_SP500_SAMPLE = [
    'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM',
    'JNJ','V','UNH','HD','PG','MA','XOM','BAC','MRK',
    'ABBV','CVX','KO','PEP','COST','AVGO','WMT','LLY',
    'CSCO','MCD','TMO','CRM','NFLX',
]


def _score_label(score: float) -> str:
    if score <= 25: return "Extreme Fear"
    if score <= 45: return "Fear"
    if score <= 55: return "Neutral"
    if score <= 75: return "Greed"
    return "Extreme Greed"


def _vix_score(vix: float) -> float:
    """High VIX = fear = low score."""
    if vix <= 10:  return 95
    if vix <= 13:  return 85
    if vix <= 16:  return 72
    if vix <= 20:  return 55
    if vix <= 25:  return 40
    if vix <= 30:  return 28
    if vix <= 40:  return 15
    return 5


def _pc_score(ratio: float) -> float:
    """High put/call = fear = low score."""
    if ratio <= 0.40: return 95
    if ratio <= 0.55: return 80
    if ratio <= 0.70: return 62
    if ratio <= 0.85: return 50
    if ratio <= 1.00: return 38
    if ratio <= 1.20: return 25
    return 12


@app.get("/api/market/sentiment")
def get_market_sentiment():
    cache_key = "mkt_sentiment_v1"
    cached = cache_get(cache_key, _SENTIMENT_TTL)
    if cached:
        return cached

    indicators: list[dict] = []
    fetch_errors: list[str] = []

    # ── 1. VIX ────────────────────────────────────────────────────────────────
    vix_score_val = None
    vix_data = {}
    try:
        vix_hist = yf.Ticker("^VIX").history(period="1y")
        vix_hist.index = vix_hist.index.tz_localize(None) if vix_hist.index.tzinfo else vix_hist.index
        vix_closes = vix_hist["Close"].dropna()
        cur_vix   = float(vix_closes.iloc[-1])
        ma50_vix  = float(vix_closes.iloc[-50:].mean())
        vs_ma_pct = round((cur_vix / ma50_vix - 1) * 100, 1)
        vix_score_val = _vix_score(cur_vix)

        # VIX term structure
        vix3m_cur = None
        try:
            v3h = yf.Ticker("^VIX3M").history(period="5d")
            if not v3h.empty:
                vix3m_cur = round(float(v3h["Close"].dropna().iloc[-1]), 2)
        except Exception:
            pass

        term_structure = None
        if vix3m_cur:
            term_structure = "contango" if cur_vix < vix3m_cur else "backwardation"

        # 90-day history for chart
        history_90 = [
            {"date": str(d.date()), "value": round(float(v), 2)}
            for d, v in zip(vix_closes.index[-90:], vix_closes.values[-90:])
        ]

        vix_data = {
            "current": round(cur_vix, 2),
            "ma50":    round(ma50_vix, 2),
            "vsMa50Pct": vs_ma_pct,
            "vix3m":   vix3m_cur,
            "termStructure": term_structure,
            "history": history_90,
        }
        indicators.append({
            "id": "vix", "name": "Market Volatility (VIX)",
            "score": round(vix_score_val),
            "label": _score_label(vix_score_val),
            "reading": f"{cur_vix:.1f}",
            "readingUnit": "pts",
            "context": f"VIX {'+' if vs_ma_pct >= 0 else ''}{vs_ma_pct}% vs 50d avg ({ma50_vix:.1f})"
                       + (f" · {term_structure}" if term_structure else ""),
            "extra": vix_data,
        })
    except Exception as e:
        fetch_errors.append(f"VIX: {e}")

    # ── 2. Put/Call Ratio ─────────────────────────────────────────────────────
    pc_score_val = None
    try:
        spy = yf.Ticker("SPY")
        exps = spy.options
        if exps:
            chain = spy.option_chain(exps[0])
            put_vol  = int(chain.puts["volume"].fillna(0).sum())
            call_vol = int(chain.calls["volume"].fillna(0).sum())
            pc_ratio = round(put_vol / call_vol, 3) if call_vol > 0 else None
            if pc_ratio is not None:
                pc_score_val = _pc_score(pc_ratio)
                indicators.append({
                    "id": "putCall", "name": "Put/Call Ratio",
                    "score": round(pc_score_val),
                    "label": _score_label(pc_score_val),
                    "reading": f"{pc_ratio:.2f}",
                    "readingUnit": "ratio",
                    "context": f"{put_vol:,} puts / {call_vol:,} calls on SPY ({exps[0]})",
                    "extra": {"ratio": pc_ratio, "putVol": put_vol, "callVol": call_vol, "expiry": exps[0]},
                })
    except Exception as e:
        fetch_errors.append(f"PutCall: {e}")

    # ── 3. Market Momentum (SPY vs 200MA + ROC) ────────────────────────────────
    momentum_score_val = None
    try:
        spy_hist = yf.Ticker("SPY").history(period="2y")
        spy_hist.index = spy_hist.index.tz_localize(None) if spy_hist.index.tzinfo else spy_hist.index
        spy_c = spy_hist["Close"].dropna()
        cur_spy  = float(spy_c.iloc[-1])
        ma200    = float(spy_c.iloc[-200:].mean())
        above200 = cur_spy > ma200
        pct_vs200 = round((cur_spy / ma200 - 1) * 100, 2)

        # 125-day rate of change
        roc125 = round((cur_spy / float(spy_c.iloc[-126]) - 1) * 100, 2) if len(spy_c) >= 126 else None

        if roc125 is not None:
            # Score: above 200MA baseline + ROC bonus
            base = 60 if above200 else 35
            roc_adj = max(-25, min(25, roc125 * 1.2))
            momentum_score_val = max(5, min(95, base + roc_adj))
        else:
            momentum_score_val = 60 if above200 else 35

        ret1m = round((cur_spy / float(spy_c.iloc[-21]) - 1) * 100, 2) if len(spy_c) >= 21 else None
        ret3m = round((cur_spy / float(spy_c.iloc[-63]) - 1) * 100, 2) if len(spy_c) >= 63 else None

        indicators.append({
            "id": "momentum", "name": "Market Momentum",
            "score": round(momentum_score_val),
            "label": _score_label(momentum_score_val),
            "reading": f"{'Above' if above200 else 'Below'} 200MA",
            "readingUnit": "",
            "context": f"SPY {'+' if pct_vs200 >= 0 else ''}{pct_vs200}% vs 200d MA"
                       + (f" · 125d ROC: {'+' if roc125 >= 0 else ''}{roc125}%" if roc125 is not None else ""),
            "extra": {"aboveMA200": above200, "pctVsMA200": pct_vs200, "roc125d": roc125,
                      "ret1m": ret1m, "ret3m": ret3m, "currentPrice": round(cur_spy, 2), "ma200": round(ma200, 2)},
        })
    except Exception as e:
        fetch_errors.append(f"Momentum: {e}")

    # ── 4. Market Breadth (% of S&P sample above 50MA) ────────────────────────
    breadth_score_val = None
    try:
        above_ma50: list[bool] = []

        def _check_above50(sym: str) -> bool | None:
            try:
                h = yf.Ticker(sym).history(period="3mo")
                if h.empty or len(h) < 52:
                    return None
                c = h["Close"].dropna()
                return float(c.iloc[-1]) > float(c.iloc[-50:].mean())
            except Exception:
                return None

        with ThreadPoolExecutor(max_workers=10) as pool:
            for result in pool.map(_check_above50, _SP500_SAMPLE):
                if result is not None:
                    above_ma50.append(result)

        if above_ma50:
            pct_above = round(sum(above_ma50) / len(above_ma50) * 100)
            breadth_score_val = pct_above  # 0-100 directly
            indicators.append({
                "id": "breadth", "name": "Market Breadth",
                "score": round(breadth_score_val),
                "label": _score_label(breadth_score_val),
                "reading": f"{pct_above}%",
                "readingUnit": "above 50MA",
                "context": f"{sum(above_ma50)}/{len(above_ma50)} of S&P sample stocks above their 50-day MA",
                "extra": {"pctAbove50MA": pct_above, "sampleSize": len(above_ma50), "aboveCount": sum(above_ma50)},
            })
    except Exception as e:
        fetch_errors.append(f"Breadth: {e}")

    # ── 5. Junk Bond Demand (HYG vs LQD) ──────────────────────────────────────
    credit_score_val = None
    try:
        def _etf_ret(sym, days):
            h = yf.Ticker(sym).history(period="3mo")
            c = h["Close"].dropna()
            if len(c) < days + 1:
                return None
            return round((float(c.iloc[-1]) / float(c.iloc[-days - 1]) - 1) * 100, 2)

        hyg_ret = _etf_ret("HYG", 21)
        lqd_ret = _etf_ret("LQD", 21)

        if hyg_ret is not None and lqd_ret is not None:
            spread = round(hyg_ret - lqd_ret, 2)
            # Positive spread = junk bonds outperforming = risk appetite = greed
            base = 50
            credit_score_val = max(5, min(95, base + spread * 6))
            indicators.append({
                "id": "credit", "name": "Junk Bond Demand",
                "score": round(credit_score_val),
                "label": _score_label(credit_score_val),
                "reading": f"{'+' if spread >= 0 else ''}{spread}%",
                "readingUnit": "HYG vs LQD",
                "context": f"HYG 1M: {'+' if hyg_ret >= 0 else ''}{hyg_ret}%  ·  LQD 1M: {'+' if lqd_ret >= 0 else ''}{lqd_ret}%"
                           + (" → Risk appetite elevated" if spread > 0.5 else " → Credit stress" if spread < -0.5 else ""),
                "extra": {"hygRet1m": hyg_ret, "lqdRet1m": lqd_ret, "spread": spread},
            })
    except Exception as e:
        fetch_errors.append(f"Credit: {e}")

    # ── 6. Safe Haven Demand (SPY vs TLT) ─────────────────────────────────────
    safe_haven_score_val = None
    try:
        def _ret21(sym):
            h = yf.Ticker(sym).history(period="2mo")
            c = h["Close"].dropna()
            if len(c) < 22:
                return None
            return round((float(c.iloc[-1]) / float(c.iloc[-22]) - 1) * 100, 2)

        spy_ret = _ret21("SPY")
        tlt_ret = _ret21("TLT")
        gld_ret = _ret21("GLD")

        if spy_ret is not None and tlt_ret is not None:
            spread = round(spy_ret - tlt_ret, 2)
            # Stocks outperforming bonds = greed; bonds outperforming = fear
            safe_haven_score_val = max(5, min(95, 50 + spread * 2.5))
            context = f"SPY 1M: {'+' if spy_ret >= 0 else ''}{spy_ret}%  ·  TLT 1M: {'+' if tlt_ret >= 0 else ''}{tlt_ret}%"
            if gld_ret is not None:
                context += f"  ·  GLD 1M: {'+' if gld_ret >= 0 else ''}{gld_ret}%"
            if spread > 3:
                context += " → Stocks dominating bonds"
            elif spread < -3:
                context += " → Flight to safety"

            indicators.append({
                "id": "safeHaven", "name": "Safe Haven Demand",
                "score": round(safe_haven_score_val),
                "label": _score_label(safe_haven_score_val),
                "reading": f"{'Stocks' if spread >= 0 else 'Bonds'} leading",
                "readingUnit": "",
                "context": context,
                "extra": {"spyRet1m": spy_ret, "tltRet1m": tlt_ret, "gldRet1m": gld_ret, "spread": spread},
            })
    except Exception as e:
        fetch_errors.append(f"SafeHaven: {e}")

    # ── Overall score ──────────────────────────────────────────────────────────
    scored = [ind for ind in indicators if ind.get("score") is not None]
    overall = round(sum(ind["score"] for ind in scored) / len(scored)) if scored else 50

    result = {
        "timestamp":    pd.Timestamp.now().isoformat()[:19],
        "overallScore": overall,
        "overallLabel": _score_label(overall),
        "indicators":   indicators,
        "errors":       fetch_errors,
        "vixHistory":   vix_data.get("history", []),
    }
    cache_set(cache_key, result)
    return result


# ── Analyst Rating Tracker ────────────────────────────────────────────────────

_ANALYST_TTL = timedelta(hours=6)

_GRADE_POSITIVE = {
    'buy','strong buy','overweight','outperform','outperformer',
    'positive','accumulate','add','top pick','conviction buy',
    'sector outperform','market outperform',
}
_GRADE_NEGATIVE = {
    'sell','strong sell','underweight','underperform','underperformer',
    'negative','reduce','avoid','market underperform','sector underperform',
}

def _normalize_grade(grade: str | None) -> str:
    if not grade:
        return 'neutral'
    g = grade.lower().strip()
    if g in _GRADE_POSITIVE:
        return 'positive'
    if g in _GRADE_NEGATIVE:
        return 'negative'
    return 'neutral'


def _action_label(action: str) -> str:
    return {'up': 'Upgrade', 'down': 'Downgrade', 'init': 'Initiation',
            'reit': 'Reiteration', 'main': 'Maintained'}.get(str(action).lower(), action)


def _consensus_label(mean: float | None) -> str:
    if mean is None:
        return 'N/A'
    if mean <= 1.5: return 'Strong Buy'
    if mean <= 2.5: return 'Buy'
    if mean <= 3.5: return 'Hold'
    if mean <= 4.5: return 'Sell'
    return 'Strong Sell'


def _fetch_analyst_ratings(sym: str) -> dict | None:
    cache_key = f"analyst:{sym}"
    cached = cache_get(cache_key, _ANALYST_TTL)
    if cached:
        return cached
    try:
        t       = yf.Ticker(sym)
        info    = {}
        try:
            info = t.info or {}
        except Exception:
            pass

        name         = info.get('longName') or info.get('shortName') or sym
        cur_price    = _safe_float(info.get('currentPrice') or info.get('regularMarketPrice'))
        target_mean  = _safe_float(info.get('targetMeanPrice'))
        target_high  = _safe_float(info.get('targetHighPrice'))
        target_low   = _safe_float(info.get('targetLowPrice'))
        target_med   = _safe_float(info.get('targetMedianPrice'))
        rec_mean     = _safe_float(info.get('recommendationMean'))
        rec_key      = info.get('recommendationKey')
        analyst_cnt  = info.get('numberOfAnalystOpinions')

        upside_pct = None
        if cur_price and target_mean and cur_price > 0:
            upside_pct = round((target_mean / cur_price - 1) * 100, 1)

        # Price history for computing post-rating returns
        hist = None
        try:
            h = t.history(period='6mo')
            h.index = h.index.tz_localize(None) if h.index.tzinfo else h.index
            hist = h['Close'].dropna()
        except Exception:
            pass

        # Upgrades / downgrades
        recent_changes: list[dict] = []
        upgrade_ct = downgrade_ct = init_ct = reit_ct = 0
        cutoff = pd.Timestamp.now() - pd.Timedelta(days=90)

        try:
            ud = t.upgrades_downgrades
            if ud is not None and not ud.empty:
                ud.index = ud.index.tz_localize(None) if ud.index.tzinfo else ud.index
                recent = ud[ud.index >= cutoff].sort_index(ascending=False)

                for dt, row in recent.iterrows():
                    action     = str(row.get('Action', '')).lower()
                    from_grade = str(row.get('FromGrade', '')) or None
                    to_grade   = str(row.get('ToGrade', ''))   or None
                    firm       = str(row.get('Firm', ''))

                    if action == 'up':   upgrade_ct   += 1
                    elif action == 'down': downgrade_ct += 1
                    elif action == 'init': init_ct      += 1
                    elif action in ('reit', 'main'): reit_ct += 1

                    # Price at rating date and 5-day return afterward
                    price_at   = None
                    ret_5d     = None
                    ret_since  = None
                    if hist is not None:
                        idx = hist.index.searchsorted(dt, side='left')
                        if 0 <= idx < len(hist):
                            price_at = round(float(hist.iloc[idx]), 2)
                            # 5-day return
                            if idx + 5 < len(hist):
                                ret_5d = round((float(hist.iloc[idx + 5]) / price_at - 1) * 100, 2)
                            # Return since rating to now
                            if cur_price and price_at:
                                ret_since = round((cur_price / price_at - 1) * 100, 2)

                    recent_changes.append({
                        'date':      str(dt.date()),
                        'firm':      firm,
                        'action':    action,
                        'actionLabel': _action_label(action),
                        'fromGrade': from_grade,
                        'toGrade':   to_grade,
                        'sentiment': _normalize_grade(to_grade),
                        'priceAt':   price_at,
                        'ret5d':     ret_5d,
                        'retSince':  ret_since,
                    })
        except Exception as exc:
            logger.warning('analyst upgrades %s: %s', sym, exc)

        result = {
            'symbol':      sym,
            'name':        name,
            'currentPrice': cur_price,
            'consensus': {
                'rating':     rec_key,
                'label':      _consensus_label(rec_mean),
                'mean':       rec_mean,
                'count':      analyst_cnt,
                'targetMean': target_mean,
                'targetHigh': target_high,
                'targetLow':  target_low,
                'targetMed':  target_med,
                'upsidePct':  upside_pct,
            },
            'recentChanges': recent_changes,
            'summary': {
                'upgrades':   upgrade_ct,
                'downgrades': downgrade_ct,
                'initiations': init_ct,
                'reiterations': reit_ct,
                'netSentiment': upgrade_ct - downgrade_ct,
                'totalChanges': len(recent_changes),
            },
        }
        cache_set(cache_key, result)
        return result
    except Exception as exc:
        logger.warning('analyst ratings %s: %s', sym, exc)
        return None


@app.get('/api/market/analyst-ratings')
def get_analyst_ratings(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(',') if s.strip()]
    if not syms:
        return []
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(syms), 6)) as pool:
        futures = {pool.submit(_fetch_analyst_ratings, sym): sym for sym in syms}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                results.append(r)
    results.sort(key=lambda x: -(x['summary'].get('totalChanges', 0)))
    return results


# ── EDGAR Fund Holdings Explorer ──────────────────────────────────────────────

_EDGAR_UA           = {'User-Agent': 'StockMonitor/1.0 raghuravuri@gmail.com'}
_EDGAR_SEARCH_TTL   = timedelta(hours=12)
_EDGAR_HOLDINGS_TTL = timedelta(hours=6)
_EDGAR_TICKERMAP_TTL = timedelta(hours=24)

_EDGAR_ASSET_CATS = {
    'EC': 'Equity', 'DBT': 'Debt', 'DERIV': 'Derivative',
    'OTH': 'Other', 'ABS': 'ABS', 'MBS': 'MBS',
    'STIV': 'Short-Term', 'RE': 'Real Estate',
}

# Filing types used by EDGAR for monthly portfolio reports (no hyphen variant is current)
_NPORT_FORMS = {'NPORT-P', 'N-PORT-P', 'NPORT-P/A', 'N-PORT-P/A', 'N-PORT', 'NPORT'}

_POPULAR_FUNDS = [
    {'ticker': 'SPY',  'name': 'SPDR S&P 500 ETF Trust',          'cik': '884394'},
    {'ticker': 'QQQ',  'name': 'Invesco QQQ Trust',                'cik': '1067839'},
    {'ticker': 'IVV',  'name': 'iShares Core S&P 500 ETF',         'cik': '1100663'},
    {'ticker': 'VTI',  'name': 'Vanguard Total Stock Market ETF',  'cik': '1075817'},
    {'ticker': 'ARKK', 'name': 'ARK Innovation ETF',               'cik': '1579982'},
    {'ticker': 'XLK',  'name': 'Technology Select Sector SPDR',    'cik': '1064642'},
    {'ticker': 'XLF',  'name': 'Financial Select Sector SPDR',     'cik': '1064641'},
    {'ticker': 'IWM',  'name': 'iShares Russell 2000 ETF',         'cik': '1100624'},
    {'ticker': 'GLD',  'name': 'SPDR Gold Shares',                 'cik': '1222333'},
    {'ticker': 'VOO',  'name': 'Vanguard S&P 500 ETF',             'cik': '1479240'},
]


def _edgar_req(url: str, timeout: int = 30) -> curl_requests.Response:
    return curl_requests.get(url, headers=_EDGAR_UA, timeout=timeout, impersonate='chrome')


def _localname_find(elem, localname: str):
    for child in elem:
        if child.tag.split('}')[-1] == localname:
            return child
    return None


def _localname_iter(root, localname: str):
    for el in root.iter():
        if el.tag.split('}')[-1] == localname:
            yield el


# ── Name → Ticker lookup (from SEC company_tickers_exchange.json) ─────────────

def _build_ticker_map() -> dict[str, str]:
    """Download SEC company ticker list and build normalized-name → ticker map."""
    cache_key = 'sec_ticker_name_map'
    cached = cache_get(cache_key, _EDGAR_TICKERMAP_TTL)
    if cached:
        return cached
    try:
        data   = _edgar_req('https://www.sec.gov/files/company_tickers_exchange.json').json()
        fields = data.get('fields', [])
        rows   = data.get('data', [])
        ni = fields.index('name')   if 'name'   in fields else 1
        ti = fields.index('ticker') if 'ticker' in fields else 2

        _STRIP_SUFFIXES = (
            ' INC.', ' INC', ' CORP.', ' CORP', ' CO.', ' CO',
            ' LTD.', ' LTD', ' LLC', ' LP', ' PLC', ' SA', ' AG',
            ' NV', ' SE', ' GROUP', ' HOLDINGS', ' HOLDING',
            ' TRUST', ' FUND', ' ETF', ' CLASS A', ' CLASS B', ' CLASS C',
        )

        ticker_map: dict[str, str] = {}
        for row in rows:
            if len(row) <= max(ni, ti):
                continue
            raw_name = str(row[ni]).strip()
            ticker   = str(row[ti]).strip().upper()
            if not raw_name or not ticker or len(ticker) > 6:
                continue
            # Store original normalized
            key = raw_name.upper().rstrip('.')
            ticker_map[key] = ticker
            # Strip suffixes progressively
            stripped = key
            for sfx in _STRIP_SUFFIXES:
                if stripped.endswith(sfx):
                    stripped = stripped[: -len(sfx)].rstrip(' ,')
            if stripped != key:
                ticker_map.setdefault(stripped, ticker)

        cache_set(cache_key, ticker_map)
        return ticker_map
    except Exception as exc:
        logger.warning('sec ticker map build: %s', exc)
        return {}


def _lookup_ticker_by_name(name: str, ticker_map: dict[str, str]) -> str | None:
    if not name or not ticker_map:
        return None
    _STRIP_SUFFIXES = (
        ' INC.', ' INC', ' CORP.', ' CORP', ' CO.', ' CO',
        ' LTD.', ' LTD', ' LLC', ' LP', ' PLC', ' SA', ' AG',
        ' NV', ' SE', ' GROUP', ' HOLDINGS', ' HOLDING',
        ' TRUST', ' FUND', ' ETF', ' CLASS A', ' CLASS B', ' CLASS C',
        ' THE',
    )
    key = name.upper().rstrip('.,')
    # Direct match
    if key in ticker_map:
        return ticker_map[key]
    # Strip common suffixes
    stripped = key
    for sfx in _STRIP_SUFFIXES:
        if stripped.endswith(sfx):
            stripped = stripped[: -len(sfx)].rstrip(' ,')
    if stripped in ticker_map:
        return ticker_map[stripped]
    return None


# ── EDGAR fund search ─────────────────────────────────────────────────────────

def _edgar_search_funds(query: str) -> list[dict]:
    cache_key = f"edgar_search:{query.lower().strip()}"
    cached = cache_get(cache_key, _EDGAR_SEARCH_TTL)
    if cached:
        return cached

    results: list[dict] = []
    seen: set[str] = set()
    q = query.strip()

    try:
        # 1) Try direct CIK/ticker search — works for known tickers like SPY, QQQ
        url_cik = (
            f"https://www.sec.gov/cgi-bin/browse-edgar"
            f"?company=&CIK={q}&type=NPORT-P&dateb=&owner=include&count=10"
            f"&search_text=&action=getcompany"
        )
        html_cik = _edgar_req(url_cik).text

        # When EDGAR finds one exact match it shows company details (no table row), extract CIK
        single = re.search(
            r'CIK[#\s]*:.*?CIK=0*(\d+)[^"]*">0*(\d+)\s*\(see all',
            html_cik, re.IGNORECASE | re.DOTALL
        )
        if single:
            cik = single.group(1)
            name_m = re.search(r'<span class="companyName">([^<]+)', html_cik)
            name = name_m.group(1).strip() if name_m else q.upper()
            # Strip the CIK# suffix that EDGAR appends
            name = re.sub(r'\s*CIK.*', '', name).strip()
            if cik not in seen:
                seen.add(cik)
                results.append({'cik': cik, 'name': name})
        else:
            # Multiple results in tableFile2
            rows = re.findall(
                r'CIK=0*(\d+)[^"]*">\s*0*\1\s*</a>\s*</td>\s*<td[^>]*>\s*<a[^>]+>([^<]+)</a>',
                html_cik, re.IGNORECASE
            )
            for cik, name in rows[:8]:
                if cik not in seen:
                    seen.add(cik)
                    results.append({'cik': cik, 'name': name.strip()})

        # 2) Company name search (catches fund families like "iShares", "Vanguard")
        if not results or len(results) < 3:
            url_name = (
                f"https://www.sec.gov/cgi-bin/browse-edgar"
                f"?company={q.replace(' ', '+')}&CIK=&type=NPORT-P&dateb=&owner=include&count=15"
                f"&search_text=&action=getcompany"
            )
            html_name = _edgar_req(url_name).text
            rows2 = re.findall(
                r'CIK=0*(\d+)[^"]*">\s*0*\1\s*</a>\s*</td>\s*<td[^>]*>\s*<a[^>]+>([^<]+)</a>',
                html_name, re.IGNORECASE
            )
            for cik, name in rows2[:10]:
                if cik not in seen:
                    seen.add(cik)
                    results.append({'cik': cik, 'name': name.strip()})

    except Exception as exc:
        logger.warning('edgar fund search %s: %s', q, exc)

    cache_set(cache_key, results[:15])
    return results[:15]


# ── Latest N-PORT filing ──────────────────────────────────────────────────────

def _edgar_latest_nport(cik: str):
    """Return (accession, period, entity_name) for the latest NPORT-P filing."""
    try:
        padded = cik.zfill(10)
        data = _edgar_req(f"https://data.sec.gov/submissions/CIK{padded}.json").json()
        entity_name = data.get('name', '')

        filings = data.get('filings', {}).get('recent', {})
        forms   = filings.get('form', [])
        accnums = filings.get('accessionNumber', [])
        periods = filings.get('reportDate', [])
        dates   = filings.get('filingDate', [])

        for i, form in enumerate(forms):
            if form.upper() in _NPORT_FORMS:
                acc    = accnums[i] if i < len(accnums) else ''
                period = (periods[i] if i < len(periods) and periods[i]
                          else dates[i][:10] if i < len(dates) else '')
                return acc, period, entity_name
        return None
    except Exception as exc:
        logger.warning('edgar submissions %s: %s', cik, exc)
        return None


def _edgar_filing_xml(cik: str, accession: str) -> str | None:
    """Download the raw N-PORT XML from EDGAR."""
    try:
        acc_nodash = accession.replace('-', '')
        base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc_nodash}"

        # The raw XML is always primary_doc.xml at the accession root,
        # even when submissions.json lists an XSL subdirectory path.
        for filename in ('primary_doc.xml', 'form.xml', 'nport.xml'):
            try:
                resp = _edgar_req(f"{base}/{filename}", timeout=90)
                if resp.status_code == 200 and resp.text.strip().startswith('<'):
                    return resp.text
            except Exception:
                continue

        # Fallback: parse filing index for any .xml link
        idx = _edgar_req(f"{base}/{accession}-index.htm", timeout=30)
        links = re.findall(r'href="(/Archives/edgar/data/\d+/[^"]+\.xml)"', idx.text, re.I)
        for link in links:
            try:
                r = _edgar_req(f"https://www.sec.gov{link}", timeout=90)
                if r.status_code == 200 and r.text.strip().startswith('<'):
                    return r.text
            except Exception:
                continue
        return None
    except Exception as exc:
        logger.warning('edgar xml %s/%s: %s', cik, accession, exc)
        return None


def _parse_nport_xml(xml_text: str, ticker_map: dict) -> tuple[dict, list[dict]]:
    """Parse N-PORT XML; enrich holding tickers via name lookup."""
    fund_info: dict = {'netAssets': None, 'totAssets': None, 'seriesName': None, 'period': None}
    holdings: list[dict] = []

    try:
        root = ET.fromstring(xml_text)

        # Fund-level metadata
        for tag, key in [('seriesName', 'seriesName'), ('regName', 'seriesName'),
                         ('repPdDate', 'period'), ('totAssets', 'totAssets'),
                         ('netAssets', 'netAssets')]:
            for el in _localname_iter(root, tag):
                val = el.text.strip() if el.text else None
                if not val or val == 'N/A':
                    break
                if key in ('totAssets', 'netAssets'):
                    fund_info[key] = _safe_float(val)
                elif not fund_info.get(key):
                    fund_info[key] = val
                break

        # Holdings — each <invstOrSec> element
        for sec in _localname_iter(root, 'invstOrSec'):
            def _txt(lname):
                el = _localname_find(sec, lname)
                return el.text.strip() if el is not None and el.text else None

            name = _txt('name')
            if not name:
                continue

            pct_val  = _safe_float(_txt('pctVal'))
            # N-PORT uses valUSD for USD fair value; older forms used fairValAmt
            fair_val = _safe_float(_txt('valUSD') or _txt('fairValAmt'))
            asset_cat = _txt('assetCat') or 'OTH'
            country  = _txt('invCountry')
            cusip    = _txt('cusip')

            # Extract ISIN from <identifiers>
            isin = None
            ident_el = _localname_find(sec, 'identifiers')
            if ident_el is not None:
                for child in ident_el:
                    ltag = child.tag.split('}')[-1]
                    if ltag == 'isin':
                        isin = child.get('value') or (child.text.strip() if child.text else None)
                    # Some older filings have <ticker value="...">
                    # (rare in modern N-PORT but keep for compatibility)

            # Derive ticker: try name lookup in SEC ticker map
            ticker = _lookup_ticker_by_name(name, ticker_map)

            holdings.append({
                'name':       name,
                'ticker':     ticker,
                'cusip':      cusip,
                'isin':       isin,
                'weight':     round(pct_val, 4) if pct_val is not None else None,
                'fairValue':  round(fair_val, 2) if fair_val is not None else None,
                'assetCat':   _EDGAR_ASSET_CATS.get(asset_cat, asset_cat),
                'country':    country,
                'price':      None,
                'high52w':    None,
                'low52w':     None,
                'perf1m':     None,
                'perf3m':     None,
                'perf6m':     None,
                'perf1y':     None,
                'pctFromHigh': None,
            })

    except Exception as exc:
        logger.warning('nport xml parse: %s', exc)

    holdings.sort(key=lambda h: -(h['weight'] or 0))
    return fund_info, holdings


def _enrich_edgar_holding(h: dict) -> None:
    ticker = (h.get('ticker') or '').strip().upper()
    if not ticker or len(ticker) > 6 or not ticker.replace('.', '').isalpha():
        return
    try:
        t  = yf.Ticker(ticker)
        fi = t.fast_info
        price   = _safe_float(getattr(fi, 'last_price', None))
        high52w = _safe_float(getattr(fi, 'year_high', None))
        low52w  = _safe_float(getattr(fi, 'year_low', None))
        if not price:
            return
        h['price']   = round(price, 2)
        h['high52w'] = round(high52w, 2) if high52w else None
        h['low52w']  = round(low52w,  2) if low52w  else None
        if high52w and price:
            h['pctFromHigh'] = round((price / high52w - 1) * 100, 1)
        hist = t.history(period='1y')
        if hist.empty:
            return
        hist.index = hist.index.tz_localize(None) if hist.index.tzinfo else hist.index
        closes = hist['Close'].dropna()
        n = len(closes)
        def _ret(days: int):
            idx = max(0, n - days - 1)
            ref = float(closes.iloc[idx])
            return round((price / ref - 1) * 100, 1) if ref else None
        h['perf1m'] = _ret(21)
        h['perf3m'] = _ret(63)
        h['perf6m'] = _ret(126)
        h['perf1y'] = _ret(252)
    except Exception:
        pass


@app.get('/api/edgar/fund-search')
def edgar_fund_search(q: str = ''):
    if not q.strip():
        return []
    return _edgar_search_funds(q.strip())


@app.get('/api/edgar/fund-holdings')
def edgar_fund_holdings(cik: str, enrich: int = 50):
    cache_key = f"edgar_holdings2:{cik}:{enrich}"
    cached = cache_get(cache_key, _EDGAR_HOLDINGS_TTL)
    if cached:
        return cached

    nport = _edgar_latest_nport(cik)
    if not nport:
        raise HTTPException(404, 'No NPORT-P filing found for this CIK')

    accession, period, entity_name = nport
    xml_text = _edgar_filing_xml(cik, accession)
    if not xml_text:
        raise HTTPException(502, 'Could not retrieve N-PORT XML from EDGAR')

    # Build name→ticker map once (cached 24h)
    ticker_map = _build_ticker_map()

    fund_info, holdings = _parse_nport_xml(xml_text, ticker_map)
    if not fund_info.get('period'):
        fund_info['period'] = period
    if not fund_info.get('seriesName'):
        fund_info['seriesName'] = entity_name

    # Enrich top N holdings that resolved a ticker
    to_enrich = [h for h in holdings if h.get('ticker')][:max(1, enrich)]
    with ThreadPoolExecutor(max_workers=10) as pool:
        futs = [pool.submit(_enrich_edgar_holding, h) for h in to_enrich]
        for f in as_completed(futs):
            f.result()

    result = {
        'fund':         fund_info,
        'cik':          cik,
        'accession':    accession,
        'holdings':     holdings,
        'holdingCount': len(holdings),
    }
    cache_set(cache_key, result)
    return result


@app.get('/api/edgar/popular-funds')
def edgar_popular_funds():
    return _POPULAR_FUNDS


# ── Correlation Matrix ────────────────────────────────────────────────────────

_CORR_TTL = timedelta(hours=1)


@app.get("/api/market/correlation")
def get_correlation(symbols: str, period: str = "3mo"):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if len(syms) < 2:
        raise HTTPException(400, "Need at least 2 symbols")
    cache_key = f"corr:{'_'.join(sorted(syms))}:{period}"
    cached = cache_get(cache_key, _CORR_TTL)
    if cached:
        return cached

    valid_periods = {"1mo", "3mo", "6mo", "1y", "2y"}
    if period not in valid_periods:
        period = "3mo"

    try:
        price_data: dict[str, pd.Series] = {}
        errors: list[str] = []

        def _fetch_close(sym: str):
            try:
                hist = yf.Ticker(sym).history(period=period)
                if hist.empty:
                    return sym, None
                closes = hist["Close"].dropna()
                if len(closes) < 10:
                    return sym, None
                return sym, closes
            except Exception:
                return sym, None

        with ThreadPoolExecutor(max_workers=min(len(syms), 8)) as pool:
            for sym, closes in pool.map(_fetch_close, syms):
                if closes is not None:
                    price_data[sym] = closes
                else:
                    errors.append(sym)

        if len(price_data) < 2:
            raise HTTPException(400, "Insufficient data for correlation")

        df = pd.DataFrame(price_data).dropna()
        returns = df.pct_change().dropna()
        corr = returns.corr()

        used_syms = list(corr.columns)
        matrix = []
        for sym_a in used_syms:
            row = []
            for sym_b in used_syms:
                val = corr.loc[sym_a, sym_b]
                row.append(round(float(val), 4) if not pd.isna(val) else None)
            matrix.append(row)

        result = {"symbols": used_syms, "matrix": matrix, "period": period, "errors": errors}
        cache_set(cache_key, result)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Correlation: %s", exc)
        raise HTTPException(500, str(exc))


# ── Seasonal Patterns ─────────────────────────────────────────────────────────

_SEASONAL_TTL = timedelta(hours=24)
_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@app.get("/api/market/seasonal")
def get_seasonal(symbol: str, years: int = 10):
    sym = symbol.strip().upper()
    cache_key = f"seasonal:{sym}:{years}"
    cached = cache_get(cache_key, _SEASONAL_TTL)
    if cached:
        return cached

    try:
        t = yf.Ticker(sym)
        hist = t.history(period=f"{years}y")
        if hist.empty or len(hist) < 100:
            raise HTTPException(404, f"Insufficient history for {sym}")

        info = t.fast_info
        name = getattr(info, "exchange", None)
        try:
            name = t.info.get("longName") or t.info.get("shortName") or sym
        except Exception:
            name = sym

        hist = hist[["Close"]].copy()
        hist.index = hist.index.tz_localize(None) if hist.index.tzinfo else hist.index
        hist["year"]  = hist.index.year
        hist["month"] = hist.index.month

        month_data: dict[int, list[float]] = {m: [] for m in range(1, 13)}

        for (yr, mo), grp in hist.groupby(["year", "month"]):
            if len(grp) < 5:
                continue
            open_px  = float(grp["Close"].iloc[0])
            close_px = float(grp["Close"].iloc[-1])
            if open_px > 0:
                ret = (close_px / open_px - 1) * 100
                month_data[mo].append(round(ret, 2))

        months = []
        for m in range(1, 13):
            rets = month_data[m]
            if not rets:
                months.append({"month": m, "name": _MONTH_NAMES[m - 1],
                               "avgReturn": None, "winRate": None,
                               "best": None, "worst": None, "years": 0, "returns": []})
                continue
            avg = round(sum(rets) / len(rets), 2)
            win = round(sum(1 for r in rets if r > 0) / len(rets) * 100)
            months.append({
                "month":     m,
                "name":      _MONTH_NAMES[m - 1],
                "avgReturn": avg,
                "winRate":   win,
                "best":      round(max(rets), 2),
                "worst":     round(min(rets), 2),
                "years":     len(rets),
                "returns":   rets,
            })

        valid = [mo for mo in months if mo["avgReturn"] is not None]
        best_mo  = max(valid, key=lambda x: x["avgReturn"]) if valid else None
        worst_mo = min(valid, key=lambda x: x["avgReturn"]) if valid else None

        result = {
            "symbol":   sym,
            "name":     name,
            "months":   months,
            "bestMonth":  best_mo["month"] if best_mo else None,
            "worstMonth": worst_mo["month"] if worst_mo else None,
            "yearsOfData": years,
        }
        cache_set(cache_key, result)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Seasonal %s: %s", sym, exc)
        raise HTTPException(500, str(exc))


# ── ETF Overlap Analyzer ──────────────────────────────────────────────────────

_ETF_OVERLAP_TTL = timedelta(hours=24)


def _fetch_etf_holdings(sym: str) -> dict | None:
    cache_key = f"etfhold:{sym}"
    cached = cache_get(cache_key, _ETF_OVERLAP_TTL)
    if cached:
        return cached
    try:
        t = yf.Ticker(sym)
        info = {}
        try:
            info = t.info or {}
        except Exception:
            pass

        name = info.get("longName") or info.get("shortName") or sym
        holdings_list: list[dict] = []

        try:
            fd = t.get_funds_data()
            if fd is not None and hasattr(fd, "top_holdings"):
                th = fd.top_holdings
                if th is not None and not th.empty:
                    for idx, row in th.iterrows():
                        ticker_sym = str(idx) if idx else None
                        pct = None
                        for col in ["holdingPercent", "Holding Percent", "value"]:
                            if col in row and row[col] is not None:
                                try:
                                    pct = float(row[col]) * 100
                                    break
                                except Exception:
                                    pass
                        holding_name = None
                        for col in ["holdingName", "Holding Name", "name"]:
                            if col in row:
                                holding_name = str(row[col])
                                break
                        if ticker_sym and pct is not None:
                            holdings_list.append({
                                "symbol": ticker_sym.upper(),
                                "name":   holding_name or ticker_sym,
                                "weight": round(pct, 4),
                            })
        except Exception:
            pass

        if not holdings_list:
            try:
                th = t.funds_data.top_holdings if hasattr(t, "funds_data") else None
                if th is not None and not th.empty:
                    for idx, row in th.iterrows():
                        ticker_sym = str(idx) if idx else None
                        pct = None
                        try:
                            pct = float(row.iloc[0]) * 100
                        except Exception:
                            pass
                        if ticker_sym and pct is not None:
                            holdings_list.append({
                                "symbol": ticker_sym.upper(),
                                "name":   ticker_sym,
                                "weight": round(pct, 4),
                            })
            except Exception:
                pass

        result = {"symbol": sym, "name": name, "holdings": holdings_list}
        cache_set(cache_key, result)
        return result
    except Exception as exc:
        logger.warning("ETF holdings %s: %s", sym, exc)
        return None


@app.get("/api/market/etf-overlap")
def get_etf_overlap(tickers: str):
    syms = [s.strip().upper() for s in tickers.split(",") if s.strip()][:4]
    if len(syms) < 2:
        raise HTTPException(400, "Need at least 2 ETF tickers")

    cache_key = f"etfoverlap:{'_'.join(sorted(syms))}"
    cached = cache_get(cache_key, _ETF_OVERLAP_TTL)
    if cached:
        return cached

    etf_data: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(syms), 4)) as pool:
        futures = {pool.submit(_fetch_etf_holdings, sym): sym for sym in syms}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                etf_data.append(r)

    etf_data.sort(key=lambda x: syms.index(x["symbol"]) if x["symbol"] in syms else 99)

    holding_map: dict[str, dict] = {}
    for etf in etf_data:
        for h in etf.get("holdings", []):
            hs = h["symbol"]
            if hs not in holding_map:
                holding_map[hs] = {"symbol": hs, "name": h["name"], "appearsIn": [], "weights": {}}
            holding_map[hs]["appearsIn"].append(etf["symbol"])
            holding_map[hs]["weights"][etf["symbol"]] = h["weight"]

    all_holdings = list(holding_map.values())
    overlap = [h for h in all_holdings if len(h["appearsIn"]) >= 2]
    overlap.sort(key=lambda x: -sum(x["weights"].values()))

    result = {
        "etfs":    etf_data,
        "overlap": overlap[:50],
        "allHoldings": all_holdings,
        "overlapCount": len(overlap),
    }
    cache_set(cache_key, result)
    return result


# ── Relative Strength Ranker ──────────────────────────────────────────────────

_RS_TTL = timedelta(minutes=30)


@app.get("/api/market/relative-strength")
def get_relative_strength(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []

    all_syms = list(dict.fromkeys(syms + ["SPY"]))
    cache_key = f"rs:{'_'.join(sorted(syms))}"
    cached = cache_get(cache_key, _RS_TTL)
    if cached:
        return cached

    def _fetch_rs_data(sym: str):
        try:
            hist = yf.Ticker(sym).history(period="1y")
            if hist.empty or len(hist) < 20:
                return sym, None
            closes = hist["Close"].dropna()
            return sym, closes
        except Exception:
            return sym, None

    price_map: dict[str, pd.Series] = {}
    with ThreadPoolExecutor(max_workers=min(len(all_syms), 8)) as pool:
        for sym, closes in pool.map(_fetch_rs_data, all_syms):
            if closes is not None:
                price_map[sym] = closes

    spy_closes = price_map.get("SPY")
    if spy_closes is None:
        return []

    def _period_return(closes: pd.Series, days: int) -> float | None:
        if len(closes) < days + 1:
            return None
        end   = float(closes.iloc[-1])
        start = float(closes.iloc[-days - 1])
        return round((end / start - 1) * 100, 2) if start else None

    def _rs_ratio(stock_ret: float | None, spy_ret: float | None) -> float | None:
        if stock_ret is None or spy_ret is None:
            return None
        if spy_ret == 0:
            return None
        return round(stock_ret / abs(spy_ret) if spy_ret < 0 else stock_ret / spy_ret, 3)

    PERIODS = [(5, "rs1w"), (21, "rs1m"), (63, "rs3m"), (126, "rs6m"), (252, "rs1y")]
    spy_rets = {label: _period_return(spy_closes, days) for days, label in PERIODS}

    results = []
    for sym in syms:
        closes = price_map.get(sym)
        if closes is None:
            continue
        try:
            t = yf.Ticker(sym)
            info = {}
            try:
                fi = t.fast_info
                price = _safe_float(getattr(fi, "last_price", None))
            except Exception:
                price = None
            try:
                info = t.info or {}
            except Exception:
                pass
            name   = info.get("longName") or info.get("shortName") or sym
            sector = info.get("sector")

            row: dict = {"symbol": sym, "name": name, "sector": sector, "price": price}
            composite_parts = []
            for days, label in PERIODS:
                sr = _period_return(closes, days)
                rs = _rs_ratio(sr, spy_rets[label])
                row[label.replace("rs", "ret")] = sr
                row[label] = rs
                if rs is not None:
                    composite_parts.append(rs)

            row["composite"] = round(sum(composite_parts) / len(composite_parts), 3) if composite_parts else None
            results.append(row)
        except Exception as exc:
            logger.warning("RS %s: %s", sym, exc)

    results.sort(key=lambda x: -(x.get("composite") or 0))
    cache_set(cache_key, results)
    return results


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}
