"""AI Morning Briefing — AI Tools -> Morning Briefing.

Streams a personalized market briefing (indices, sector rotation,
watchlist spotlight, key headlines, risks) from Claude, seeded with
live index/sector/news data.
"""
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
import yfinance as yf
from anthropic import Anthropic
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

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


@router.post("/api/ai/morning-briefing")
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


