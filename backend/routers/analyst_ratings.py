"""Analyst Ratings — Chart Modal (Analysts tab, per-symbol view).

Analyst price targets, recommendation key, and rating/upgrade-downgrade
history for a single symbol.

Cache key "analyst:{symbol}" is scoped to this endpoint only — a
separate, differently-shaped tracker (routers/analyst_rating_tracker.py,
/api/market/analyst-ratings) used to share this exact cache key before
extraction, which meant whichever endpoint ran first silently poisoned
the cache for the other. Fixed by giving the tracker its own
"analyst_tracker:{symbol}" key.
"""
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float, _ANALYST_TTL

router = APIRouter()

# ── Analyst Ratings ───────────────────────────────────────────────────────────

@router.get("/api/analyst/{symbol}")
def get_analyst_data(symbol: str):
    sym = symbol.upper()
    key = f"analyst:{sym}"
    cached = cache_get(key, _ANALYST_TTL)
    if cached is not None:
        return cached
    try:
        ticker = yf.Ticker(sym, session=_session)
        info   = ticker.info

        # Recommendation history (monthly summary)
        rec_hist = []
        try:
            recs = ticker.recommendations
            if recs is not None and len(recs) > 0:
                cols = list(recs.columns)
                if "strongBuy" in cols or "strong_buy" in cols:
                    for _, r in recs.tail(8).iterrows():
                        rec_hist.append({
                            "period":    str(r.get("period", r.name)),
                            "strongBuy": int(r.get("strongBuy", r.get("strong_buy", 0)) or 0),
                            "buy":       int(r.get("buy", 0) or 0),
                            "hold":      int(r.get("hold", 0) or 0),
                            "sell":      int(r.get("sell", 0) or 0),
                            "strongSell":int(r.get("strongSell", r.get("strong_sell", 0)) or 0),
                        })
                else:
                    for _, r in recs.tail(12).iterrows():
                        rec_hist.append({
                            "date":      str(pd.Timestamp(r.name).date()) if hasattr(r.name, "date") else str(r.name),
                            "firm":      str(r.get("Firm", "")),
                            "toGrade":   str(r.get("To Grade", r.get("toGrade", ""))),
                            "fromGrade": str(r.get("From Grade", r.get("fromGrade", ""))),
                            "action":    str(r.get("Action", r.get("action", ""))),
                        })
        except Exception:
            pass

        result = {
            "symbol": sym,
            "recommendationKey":       info.get("recommendationKey"),
            "numberOfAnalystOpinions": info.get("numberOfAnalystOpinions"),
            "targetMeanPrice":   _safe_float(info.get("targetMeanPrice")),
            "targetHighPrice":   _safe_float(info.get("targetHighPrice")),
            "targetLowPrice":    _safe_float(info.get("targetLowPrice")),
            "targetMedianPrice": _safe_float(info.get("targetMedianPrice")),
            "currentPrice":      _safe_float(info.get("currentPrice")),
            "history": rec_hist,
        }
        cache_set(key, result)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


