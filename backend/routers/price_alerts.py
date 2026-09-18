"""Price Alerts — Watchlist (bell icon on any row).

CRUD for price/percent-change/52-week-break/volume-spike alerts.
"""
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import db_session, PriceAlert

router = APIRouter()

# ── Price Alerts ──────────────────────────────────────────────────────────────

def _alert_row(r):
    return {
        "id":            r.id,
        "symbol":        r.symbol,
        "target_price":  r.target_price,
        "condition":     r.condition,
        "note":          r.note or "",
        "status":        r.status,
        "alert_type":    getattr(r, "alert_type", None) or "price",
        "trigger_value": getattr(r, "trigger_value", None),
        "created_at":    r.created_at.isoformat(),
        "triggered_at":  r.triggered_at.isoformat() if r.triggered_at else None,
    }


@router.get("/api/alerts")
def list_alerts():
    with db_session() as db:
        rows = db.query(PriceAlert).order_by(PriceAlert.created_at.desc()).all()
        return [_alert_row(r) for r in rows]


class AlertCreate(BaseModel):
    symbol:        str
    target_price:  float
    condition:     str         # 'above' | 'below'
    note:          str = ""
    alert_type:    str = "price"   # 'price' | 'pct_change' | 'week52_break' | 'volume_spike'
    trigger_value: float | None = None


@router.post("/api/alerts", status_code=201)
def create_alert(body: AlertCreate):
    body.symbol = body.symbol.upper()
    if body.condition not in ("above", "below"):
        raise HTTPException(400, "condition must be 'above' or 'below'")
    valid_types = {"price", "pct_change", "week52_break", "volume_spike"}
    if body.alert_type not in valid_types:
        body.alert_type = "price"
    with db_session() as db:
        row = PriceAlert(
            symbol=body.symbol,
            target_price=body.target_price,
            condition=body.condition,
            note=body.note,
            alert_type=body.alert_type,
            trigger_value=body.trigger_value,
        )
        db.add(row)
        db.flush()
        return _alert_row(row)


@router.delete("/api/alerts/{alert_id}", status_code=204)
def delete_alert(alert_id: int):
    with db_session() as db:
        row = db.query(PriceAlert).filter(PriceAlert.id == alert_id).first()
        if row:
            db.delete(row)


@router.patch("/api/alerts/{alert_id}/trigger")
def trigger_alert(alert_id: int):
    with db_session() as db:
        row = db.query(PriceAlert).filter(PriceAlert.id == alert_id).first()
        if row and row.status == "active":
            row.status = "triggered"
            row.triggered_at = datetime.utcnow()
    return {"ok": True}


@router.patch("/api/alerts/{alert_id}/dismiss")
def dismiss_alert(alert_id: int):
    with db_session() as db:
        row = db.query(PriceAlert).filter(PriceAlert.id == alert_id).first()
        if row:
            row.status = "dismissed"
    return {"ok": True}

