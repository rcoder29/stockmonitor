"""News Sentiment Engine — Watchlist -> News Sentiment (multi-symbol batch).

Batch sentiment scoring across up to 20 symbols in one Claude call.

Renamed _SENTIMENT_TTL -> _NEWS_SENTIMENT_TTL during extraction (see
routers/ai_news_sentiment.py docstring for why — three sections reused
this name with three different intended values, and the last
definition in the file silently won for all of them at runtime).

Cache key changed from "sentiment:{symbols}" to
"news_sentiment:{symbols}": for a single-symbol request the old key
collapsed to the exact same string as routers/ai_news_sentiment.py's
per-symbol cache key ("sentiment:AAPL"), despite the two endpoints
returning completely different response shapes — whichever ran first
would silently poison the cache for the other.
"""
import asyncio
import json
import logging
import os
from datetime import timedelta
from typing import List
import yfinance as yf
from anthropic import Anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import cache_get, cache_set
from edgar_utils import _session

logger = logging.getLogger(__name__)
router = APIRouter()

_NEWS_SENTIMENT_TTL = timedelta(hours=2)


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


@router.post("/api/news/sentiment")
async def get_news_sentiment(req: SentimentRequest):
    symbols   = [s.upper().strip() for s in req.symbols[:20]]
    cache_key = f"news_sentiment:{','.join(sorted(symbols))}"
    cached    = cache_get(cache_key, _NEWS_SENTIMENT_TTL)
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


