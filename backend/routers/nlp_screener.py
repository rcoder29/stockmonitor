"""NLP Screener — Research → Screener (NLP mode).

Converts a natural-language query into filter conditions via Claude, then
runs them through the Custom Screener.

FilterCondition/CustomScreenRequest/run_custom_screener live in main.py's
Custom Screener section (shared with the regular filter-builder screener) —
imported with a function-scoped deferred import since main.py imports this
router to register it, which would otherwise cycle.
"""
import os
import json
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from anthropic import Anthropic

logger = logging.getLogger(__name__)
router = APIRouter()

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


@router.post("/api/screener/nlp")
async def screener_nlp(req: NLPScreenRequest):
    from main import FilterCondition, CustomScreenRequest, run_custom_screener

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

