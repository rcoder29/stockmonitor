"""Claude Trade Idea Generator — Watchlist (trade ideas panel).

Streams 3-5 trade ideas from Claude given the current watchlist snapshot
and any triggered price alerts.
"""
import json
import logging
import os
from typing import List
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from anthropic import Anthropic

logger = logging.getLogger(__name__)
router = APIRouter()

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


@router.post("/api/trade-ideas")
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


