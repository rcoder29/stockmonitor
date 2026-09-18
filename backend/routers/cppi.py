"""CPPI Allocator — Portfolio → CPPI Allocator.

Constant Proportion Portfolio Insurance: dynamically splits a portfolio
between a risky asset and a safe (cash/bond-like) asset so that value never
falls below a floor. exposure = multiplier x (portfolio_value - floor),
rebalanced whenever actual vs. target risky-asset weight drifts past a
configured band.
"""
import logging
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import yfinance as yf

from database import db_session, CppiStrategy, CppiRebalanceLog
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

# ── CPPI Allocator ───────────────────────────────────────────────────────────
# Constant Proportion Portfolio Insurance: dynamically splits a portfolio between
# a risky asset and a safe (cash/bond-like) asset so that value never falls below
# a floor. exposure = multiplier × (portfolio_value − floor), rebalanced whenever
# actual vs. target risky-asset weight drifts past a configured band.

class CppiConfigCreate(BaseModel):
    risky_symbol:       str
    initial_capital:    float = 10000.0
    floor_pct:          float = 90.0   # floor as % of initial capital
    multiplier:         float = 4.0
    safe_rate_pct:      float = 4.5    # annual yield on the safe-asset sleeve
    rebalance_band_pct: float = 5.0    # drift (pct pts) that triggers a rebalance


def _cppi_days_between(d1: str, d2: str) -> int:
    return (datetime.strptime(d2, "%Y-%m-%d") - datetime.strptime(d1, "%Y-%m-%d")).days


def _cppi_floor_value(strategy: "CppiStrategy", as_of: str) -> float:
    base_floor = strategy.initial_capital * strategy.floor_pct / 100
    years = max(0.0, _cppi_days_between(strategy.start_date, as_of) / 365.25)
    return base_floor * ((1 + strategy.safe_rate_pct / 100) ** years)


def _cppi_accrued_safe_cash(strategy: "CppiStrategy", as_of: str) -> float:
    days = max(0, _cppi_days_between(strategy.last_rebalance_date, as_of))
    daily_rate = strategy.safe_rate_pct / 100 / 365.25
    return strategy.safe_cash * ((1 + daily_rate) ** days)


def _cppi_price(symbol: str) -> float:
    try:
        price = _safe_float(yf.Ticker(symbol, session=_session).fast_info.last_price)
    except Exception as e:
        raise HTTPException(500, f"Price fetch failed: {e}")
    if not price:
        raise HTTPException(400, f"Could not fetch a price for {symbol}")
    return price


def _cppi_config_dict(strategy: "CppiStrategy") -> dict:
    return {
        "id":                 strategy.id,
        "riskySymbol":        strategy.risky_symbol,
        "safeRatePct":        strategy.safe_rate_pct,
        "initialCapital":     strategy.initial_capital,
        "floorPct":           strategy.floor_pct,
        "multiplier":         strategy.multiplier,
        "rebalanceBandPct":   strategy.rebalance_band_pct,
        "startDate":          strategy.start_date,
        "lastRebalanceDate":  strategy.last_rebalance_date,
        "lastRebalancePrice": round(strategy.last_rebalance_price, 2),
    }


def _cppi_state(strategy: "CppiStrategy", current_price: float) -> dict:
    today = datetime.utcnow().strftime("%Y-%m-%d")
    safe_cash_now = _cppi_accrued_safe_cash(strategy, today)
    exposure_now = strategy.risky_shares * current_price
    portfolio_value = exposure_now + safe_cash_now
    floor_value = _cppi_floor_value(strategy, today)
    cushion = max(0.0, portfolio_value - floor_value)
    target_exposure = min(portfolio_value, max(0.0, strategy.multiplier * cushion))
    target_pct = (target_exposure / portfolio_value * 100) if portfolio_value else 0.0
    actual_pct = (exposure_now / portfolio_value * 100) if portfolio_value else 0.0
    drift_pct = actual_pct - target_pct

    return {
        "date":               today,
        "riskyPrice":         round(current_price, 2),
        "portfolioValue":     round(portfolio_value, 2),
        "floorValue":         round(floor_value, 2),
        "cushion":            round(cushion, 2),
        "safeCash":           round(safe_cash_now, 2),
        "riskyExposure":      round(exposure_now, 2),
        "riskySharesHeld":    round(strategy.risky_shares, 4),
        "targetExposure":     round(target_exposure, 2),
        "targetExposurePct":  round(target_pct, 1),
        "actualExposurePct":  round(actual_pct, 1),
        "driftPct":           round(drift_pct, 1),
        "recommendedTrade":   round(target_exposure - exposure_now, 2),
        "needsRebalance":     portfolio_value > 0 and abs(drift_pct) > strategy.rebalance_band_pct,
        "totalReturnPct":     round((portfolio_value / strategy.initial_capital - 1) * 100, 2)
                               if strategy.initial_capital else 0.0,
        "distanceToFloorPct": round((portfolio_value / floor_value - 1) * 100, 1) if floor_value else None,
    }


@router.get("/api/cppi")
def get_cppi():
    with db_session() as db:
        strategy = db.query(CppiStrategy).order_by(CppiStrategy.id.desc()).first()
        if not strategy:
            return {"active": False}
        log_rows = (db.query(CppiRebalanceLog)
                      .filter(CppiRebalanceLog.strategy_id == strategy.id)
                      .order_by(CppiRebalanceLog.created_at.desc()).all())
        config = _cppi_config_dict(strategy)
        s = strategy

    price = _cppi_price(s.risky_symbol)
    state = _cppi_state(s, price)
    log = [{
        "date":            r.date,
        "riskyPrice":      round(r.risky_price, 2),
        "portfolioValue":  round(r.portfolio_value, 2),
        "floorValue":      round(r.floor_value, 2),
        "cushion":         round(r.cushion, 2),
        "exposureBefore":  round(r.exposure_before, 2),
        "exposureAfter":   round(r.exposure_after, 2),
        "tradeAmount":     round(r.trade_amount, 2),
        "trigger":         r.trigger,
    } for r in log_rows]

    return {"active": True, "config": config, "state": state, "log": log}


@router.post("/api/cppi", status_code=201)
def create_cppi(body: CppiConfigCreate):
    symbol = body.risky_symbol.strip().upper()
    if not symbol:
        raise HTTPException(400, "Risky asset symbol is required")
    if body.initial_capital <= 0:
        raise HTTPException(400, "Initial capital must be positive")
    if not (0 < body.floor_pct < 100):
        raise HTTPException(400, "Floor % must be between 0 and 100")
    if body.multiplier <= 0:
        raise HTTPException(400, "Multiplier must be positive")

    price = _cppi_price(symbol)
    today = datetime.utcnow().strftime("%Y-%m-%d")

    floor_value = body.initial_capital * body.floor_pct / 100
    cushion = max(0.0, body.initial_capital - floor_value)
    exposure = min(body.initial_capital, max(0.0, body.multiplier * cushion))
    risky_shares = exposure / price
    safe_cash = body.initial_capital - exposure

    with db_session() as db:
        # Only one CPPI strategy is managed at a time — starting a new one replaces it.
        old_ids = [r.id for r in db.query(CppiStrategy).all()]
        if old_ids:
            db.query(CppiRebalanceLog).filter(CppiRebalanceLog.strategy_id.in_(old_ids)).delete(synchronize_session=False)
            db.query(CppiStrategy).filter(CppiStrategy.id.in_(old_ids)).delete(synchronize_session=False)

        strategy = CppiStrategy(
            risky_symbol         = symbol,
            safe_rate_pct        = body.safe_rate_pct,
            initial_capital      = body.initial_capital,
            floor_pct            = body.floor_pct,
            multiplier           = body.multiplier,
            rebalance_band_pct   = body.rebalance_band_pct,
            start_date           = today,
            risky_shares         = risky_shares,
            safe_cash            = safe_cash,
            last_rebalance_date  = today,
            last_rebalance_price = price,
        )
        db.add(strategy)
        db.flush()
        db.add(CppiRebalanceLog(
            strategy_id=strategy.id, date=today, risky_price=price,
            portfolio_value=body.initial_capital, floor_value=floor_value, cushion=cushion,
            exposure_before=0.0, exposure_after=exposure, trade_amount=exposure, trigger="initial",
        ))
        return {"id": strategy.id}


@router.delete("/api/cppi", status_code=204)
def delete_cppi():
    with db_session() as db:
        old_ids = [r.id for r in db.query(CppiStrategy).all()]
        if old_ids:
            db.query(CppiRebalanceLog).filter(CppiRebalanceLog.strategy_id.in_(old_ids)).delete(synchronize_session=False)
            db.query(CppiStrategy).filter(CppiStrategy.id.in_(old_ids)).delete(synchronize_session=False)


@router.post("/api/cppi/rebalance")
def rebalance_cppi():
    with db_session() as db:
        strategy = db.query(CppiStrategy).order_by(CppiStrategy.id.desc()).first()
        if not strategy:
            raise HTTPException(404, "No active CPPI strategy")
        s_id, symbol = strategy.id, strategy.risky_symbol

    price = _cppi_price(symbol)
    today = datetime.utcnow().strftime("%Y-%m-%d")

    with db_session() as db:
        strategy = db.query(CppiStrategy).filter(CppiStrategy.id == s_id).first()
        if not strategy:
            raise HTTPException(404, "No active CPPI strategy")

        safe_cash_now = _cppi_accrued_safe_cash(strategy, today)
        exposure_before = strategy.risky_shares * price
        portfolio_value = exposure_before + safe_cash_now
        floor_value = _cppi_floor_value(strategy, today)
        cushion = max(0.0, portfolio_value - floor_value)
        target_exposure = min(portfolio_value, max(0.0, strategy.multiplier * cushion))

        strategy.risky_shares = target_exposure / price if price else 0.0
        strategy.safe_cash = portfolio_value - target_exposure
        strategy.last_rebalance_date = today
        strategy.last_rebalance_price = price

        db.add(CppiRebalanceLog(
            strategy_id=s_id, date=today, risky_price=price,
            portfolio_value=portfolio_value, floor_value=floor_value, cushion=cushion,
            exposure_before=exposure_before, exposure_after=target_exposure,
            trade_amount=target_exposure - exposure_before, trigger="manual",
        ))
        return {"ok": True}


class CppiBacktestRequest(BaseModel):
    symbol:              str
    period:              str   = "2y"
    initial_capital:     float = 10000.0
    floor_pct:           float = 90.0
    multiplier:          float = 4.0
    safe_rate_pct:       float = 4.5
    rebalance_band_pct:  float = 5.0


@router.post("/api/cppi/backtest")
def backtest_cppi(body: CppiBacktestRequest):
    symbol = body.symbol.strip().upper()
    period_map = {"6mo": "6mo", "1y": "1y", "2y": "2y", "5y": "5y"}
    yf_period = period_map.get(body.period, "2y")

    try:
        hist = yf.Ticker(symbol, session=_session).history(period=yf_period)
        if hist.empty or len(hist) < 30:
            raise HTTPException(400, "Insufficient price history")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Data fetch failed: {e}")

    closes = [float(v) for v in hist["Close"].tolist()]
    dates  = [str(d.date()) for d in hist.index]
    n = len(closes)

    daily_safe_rate = body.safe_rate_pct / 100 / 365.25
    base_floor = body.initial_capital * body.floor_pct / 100
    start_dt = hist.index[0]

    floor_series, cppi_equity, risky_pct_series = [], [], []

    floor0 = base_floor
    cushion0 = max(0.0, body.initial_capital - floor0)
    exposure0 = min(body.initial_capital, max(0.0, body.multiplier * cushion0))
    risky_shares = exposure0 / closes[0]
    safe_cash = body.initial_capital - exposure0

    rebalances = [{"date": dates[0], "price": round(closes[0], 2), "action": "INITIAL",
                   "exposurePct": round(exposure0 / body.initial_capital * 100, 1) if body.initial_capital else 0}]

    for i in range(n):
        price = closes[i]
        years = (hist.index[i] - start_dt).days / 365.25
        floor_val = base_floor * ((1 + body.safe_rate_pct / 100) ** years)
        if i > 0:
            safe_cash *= (1 + daily_safe_rate)

        exposure = risky_shares * price
        portfolio_value = exposure + safe_cash
        cushion = max(0.0, portfolio_value - floor_val)
        target_exposure = min(portfolio_value, max(0.0, body.multiplier * cushion))
        actual_pct = (exposure / portfolio_value * 100) if portfolio_value else 0.0
        target_pct = (target_exposure / portfolio_value * 100) if portfolio_value else 0.0

        if portfolio_value > 0 and abs(actual_pct - target_pct) > body.rebalance_band_pct:
            trade = target_exposure - exposure
            risky_shares = target_exposure / price if price else 0.0
            safe_cash = portfolio_value - target_exposure
            rebalances.append({"date": dates[i], "price": round(price, 2),
                                "action": "BUY" if trade > 0 else "SELL",
                                "exposurePct": round(target_pct, 1)})
            exposure, actual_pct = target_exposure, target_pct

        floor_series.append(round(floor_val, 2))
        cppi_equity.append(round(portfolio_value, 2))
        risky_pct_series.append(round(actual_pct, 1))

    bh_shares = body.initial_capital / closes[0]
    benchmark = [round(bh_shares * c, 2) for c in closes]

    final_eq  = cppi_equity[-1]
    total_ret = (final_eq / body.initial_capital - 1) * 100
    bh_ret    = (benchmark[-1] / body.initial_capital - 1) * 100

    def _max_dd(series):
        peak = series[0]; mdd = 0.0
        for v in series:
            if v > peak: peak = v
            dd = (v - peak) / peak * 100 if peak > 0 else 0
            if dd < mdd: mdd = dd
        return mdd

    return {
        "dates":      dates,
        "cppiEquity": cppi_equity,
        "benchmark":  benchmark,
        "floorLine":  floor_series,
        "riskyPct":   risky_pct_series,
        "rebalances": rebalances,
        "stats": {
            "totalReturn":    round(total_ret, 2),
            "bhReturn":       round(bh_ret, 2),
            "alpha":          round(total_ret - bh_ret, 2),
            "maxDrawdown":    round(_max_dd(cppi_equity), 2),
            "bhMaxDrawdown":  round(_max_dd(benchmark), 2),
            "finalEquity":    round(final_eq, 2),
            "numRebalances":  len(rebalances) - 1,
            "floorBreached":  any(e < f for e, f in zip(cppi_equity, floor_series)),
        },
    }


