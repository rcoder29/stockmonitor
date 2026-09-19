"""Earnings Surprise Tracker — Research -> Earnings Surprise.

Historical EPS beat rate, average surprise %, beat streak, and post-
earnings price drift (1d/5d) across a list of symbols.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
import pandas as pd
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Earnings Surprise Tracker ─────────────────────────────────────────────────

_EARN_SURP_TTL = timedelta(hours=12)


def _calc_drift(hist: pd.DataFrame, earn_date_str: str, days: int):
    try:
        earn_dt = pd.Timestamp(earn_date_str, tz="UTC")
        future = hist.index[hist.index >= earn_dt]
        if len(future) < days + 1:
            return None
        c0 = float(hist.loc[future[0], "Close"])
        cn = float(hist.loc[future[days], "Close"])
        return round((cn / c0 - 1) * 100, 2) if c0 else None
    except Exception:
        return None


def _fetch_earn_surprise(sym: str) -> dict | None:
    cache_key = f"earnsurp:{sym}"
    cached = cache_get(cache_key, _EARN_SURP_TTL)
    if cached:
        return cached
    try:
        t    = yf.Ticker(sym, session=_session)
        info = t.info or {}

        eh = None
        try:
            eh = t.earnings_history
        except Exception:
            pass

        if eh is None or eh.empty:
            return {"symbol": sym, "name": info.get("longName") or sym, "quarters": [], "noData": True}

        hist = None
        try:
            hist = t.history(period="2y", interval="1d", auto_adjust=True)
            if hist.index.tz is None:
                hist.index = hist.index.tz_localize("UTC")
        except Exception:
            pass

        quarters = []
        for idx, row in eh.iterrows():
            try:
                eps_est = _safe_float(row.get("epsEstimate"))
                eps_act = _safe_float(row.get("epsActual"))
                if eps_est is None and eps_act is None:
                    continue

                # Calculate surprise % from raw values (avoids yfinance fraction/pct ambiguity)
                surp_pct = None
                if eps_est is not None and eps_act is not None and eps_est != 0:
                    surp_pct = round((eps_act - eps_est) / abs(eps_est) * 100, 2)

                beat = (eps_act >= eps_est) if (eps_est is not None and eps_act is not None) else None
                date_str = str(idx.date()) if hasattr(idx, "date") else str(idx)[:10]

                quarters.append({
                    "date":        date_str,
                    "epsEstimate": round(eps_est, 4) if eps_est is not None else None,
                    "epsActual":   round(eps_act, 4) if eps_act is not None else None,
                    "surprisePct": surp_pct,
                    "beat":        beat,
                    "drift1d":     _calc_drift(hist, date_str, 1) if hist is not None else None,
                    "drift5d":     _calc_drift(hist, date_str, 5) if hist is not None else None,
                })
            except Exception as e:
                logger.debug("Quarter parse %s: %s", sym, e)

        # Most-recent first, cap at 8
        quarters.sort(key=lambda q: q["date"], reverse=True)
        quarters = quarters[:8]

        with_eps = [q for q in quarters if q["beat"] is not None]
        beat_ct  = sum(1 for q in with_eps if q["beat"])
        beat_rate = round(beat_ct / len(with_eps) * 100) if with_eps else None

        surps = [q["surprisePct"] for q in quarters if q["surprisePct"] is not None]
        avg_surp = round(sum(surps) / len(surps), 2) if surps else None

        streak = 0
        for q in quarters:
            if q["beat"] is True:
                streak += 1
            else:
                break

        d1s = [q["drift1d"] for q in quarters if q["drift1d"] is not None]
        d5s = [q["drift5d"] for q in quarters if q["drift5d"] is not None]

        result = {
            "symbol":        sym,
            "name":          info.get("longName") or info.get("shortName") or sym,
            "sector":        info.get("sector"),
            "quarters":      quarters,
            "beatRate":      beat_rate,
            "beatCount":     beat_ct,
            "totalQuarters": len(with_eps),
            "avgSurprisePct": avg_surp,
            "beatStreak":    streak,
            "avgDrift1d":    round(sum(d1s) / len(d1s), 2) if d1s else None,
            "avgDrift5d":    round(sum(d5s) / len(d5s), 2) if d5s else None,
        }
        cache_set(cache_key, result)
        return result
    except Exception as exc:
        logger.warning("Earnings surprise %s: %s", sym, exc)
        return None


@router.get("/api/market/earnings-surprise")
def get_earnings_surprise(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(syms), 6)) as pool:
        futures = {pool.submit(_fetch_earn_surprise, sym): sym for sym in syms}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                results.append(r)
    results.sort(key=lambda x: -(x.get("beatRate") or 0))
    return results


