"""AI Stock Analyzer — AI Tools -> Stock Analyzer.

Live fundamentals/technicals snapshot for a single symbol, plus a
streamed equity-research-style Claude analysis (moat, valuation, bull/
bear case, verdict) built from it.
"""
import logging
import os
from datetime import datetime, timedelta
import yfinance as yf
from anthropic import Anthropic
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

# ── AI Stock Analyzer ─────────────────────────────────────────────────────────

_SNAPSHOT_TTL = timedelta(minutes=15)

_STOCK_ANALYZE_SYSTEM = """You are a senior equity research analyst at a bulge-bracket investment bank. Produce a concise, data-driven single-stock analysis that a sophisticated investor can act on.

Use ONLY the data provided. Use the actual numbers — name the metrics, dollar amounts, percentages. Do NOT give generic statements that could apply to any stock.

Use exactly these section headers:

## Business Overview
2–3 sentences: what the company does, its primary revenue model, and what differentiates it in its industry. Include sector and industry context.

## Competitive Position & Moat
Assess competitive advantages (pricing power, switching costs, network effects, cost advantages, regulatory moats). Name specific competitors. Be direct about how wide or narrow the moat is.

## Financial Snapshot
Revenue trajectory, margin trends, balance sheet (cash vs debt), and free cash flow. Flag red flags or standout positives using the actual numbers. Mention ROE and what it implies about capital efficiency.

## Valuation
Analyse P/E, forward P/E, P/S, EV/EBITDA vs typical sector norms. Estimate or discuss PEG ratio. Is the stock cheap, fairly valued, or expensive? Take a clear stance.

## Bull Case
3 specific reasons to own this stock. Reference actual metrics or upcoming catalysts. Include a timeframe (6–12 months or 2–3 years).

## Bear Case & Key Risks
3 most significant risks: valuation risk, competitive threats, macro sensitivity, or company-specific risks. State what would break the bull thesis.

## Verdict
One paragraph: Bullish / Neutral / Bearish with conviction (high/medium/low). Name the single most important catalyst to watch and the price level or metric that would change your view.

Write with conviction. Good research takes a clear stance."""


def _build_snapshot(symbol: str) -> dict:
    """Fetch comprehensive stock data. Called by both snapshot endpoint and AI analyzer."""
    t = yf.Ticker(symbol, session=_session)
    info = t.info or {}

    price = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
    if price is None:
        price = _safe_float(t.fast_info.last_price)
    if price is None:
        raise HTTPException(status_code=404, detail=f"Ticker '{symbol}' not found or has no price data.")

    prev = _safe_float(info.get("previousClose") or info.get("regularMarketPreviousClose"))
    change     = round(price - prev, 2)         if price and prev else None
    change_pct = round(change / prev * 100, 2)  if change and prev else None

    # Technicals from 1-year history
    ma50 = ma200 = ytd_ret = r1m = r3m = rsi14 = None
    try:
        hist = t.history(period="1y")
        if len(hist) > 0:
            closes = hist["Close"]
            if len(closes) >= 50:
                ma50  = round(float(closes.rolling(50).mean().iloc[-1]),  2)
            if len(closes) >= 200:
                ma200 = round(float(closes.rolling(200).mean().iloc[-1]), 2)
            this_year = datetime.now().year
            ytd_hist = hist[hist.index.year == this_year]
            if len(ytd_hist) > 0 and price:
                ytd_ret = round((price - float(ytd_hist["Close"].iloc[0]))
                                / float(ytd_hist["Close"].iloc[0]) * 100, 2)
            if len(closes) >= 21 and price:
                r1m = round((price - float(closes.iloc[-21])) / float(closes.iloc[-21]) * 100, 2)
            if len(closes) >= 63 and price:
                r3m = round((price - float(closes.iloc[-63])) / float(closes.iloc[-63]) * 100, 2)
            if len(closes) >= 15:
                delta = closes.diff()
                gain  = delta.clip(lower=0).rolling(14).mean()
                loss  = (-delta.clip(upper=0)).rolling(14).mean()
                rs    = gain / loss
                rsi14 = round(float((100 - 100 / (1 + rs)).iloc[-1]), 1)
    except Exception as exc:
        logger.debug("Technicals %s: %s", symbol, exc)

    # Next earnings date — current yfinance returns .calendar as a plain
    # dict with a list of dates (not a DataFrame column/Series).
    earnings_date = None
    try:
        cal = t.calendar
        if cal and "Earnings Date" in cal:
            dates = cal["Earnings Date"]
            iterable = dates if hasattr(dates, "__iter__") and not isinstance(dates, str) else [dates]
            for d in iterable:
                try:
                    earnings_date = str(d.date()) if hasattr(d, "date") else str(d)
                    break
                except Exception:
                    pass
    except Exception:
        pass

    def sp(v):
        return round(v * 100, 2) if v is not None else None

    return {
        "symbol":         symbol,
        "name":           info.get("longName") or info.get("shortName") or symbol,
        "exchange":       info.get("exchange") or info.get("fullExchangeName"),
        "sector":         info.get("sector"),
        "industry":       info.get("industry"),
        "price":          price,
        "change":         change,
        "changePct":      change_pct,
        "week52High":     _safe_float(info.get("fiftyTwoWeekHigh")),
        "week52Low":      _safe_float(info.get("fiftyTwoWeekLow")),
        "marketCap":      _safe_float(info.get("marketCap")),
        "beta":           _safe_float(info.get("beta")),
        "peRatio":        _safe_float(info.get("trailingPE")),
        "forwardPE":      _safe_float(info.get("forwardPE")),
        "priceToBook":    _safe_float(info.get("priceToBook")),
        "priceToSales":   _safe_float(info.get("priceToSalesTrailingTwelveMonths")),
        "evEbitda":       _safe_float(info.get("enterpriseToEbitda")),
        "revenue":        _safe_float(info.get("totalRevenue")),
        "revenueGrowth":  sp(info.get("revenueGrowth")),
        "earningsGrowth": sp(info.get("earningsGrowth")),
        "profitMargin":   sp(info.get("profitMargins")),
        "grossMargin":    sp(info.get("grossMargins")),
        "operatingMargin":sp(info.get("operatingMargins")),
        "roe":            sp(info.get("returnOnEquity")),
        "roa":            sp(info.get("returnOnAssets")),
        "debtToEquity":   _safe_float(info.get("debtToEquity")),
        "totalCash":      _safe_float(info.get("totalCash")),
        "totalDebt":      _safe_float(info.get("totalDebt")),
        "freeCashflow":   _safe_float(info.get("freeCashflow")),
        "dividendYield":  sp(info.get("dividendYield")),
        "targetMeanPrice":_safe_float(info.get("targetMeanPrice")),
        "targetHighPrice":_safe_float(info.get("targetHighPrice")),
        "targetLowPrice": _safe_float(info.get("targetLowPrice")),
        "analystCount":   info.get("numberOfAnalystOpinions"),
        "recommendation": info.get("recommendationKey"),
        "shortPct":       sp(info.get("shortPercentOfFloat")),
        "employees":      info.get("fullTimeEmployees"),
        "description":    (info.get("longBusinessSummary") or "")[:600],
        "descriptionFull":info.get("longBusinessSummary") or "",
        "ma50":           ma50,
        "ma200":          ma200,
        "ytdReturn":      ytd_ret,
        "return1m":       r1m,
        "return3m":       r3m,
        "rsi14":          rsi14,
        "earningsDate":   earnings_date,
    }


@router.get("/api/market/stock-snapshot/{symbol}")
def get_stock_snapshot(symbol: str):
    symbol = symbol.upper().strip()
    cache_key = f"snapshot:{symbol}"
    cached = cache_get(cache_key, _SNAPSHOT_TTL)
    if cached is not None:
        return cached
    result = _build_snapshot(symbol)
    cache_set(cache_key, result)
    return result


class StockAnalyzeRequest(BaseModel):
    symbol: str

@router.post("/api/ai/stock-analyze")
def ai_stock_analyze(body: StockAnalyzeRequest):
    symbol = (body.symbol or "").upper().strip()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol required")

    # Use cached snapshot if available, otherwise fetch fresh
    cache_key = f"snapshot:{symbol}"
    snap = cache_get(cache_key, _SNAPSHOT_TTL)
    if snap is None:
        snap = _build_snapshot(symbol)
        cache_set(cache_key, snap)

    def fc(v, suffix=""):
        if v is None: return "N/A"
        if suffix == "$":
            if abs(v) >= 1e12: return f"${v/1e12:.2f}T"
            if abs(v) >= 1e9:  return f"${v/1e9:.2f}B"
            if abs(v) >= 1e6:  return f"${v/1e6:.2f}M"
            return f"${v:,.0f}"
        if suffix == "%": return f"{v:.2f}%"
        if suffix == "x": return f"{v:.1f}x"
        return str(round(v, 2))

    price = snap.get("price") or 0
    ma50  = snap.get("ma50")
    ma200 = snap.get("ma200")
    above50  = "above" if ma50  and price > ma50  else "below" if ma50  else "N/A"
    above200 = "above" if ma200 and price > ma200 else "below" if ma200 else "N/A"

    tgt_mean = snap.get("targetMeanPrice")
    upside = round((tgt_mean - price) / price * 100, 1) if tgt_mean and price else None

    user_msg = f"""Analyse {symbol} — {snap.get('name', symbol)}.

PRICE & TECHNICALS
Current: ${price:,.2f}  |  Change today: {fc(snap.get('changePct'), '%')}
52-week range: ${fc(snap.get('week52Low'))} – ${fc(snap.get('week52High'))}
YTD return: {fc(snap.get('ytdReturn'), '%')}  |  1M: {fc(snap.get('return1m'), '%')}  |  3M: {fc(snap.get('return3m'), '%')}
Beta: {fc(snap.get('beta'))}  |  RSI (14): {fc(snap.get('rsi14'))}
50-day MA: ${fc(snap.get('ma50'))} ({above50})  |  200-day MA: ${fc(snap.get('ma200'))} ({above200})
Short interest: {fc(snap.get('shortPct'), '%')} of float

FUNDAMENTALS
Market cap: {fc(snap.get('marketCap'), '$')}  |  Sector: {snap.get('sector') or 'N/A'}  |  Industry: {snap.get('industry') or 'N/A'}
Revenue (TTM): {fc(snap.get('revenue'), '$')}  |  Revenue growth YoY: {fc(snap.get('revenueGrowth'), '%')}
Earnings growth YoY: {fc(snap.get('earningsGrowth'), '%')}
Gross margin: {fc(snap.get('grossMargin'), '%')}  |  Operating margin: {fc(snap.get('operatingMargin'), '%')}  |  Net margin: {fc(snap.get('profitMargin'), '%')}
Return on equity: {fc(snap.get('roe'), '%')}  |  Return on assets: {fc(snap.get('roa'), '%')}
Free cash flow: {fc(snap.get('freeCashflow'), '$')}
Cash: {fc(snap.get('totalCash'), '$')}  |  Total debt: {fc(snap.get('totalDebt'), '$')}  |  Debt/Equity: {fc(snap.get('debtToEquity'))}
Dividend yield: {fc(snap.get('dividendYield'), '%')}
Employees: {f"{snap['employees']:,}" if snap.get('employees') else 'N/A'}
Next earnings: {snap.get('earningsDate') or 'N/A'}

VALUATION MULTIPLES
P/E (TTM): {fc(snap.get('peRatio'), 'x')}  |  Forward P/E: {fc(snap.get('forwardPE'), 'x')}
Price/Sales: {fc(snap.get('priceToSales'), 'x')}  |  Price/Book: {fc(snap.get('priceToBook'), 'x')}  |  EV/EBITDA: {fc(snap.get('evEbitda'), 'x')}

ANALYST CONSENSUS
Rating: {(snap.get('recommendation') or 'N/A').upper()}  |  Analysts covering: {snap.get('analystCount') or 'N/A'}
Price targets — Low: ${fc(snap.get('targetLowPrice'))}  |  Mean: ${fc(tgt_mean)}  |  High: ${fc(snap.get('targetHighPrice'))}
Upside to mean target: {f'{upside}%' if upside is not None else 'N/A'}

BUSINESS DESCRIPTION
{snap.get('descriptionFull') or 'Not available.'}"""

    anthropic_client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

    def generate():
        try:
            with anthropic_client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=2000,
                system=[{"type": "text", "text": _STOCK_ANALYZE_SYSTEM,
                          "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user_msg}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {text}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            yield f"data: [ERROR] {exc}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


