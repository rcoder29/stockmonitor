"""Digest orchestration — settings, due-time logic, run + audit log, and the
background scheduler thread.

Delivery guarantees:
  * At most once per period. Scheduled runs claim a DigestLog row keyed by
    (kind, date-or-ISO-week) before doing any work; the unique constraint makes
    a second tick (or a second process) lose the race and skip.
  * Catch-up. This app usually runs on a laptop that sleeps, so a digest that
    was due while the machine was off is still sent if the app comes back
    within a window after the scheduled time (never for a stale morning digest
    in the afternoon).
  * Retry. A failed delivery is retried every RETRY_GAP, up to MAX_ATTEMPTS.
  * Quiet when unconfigured. With no delivery channel set up, nothing is
    claimed or logged — the digest stays due until one is.
"""
import json
import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError

from database import db_session, DigestSettings, DigestLog
from digest_builder import build_digest, generate_ai_summary
from digest_channels import CHANNELS, configured_channels
from digest_render import render

logger = logging.getLogger(__name__)

TICK_SECONDS = 60
DAILY_CATCHUP = timedelta(hours=6)
WEEKLY_CATCHUP = timedelta(hours=12)     # also bounded by the weekly day ending at midnight
MAX_ATTEMPTS = 3
RETRY_GAP = timedelta(minutes=10)
STALE_PENDING = timedelta(minutes=30)    # a 'pending' row this old means the process died mid-run


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _naive_utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


# ── Settings ──────────────────────────────────────────────────────────────────

def _settings_dict(r: DigestSettings) -> dict:
    return {
        "timezone": r.timezone,
        "daily_enabled": bool(r.daily_enabled), "daily_time": r.daily_time,
        "daily_weekdays_only": bool(r.daily_weekdays_only),
        "weekly_enabled": bool(r.weekly_enabled), "weekly_day": r.weekly_day, "weekly_time": r.weekly_time,
        "use_ai": bool(r.use_ai),
    }


def get_settings() -> dict:
    with db_session() as db:
        row = db.get(DigestSettings, 1)
        if row is None:
            row = DigestSettings(id=1)
            db.add(row)
            db.flush()
            # Column defaults apply at INSERT; flush so the dict below sees them.
            db.refresh(row)
        return _settings_dict(row)


def update_settings(patch: dict) -> dict:
    """Apply already-validated fields (the router validates) and return the result."""
    with db_session() as db:
        row = db.get(DigestSettings, 1) or DigestSettings(id=1)
        db.add(row)
        for key, val in patch.items():
            setattr(row, key, int(val) if isinstance(val, bool) else val)
        row.updated_at = datetime.utcnow()
        db.flush()
        db.refresh(row)
        return _settings_dict(row)


# ── When is a digest due? ─────────────────────────────────────────────────────

def _at(local: datetime, hhmm: str) -> datetime:
    h, m = (int(x) for x in hhmm.split(":"))
    return local.replace(hour=h, minute=m, second=0, microsecond=0)


def due_runs(settings: dict, now: datetime) -> list[tuple[str, str]]:
    """(kind, period_key) pairs whose scheduled time has passed within the
    catch-up window. Pure function of settings + clock, so it's easy to test."""
    local = now.astimezone(ZoneInfo(settings["timezone"]))
    due = []
    if settings["daily_enabled"] and not (settings["daily_weekdays_only"] and local.weekday() >= 5):
        at = _at(local, settings["daily_time"])
        if at <= local < at + DAILY_CATCHUP:
            due.append(("daily", local.date().isoformat()))
    if settings["weekly_enabled"] and local.weekday() == settings["weekly_day"]:
        at = _at(local, settings["weekly_time"])
        if at <= local < at + WEEKLY_CATCHUP:
            iso = local.isocalendar()
            due.append(("weekly", f"{iso.year}-W{iso.week:02d}"))
    return due


def next_run(kind: str, settings: dict, now: datetime) -> str | None:
    """ISO timestamp (in the configured timezone) of the next scheduled run, or None if disabled."""
    if not settings[f"{kind}_enabled"]:
        return None
    local = now.astimezone(ZoneInfo(settings["timezone"]))
    for offset in range(9):
        day = local + timedelta(days=offset)
        if kind == "daily" and settings["daily_weekdays_only"] and day.weekday() >= 5:
            continue
        if kind == "weekly" and day.weekday() != settings["weekly_day"]:
            continue
        at = _at(day, settings[f"{kind}_time"])
        if at > local:
            return at.isoformat()
    return None


# ── Running a digest ──────────────────────────────────────────────────────────

def _claim(kind: str, period_key: str, trigger: str, now: datetime) -> int | None:
    """Reserve this (kind, period) for us, or return None if someone else has it
    (already sent, in flight, or out of retries)."""
    naive = _naive_utc(now)
    try:
        with db_session() as db:
            row = db.query(DigestLog).filter_by(kind=kind, period_key=period_key).first()
            if row is None:
                row = DigestLog(kind=kind, period_key=period_key, trigger=trigger, status="pending",
                                attempts=1, created_at=naive, updated_at=naive)
                db.add(row)
                db.flush()
                return row.id
            age = naive - row.updated_at
            retryable = row.status == "failed" and age >= RETRY_GAP
            stale = row.status == "pending" and age >= STALE_PENDING
            if (retryable or stale) and row.attempts < MAX_ATTEMPTS:
                row.status, row.attempts, row.updated_at = "pending", row.attempts + 1, naive
                return row.id
            return None
    except IntegrityError:
        return None    # lost the insert race to another tick/process


def _finish(log_id: int, ok: bool, results: dict, text: str, error: str | None, now: datetime) -> None:
    with db_session() as db:
        row = db.get(DigestLog, log_id)
        row.status = "sent" if ok else "failed"
        row.channels = json.dumps(results)
        row.text = text
        row.error = (error or "")[:500] or None
        row.updated_at = _naive_utc(now)


def log_dict(row: DigestLog, with_text: bool = False) -> dict:
    d = {
        "id": row.id, "kind": row.kind, "period_key": row.period_key, "trigger": row.trigger,
        "status": row.status, "attempts": row.attempts, "channels": json.loads(row.channels or "{}"),
        "error": row.error, "created_at": row.created_at.isoformat() + "Z",
    }
    if with_text:
        d["text"] = row.text or ""
    return d


def run_digest(kind: str, trigger: str = "manual", period_key: str | None = None,
               now: datetime | None = None, channels: list[str] | None = None) -> dict:
    """Build, render, deliver and log one digest. Returns the log row (with text),
    or {"skipped": True} when a scheduled period is already claimed."""
    now = now or _utcnow()
    period_key = period_key or f"manual:{now.strftime('%Y%m%dT%H%M%S%f')}"
    log_id = _claim(kind, period_key, trigger, now)
    if log_id is None:
        return {"skipped": True}

    text, results, error, ok = "", {}, None, False
    try:
        settings = get_settings()
        digest = build_digest(kind, now, settings["timezone"])
        if settings["use_ai"]:
            digest["ai_summary"] = generate_ai_summary(digest)
        text = render(digest, "text")
        html_text = render(digest, "html")
        for name in channels or configured_channels():
            if name in CHANNELS:
                results[name] = CHANNELS[name].send(html_text, text)
        ok = any(r["ok"] for r in results.values())
        if not ok:
            error = next((r["error"] for r in results.values() if r.get("error")), "no delivery channel configured")
    except Exception as exc:
        logger.exception("Digest %s failed", kind)
        error = f"{type(exc).__name__}: {exc}"

    _finish(log_id, ok, results, text, error, now)
    with db_session() as db:
        return log_dict(db.get(DigestLog, log_id), with_text=True)


def tick(now: datetime | None = None) -> list[dict]:
    """One scheduler pass: run whatever is due. Returns the runs it performed."""
    now = now or _utcnow()
    if not configured_channels():
        return []
    ran = []
    for kind, key in due_runs(get_settings(), now):
        result = run_digest(kind, "scheduled", key, now)
        if not result.get("skipped"):
            ran.append(result)
    return ran


# ── History ───────────────────────────────────────────────────────────────────

def list_history(limit: int = 30) -> list[dict]:
    with db_session() as db:
        rows = db.query(DigestLog).order_by(DigestLog.created_at.desc(), DigestLog.id.desc()).limit(limit).all()
        return [log_dict(r) for r in rows]


def get_log(log_id: int) -> dict | None:
    with db_session() as db:
        row = db.get(DigestLog, log_id)
        return log_dict(row, with_text=True) if row else None


# ── Scheduler thread ──────────────────────────────────────────────────────────

_stop = threading.Event()
_thread: threading.Thread | None = None
_lock = threading.Lock()


def _loop() -> None:
    # First pass runs immediately, so opening the app shortly after a missed
    # scheduled time delivers the catch-up digest right away.
    while not _stop.is_set():
        try:
            tick()
        except Exception:
            logger.exception("Digest scheduler tick failed")
        _stop.wait(TICK_SECONDS)


def start_scheduler() -> bool:
    """Start the background thread. No-op (False) if disabled via DIGEST_SCHEDULER=0
    or already running."""
    global _thread
    if os.environ.get("DIGEST_SCHEDULER", "1") == "0":
        return False
    with _lock:
        if _thread and _thread.is_alive():
            return False
        _stop.clear()
        _thread = threading.Thread(target=_loop, name="digest-scheduler", daemon=True)
        _thread.start()
    logger.info("Digest scheduler started")
    return True


def stop_scheduler() -> None:
    _stop.set()
    if _thread:
        _thread.join(timeout=5)


def scheduler_running() -> bool:
    return bool(_thread and _thread.is_alive())


def status(now: datetime | None = None) -> dict:
    now = now or _utcnow()
    settings = get_settings()
    return {
        "channels": {name: ch.configured() for name, ch in CHANNELS.items()},
        "scheduler_running": scheduler_running(),
        "ai_available": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "next_daily": next_run("daily", settings, now),
        "next_weekly": next_run("weekly", settings, now),
    }
