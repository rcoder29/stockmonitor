"""AI News Sentiment — Chart Modal (News tab, per-symbol AI sentiment).

A single symbol's recent headlines, scored by Claude for sentiment.

Renamed _SENTIMENT_TTL -> _AI_SENTIMENT_TTL during extraction: this name
was reused by two other sections (News Sentiment Engine, hours=2; Market
Sentiment Dashboard, minutes=30) with three different intended values.
Since Python module-level execution means the LAST definition silently
wins everywhere, all three endpoints were actually running on
Market Sentiment Dashboard's minutes=30 (defined last in the file),
not their own intended TTL. Each now has its own distinctly-named
constant restoring its originally-intended value.
"""
import json
import logging
import os
from datetime import timedelta
import yfinance as yf
from anthropic import Anthropic
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _session

logger = logging.getLogger(__name__)
router = APIRouter()

_AI_SENTIMENT_TTL = timedelta(hours=1)



@router.get("/api/sentiment/{symbol}")
def get_sentiment(symbol: str):
    symbol = symbol.upper()
    cache_key = f"sentiment:{symbol}"
    cached = cache_get(cache_key, _AI_SENTIMENT_TTL)
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


