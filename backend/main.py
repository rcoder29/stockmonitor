from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import yfinance as yf
import yfinance.screener.screener as yf_screener
import logging
import os
from dotenv import load_dotenv
load_dotenv()

from database import (
    init_db, migrate_db, cache_get, cache_set,
)
# Shared SEC EDGAR helpers, split out so both main.py and routers/ can import
# them without a circular dependency — see edgar_utils.py's module docstring.
from edgar_utils import (
    _session, _safe_float,
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
    ai_news_sentiment, news_sentiment_engine, custom_news_feed,
    market_sentiment_dashboard,
    index_constituents, tax_advisor, short_squeeze_scanner,
    ipo_lockup_calendar, fed_watch, ai_morning_briefing, crypto_dashboard,
    ai_portfolio_review, economic_dashboard, ai_stock_analyzer,
    dividend_tracker, watchlist_heatmap, earnings_surprise_tracker,
    earnings_strategy_analyzer, market_correlation, digest, range_screener,
)
import digest_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app):
    # Background thread that sends the scheduled daily/weekly digests. Only runs
    # under a real server (TestClient without a `with` block never enters the
    # lifespan); DIGEST_SCHEDULER=0 disables it.
    digest_service.start_scheduler()
    yield
    digest_service.stop_scheduler()


app = FastAPI(title="Stock Monitor API", lifespan=lifespan)

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
app.include_router(ai_news_sentiment.router)
app.include_router(news_sentiment_engine.router)
app.include_router(custom_news_feed.router)
app.include_router(market_sentiment_dashboard.router)
app.include_router(index_constituents.router)
app.include_router(tax_advisor.router)
app.include_router(short_squeeze_scanner.router)
app.include_router(ipo_lockup_calendar.router)
app.include_router(fed_watch.router)
app.include_router(ai_morning_briefing.router)
app.include_router(crypto_dashboard.router)
app.include_router(ai_portfolio_review.router)
app.include_router(economic_dashboard.router)
app.include_router(ai_stock_analyzer.router)
app.include_router(dividend_tracker.router)
app.include_router(watchlist_heatmap.router)
app.include_router(earnings_surprise_tracker.router)
app.include_router(earnings_strategy_analyzer.router)
app.include_router(market_correlation.router)
app.include_router(digest.router)
app.include_router(range_screener.router)

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
