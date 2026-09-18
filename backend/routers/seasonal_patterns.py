"""Seasonal Patterns — Research → Seasonal Patterns.

Monthly seasonality (average return, win rate, best/worst) for a symbol over
a trailing N-year window.
"""
import logging
from datetime import timedelta
from fastapi import APIRouter, HTTPException
import yfinance as yf

from database import cache_get, cache_set

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Seasonal Patterns ─────────────────────────────────────────────────────────

_SEASONAL_TTL = timedelta(hours=24)
_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@router.get("/api/market/seasonal")
def get_seasonal(symbol: str, years: int = 10):
    sym = symbol.strip().upper()
    cache_key = f"seasonal:{sym}:{years}"
    cached = cache_get(cache_key, _SEASONAL_TTL)
    if cached:
        return cached

    try:
        t = yf.Ticker(sym)
        hist = t.history(period=f"{years}y")
        if hist.empty or len(hist) < 100:
            raise HTTPException(404, f"Insufficient history for {sym}")

        info = t.fast_info
        name = getattr(info, "exchange", None)
        try:
            name = t.info.get("longName") or t.info.get("shortName") or sym
        except Exception:
            name = sym

        hist = hist[["Close"]].copy()
        hist.index = hist.index.tz_localize(None) if hist.index.tzinfo else hist.index
        hist["year"]  = hist.index.year
        hist["month"] = hist.index.month

        month_data: dict[int, list[float]] = {m: [] for m in range(1, 13)}

        for (yr, mo), grp in hist.groupby(["year", "month"]):
            if len(grp) < 5:
                continue
            open_px  = float(grp["Close"].iloc[0])
            close_px = float(grp["Close"].iloc[-1])
            if open_px > 0:
                ret = (close_px / open_px - 1) * 100
                month_data[mo].append(round(ret, 2))

        months = []
        for m in range(1, 13):
            rets = month_data[m]
            if not rets:
                months.append({"month": m, "name": _MONTH_NAMES[m - 1],
                               "avgReturn": None, "winRate": None,
                               "best": None, "worst": None, "years": 0, "returns": []})
                continue
            avg = round(sum(rets) / len(rets), 2)
            win = round(sum(1 for r in rets if r > 0) / len(rets) * 100)
            months.append({
                "month":     m,
                "name":      _MONTH_NAMES[m - 1],
                "avgReturn": avg,
                "winRate":   win,
                "best":      round(max(rets), 2),
                "worst":     round(min(rets), 2),
                "years":     len(rets),
                "returns":   rets,
            })

        valid = [mo for mo in months if mo["avgReturn"] is not None]
        best_mo  = max(valid, key=lambda x: x["avgReturn"]) if valid else None
        worst_mo = min(valid, key=lambda x: x["avgReturn"]) if valid else None

        result = {
            "symbol":   sym,
            "name":     name,
            "months":   months,
            "bestMonth":  best_mo["month"] if best_mo else None,
            "worstMonth": worst_mo["month"] if worst_mo else None,
            "yearsOfData": years,
        }
        cache_set(cache_key, result)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Seasonal %s: %s", sym, exc)
        raise HTTPException(500, str(exc))


