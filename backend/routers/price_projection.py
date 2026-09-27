"""Price Projection — Research → Price Projection.

Given a ticker (stock or ETF), projects a probabilistic price range out to 1
year, combining four market-implied inputs:

  - Options-implied volatility term structure: ATM implied vol from every
    available expiration out to ~13 months (yfinance option chains), used as
    the primary volatility input at each monthly horizon (interpolated
    between the expiries actually traded, rather than one flat number scaled
    by sqrt(t)). Falls back to trailing 1-year realized volatility for
    non-optionable symbols.
  - The 1-year Treasury yield (routers/treasury.py) as the risk-free rate for
    a standard risk-neutral drift (r - q), net of the security's own
    dividend yield.
  - VIX vs. its trailing 1-year median, as a market-wide vol-regime
    multiplier scaling the options-implied vol up or down.
  - The issuer's own corporate-bond credit spread over Treasuries
    (routers/corporate_bonds.py) as a proxy for single-name CDS. True
    single-name CDS data is proprietary (Markit/Bloomberg/ICE) and not
    available from any free source, so this reuses the bond-YTM-vs-Treasury
    spread this app already computes for the same issuer. A wide spread
    prices default/distress risk, which is asymmetric, so it only pulls the
    lower percentiles (p10/p25) down further — it never widens the upside.

The result is a lognormal percentile cone (p10/p25/p50/p75/p90), not a
forecast: it says what the market's own pricing (options, rates, credit)
implies about the range of outcomes, assuming those prices are efficient and
returns are lognormal — both simplifying assumptions. See `methodologyNote`
in the response, always returned alongside the raw inputs so nothing is a
black box.
"""
import logging
import asyncio
import math
import statistics
from datetime import timedelta, datetime, date
from fastapi import APIRouter
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float, _dividend_yield_fraction
from routers.treasury import treasury_current
from routers.corporate_bonds import bonds_search

logger = logging.getLogger(__name__)
router = APIRouter()

_PROJECTION_TTL = timedelta(hours=2)

_PERCENTILES = [("p10", -1.2816), ("p25", -0.6745), ("p50", 0.0), ("p75", 0.6745), ("p90", 1.2816)]
_HORIZON_MONTHS = 12
_MAX_EXPIRIES_SAMPLED = 10
_MAX_DAYS_OUT = 400

_METHODOLOGY_NOTE = (
    "Probabilistic, market-implied cone — not a forecast or investment advice. "
    "Median assumes risk-neutral drift (1yr Treasury yield minus dividend yield). "
    "Bands assume lognormal returns using the options market's own implied "
    "volatility at each horizon (interpolated across traded expirations, or "
    "trailing realized volatility when the symbol has no options), scaled by "
    "the current VIX regime. The lower bands (p10/p25) are pulled down further "
    "when the issuer's own corporate-bond credit spread is elevated, as a proxy "
    "for single-name CDS — true CDS data is proprietary and not available from "
    "any free source."
)


def _get_price(t) -> float | None:
    try:
        info = t.info or {}
        price = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
        if price:
            return price
    except Exception:
        pass
    try:
        hist = t.history(period="5d")
        if not hist.empty:
            return _safe_float(hist["Close"].dropna().iloc[-1])
    except Exception:
        pass
    return None


def _get_dividend_yield(t) -> float:
    try:
        return _dividend_yield_fraction(t.info or {}) or 0.0
    except Exception:
        return 0.0


def _atm_iv(t, expiry: str, price: float) -> float | None:
    """ATM implied vol (annualized, decimal) for one expiry — averages call+put IV
    at the strike nearest the current price."""
    try:
        chain = t.option_chain(expiry)
        calls, puts = chain.calls, chain.puts
        if calls.empty:
            return None
        strikes = calls["strike"].values
        atm_idx = int(abs(strikes - price).argmin())
        atm_strike = float(strikes[atm_idx])
        ivs = []
        c_row = calls[calls["strike"] == atm_strike]
        if not c_row.empty:
            iv = _safe_float(c_row["impliedVolatility"].values[0])
            if iv and iv > 0:
                ivs.append(iv)
        if not puts.empty:
            p_row = puts[puts["strike"] == atm_strike]
            if not p_row.empty:
                iv = _safe_float(p_row["impliedVolatility"].values[0])
                if iv and iv > 0:
                    ivs.append(iv)
        return statistics.mean(ivs) if ivs else None
    except Exception as e:
        logger.warning("ATM IV fetch failed for expiry %s: %s", expiry, e)
        return None


def _implied_vol_curve(t, price: float) -> list[tuple[int, str, float]]:
    """Sorted [(days_out, expiry, atm_iv)] for expiries within _MAX_DAYS_OUT,
    subsampled to _MAX_EXPIRIES_SAMPLED to bound the number of option-chain fetches
    (a weeklies-heavy name can have 40+ expirations inside a year)."""
    try:
        expiries = list(t.options or [])
    except Exception:
        expiries = []
    today = date.today()
    dated = []
    for exp in expiries:
        try:
            d = datetime.strptime(exp, "%Y-%m-%d").date()
            days_out = (d - today).days
            if 0 < days_out <= _MAX_DAYS_OUT:
                dated.append((days_out, exp))
        except ValueError:
            continue
    dated.sort()
    if len(dated) > _MAX_EXPIRIES_SAMPLED:
        step = len(dated) / _MAX_EXPIRIES_SAMPLED
        dated = [dated[int(i * step)] for i in range(_MAX_EXPIRIES_SAMPLED)]

    curve = []
    for days_out, exp in dated:
        iv = _atm_iv(t, exp, price)
        if iv:
            curve.append((days_out, exp, iv))
    return curve


def _interp_sigma(curve: list[tuple[int, str, float]], days_out: int) -> float | None:
    """Piecewise-linear interpolation/extrapolation of the IV curve at an arbitrary horizon."""
    if not curve:
        return None
    if days_out <= curve[0][0]:
        return curve[0][2]
    if days_out >= curve[-1][0]:
        return curve[-1][2]
    for i in range(len(curve) - 1):
        d0, _, iv0 = curve[i]
        d1, _, iv1 = curve[i + 1]
        if d0 <= days_out <= d1:
            if d1 == d0:
                return iv0
            w = (days_out - d0) / (d1 - d0)
            return iv0 + w * (iv1 - iv0)
    return curve[-1][2]


def _historical_vol(t) -> float | None:
    """Fallback annualized realized vol from daily log returns — used only when
    the symbol has no listed options."""
    try:
        hist = t.history(period="1y")
        closes = hist["Close"].dropna()
        if len(closes) < 20:
            return None
        log_rets = [math.log(closes.iloc[i] / closes.iloc[i - 1]) for i in range(1, len(closes))]
        if len(log_rets) < 2:
            return None
        return statistics.stdev(log_rets) * math.sqrt(252)
    except Exception as e:
        logger.warning("historical vol calc failed: %s", e)
        return None


def _risk_free_rate() -> float | None:
    try:
        rates = treasury_current().get("rates", [])
        for r in rates:
            if r.get("key") == "1yr" and r.get("yield") is not None:
                return r["yield"] / 100.0
    except Exception as e:
        logger.warning("treasury fetch failed: %s", e)
    return None


def _vix_regime() -> dict | None:
    """Current VIX vs. its trailing 1yr median, as a clamped vol-scaling multiplier."""
    try:
        hist = yf.Ticker("^VIX", session=_session).history(period="1y")
        closes = hist["Close"].dropna()
        if closes.empty:
            return None
        current = float(closes.iloc[-1])
        median = float(closes.median())
        multiplier = (current / median) if median else 1.0
        multiplier = max(0.7, min(1.5, multiplier))

        term_structure = None
        try:
            v3h = yf.Ticker("^VIX3M", session=_session).history(period="5d")
            if not v3h.empty:
                vix3m = float(v3h["Close"].dropna().iloc[-1])
                term_structure = "contango" if current < vix3m else "backwardation"
        except Exception:
            pass

        return {
            "current":          round(current, 2),
            "trailingMedian":   round(median, 2),
            "regimeMultiplier": round(multiplier, 3),
            "termStructure":    term_structure,
        }
    except Exception as e:
        logger.warning("VIX regime fetch failed: %s", e)
        return None


def _credit_spread_proxy(symbol: str) -> dict | None:
    """Median credit spread (bps over Treasury) across the issuer's fund-held
    bonds, reusing corporate_bonds.py's own YTM-vs-Treasury calc as a single-name
    CDS proxy. Returns None if no fund-held, live-priced bonds are found (most
    non-investment-grade-bond-issuing companies, and all ETFs)."""
    try:
        result = bonds_search(symbol)
        spreads = [b["spreadBps"] for b in result.get("bonds", []) if b.get("spreadBps") is not None]
        if not spreads:
            return None
        return {
            "bps":       round(statistics.median(spreads)),
            "bondCount": len(spreads),
        }
    except Exception as e:
        logger.warning("credit spread proxy lookup failed for %s: %s", symbol, e)
        return None


def _credit_stress_factor(spread_bps: float | None) -> float:
    """Maps a credit spread to a [0, 0.3] downside-tail stress factor. 0 bps -> 0
    (no extra downside pull); ~1000+ bps (distressed) saturates at the 0.3 cap."""
    if not spread_bps or spread_bps <= 0:
        return 0.0
    return max(0.0, min(0.3, spread_bps / 1000.0))


def _project_percentiles(price: float, r: float, q: float, sigma: float, t: float,
                          credit_stress: float) -> dict:
    """Lognormal percentile prices at horizon t (years), given annualized drift
    (r - q) and volatility sigma. Applies the credit-stress factor only to the
    lower percentiles, scaled by how far out in time (more time = more room for
    credit deterioration to compound)."""
    out = {}
    for key, z in _PERCENTILES:
        exponent = (r - q) * t - 0.5 * sigma * sigma * t + z * sigma * math.sqrt(t)
        out[key] = price * math.exp(exponent)
    if credit_stress > 0:
        out["p10"] *= (1 - credit_stress * t)
        out["p25"] *= (1 - credit_stress * 0.4 * t)
    return {k: round(v, 2) for k, v in out.items()}


def _compute_price_projection(symbol: str) -> dict:
    try:
        t = yf.Ticker(symbol, session=_session)
        price = _get_price(t)
        if not price:
            return {"symbol": symbol, "error": "No price data available for this symbol."}

        dividend_yield = _get_dividend_yield(t)
        risk_free_rate = _risk_free_rate()
        vix = _vix_regime()
        credit_spread = _credit_spread_proxy(symbol)
        vol_curve = _implied_vol_curve(t, price)
        vol_source = "options" if vol_curve else "historical"
        hist_sigma = None if vol_curve else _historical_vol(t)

        if not vol_curve and hist_sigma is None:
            return {"symbol": symbol, "error": "No options or historical volatility data available for this symbol."}

        r = risk_free_rate if risk_free_rate is not None else 0.0
        q = dividend_yield
        vix_mult = vix["regimeMultiplier"] if vix else 1.0
        credit_stress = _credit_stress_factor(credit_spread["bps"] if credit_spread else None)

        today = date.today()
        points = [{
            "month": 0, "date": str(today), "daysOut": 0,
            **{key: round(price, 2) for key, _ in _PERCENTILES},
        }]
        for month in range(1, _HORIZON_MONTHS + 1):
            days_out = round(month * 365.25 / 12)
            t_years = days_out / 365.25
            sigma = _interp_sigma(vol_curve, days_out) if vol_curve else hist_sigma
            sigma_effective = sigma * vix_mult
            row = _project_percentiles(price, r, q, sigma_effective, t_years, credit_stress)
            points.append({
                "month":   month,
                "date":    str(today + timedelta(days=days_out)),
                "daysOut": days_out,
                "sigma":   round(sigma_effective, 4),
                **row,
            })

        return {
            "symbol":   symbol,
            "price":    price,
            "asOf":     str(today),
            "inputs": {
                "riskFreeRate":       round(r, 4) if risk_free_rate is not None else None,
                "dividendYield":      round(q, 4),
                "volSource":          vol_source,
                "volCurveExtrapolated": bool(vol_curve) and vol_curve[-1][0] < 330,
                "impliedVolCurve":    [
                    {"daysOut": d, "expiry": e, "atmIv": round(iv, 4)} for d, e, iv in vol_curve
                ],
                "historicalVol":      round(hist_sigma, 4) if hist_sigma is not None else None,
                "vix":                vix,
                "creditSpread":       credit_spread,
            },
            "projection":      points,
            "methodologyNote": _METHODOLOGY_NOTE,
        }
    except Exception as e:
        logger.warning("price projection failed for %s: %s", symbol, e)
        return {"symbol": symbol, "error": str(e)}


@router.get("/api/price-projection/{symbol}")
async def get_price_projection(symbol: str):
    sym = symbol.upper().strip()
    cache_key = f"priceproj:{sym}"
    cached = cache_get(cache_key, _PROJECTION_TTL)
    if cached is not None:
        return cached
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, lambda: _compute_price_projection(sym))
    cache_set(cache_key, result)
    return result
