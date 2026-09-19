"""Screener — Research -> Screener (technical + fundamental preset modes).

_fetch_fundamentals is still in main.py (shared by several other
not-yet-extracted sections) — imported with a function-scoped deferred
import since main.py imports this router to register it, which would
otherwise cycle.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import cache_get, cache_set
from edgar_utils import _session, _calc_rsi, SCREENER_UNIVERSE

router = APIRouter()

# ── Screener ─────────────────────────────────────────────────────────────────

_SCREEN_TTL = timedelta(minutes=20)


@router.get("/api/screener/technical")
def technical_screener(scan: str = "52w_high"):
    from main import _fetch_fundamentals

    cache_key = f"screener:tech:{scan}"
    cached = cache_get(cache_key, _SCREEN_TTL)
    if cached is not None:
        return cached

    valid_scans = {"52w_high", "golden_cross", "death_cross", "rsi_oversold", "rsi_overbought", "high_volume", "short_interest"}
    if scan not in valid_scans:
        raise HTTPException(400, f"scan must be one of {valid_scans}")

    try:
        raw = yf.download(SCREENER_UNIVERSE, period="1y", interval="1d",
                          auto_adjust=True, progress=False, session=_session)
        closes  = raw["Close"].dropna(how="all")
        volumes = raw["Volume"].dropna(how="all")
    except Exception as e:
        raise HTTPException(500, str(e))

    results = []
    for sym in SCREENER_UNIVERSE:
        if sym not in closes.columns:
            continue
        prices = closes[sym].dropna()
        vols   = volumes[sym].dropna() if sym in volumes.columns else None
        if len(prices) < 60:
            continue

        price   = float(prices.iloc[-1])
        chg_pct = float((prices.iloc[-1] / prices.iloc[-2] - 1) * 100) if len(prices) >= 2 else 0.0
        vol_today = float(vols.iloc[-1]) if vols is not None and len(vols) > 0 else None

        row = {"symbol": sym, "price": round(price, 2), "changePercent": round(chg_pct, 2),
               "volume": int(vol_today) if vol_today else None}

        if scan == "52w_high":
            high = float(prices.max())
            pct_from_high = round((price / high - 1) * 100, 2)
            if pct_from_high >= -3:
                row.update({"high52w": round(high, 2), "pctFromHigh": pct_from_high})
                results.append(row)

        elif scan in ("golden_cross", "death_cross"):
            if len(prices) < 200:
                continue
            ma50  = prices.rolling(50).mean()
            ma200 = prices.rolling(200).mean()
            # Look for crossover within the last 30 days
            diff = ma50 - ma200
            sign_changes = (diff > 0).astype(int).diff().abs()
            recent = sign_changes.iloc[-30:]
            crossed = recent.sum() > 0
            is_golden = float(ma50.iloc[-1]) > float(ma200.iloc[-1])
            if (scan == "golden_cross" and is_golden and crossed) or \
               (scan == "death_cross"  and not is_golden and crossed):
                row.update({"ma50": round(float(ma50.iloc[-1]), 2),
                            "ma200": round(float(ma200.iloc[-1]), 2)})
                results.append(row)

        elif scan in ("rsi_oversold", "rsi_overbought"):
            rsi_series = _calc_rsi(prices)
            rsi_val    = float(rsi_series.iloc[-1])
            if rsi_val != rsi_val:
                continue
            if (scan == "rsi_oversold"  and rsi_val < 30) or \
               (scan == "rsi_overbought" and rsi_val > 70):
                row.update({"rsi": round(rsi_val, 1)})
                results.append(row)

        elif scan == "high_volume":
            if vols is None or len(vols) < 22:
                continue
            avg_vol_20 = float(vols.iloc[-21:-1].mean())
            if avg_vol_20 > 0 and vol_today and vol_today >= 2 * avg_vol_20:
                row.update({"avgVolume20d": int(avg_vol_20),
                            "volRatio": round(vol_today / avg_vol_20, 1)})
                results.append(row)

    if scan == "short_interest":
        def _fetch_si(sym2):
            f = _fetch_fundamentals(sym2)
            si_pct = f.get("shortPercentOfFloat")
            if si_pct is not None and si_pct > 0.10:
                price2 = None
                try:
                    if sym2 in closes.columns:
                        price2 = round(float(closes[sym2].dropna().iloc[-1]), 2)
                except Exception:
                    pass
                return {
                    "symbol": sym2,
                    "price": price2,
                    "shortPercentOfFloat": round(si_pct * 100, 1),
                    "shortRatio": round(float(f["shortRatio"]), 1) if f.get("shortRatio") else None,
                    "marketCap": f.get("marketCap"),
                    "sector": f.get("sector"),
                }
            return None
        with ThreadPoolExecutor(max_workers=10) as ex2:
            for item in ex2.map(_fetch_si, SCREENER_UNIVERSE):
                if item:
                    results.append(item)
        results.sort(key=lambda x: x.get("shortPercentOfFloat", 0), reverse=True)
        cache_set(cache_key, results)
        return results

    results.sort(key=lambda x: x.get("pctFromHigh", x.get("rsi", x.get("volRatio", 0))),
                 reverse=(scan not in ("rsi_oversold",)))
    cache_set(cache_key, results)
    return results


@router.get("/api/screener/fundamental")
def fundamental_screener(screen: str = "quality_growth"):
    from main import _fetch_fundamentals

    cache_key = f"screener:fund:{screen}"
    cached = cache_get(cache_key, _SCREEN_TTL)
    if cached is not None:
        return cached

    presets = {
        "quality_growth":    lambda f: (f.get("profitMargin") or 0) > 0.15 and (f.get("revenueGrowth") or 0) > 0.08 and (f.get("debtToEquity") or 999) < 150,
        "deep_value":        lambda f: 0 < (f.get("peRatio") or 999) < 15 and 0 < (f.get("priceToBook") or 999) < 2,
        "dividend_income":   lambda f: (f.get("dividendYield") or 0) > 0.02 and 0 < (f.get("peRatio") or 999) < 35,
        "momentum_quality":  lambda f: (f.get("roe") or 0) > 0.15 and (f.get("profitMargin") or 0) > 0.10,
    }
    if screen not in presets:
        raise HTTPException(400, f"screen must be one of {list(presets.keys())}")

    filt = presets[screen]
    results = []

    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(_fetch_fundamentals, sym): sym for sym in SCREENER_UNIVERSE}
        for f in as_completed(futures):
            data = f.result()
            if data and filt(data):
                results.append({
                    "symbol":        data["symbol"],
                    "name":          data.get("name", ""),
                    "price":         data.get("price"),
                    "peRatio":       data.get("peRatio"),
                    "forwardPE":     data.get("forwardPE"),
                    "profitMargin":  round((data.get("profitMargin") or 0) * 100, 1),
                    "revenueGrowth": round((data.get("revenueGrowth") or 0) * 100, 1),
                    "dividendYield": round((data.get("dividendYield") or 0) * 100, 2),
                    "debtToEquity":  data.get("debtToEquity"),
                    "roe":           round((data.get("roe") or 0) * 100, 1),
                    "marketCap":     data.get("marketCap"),
                    "sector":        data.get("sector"),
                })

    results.sort(key=lambda x: x.get("profitMargin") or 0, reverse=True)
    cache_set(cache_key, results)
    return results


