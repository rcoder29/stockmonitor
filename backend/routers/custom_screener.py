"""Custom Screener — Research → Screener (filter-builder mode).

FilterCondition/CustomScreenRequest/run_custom_screener are also used by
routers/nlp_screener.py's NLP mode (imported there directly, not deferred —
no circularity since nlp_screener.py doesn't need to be imported by this
module). _fetch_fundamentals lives in main.py's Fundamentals section (too
widely shared to move in this pass) — imported with a function-scoped
deferred import since main.py imports this router to register it, which
would otherwise cycle.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import cache_get

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Custom Screener ───────────────────────────────────────────────────────────

_SP100 = [
    "AAPL","MSFT","AMZN","GOOGL","META","NVDA","TSLA","JPM","V","UNH",
    "JNJ","WMT","XOM","MA","PG","HD","CVX","LLY","ABBV","MRK",
    "PEP","KO","AVGO","COST","TMO","MCD","ABT","CSCO","DHR","ACN",
    "NEE","WFC","TXN","CMCSA","VZ","INTC","BMY","AMGN","RTX","HON",
    "PM","IBM","GE","LOW","CAT","BA","UPS","GS","MS","BLK",
    "SPGI","ISRG","MDT","SYK","GILD","CRM","ADBE","QCOM","AMAT","NOW",
    "LRCX","MU","PANW","PYPL","UBER","AMD","NFLX","DIS","SBUX","NKE",
    "T","F","GM","BAC","C","WBA","PFE","AXP","MMM","MO",
]

_CUSTOM_SCREEN_FIELDS = {
    "peRatio":             "P/E Ratio",
    "forwardPE":           "Forward P/E",
    "priceToBook":         "P/B Ratio",
    "beta":                "Beta",
    "dividendYield":       "Dividend Yield",
    "marketCap":           "Market Cap ($B)",
    "profitMargin":        "Profit Margin",
    "roe":                 "ROE",
    "debtToEquity":        "Debt/Equity",
    "shortPercentOfFloat": "Short Float %",
}


class FilterCondition(BaseModel):
    field:  str
    op:     str    # 'lt' | 'gt' | 'lte' | 'gte' | 'between'
    value:  float
    value2: float | None = None


class CustomScreenRequest(BaseModel):
    filters: list[FilterCondition]
    symbols: list[str] = []   # empty → use SP100


def _apply_filter(fund: dict, f: FilterCondition) -> bool:
    raw = fund.get(f.field)
    if raw is None:
        return False
    # dividendYield and related are stored as fractions (0.02 = 2%)
    val = raw
    if f.field in ("dividendYield", "profitMargin", "roe", "shortPercentOfFloat"):
        val = raw * 100
    if f.field == "marketCap":
        val = raw / 1e9
    if f.op == "lt":   return val < f.value
    if f.op == "gt":   return val > f.value
    if f.op == "lte":  return val <= f.value
    if f.op == "gte":  return val >= f.value
    if f.op == "between" and f.value2 is not None:
        return f.value <= val <= f.value2
    return False


@router.post("/api/screener/custom")
def run_custom_screener(body: CustomScreenRequest):
    from main import _fetch_fundamentals

    universe = [s.upper() for s in body.symbols] if body.symbols else _SP100
    if not body.filters:
        raise HTTPException(400, "At least one filter required")

    results = []
    with ThreadPoolExecutor(max_workers=12) as ex:
        futures = {ex.submit(_fetch_fundamentals, s): s for s in universe}
        for f in as_completed(futures):
            sym = futures[f]
            try:
                fund = f.result()
                q_cached = cache_get(f"quote:{sym}", timedelta(minutes=10))
                price = q_cached.get("price") if q_cached else None
                if all(_apply_filter(fund, filt) for filt in body.filters):
                    results.append({
                        "symbol":        sym,
                        "name":          fund.get("name", sym),
                        "price":         price,
                        "peRatio":       fund.get("peRatio"),
                        "forwardPE":     fund.get("forwardPE"),
                        "priceToBook":   fund.get("priceToBook"),
                        "beta":          fund.get("beta"),
                        "dividendYield": fund.get("dividendYield"),
                        "marketCap":     fund.get("marketCap") or (q_cached.get("marketCap") if q_cached else None),
                        "profitMargin":  fund.get("profitMargin"),
                        "roe":           fund.get("roe"),
                        "debtToEquity":  fund.get("debtToEquity"),
                        "shortPercentOfFloat": fund.get("shortPercentOfFloat"),
                        "sector":        fund.get("sector"),
                    })
            except Exception as e:
                logger.warning("custom screen %s: %s", sym, e)

    results.sort(key=lambda x: x.get("marketCap") or 0, reverse=True)
    return results[:50]
