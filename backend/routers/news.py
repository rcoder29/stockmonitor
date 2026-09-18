"""Symbol news — Chart Modal (News tab).

Recent headlines for a symbol via yfinance's news feed.
"""
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _session

logger = logging.getLogger(__name__)
router = APIRouter()

_NEWS_TTL = timedelta(minutes=5)

# ── News ──────────────────────────────────────────────────────────────────────

@router.get("/api/news/{symbol}")
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

