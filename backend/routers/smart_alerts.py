"""Smart Alerts 2.0 — Watchlist -> Smart Alerts.

Rule-based alerts (volume spike, gap up/down, RSI overbought/oversold,
golden/death cross, earnings proximity) evaluated on demand via scan.
"""
import asyncio
import json
import logging
from datetime import datetime
import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import db_session, SmartAlertRule
from edgar_utils import _session, _calc_rsi

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Smart Alerts 2.0 ──────────────────────────────────────────────────────────

SMART_ALERT_TYPES = {
    "volume_spike":       {"param": "multiplier",  "default": 2.0,  "label": "Volume Spike"},
    "gap_up":             {"param": "pct",          "default": 2.0,  "label": "Gap Up"},
    "gap_down":           {"param": "pct",          "default": 2.0,  "label": "Gap Down"},
    "rsi_overbought":     {"param": "threshold",    "default": 70.0, "label": "RSI Overbought"},
    "rsi_oversold":       {"param": "threshold",    "default": 30.0, "label": "RSI Oversold"},
    "golden_cross":       {"param": None,           "default": None, "label": "Golden Cross (MA50/200)"},
    "death_cross":        {"param": None,           "default": None, "label": "Death Cross (MA50/200)"},
    "earnings_proximity": {"param": "days",         "default": 5,    "label": "Earnings Proximity"},
}


class SmartAlertCreate(BaseModel):
    symbol:     str
    alert_type: str
    params:     dict = {}


@router.get("/api/alerts/smart")
def list_smart_alerts():
    with db_session() as db:
        rules = db.query(SmartAlertRule).filter(SmartAlertRule.active == 1).order_by(SmartAlertRule.created_at.desc()).all()
        return [{"id": r.id, "symbol": r.symbol, "alert_type": r.alert_type,
                 "params": json.loads(r.params), "created_at": str(r.created_at)} for r in rules]


@router.post("/api/alerts/smart")
def create_smart_alert(req: SmartAlertCreate):
    sym = req.symbol.upper().strip()
    if req.alert_type not in SMART_ALERT_TYPES:
        raise HTTPException(400, f"Unknown alert_type. Valid: {list(SMART_ALERT_TYPES)}")
    with db_session() as db:
        rule = SmartAlertRule(symbol=sym, alert_type=req.alert_type, params=json.dumps(req.params))
        db.add(rule)
        db.flush()
        return {"id": rule.id, "symbol": sym, "alert_type": req.alert_type}


@router.delete("/api/alerts/smart/{rule_id}")
def delete_smart_alert(rule_id: int):
    with db_session() as db:
        rule = db.query(SmartAlertRule).filter(SmartAlertRule.id == rule_id).first()
        if not rule:
            raise HTTPException(404, "Rule not found")
        rule.active = 0
    return {"ok": True}


def _check_smart_rule(rule: dict) -> dict | None:
    sym        = rule["symbol"]
    atype      = rule["alert_type"]
    params     = rule["params"]

    try:
        t = yf.Ticker(sym, session=_session)
        hist = t.history(period="1y", interval="1d", auto_adjust=True)
        if len(hist) < 5:
            return None
        closes  = hist["Close"].dropna().values.astype(float)
        volumes = hist["Volume"].dropna().values.astype(float)

        if atype == "volume_spike":
            mult   = params.get("multiplier", 2.0)
            avg20  = float(np.mean(volumes[-21:-1])) if len(volumes) >= 21 else float(np.mean(volumes[:-1]))
            today  = float(volumes[-1])
            if avg20 > 0 and today >= mult * avg20:
                return {"triggered": True, "detail": f"Volume {today/avg20:.1f}× avg20 ({int(today):,} vs {int(avg20):,})"}

        elif atype in ("gap_up", "gap_down"):
            pct_thresh = params.get("pct", 2.0)
            prev_close = float(hist["Close"].dropna().iloc[-2])
            today_open = float(hist["Open"].dropna().iloc[-1])
            gap_pct    = (today_open / prev_close - 1) * 100
            if atype == "gap_up"   and gap_pct >= pct_thresh:
                return {"triggered": True, "detail": f"Gapped up {gap_pct:+.2f}% at open"}
            if atype == "gap_down" and gap_pct <= -pct_thresh:
                return {"triggered": True, "detail": f"Gapped down {gap_pct:+.2f}% at open"}

        elif atype in ("rsi_overbought", "rsi_oversold"):
            thresh = params.get("threshold", 70 if atype == "rsi_overbought" else 30)
            rsi    = float(_calc_rsi(pd.Series(closes), 14).iloc[-1])
            if atype == "rsi_overbought" and rsi >= thresh:
                return {"triggered": True, "detail": f"RSI(14) = {rsi:.1f} ≥ {thresh}"}
            if atype == "rsi_oversold"   and rsi <= thresh:
                return {"triggered": True, "detail": f"RSI(14) = {rsi:.1f} ≤ {thresh}"}

        elif atype in ("golden_cross", "death_cross"):
            if len(closes) < 201:
                return None
            ma50_today  = float(np.mean(closes[-50:]))
            ma200_today = float(np.mean(closes[-200:]))
            ma50_prev   = float(np.mean(closes[-51:-1]))
            ma200_prev  = float(np.mean(closes[-201:-1]))
            if atype == "golden_cross" and ma50_prev <= ma200_prev and ma50_today > ma200_today:
                return {"triggered": True, "detail": f"MA50 ({ma50_today:.2f}) crossed above MA200 ({ma200_today:.2f})"}
            if atype == "death_cross"  and ma50_prev >= ma200_prev and ma50_today < ma200_today:
                return {"triggered": True, "detail": f"MA50 ({ma50_today:.2f}) crossed below MA200 ({ma200_today:.2f})"}

        elif atype == "earnings_proximity":
            # Current yfinance returns .calendar as a plain dict, not a
            # DataFrame (see routers/rich_earnings_calendar.py for the same fix).
            days_thresh = int(params.get("days", 5))
            cal = t.calendar
            if cal and "Earnings Date" in cal:
                dates = cal["Earnings Date"]
                iterable = dates if hasattr(dates, "__iter__") and not isinstance(dates, str) else [dates]
                for d in iterable:
                    try:
                        next_date = d.date() if hasattr(d, "date") else pd.to_datetime(d).date()
                    except Exception:
                        continue
                    days_away = (next_date - datetime.utcnow().date()).days
                    if 0 <= days_away <= days_thresh:
                        return {"triggered": True, "detail": f"Earnings in {days_away} day(s) ({next_date})"}
                    break

    except Exception as e:
        logger.debug("smart alert check failed %s/%s: %s", sym, atype, e)

    return None


@router.post("/api/alerts/smart/scan")
async def scan_smart_alerts():
    with db_session() as db:
        rules = db.query(SmartAlertRule).filter(SmartAlertRule.active == 1).all()
        rule_dicts = [{"id": r.id, "symbol": r.symbol, "alert_type": r.alert_type,
                       "params": json.loads(r.params)} for r in rules]

    if not rule_dicts:
        return []

    loop    = asyncio.get_event_loop()
    futures = {loop.run_in_executor(None, _check_smart_rule, r): r for r in rule_dicts}
    results = []
    for fut, rule in futures.items():
        outcome = await fut
        if outcome and outcome.get("triggered"):
            results.append({
                "id":         rule["id"],
                "symbol":     rule["symbol"],
                "alert_type": rule["alert_type"],
                "label":      SMART_ALERT_TYPES.get(rule["alert_type"], {}).get("label", rule["alert_type"]),
                "detail":     outcome.get("detail", ""),
            })
    return results


# ── News Sentiment Engine ──────────────────────────────────────────────────────
