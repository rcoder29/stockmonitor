"""Custom News Feed — News -> My News Feed.

Aggregates news across a chosen set of topics/indices/sectors (or raw
tickers) into one deduplicated, chronologically-sorted feed.

_fetch_feed is still in main.py (shared by Market summary and Day
Trader Scanners) — imported with a function-scoped deferred import
since main.py imports this router to register it, which would
otherwise cycle.
"""
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Query

router = APIRouter()

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

@router.get("/api/news-feed")
async def get_custom_news_feed(topics: str = Query(...)):
    from main import _fetch_feed

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


