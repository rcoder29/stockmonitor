"""Earnings Call Summarizer — Chart Modal (Earnings tab, AI summary).

Fetches the most recent 8-K filing text from EDGAR and asks Claude to
extract a structured beat/miss, guidance, tone, and key-themes summary.
"""
import asyncio
import logging
import os
from datetime import timedelta
from fastapi import APIRouter, HTTPException
from anthropic import Anthropic

from database import cache_get, cache_set
from edgar_utils import _session, _get_cik

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Earnings Call Summarizer ──────────────────────────────────────────────────

_TRANSCRIPT_TTL = timedelta(hours=24)

_TRANSCRIPT_SYSTEM = """You are a financial analyst summarizing an earnings press release or 8-K filing.
Extract key information and return a JSON object with exactly these fields:
{
  "quarter": "Q1 2025",
  "beat_miss": "Beat EPS by $0.12, revenue in-line",
  "guidance": "Full-year EPS guided to $7.20-7.40, above consensus $7.15",
  "tone": "bullish",
  "tone_reason": "Management expressed strong confidence citing pipeline growth",
  "key_themes": ["AI adoption", "margin expansion", "international growth"],
  "risks": ["macro uncertainty", "supply chain pressure"],
  "notable_quote": "Most impactful verbatim quote from management"
}
tone must be one of: bullish, neutral, cautious, bearish.
If data is missing for a field, use null. Return ONLY valid JSON, no other text."""


@router.get("/api/earnings/transcript-summary/{symbol}")
async def get_transcript_summary(symbol: str):
    sym = symbol.upper().strip()
    cache_key = f"transcript:{sym}"
    cached = cache_get(cache_key, _TRANSCRIPT_TTL)
    if cached is not None:
        return cached

    cik = _get_cik(sym)
    if not cik:
        raise HTTPException(404, "Ticker not found in EDGAR")

    cik_int = int(cik)
    headers = {"User-Agent": "StockMonitor raghuravuri@gmail.com"}

    # Fetch recent filings to find the most recent 8-K (earnings announcement)
    loop = asyncio.get_event_loop()
    try:
        sub_url = f"https://data.sec.gov/submissions/CIK{cik}.json"
        r = await loop.run_in_executor(None, lambda: _session.get(sub_url, headers=headers))
        sub_data = r.json()
    except Exception as e:
        raise HTTPException(502, f"EDGAR fetch failed: {e}")

    recent  = sub_data.get("filings", {}).get("recent", {})
    forms   = recent.get("form", [])
    dates   = recent.get("filingDate", [])
    accnums = recent.get("accessionNumber", [])
    docs    = recent.get("primaryDocument", [])
    descs   = recent.get("primaryDocDescription", [])
    company = sub_data.get("name", sym)

    # Find most recent 8-K (likely earnings press release)
    target_acc = target_doc = target_date = None
    for form, date, acc, doc, desc in zip(forms, dates, accnums, docs, descs):
        if form == "8-K":
            target_acc = acc.replace("-", "")
            target_doc = doc
            target_date = date
            break

    if not target_acc:
        raise HTTPException(404, "No recent 8-K filing found for this ticker")

    filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{target_acc}/{target_doc}"

    try:
        r2 = await loop.run_in_executor(None, lambda: _session.get(filing_url, headers=headers))
        raw_html = r2.text
    except Exception as e:
        raise HTTPException(502, f"Filing fetch failed: {e}")

    # Strip HTML tags and collapse whitespace
    import re as _re
    text = _re.sub(r"<[^>]+>", " ", raw_html)
    text = _re.sub(r"&nbsp;", " ", text)
    text = _re.sub(r"&amp;", "&", text)
    text = _re.sub(r"&lt;", "<", text)
    text = _re.sub(r"&gt;", ">", text)
    text = _re.sub(r"\s+", " ", text).strip()
    text = text[:7000]  # limit tokens

    # Send to Claude for structured summary
    try:
        _ac = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
        claude_resp = await loop.run_in_executor(None, lambda: _ac.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=800,
            system=_TRANSCRIPT_SYSTEM,
            messages=[{"role": "user", "content": f"Symbol: {sym}\nFiling date: {target_date}\nFiling text:\n{text}"}],
        ))
        raw = claude_resp.content[0].text.strip()
        import json as _json
        summary = _json.loads(raw)
    except Exception as e:
        logger.warning("Transcript summary LLM failed %s: %s", sym, e)
        raise HTTPException(502, f"Summary generation failed: {e}")

    result = {
        "symbol":      sym,
        "company":     company,
        "filing_date": target_date,
        "filing_url":  filing_url,
        "summary":     summary,
    }
    cache_set(cache_key, result)
    return result


