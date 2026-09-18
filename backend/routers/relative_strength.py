"""Relative Strength Ranker — Research → Relative Strength.

Ranks symbols by relative strength vs. SPY across 1W/1M/3M/6M/1Y windows,
with a composite score.
"""
import logging
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter
import pandas as pd
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Relative Strength Ranker ──────────────────────────────────────────────────

_RS_TTL = timedelta(minutes=30)


@router.get("/api/market/relative-strength")
def get_relative_strength(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []

    all_syms = list(dict.fromkeys(syms + ["SPY"]))
    cache_key = f"rs:{'_'.join(sorted(syms))}"
    cached = cache_get(cache_key, _RS_TTL)
    if cached:
        return cached

    def _fetch_rs_data(sym: str):
        try:
            hist = yf.Ticker(sym).history(period="1y")
            if hist.empty or len(hist) < 20:
                return sym, None
            closes = hist["Close"].dropna()
            return sym, closes
        except Exception:
            return sym, None

    price_map: dict[str, pd.Series] = {}
    with ThreadPoolExecutor(max_workers=min(len(all_syms), 8)) as pool:
        for sym, closes in pool.map(_fetch_rs_data, all_syms):
            if closes is not None:
                price_map[sym] = closes

    spy_closes = price_map.get("SPY")
    if spy_closes is None:
        return []

    def _period_return(closes: pd.Series, days: int) -> float | None:
        if len(closes) < days + 1:
            return None
        end   = float(closes.iloc[-1])
        start = float(closes.iloc[-days - 1])
        return round((end / start - 1) * 100, 2) if start else None

    def _rs_ratio(stock_ret: float | None, spy_ret: float | None) -> float | None:
        if stock_ret is None or spy_ret is None:
            return None
        if spy_ret == 0:
            return None
        return round(stock_ret / abs(spy_ret) if spy_ret < 0 else stock_ret / spy_ret, 3)

    PERIODS = [(5, "rs1w"), (21, "rs1m"), (63, "rs3m"), (126, "rs6m"), (252, "rs1y")]
    spy_rets = {label: _period_return(spy_closes, days) for days, label in PERIODS}

    results = []
    for sym in syms:
        closes = price_map.get(sym)
        if closes is None:
            continue
        try:
            t = yf.Ticker(sym)
            info = {}
            try:
                fi = t.fast_info
                price = _safe_float(getattr(fi, "last_price", None))
            except Exception:
                price = None
            try:
                info = t.info or {}
            except Exception:
                pass
            name   = info.get("longName") or info.get("shortName") or sym
            sector = info.get("sector")

            row: dict = {"symbol": sym, "name": name, "sector": sector, "price": price}
            composite_parts = []
            for days, label in PERIODS:
                sr = _period_return(closes, days)
                rs = _rs_ratio(sr, spy_rets[label])
                row[label.replace("rs", "ret")] = sr
                row[label] = rs
                if rs is not None:
                    composite_parts.append(rs)

            row["composite"] = round(sum(composite_parts) / len(composite_parts), 3) if composite_parts else None
            results.append(row)
        except Exception as exc:
            logger.warning("RS %s: %s", sym, exc)

    results.sort(key=lambda x: -(x.get("composite") or 0))
    cache_set(cache_key, results)
    return results


