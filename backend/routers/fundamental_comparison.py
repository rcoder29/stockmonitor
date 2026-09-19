"""Fundamental Comparison Tool — Research -> Chart Compare.

Side-by-side fundamentals across up to 5 symbols, with per-metric
best/worst highlighting.
"""
import asyncio
from datetime import timedelta
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

router = APIRouter()

# ── Fundamental Comparison Tool ───────────────────────────────────────────────

_FUNDC_TTL = timedelta(hours=2)

_COMPARE_METRICS = [
    ("Market Cap",         "marketCap",           "B",    lambda v: f"${v/1e9:.1f}B"),
    ("Price",              "currentPrice",         "$",    lambda v: f"${v:.2f}"),
    ("P/E (Trailing)",     "trailingPE",           "x",    lambda v: f"{v:.1f}x"),
    ("P/E (Forward)",      "forwardPE",            "x",    lambda v: f"{v:.1f}x"),
    ("P/S",                "priceToSalesTrailing12Months", "x", lambda v: f"{v:.1f}x"),
    ("P/B",                "priceToBook",          "x",    lambda v: f"{v:.1f}x"),
    ("EV/EBITDA",          "enterpriseToEbitda",   "x",    lambda v: f"{v:.1f}x"),
    ("Rev Growth (YoY)",   "revenueGrowth",        "%",    lambda v: f"{v*100:.1f}%"),
    ("Gross Margin",       "grossMargins",         "%",    lambda v: f"{v*100:.1f}%"),
    ("Op Margin",          "operatingMargins",     "%",    lambda v: f"{v*100:.1f}%"),
    ("Net Margin",         "profitMargins",        "%",    lambda v: f"{v*100:.1f}%"),
    ("ROE",                "returnOnEquity",       "%",    lambda v: f"{v*100:.1f}%"),
    ("ROA",                "returnOnAssets",       "%",    lambda v: f"{v*100:.1f}%"),
    ("Debt/Equity",        "debtToEquity",         "x",    lambda v: f"{v:.2f}x"),
    ("Current Ratio",      "currentRatio",         "x",    lambda v: f"{v:.2f}x"),
    ("Dividend Yield",     "dividendYield",        "%",    lambda v: f"{v*100:.2f}%"),
    ("Beta",               "beta",                 "",     lambda v: f"{v:.2f}"),
    ("Short % Float",      "shortPercentOfFloat",  "%",    lambda v: f"{v*100:.1f}%"),
    ("Insider Own%",       "heldPercentInsiders",  "%",    lambda v: f"{v*100:.1f}%"),
    ("52W High",           "fiftyTwoWeekHigh",     "$",    lambda v: f"${v:.2f}"),
    ("52W Low",            "fiftyTwoWeekLow",      "$",    lambda v: f"${v:.2f}"),
]

# Metrics where lower = better (for color-coding)
_LOWER_BETTER = {"P/E (Trailing)", "P/E (Forward)", "P/S", "P/B", "EV/EBITDA", "Debt/Equity", "Short % Float"}
# Metrics where direction doesn't clearly apply
_NEUTRAL_METRICS = {"Price", "Market Cap", "52W High", "52W Low", "Beta", "Dividend Yield"}


def _fetch_compare_symbol(symbol: str) -> dict:
    cache_key = f"fundc:{symbol}"
    cached = cache_get(cache_key, _FUNDC_TTL)
    if cached is not None:
        return cached

    try:
        info = yf.Ticker(symbol, session=_session).info
        row  = {"symbol": symbol, "name": info.get("shortName", symbol)}
        for label, key, _, _ in _COMPARE_METRICS:
            row[label] = _safe_float(info.get(key))
        cache_set(cache_key, row)
        return row
    except Exception as e:
        return {"symbol": symbol, "error": str(e)}


@router.get("/api/compare/fundamentals")
async def compare_fundamentals(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()][:5]
    if not syms:
        raise HTTPException(400, "Provide at least one symbol")
    loop    = asyncio.get_event_loop()
    results = await asyncio.gather(*[loop.run_in_executor(None, _fetch_compare_symbol, s) for s in syms])

    # Compute per-metric best/worst for highlighting
    metrics_meta = []
    for label, _, unit, fmt_fn in _COMPARE_METRICS:
        vals = {r["symbol"]: r.get(label) for r in results if r.get(label) is not None}
        if not vals:
            metrics_meta.append({"label": label, "unit": unit, "best": None, "worst": None})
            continue
        if label in _NEUTRAL_METRICS:
            metrics_meta.append({"label": label, "unit": unit, "best": None, "worst": None})
            continue
        lower_better = label in _LOWER_BETTER
        best  = min(vals, key=vals.get) if lower_better else max(vals, key=vals.get)
        worst = max(vals, key=vals.get) if lower_better else min(vals, key=vals.get)
        metrics_meta.append({"label": label, "unit": unit, "best": best, "worst": worst})

    return {"symbols": syms, "rows": list(results), "metrics": metrics_meta}


