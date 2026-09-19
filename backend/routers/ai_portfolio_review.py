"""AI Portfolio Review — AI Tools -> Portfolio Review.

Streams a portfolio strategist-style review (concentration risk, sector
tilt, valuation flags, rebalancing recommendations) from Claude, seeded
with live-quote-enriched current holdings.

_fetch_quote is still in main.py (shared by many other not-yet-extracted
sections) — imported with a function-scoped deferred import since
main.py imports this router to register it, which would otherwise
cycle.
"""
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from anthropic import Anthropic
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from database import db_session, PortfolioPosition

logger = logging.getLogger(__name__)
router = APIRouter()

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


@router.post("/api/ai/portfolio-review")
def ai_portfolio_review():
    from main import _fetch_quote

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


