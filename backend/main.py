from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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
    WatchlistSymbol, PortfolioPosition, PriceAlert, TradeJournalEntry,
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


@app.get("/api/watchlist")
def get_watchlist():
    with db_session() as db:
        rows = db.query(WatchlistSymbol).order_by(WatchlistSymbol.added_at).all()
        return [r.symbol for r in rows]


@app.post("/api/watchlist", status_code=201)
def add_to_watchlist(body: SymbolIn):
    sym = body.symbol.strip().upper()
    if not sym:
        raise HTTPException(400, "Symbol required")
    with db_session() as db:
        exists = db.query(WatchlistSymbol).filter(WatchlistSymbol.symbol == sym).first()
        if exists:
            return {"symbol": sym}
        db.add(WatchlistSymbol(symbol=sym))
    return {"symbol": sym}


@app.delete("/api/watchlist/{symbol}", status_code=204)
def remove_from_watchlist(symbol: str):
    symbol = symbol.upper()
    with db_session() as db:
        row = db.query(WatchlistSymbol).filter(WatchlistSymbol.symbol == symbol).first()
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


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}
