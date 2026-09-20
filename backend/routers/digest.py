"""Digests — AI Tools -> Digests.

Settings, status, preview, send-now, a Telegram test message, and the send
history for the daily / weekly digests. The heavy lifting lives in
digest_service.py (orchestration + scheduler), digest_builder.py (data),
digest_render.py (formatting) and digest_channels.py (delivery).
"""
import re
from datetime import datetime, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

import digest_service
from digest_builder import build_digest, generate_ai_summary
from digest_channels import CHANNELS, configured_channels
from digest_render import render

router = APIRouter()

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class SettingsPatch(BaseModel):
    timezone: str | None = None
    daily_enabled: bool | None = None
    daily_time: str | None = None
    daily_weekdays_only: bool | None = None
    weekly_enabled: bool | None = None
    weekly_day: int | None = None
    weekly_time: str | None = None
    use_ai: bool | None = None

    @field_validator("daily_time", "weekly_time")
    @classmethod
    def _time(cls, v):
        if v is not None and not _HHMM.match(v):
            raise ValueError("time must be HH:MM (24-hour)")
        return v

    @field_validator("weekly_day")
    @classmethod
    def _day(cls, v):
        if v is not None and not 0 <= v <= 6:
            raise ValueError("weekly_day must be 0 (Mon) to 6 (Sun)")
        return v

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v):
        if v is not None:
            try:
                ZoneInfo(v)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValueError(f"unknown timezone {v!r}")
        return v


class KindBody(BaseModel):
    kind: Literal["daily", "weekly"]


@router.get("/api/digest/settings")
def get_settings():
    return digest_service.get_settings()


@router.put("/api/digest/settings")
def put_settings(body: SettingsPatch):
    return digest_service.update_settings(body.model_dump(exclude_none=True))


@router.get("/api/digest/status")
def get_status():
    return digest_service.status()


@router.post("/api/digest/preview")
def preview(body: KindBody):
    """Build and render a digest without sending or logging it."""
    settings = digest_service.get_settings()
    digest = build_digest(body.kind, datetime.now(timezone.utc), settings["timezone"])
    if settings["use_ai"]:
        digest["ai_summary"] = generate_ai_summary(digest)
    return {"digest": digest, "text": render(digest, "text")}


@router.post("/api/digest/send")
def send_now(body: KindBody):
    """Build and deliver a digest immediately to every configured channel."""
    if not configured_channels():
        raise HTTPException(400, "No delivery channel configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in backend/.env")
    return digest_service.run_digest(body.kind, trigger="manual")


@router.post("/api/digest/test")
def send_test():
    """Send a one-line message to confirm the channel credentials work."""
    names = configured_channels()
    if not names:
        raise HTTPException(400, "No delivery channel configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in backend/.env")
    text = "Stock Monitor: test message — your digest delivery is working."
    results = {n: CHANNELS[n].send(text, text) for n in names}
    return {"ok": any(r["ok"] for r in results.values()), "channels": results}


@router.get("/api/digest/history")
def history(limit: int = 30):
    return digest_service.list_history(max(1, min(limit, 100)))


@router.get("/api/digest/history/{log_id}")
def history_item(log_id: int):
    row = digest_service.get_log(log_id)
    if not row:
        raise HTTPException(404, "Digest not found")
    return row
