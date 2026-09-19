from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import List
import pandas as pd
import yfinance as yf
import yfinance.screener.screener as yf_screener
import logging
import json
import os
from anthropic import Anthropic
from dotenv import load_dotenv
load_dotenv()

from database import (
    init_db, migrate_db, db_session, cache_get, cache_set,
    PortfolioPosition,
)
# Shared SEC EDGAR helpers, split out so both main.py and routers/ can import
# them without a circular dependency — see edgar_utils.py's module docstring.
from edgar_utils import (
    _session, _safe_float, _finite_or_none, _edgar_req, _TICKER_RE,
)
from routers import (
    corporate_bonds, convertible_bonds, treasury as treasury_router,
    merger_arb, spacs, fund_holdings, cppi, net_exposure,
    activist_tracker, reddit_trending, seasonal_patterns, etf_overlap,
    relative_strength, chart, news, analyst_history,
    earnings_calendar, portfolio_risk_data, price_alerts, portfolio_performance,
    earnings_history, premarket_movers, trade_journal, economic_calendar,
    institutional_ownership, backtester, csv_export_import, sec_filings,
    unusual_options, portfolio_equity_curve, earnings_play_calculator,
    nlp_screener, watchlist, portfolio, ai_chat, financial_advisor,
    custom_screener, technical_signals, options_strategy_builder,
    trade_idea_generator, portfolio_risk_dashboard,
    position_sizing, portfolio_optimizer, rich_earnings_calendar,
    options_pnl_tracker, portfolio_xray, sector_momentum, market_breadth,
    fundamental_comparison, price_target_tracker, earnings_call_summarizer,
    dcf_valuation, yield_curve,
    ai_stocks, ai_analyst_actions, day_trader_scanners, screener,
    options_chain, dividends, correlation_matrix, sector_rotation,
    websocket_quotes, smart_alerts,
    insider_transactions, analyst_ratings, insider_trading_feed,
    analyst_rating_tracker,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Stock Monitor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(corporate_bonds.router)
app.include_router(convertible_bonds.router)
app.include_router(treasury_router.router)
app.include_router(merger_arb.router)
app.include_router(spacs.router)
app.include_router(fund_holdings.router)
app.include_router(cppi.router)
app.include_router(net_exposure.router)
app.include_router(activist_tracker.router)
app.include_router(reddit_trending.router)
app.include_router(seasonal_patterns.router)
app.include_router(etf_overlap.router)
app.include_router(relative_strength.router)
app.include_router(chart.router)
app.include_router(news.router)
app.include_router(analyst_history.router)
app.include_router(earnings_calendar.router)
app.include_router(portfolio_risk_data.router)
app.include_router(price_alerts.router)
app.include_router(portfolio_performance.router)
app.include_router(earnings_history.router)
app.include_router(premarket_movers.router)
app.include_router(trade_journal.router)
app.include_router(economic_calendar.router)
app.include_router(institutional_ownership.router)
app.include_router(backtester.router)
app.include_router(csv_export_import.router)
app.include_router(sec_filings.router)
app.include_router(unusual_options.router)
app.include_router(portfolio_equity_curve.router)
app.include_router(earnings_play_calculator.router)
app.include_router(nlp_screener.router)
app.include_router(watchlist.router)
app.include_router(portfolio.router)
app.include_router(ai_chat.router)
app.include_router(financial_advisor.router)
app.include_router(custom_screener.router)
app.include_router(technical_signals.router)
app.include_router(options_strategy_builder.router)
app.include_router(trade_idea_generator.router)
app.include_router(portfolio_risk_dashboard.router)
app.include_router(position_sizing.router)
app.include_router(portfolio_optimizer.router)
app.include_router(rich_earnings_calendar.router)
app.include_router(options_pnl_tracker.router)
app.include_router(portfolio_xray.router)
app.include_router(sector_momentum.router)
app.include_router(market_breadth.router)
app.include_router(fundamental_comparison.router)
app.include_router(price_target_tracker.router)
app.include_router(earnings_call_summarizer.router)
app.include_router(dcf_valuation.router)
app.include_router(yield_curve.router)
app.include_router(ai_stocks.router)
app.include_router(ai_analyst_actions.router)
app.include_router(day_trader_scanners.router)
app.include_router(screener.router)
app.include_router(options_chain.router)
app.include_router(dividends.router)
app.include_router(correlation_matrix.router)
app.include_router(sector_rotation.router)
app.include_router(websocket_quotes.router)
app.include_router(smart_alerts.router)
app.include_router(insider_transactions.router)
app.include_router(analyst_ratings.router)
app.include_router(insider_trading_feed.router)
app.include_router(analyst_rating_tracker.router)

# Initialise DB tables on startup
init_db()
migrate_db()

# ── TTLs ──────────────────────────────────────────────────────────────────────
# _CHART_TTL and _NEWS_TTL moved to routers/chart.py and routers/news.py —
# each was only ever used by its own section despite living in this shared
# block.
_FUND_TTL    = timedelta(minutes=5)
_MARKET_TTL  = timedelta(minutes=15)
_PERF_TTL    = timedelta(minutes=15)


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
        # An in-progress/incomplete session (e.g. mid-trading-day) can leave
        # today's Close as NaN — drop it so .iloc[-1] never lands on NaN and
        # leaks into JSON (Starlette rejects a bare NaN).
        closes = hist["Close"].dropna()
        if len(closes) < 2:
            return {"symbol": sym}
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
#
# Live EDGAR-sourced (previously a hand-maintained static list, which meant it
# silently went stale). 424B4 = final prospectus filed at pricing -> feeds the
# lockup tracker below. S-1 = registration filed pre-pricing -> the "not yet
# priced" pipeline in ipo_pipeline(). SPACs are excluded (SIC 6770 / name
# pattern) since they're covered by their own Discovery feed.

_IPO_TTL = timedelta(hours=1)
_LOCKUP_DAYS = 180  # standard underwriting lockup; not disclosed in EDGAR full-text search metadata

_SIC_SECTOR_RANGES = (
    (2800, 2836, 'Healthcare / Biotech'), (8000, 8099, 'Healthcare / Biotech'),
    (3570, 3579, 'Technology'), (3600, 3699, 'Technology'), (7370, 7379, 'Technology'),
    (6000, 6299, 'Financials'), (6300, 6499, 'Insurance'), (6500, 6599, 'Real Estate'),
    (4800, 4899, 'Communications / Media'), (4900, 4999, 'Utilities'),
    (1000, 1499, 'Energy / Mining'), (2900, 2999, 'Energy / Mining'),
    (4000, 4799, 'Transportation'),
    (2000, 2799, 'Consumer'), (5000, 5999, 'Consumer'),
    (3000, 3999, 'Industrials'),
)


def _sic_to_sector(sic: str | None) -> str:
    try:
        code = int(sic)
    except (TypeError, ValueError):
        return 'Other'
    for lo, hi, label in _SIC_SECTOR_RANGES:
        if lo <= code <= hi:
            return label
    return 'Other'


def _is_likely_spac(name: str, sic: str | None) -> bool:
    if sic == '6770':
        return True
    n = (name or '').upper()
    return 'ACQUISITION CORP' in n or 'ACQUISITION CO' in n or 'BLANK CHECK' in n


def _edgar_ipo_scan(form: str, days_back: int) -> list[dict]:
    from datetime import date as _date
    today_str = _date.today().strftime('%Y-%m-%d')
    cutoff = (_date.today() - pd.Timedelta(days=days_back)).strftime('%Y-%m-%d')
    out = []
    try:
        url = (
            f"https://efts.sec.gov/LATEST/search-index"
            f"?q=&forms={form}&dateRange=custom&startdt={cutoff}&enddt={today_str}"
        )
        resp = _edgar_req(url).json()
        for h in resp.get('hits', {}).get('hits', [])[:100]:
            src = h.get('_source', {})
            display = (src.get('display_names') or [''])[0]
            sic = (src.get('sics') or [None])[0]
            m = _TICKER_RE.search(display)
            ticker = m.group(1).split(',')[0].strip() if m else None
            name = display.split('  (')[0].strip() if display else src.get('entity_name', '')
            if _is_likely_spac(name, sic):
                continue
            out.append({
                'accession': src.get('adsh') or h.get('_id', '').split(':')[0],
                'ticker':    ticker,
                'company':   name,
                'sector':    _sic_to_sector(sic),
                'fileDate':  src.get('file_date', ''),
                'cik':       (src.get('ciks') or [''])[0],
                'formType':  src.get('form', form),
            })
    except Exception as exc:
        logger.warning('ipo scan %s: %s', form, exc)
    return out


def _fetch_ipo_reference_price(ticker: str, ipo_date: str) -> dict:
    """First trading day's open (proxy for offer price) plus current price."""
    try:
        t = yf.Ticker(ticker)
        start = datetime.strptime(ipo_date, '%Y-%m-%d').date()
        hist = t.history(start=start.isoformat(), end=(start + timedelta(days=10)).isoformat())
        if hist.empty:
            return {}
        ref_price = _finite_or_none(round(float(hist['Open'].iloc[0]), 2))
        current = yf.Ticker(ticker).fast_info
        current_price = _finite_or_none(_safe_float(getattr(current, 'last_price', None)))
        return {'ipoPrice': ref_price, 'currentPrice': current_price}
    except Exception:
        return {}


@app.get("/api/market/ipo-calendar")
def ipo_calendar():
    """Recently-priced IPOs (from 424B4 filings) with a live lockup-expiration
    countdown. ipoPrice is the first trading day's open (a proxy -- the actual
    underwriting offer price isn't in EDGAR's full-text search metadata)."""
    cache_key = "market:ipo-calendar:v2"
    cached = cache_get(cache_key, _IPO_TTL)
    if cached is not None:
        return cached

    today = datetime.utcnow().date()
    # Look back far enough to still catch lockups expiring soon after pricing this long ago.
    filings = [f for f in _edgar_ipo_scan('424B4', days_back=_LOCKUP_DAYS + 45) if f['ticker']]

    tickers = sorted({f['ticker'] for f in filings})
    quotes = {}
    if tickers:
        with ThreadPoolExecutor(max_workers=min(len(tickers), 10)) as pool:
            futures = {pool.submit(_fetch_ipo_reference_price, f['ticker'], f['fileDate']): f['ticker'] for f in filings}
            for fut in as_completed(futures):
                t = futures[fut]
                try:
                    quotes[t] = fut.result()
                except Exception:
                    pass

    results = []
    for f in filings:
        q = quotes.get(f['ticker'], {})
        ipo_price = q.get('ipoPrice')
        current_price = q.get('currentPrice')
        if ipo_price is None or current_price is None:
            continue  # can't build a meaningful row without a price anchor
        ipo_date = datetime.strptime(f['fileDate'], '%Y-%m-%d').date()
        lockup_date = ipo_date + timedelta(days=_LOCKUP_DAYS)
        days_to_lockup = (lockup_date - today).days
        perf_pct = round((current_price - ipo_price) / ipo_price * 100, 1) if ipo_price else None

        results.append({
            "symbol":        f['ticker'],
            "company":       f['company'],
            "sector":        f['sector'],
            "ipoDate":       f['fileDate'],
            "ipoPrice":      ipo_price,
            "currentPrice":  current_price,
            "perfPct":       perf_pct,
            "lockupDate":    lockup_date.isoformat(),
            "daysSinceIpo":  (today - ipo_date).days,
            "daysToLockup":  days_to_lockup,
            "lockupExpired": days_to_lockup < 0,
        })

    results.sort(key=lambda x: x["daysToLockup"] if x["daysToLockup"] >= 0 else 999999)
    cache_set(cache_key, results)
    return results


@app.get("/api/market/ipo-pipeline")
def ipo_pipeline():
    """Companies that have filed to go public (S-1) but haven't priced yet --
    the forward-looking counterpart to the lockup tracker above."""
    cache_key = "market:ipo-pipeline"
    cached = cache_get(cache_key, _IPO_TTL)
    if cached is not None:
        return cached

    filings = _edgar_ipo_scan('S-1', days_back=60)
    # Dedupe by CIK, keeping the most recent filing (S-1/A amendments common).
    by_cik = {}
    for f in filings:
        cik = f['cik']
        if cik not in by_cik or f['fileDate'] > by_cik[cik]['fileDate']:
            by_cik[cik] = f
    results = sorted(by_cik.values(), key=lambda f: f['fileDate'], reverse=True)

    for r in results:
        r['edgarUrl'] = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=&State=0&SIC=&dateb=&owner=include&count=1&search_text=&accession={r['accession'].replace('-', '')}"

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


# ── Correlation Matrix ────────────────────────────────────────────────────────

_CORR_TTL = timedelta(hours=1)


@app.get("/api/market/correlation")
def get_market_correlation(symbols: str, period: str = "3mo"):
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


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ── Serve React build (production) ────────────────────────────────────────────
# In dev, Vite runs separately and proxies /api to this server.
# In production on Render, FastAPI serves the built frontend files.

_FRONTEND_DIST = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'dist')

if os.path.isdir(_FRONTEND_DIST):
    app.mount('/assets', StaticFiles(directory=os.path.join(_FRONTEND_DIST, 'assets')), name='assets')

    @app.get('/{full_path:path}', include_in_schema=False)
    def serve_react(full_path: str):
        # Let all non-API routes fall through to index.html for React Router
        index = os.path.join(_FRONTEND_DIST, 'index.html')
        return FileResponse(index)
