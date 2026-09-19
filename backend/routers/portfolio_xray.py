"""Portfolio X-Ray — Portfolio -> X-Ray.

Sector/cap/country concentration breakdown, weighted P/E and beta, across
current holdings.
"""
import asyncio
from datetime import timedelta
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import db_session, cache_get, cache_set, PortfolioPosition
from edgar_utils import _session, _safe_float

router = APIRouter()

# ── Portfolio X-Ray ────────────────────────────────────────────────────────────

_XRAY_TTL = timedelta(hours=1)

_CAP_BUCKETS = [
    (200e9, "Mega Cap (>$200B)"),
    (10e9,  "Large Cap ($10–200B)"),
    (2e9,   "Mid Cap ($2–10B)"),
    (300e6, "Small Cap ($300M–2B)"),
    (0,     "Micro Cap (<$300M)"),
]


def _compute_xray() -> dict:
    cache_key = "portfolio:xray"
    cached = cache_get(cache_key, _XRAY_TTL)
    if cached is not None:
        return cached

    with db_session() as db:
        positions = db.query(PortfolioPosition).all()
        holdings  = [{"symbol": p.symbol, "shares": p.shares, "avg_cost": p.avg_cost} for p in positions]

    if not holdings:
        raise ValueError("No portfolio positions")

    symbols = [h["symbol"] for h in holdings]

    # Fetch prices for market values
    try:
        prices_raw = yf.download(symbols, period="2d", interval="1d", auto_adjust=True, progress=False, session=_session)
        closes     = prices_raw["Close"].dropna(how="all") if isinstance(prices_raw.columns, pd.MultiIndex) else prices_raw.dropna(how="all")
        price_map  = {s: float(closes[s].dropna().iloc[-1]) for s in symbols if s in closes.columns}
    except Exception:
        price_map = {}

    vals = {h["symbol"]: price_map.get(h["symbol"], h["avg_cost"]) * h["shares"] for h in holdings}
    total_val = sum(vals.values()) or 1.0

    # Fetch fundamentals per symbol
    sector_weights: dict[str, float] = {}
    cap_weights:    dict[str, float] = {}
    country_weights:dict[str, float] = {}
    pe_sum = pe_weight = 0.0
    beta_sum = beta_weight = 0.0
    holding_details = []

    for sym in symbols:
        w = vals.get(sym, 0) / total_val
        try:
            info = yf.Ticker(sym, session=_session).info
            sector  = info.get("sector") or info.get("sectorDisp") or "Unknown"
            country = info.get("country") or "Unknown"
            mktcap  = _safe_float(info.get("marketCap"))
            pe      = _safe_float(info.get("trailingPE"))
            beta    = _safe_float(info.get("beta"))

            sector_weights[sector]   = sector_weights.get(sector, 0) + w
            country_weights[country] = country_weights.get(country, 0) + w

            cap_label = _CAP_BUCKETS[-1][1]
            if mktcap:
                for threshold, label in _CAP_BUCKETS:
                    if mktcap >= threshold:
                        cap_label = label
                        break
            cap_weights[cap_label] = cap_weights.get(cap_label, 0) + w

            if pe and 0 < pe < 500:
                pe_sum    += pe * w
                pe_weight += w
            if beta:
                beta_sum    += beta * w
                beta_weight += w

            holding_details.append({
                "symbol":   sym,
                "weight":   round(w * 100, 1),
                "sector":   sector,
                "country":  country,
                "mktcap":   mktcap,
                "cap_label": cap_label,
                "pe":        round(pe, 1) if pe else None,
                "beta":      round(beta, 2) if beta else None,
            })
        except Exception:
            holding_details.append({"symbol": sym, "weight": round(w * 100, 1), "sector": "Unknown"})

    def top_sorted(d: dict) -> list:
        total = sum(d.values()) or 1
        return sorted([{"label": k, "pct": round(v / total * 100, 1)} for k, v in d.items()],
                      key=lambda x: -x["pct"])

    result = {
        "total_value":       round(total_val, 2),
        "weighted_pe":       round(pe_sum / pe_weight, 1) if pe_weight > 0 else None,
        "weighted_beta":     round(beta_sum / beta_weight, 2) if beta_weight > 0 else None,
        "sector_breakdown":  top_sorted(sector_weights),
        "cap_breakdown":     top_sorted(cap_weights),
        "country_breakdown": top_sorted(country_weights),
        "holdings":          sorted(holding_details, key=lambda h: -h["weight"]),
        "concentration_top3": round(sum(h["weight"] for h in sorted(holding_details, key=lambda h: -h["weight"])[:3]), 1),
    }
    cache_set(cache_key, result)
    return result


@router.get("/api/portfolio/xray")
async def get_portfolio_xray():
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, _compute_xray)
    except ValueError as e:
        raise HTTPException(400, str(e))


