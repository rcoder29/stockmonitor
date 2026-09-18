"""AI Chat — general finance chat assistant (Gemini if configured, else Claude).
"""
import json
import logging
import os
from typing import List
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from anthropic import Anthropic

try:
    from google import genai as _genai_module
    _genai_available = True
except ImportError:
    _genai_available = False

logger = logging.getLogger(__name__)
router = APIRouter()

# ── AI Chat ───────────────────────────────────────────────────────────────────

_FINANCE_SYSTEM = """You are an expert financial advisor and investment analyst with deep knowledge of:
- Equity markets, stock analysis, and valuation methodologies (DCF, P/E, EV/EBITDA, etc.)
- Options strategies, derivatives, and risk management
- Technical analysis: chart patterns, indicators (RSI, MACD, Bollinger Bands, moving averages)
- Fundamental analysis: earnings, revenue growth, margins, balance sheets, cash flow
- Macro economics: Fed policy, interest rates, inflation, GDP, employment data
- Sector dynamics: technology, healthcare, energy, financials, consumer, industrials
- ETFs, mutual funds, fixed income, REITs, commodities, crypto
- Day trading, swing trading, and long-term investing strategies
- Portfolio construction, diversification, and risk-adjusted returns

Guidelines:
- Provide concrete, actionable analysis grounded in financial data and theory
- Explain your reasoning clearly, referencing relevant metrics and frameworks
- When discussing specific stocks, include key metrics, risks, and catalysts
- Always note that your analysis is informational and not personalized financial advice
- Be direct and specific — avoid vague generalities
- Use markdown formatting: **bold** for key terms, bullet points for lists, tables where helpful"""


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]


@router.post("/api/ai-chat")
def ai_chat(body: ChatRequest):
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    use_gemini = bool(gemini_key) and _genai_available

    def generate_gemini():
        try:
            gc = _genai_module.Client(api_key=gemini_key)
            # Build contents list: map "assistant" → "model" role
            contents = []
            for m in body.messages:
                role = "model" if m.role == "assistant" else "user"
                contents.append({"role": role, "parts": [{"text": m.content}]})
            from google.genai import types as _genai_types
            cfg = _genai_types.GenerateContentConfig(
                system_instruction=_FINANCE_SYSTEM,
                max_output_tokens=2048,
            )
            response = gc.models.generate_content_stream(
                model="gemini-2.0-flash",
                contents=contents,
                config=cfg,
            )
            for chunk in response:
                if chunk.text:
                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            logger.error("AI chat (Gemini) error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    def generate_anthropic():
        try:
            client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                system=[{"type": "text", "text": _FINANCE_SYSTEM,
                          "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": m.role, "content": m.content} for m in body.messages],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            logger.error("AI chat (Anthropic) error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        generate_gemini() if use_gemini else generate_anthropic(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
