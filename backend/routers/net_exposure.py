"""Net Market Exposure — Portfolio → Net Exposure.

Rolls stock beta, options delta, and CPPI risky-sleeve exposure into a single
"SPY-equivalent" market exposure number. Merger Arb and SPAC capital are shown
as separate sleeves rather than beta-adjusted — those strategies are
event-driven (deal completion / trust redemption), not a bet on market
direction, so folding them into a beta sum would misrepresent what they
actually expose you to.

_compute_portfolio_risk / _fetch_day_quote / _fetch_fundamentals /
_live_option_price / _sanitize_nan are core helpers used throughout main.py
by many unrelated features — imported lazily inside the functions that need
them below rather than at module level, since main.py imports this router
(to register it) and importing main.py back at module level here would be
circular. Safe because these are only called per-request, long after both
modules have finished loading.
"""
import math
import asyncio
import logging
from datetime import timedelta, datetime
import pandas as pd
from fastapi import APIRouter

from database import db_session, cache_get, cache_set, OptionsPosition, CppiStrategy
from routers.cppi import _cppi_price, _cppi_state
from routers.merger_arb import get_arb_positions
from routers.spacs import get_spac_positions

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Net Market Exposure ───────────────────────────────────────────────────────
# Rolls stock beta, options delta, and CPPI risky-sleeve exposure into a single
# "SPY-equivalent" market exposure number. Merger Arb and SPAC capital are shown
# as separate sleeves rather than beta-adjusted — those strategies are event-driven
# (deal completion / trust redemption), not a bet on market direction, so folding
# them into a beta sum would misrepresent what they actually expose you to.

_NET_EXPOSURE_TTL = timedelta(minutes=2)


def _norm_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _bs_delta(option_type: str, underlying_price, strike, years, iv, r: float = 0.045):
    """Black-Scholes delta, computed from strike/expiry/IV — yfinance's option
    chain doesn't reliably supply delta, so we derive it ourselves."""
    if underlying_price is None or not strike or iv is None or iv <= 0 or years is None:
        return None
    if years <= 0:
        itm = underlying_price > strike if option_type == "call" else underlying_price < strike
        if not itm:
            return 0.0
        return 1.0 if option_type == "call" else -1.0
    try:
        d1 = (math.log(underlying_price / strike) + (r + iv ** 2 / 2) * years) / (iv * math.sqrt(years))
        return _norm_cdf(d1) if option_type == "call" else _norm_cdf(d1) - 1
    except (ValueError, ZeroDivisionError):
        return None


async def _net_exposure_options_sleeve() -> dict:
    from main import _fetch_day_quote, _fetch_fundamentals, _live_option_price

    with db_session() as db:
        rows = db.query(OptionsPosition).all()
        positions = [{"symbol": r.symbol, "option_type": r.option_type, "strike": r.strike,
                      "expiry": r.expiry, "quantity": r.quantity} for r in rows]

    empty = {"positionCount": 0, "marketExposure": 0.0, "unresolvedCount": 0}
    if not positions:
        return empty

    today = datetime.utcnow().date()
    loop = asyncio.get_event_loop()
    underlyings = list({p["symbol"] for p in positions})

    async def get_underlying(sym):
        price_d = await loop.run_in_executor(None, _fetch_day_quote, sym)
        fund    = await loop.run_in_executor(None, _fetch_fundamentals, sym)
        return sym, {"price": price_d.get("price"), "beta": fund.get("beta")}

    underlying_data = dict(await asyncio.gather(*[get_underlying(s) for s in underlyings]))

    async def enrich(pos):
        live = await loop.run_in_executor(
            None, lambda: _live_option_price(pos["symbol"], pos["option_type"], pos["strike"], pos["expiry"])
        )
        u = underlying_data.get(pos["symbol"], {})
        u_price = u.get("price")
        years = max((pd.to_datetime(pos["expiry"]).date() - today).days, 0) / 365.25
        delta = _bs_delta(pos["option_type"], u_price, pos["strike"], years, live.get("iv"))
        if delta is None or u_price is None:
            return None
        beta = u.get("beta") if u.get("beta") is not None else 1.0
        return pos["quantity"] * delta * 100 * u_price * beta

    resolved = await asyncio.gather(*[enrich(p) for p in positions])
    exposures = [e for e in resolved if e is not None]

    return {
        "positionCount":  len(positions),
        "marketExposure": round(sum(exposures), 2),
        "unresolvedCount": len(positions) - len(exposures),
    }


@router.get("/api/portfolio/net-exposure")
async def get_net_exposure():
    from main import _compute_portfolio_risk, _fetch_fundamentals, _sanitize_nan

    cached = cache_get("portfolio:net-exposure", _NET_EXPOSURE_TTL)
    if cached is not None:
        return cached

    loop = asyncio.get_event_loop()
    sleeves = []

    # Stocks — beta-adjusted market value, reusing the existing risk calc.
    try:
        risk = await loop.run_in_executor(None, _compute_portfolio_risk)
        if "error" not in risk:
            stock_value = risk["total_value"]
            stock_exposure = round(risk["portfolio_beta"] * stock_value, 2) if risk["portfolio_beta"] is not None else None
            sleeves.append({
                "key": "stocks", "label": "Stocks",
                "capitalValue": stock_value, "marketExposure": stock_exposure,
                "beta": risk["portfolio_beta"], "includedInBeta": True,
            })
            stock_var95, stock_var99 = risk.get("var95"), risk.get("var99")
        else:
            stock_var95 = stock_var99 = None
    except Exception as e:
        logger.warning("net-exposure stocks sleeve failed: %s", e)
        stock_var95 = stock_var99 = None

    # Options — delta-adjusted, beta-weighted equivalent stock exposure.
    try:
        opt = await _net_exposure_options_sleeve()
        if opt["positionCount"]:
            sleeves.append({
                "key": "options", "label": "Options (Δ-adjusted)",
                "capitalValue": None, "marketExposure": opt["marketExposure"],
                "beta": None, "includedInBeta": True,
                "note": f"Delta-adjusted equivalent stock exposure, beta-weighted by underlying. "
                        f"{opt['unresolvedCount']} of {opt['positionCount']} position(s) could not be priced." if opt["unresolvedCount"] else
                        "Delta-adjusted equivalent stock exposure, beta-weighted by underlying.",
            })
    except Exception as e:
        logger.warning("net-exposure options sleeve failed: %s", e)

    # CPPI — risky-sleeve exposure from the active strategy, if any.
    try:
        with db_session() as db:
            cppi = db.query(CppiStrategy).order_by(CppiStrategy.id.desc()).first()
        if cppi:
            price = await loop.run_in_executor(None, _cppi_price, cppi.risky_symbol)
            state = _cppi_state(cppi, price)
            fund  = await loop.run_in_executor(None, _fetch_fundamentals, cppi.risky_symbol)
            beta  = fund.get("beta") if fund.get("beta") is not None else 1.0
            sleeves.append({
                "key": "cppi", "label": f"CPPI ({cppi.risky_symbol})",
                "capitalValue": state["riskyExposure"], "marketExposure": round(state["riskyExposure"] * beta, 2),
                "beta": beta, "includedInBeta": True,
            })
    except Exception as e:
        logger.warning("net-exposure CPPI sleeve failed: %s", e)

    # Merger Arb & SPACs — capital deployed, shown separately (event-driven, not market-beta risk).
    try:
        merger_summary = get_arb_positions().get("summary")
        if merger_summary and merger_summary.get("totalMarketValue"):
            sleeves.append({
                "key": "mergerarb", "label": "Merger Arb",
                "capitalValue": merger_summary["totalMarketValue"], "marketExposure": None,
                "beta": None, "includedInBeta": False,
                "note": "Event-driven deal-completion risk, not market-beta exposure, by strategy design.",
            })
    except Exception as e:
        logger.warning("net-exposure merger arb sleeve failed: %s", e)

    try:
        spac_summary = get_spac_positions().get("summary")
        if spac_summary and spac_summary.get("totalMarketValue"):
            sleeves.append({
                "key": "spacs", "label": "SPACs",
                "capitalValue": spac_summary["totalMarketValue"], "marketExposure": None,
                "beta": None, "includedInBeta": False,
                "note": "Pre-deal SPACs trade near trust value with minimal market beta.",
            })
    except Exception as e:
        logger.warning("net-exposure SPAC sleeve failed: %s", e)

    total_capital = sum(s["capitalValue"] for s in sleeves if s["capitalValue"] is not None)
    net_exposure  = sum(s["marketExposure"] for s in sleeves if s["includedInBeta"] and s["marketExposure"] is not None)

    result = {
        "asOf": datetime.utcnow().isoformat(),
        "sleeves": sleeves,
        "totalCapitalDeployed": round(total_capital, 2),
        "netMarketExposure": round(net_exposure, 2),
        "netMarketExposurePct": round(net_exposure / total_capital * 100, 1) if total_capital else None,
        "stockVar95": stock_var95,
        "stockVar99": stock_var99,
    }
    result = _sanitize_nan(result)
    cache_set("portfolio:net-exposure", result)
    return result


