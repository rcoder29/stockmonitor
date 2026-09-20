"""
Tests for the daily/weekly digest: due-time logic, data collection, rendering,
Telegram delivery, at-most-once claiming, and the API.
Run: python -m pytest tests/test_digest.py -v

Unlike test_main.py these run against a throwaway SQLite database, so they
never touch (or depend on the contents of) the real stockmonitor.db.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import database
import digest_channels
import digest_service
from database import (
    Base, DigestLog, PortfolioPosition, PriceAlert, PriceTarget, WatchlistSymbol,
)
from digest_builder import build_digest, generate_ai_summary
from digest_channels import TelegramChannel, split_message
from digest_render import render
from main import app

UTC = timezone.utc
MON_0830_ET = datetime(2026, 9, 21, 12, 30, tzinfo=UTC)   # Monday 08:30 in New York (EDT)


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False))
    for var in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    yield


def _settings(**over):
    base = {
        "timezone": "America/New_York",
        "daily_enabled": True, "daily_time": "08:00", "daily_weekdays_only": True,
        "weekly_enabled": True, "weekly_day": 6, "weekly_time": "18:00", "use_ai": False,
    }
    return {**base, **over}


# ── Fakes ─────────────────────────────────────────────────────────────────────

PRICES = {
    "SPY": {"price": 500.0, "1d": 1.0, "5d": 2.0}, "QQQ": {"price": 400.0, "1d": 1.5, "5d": 3.0},
    "DIA": {"price": 400.0, "1d": 0.5, "5d": 1.0}, "IWM": {"price": 200.0, "1d": -0.5, "5d": -1.0},
    "^VIX": {"price": 14.0, "1d": -2.0, "5d": -5.0}, "^TNX": {"price": 4.25, "1d": 0.1, "5d": 0.2},
    "AAPL": {"price": 110.0, "1d": 10.0, "5d": 20.0}, "MSFT": {"price": 190.0, "1d": -5.0, "5d": -2.0},
    "TSLA": {"price": 305.0, "1d": 1.0, "5d": 1.0}, "NVDA": {"price": 102.0, "1d": 1.0, "5d": 1.0},
    "AMD": {"price": 150.0, "1d": 3.0, "5d": 4.0},
    **{s: {"price": 50.0, "1d": i * 0.5, "5d": i * 1.0} for i, s in enumerate(
        ["XLK", "XLF", "XLE", "XLV", "XLC", "XLI", "XLRE", "XLY", "XLP", "XLU", "XLB"])},
}
ECON = [
    {"date": "2026-09-22", "event": "CPI Release", "type": "cpi", "daysUntil": 1},
    {"date": "2026-10-28", "event": "FOMC Rate Decision", "type": "fomc", "daysUntil": 37},
]


def fake_perf(sym):
    return PRICES.get(sym, {})


def fake_earnings(sym):
    return {"symbol": sym, "date": "2026-09-22", "daysUntil": 1, "epsEstimate": 1.5} if sym == "AAPL" else None


def build(kind="daily", **fetchers):
    kw = {"perf_fetch": fake_perf, "earnings_fetch": fake_earnings, "econ_fetch": lambda: ECON, **fetchers}
    return build_digest(kind, MON_0830_ET, "America/New_York", **kw)


def seed():
    with database.db_session() as db:
        db.add_all([
            PortfolioPosition(symbol="AAPL", shares=10, avg_cost=100.0),
            PortfolioPosition(symbol="MSFT", shares=5, avg_cost=200.0),
            WatchlistSymbol(symbol="AMD"), WatchlistSymbol(symbol="NVDA"),
            PriceAlert(symbol="TSLA", target_price=300.0, condition="above", status="active"),           # crossed
            PriceAlert(symbol="NVDA", target_price=100.0, condition="below", status="active"),           # ~2% away
            PriceAlert(symbol="AMD", target_price=200.0, condition="above", status="active"),            # far
            PriceAlert(symbol="AAPL", target_price=1.0, condition="above", status="active", alert_type="pct_change"),  # not price-type
            PriceAlert(symbol="MSFT", target_price=200.0, condition="above", status="triggered",
                       triggered_at=MON_0830_ET.replace(tzinfo=None) - timedelta(hours=2)),
        ])


# ── When is a digest due? ─────────────────────────────────────────────────────

class TestDueRuns:
    def test_daily_due_after_scheduled_time_in_local_tz(self):
        assert digest_service.due_runs(_settings(weekly_enabled=False), MON_0830_ET) == [("daily", "2026-09-21")]

    def test_daily_not_due_before_scheduled_time(self):
        assert digest_service.due_runs(_settings(), MON_0830_ET - timedelta(minutes=45)) == []

    def test_daily_catchup_window_expires(self):
        assert digest_service.due_runs(_settings(), MON_0830_ET + timedelta(hours=5)) != []
        assert digest_service.due_runs(_settings(), MON_0830_ET + timedelta(hours=6)) == []

    def test_daily_skips_weekend_when_weekdays_only(self):
        sat = datetime(2026, 9, 19, 13, 0, tzinfo=UTC)
        assert digest_service.due_runs(_settings(weekly_enabled=False), sat) == []
        assert digest_service.due_runs(_settings(weekly_enabled=False, daily_weekdays_only=False), sat) == [("daily", "2026-09-19")]

    def test_weekly_due_on_its_day_with_iso_week_key(self):
        sun = datetime(2026, 9, 20, 22, 30, tzinfo=UTC)   # Sunday 18:30 EDT
        assert digest_service.due_runs(_settings(daily_enabled=False), sun) == [("weekly", "2026-W38")]

    def test_weekly_not_due_on_other_days_or_when_disabled(self):
        assert digest_service.due_runs(_settings(daily_enabled=False), MON_0830_ET) == []
        sun = datetime(2026, 9, 20, 22, 30, tzinfo=UTC)
        assert digest_service.due_runs(_settings(daily_enabled=False, weekly_enabled=False), sun) == []


class TestNextRun:
    def test_disabled_is_none(self):
        assert digest_service.next_run("daily", _settings(daily_enabled=False), MON_0830_ET) is None

    def test_daily_after_todays_time_goes_to_tomorrow(self):
        assert digest_service.next_run("daily", _settings(), MON_0830_ET + timedelta(hours=1)).startswith("2026-09-22T08:00")

    def test_daily_friday_evening_skips_to_monday(self):
        fri_eve = datetime(2026, 9, 25, 23, 0, tzinfo=UTC)
        assert digest_service.next_run("daily", _settings(), fri_eve).startswith("2026-09-28T08:00")

    def test_weekly_finds_next_configured_weekday(self):
        assert digest_service.next_run("weekly", _settings(), MON_0830_ET).startswith("2026-09-27T18:00")


# ── Data collection ───────────────────────────────────────────────────────────

class TestBuildDigest:
    def test_portfolio_math(self):
        seed()
        p = build()["sections"]["portfolio"]
        assert p["count"] == 2
        assert p["total_value"] == pytest.approx(2050.0)
        assert p["unrealized_pnl"] == pytest.approx(50.0)
        assert p["period_pnl"] == pytest.approx(50.0)     # AAPL +100, MSFT -50
        assert p["period_pct"] == pytest.approx(2.5)      # on 2000 prior value
        assert p["vs_spy"] == pytest.approx(1.5)
        assert p["movers"][0]["symbol"] == "AAPL"

    def test_weekly_uses_five_day_returns(self):
        seed()
        p = build("weekly")["sections"]["portfolio"]
        assert build("weekly")["period"] == "5d"
        assert p["best"][0]["symbol"] == "AAPL"
        assert p["vs_spy"] == pytest.approx(p["period_pct"] - 2.0)

    def test_multiple_lots_of_one_symbol_are_aggregated(self):
        with database.db_session() as db:
            db.add_all([PortfolioPosition(symbol="AAPL", shares=10, avg_cost=100.0), PortfolioPosition(symbol="AAPL", shares=10, avg_cost=120.0)])
        p = build()["sections"]["portfolio"]
        assert p["count"] == 1
        assert p["total_value"] == pytest.approx(2200.0)
        assert p["unrealized_pnl"] == pytest.approx(0.0)   # cost 2200

    def test_unpriced_position_is_carried_at_cost_and_flagged(self):
        with database.db_session() as db:
            db.add(PortfolioPosition(symbol="ZZZZ", shares=2, avg_cost=50.0))
        p = build()["sections"]["portfolio"]
        assert p["unpriced"] == ["ZZZZ"]
        assert p["total_value"] == pytest.approx(100.0)
        assert p["period_pnl"] is None

    def test_no_positions_omits_portfolio_section(self):
        assert build()["sections"]["portfolio"] is None

    def test_alerts_crossed_near_and_recent(self):
        seed()
        a = build()["sections"]["alerts"]
        assert [x["symbol"] for x in a["crossed"]] == ["TSLA"]
        assert [x["symbol"] for x in a["near"]] == ["NVDA"]
        assert round(a["near"][0]["gap_pct"], 1) == 2.0
        assert [x["symbol"] for x in a["triggered"]] == ["MSFT"]
        assert a["active_total"] == 4

    def test_no_alerts_means_no_section(self):
        assert build()["sections"]["alerts"] is None

    def test_events_window_and_held_flag(self):
        seed()
        e = build()["sections"]["events"]
        assert e["window_days"] == 2
        assert [x["event"] for x in e["economic"]] == ["CPI Release"]     # FOMC is 37 days out
        assert e["earnings"][0]["symbol"] == "AAPL" and e["earnings"][0]["held"] is True

    def test_weekly_events_window_is_seven_days(self):
        assert build("weekly")["sections"]["events"]["window_days"] == 7

    def test_watchlist_movers(self):
        seed()
        w = build()["sections"]["watchlist"]
        assert w["gainers"][0]["symbol"] == "AMD"
        assert w["losers"] == []

    def test_targets_only_in_weekly(self):
        with database.db_session() as db:
            db.add(PriceTarget(symbol="AAPL", target_price=112.0))       # ~1.8% above
            db.add(PriceTarget(symbol="MSFT", target_price=400.0))       # far, no deadline
        assert build("daily")["sections"]["targets"] is None
        t = build("weekly")["sections"]["targets"]
        assert [x["symbol"] for x in t] == ["AAPL"]

    def test_sectors_never_overlap(self):
        m = build()["sections"]["market"]
        assert len(m["sectors_top"]) == 3 and len(m["sectors_bottom"]) == 3
        assert not {s["symbol"] for s in m["sectors_top"]} & {s["symbol"] for s in m["sectors_bottom"]}
        assert m["sectors_bottom"][0]["chg"] <= m["sectors_bottom"][1]["chg"]     # worst first
        assert m["vix"]["label"] == "Low"

    def test_one_failing_section_does_not_sink_the_digest(self):
        seed()
        def boom():
            raise RuntimeError("calendar down")
        d = build(econ_fetch=boom)
        assert "events" in d["errors"] and "calendar down" in d["errors"]["events"]
        assert d["sections"]["events"] is None
        assert d["sections"]["portfolio"] is not None and d["sections"]["market"] is not None

    def test_failing_price_fetch_degrades_instead_of_raising(self):
        def flaky(sym):
            if sym == "AAPL":
                raise RuntimeError("rate limited")
            return fake_perf(sym)
        seed()
        assert build(perf_fetch=flaky)["sections"]["portfolio"]["unpriced"] == ["AAPL"]

    def test_unknown_kind_rejected(self):
        with pytest.raises(ValueError):
            build_digest("monthly")


class TestAiSummary:
    def test_none_without_key(self):
        assert generate_ai_summary(build()) is None

    def test_returns_text_and_swallows_errors(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        client = MagicMock()
        client.messages.create.return_value.content = [MagicMock(type="text", text="  Stocks rose.  ")]
        with patch("anthropic.Anthropic", return_value=client):
            assert generate_ai_summary(build()) == "Stocks rose."
        client.messages.create.side_effect = RuntimeError("401 invalid key")
        with patch("anthropic.Anthropic", return_value=client):
            assert generate_ai_summary(build()) is None


# ── Rendering ─────────────────────────────────────────────────────────────────

class TestRender:
    def test_text_has_sections_and_no_markup(self):
        seed()
        out = render(build(), "text")
        assert out.startswith("Daily Digest — Mon Sep 21")
        for heading in ("Markets", "Your portfolio", "Watchlist movers", "Next few days", "Alerts"):
            assert heading in out
        assert "<b>" not in out
        assert "▲2.50%" in out and "+1.50 pts vs SPY" in out
        assert "crossed while you were away" in out

    def test_html_uses_bold_and_escapes_dynamic_values(self):
        seed()
        d = build()
        d["ai_summary"] = "AT&T <script> fell"
        out = render(d, "html")
        assert "<b>Daily Digest — Mon Sep 21</b>" in out
        assert "AT&amp;T &lt;script&gt; fell" in out and "<script>" not in out

    def test_weekly_labels(self):
        seed()
        out = render(build("weekly"), "text")
        assert out.startswith("Weekly Digest") and "Past 5 sessions" in out and "Coming up" in out and "Best:" in out

    def test_empty_sections_omitted_and_errors_footnoted(self):
        d = build(econ_fetch=lambda: 1 / 0)
        out = render(d, "text")
        assert "Your portfolio" not in out and "Alerts" not in out
        assert "Unavailable right now: events" in out

    def test_labels_do_not_claim_today_and_flat_moves_have_no_arrow(self):
        seed()
        out = render(build(), "text")
        assert "Last session" in out and "Today" not in out
        from digest_render import _pct
        assert _pct(-0.004, 2) == "0.00%" and _pct(0.0, 1) == "0.0%" and _pct(0.5, 1) == "▲0.5%"

    def test_unpriced_positions_are_named_and_capped(self):
        d = build()
        d["sections"]["portfolio"] = {"count": 9, "unpriced": [f"S{i}" for i in range(9)], "total_value": 1.0, "unrealized_pnl": 0.0,
                                      "unrealized_pct": 0.0, "period_pnl": None, "period_pct": None, "vs_spy": None, "movers": [], "best": [], "worst": []}
        assert "No live price (carried at cost): S0, S1, S2, S3, S4, S5 +3 more" in render(d, "text")

    def test_bad_format_rejected(self):
        with pytest.raises(ValueError):
            render(build(), "markdown")


# ── Delivery ──────────────────────────────────────────────────────────────────

class TestSplitMessage:
    def test_short_text_is_one_chunk(self):
        assert split_message("a\n\nb") == ["a\n\nb"]

    def test_splits_on_section_boundaries_and_preserves_content(self):
        sections = [f"section {i}\n" + "x" * 900 for i in range(10)]
        chunks = split_message("\n\n".join(sections), limit=2000)
        assert len(chunks) > 1 and all(len(c) <= 2000 for c in chunks)
        assert "\n\n".join(chunks) == "\n\n".join(sections)

    def test_single_oversized_block_is_hard_split(self):
        chunks = split_message("y" * 5000, limit=2000)
        assert all(len(c) <= 2000 for c in chunks) and "".join(chunks) == "y" * 5000


class TestTelegram:
    def _ok(self):
        r = MagicMock(status_code=200, content=b"{}")
        r.json.return_value = {"ok": True}
        return r

    def test_unconfigured(self):
        ch = TelegramChannel()
        assert ch.configured() is False
        assert ch.send("hi")["ok"] is False

    def test_success_posts_html_to_chat(self, monkeypatch):
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:SECRET")
        monkeypatch.setenv("TELEGRAM_CHAT_ID", "42")
        with patch("digest_channels.requests.post", return_value=self._ok()) as post:
            assert TelegramChannel().send("<b>hi</b>") == {"ok": True, "error": None}
        assert post.call_args.args[0] == "https://api.telegram.org/bot123:SECRET/sendMessage"
        assert post.call_args.kwargs["json"]["chat_id"] == "42" and post.call_args.kwargs["json"]["parse_mode"] == "HTML"

    def test_api_error_is_reported(self, monkeypatch):
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:SECRET")
        monkeypatch.setenv("TELEGRAM_CHAT_ID", "42")
        bad = MagicMock(status_code=400, content=b"{}")
        bad.json.return_value = {"ok": False, "description": "Bad Request: chat not found"}
        with patch("digest_channels.requests.post", return_value=bad):
            res = TelegramChannel().send("hi")
        assert res == {"ok": False, "error": "Bad Request: chat not found"}

    def test_token_never_leaks_from_exception_text(self, monkeypatch):
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:SECRET")
        monkeypatch.setenv("TELEGRAM_CHAT_ID", "42")
        boom = ConnectionError("HTTPSConnectionPool: url: /bot123:SECRET/sendMessage failed")
        with patch("digest_channels.requests.post", side_effect=boom):
            res = TelegramChannel().send("hi")
        assert res["ok"] is False and "SECRET" not in res["error"] and "***" in res["error"]

    def test_long_message_is_sent_in_several_posts(self, monkeypatch):
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "t")
        monkeypatch.setenv("TELEGRAM_CHAT_ID", "c")
        text = "\n\n".join("z" * 1500 for _ in range(6))
        with patch("digest_channels.requests.post", return_value=self._ok()) as post:
            TelegramChannel().send(text)
        assert post.call_count > 1
        assert all(len(c.kwargs["json"]["text"]) <= digest_channels.TELEGRAM_LIMIT for c in post.call_args_list)


# ── Orchestration: claim, retry, tick ─────────────────────────────────────────

class _FakeChannel:
    name = "fake"

    def __init__(self, ok=True):
        self.ok, self.sent = ok, []

    def configured(self):
        return True

    def send(self, html_text, plain_text=""):
        self.sent.append(html_text)
        return {"ok": self.ok, "error": None if self.ok else "boom"}


@pytest.fixture
def fake_channel(monkeypatch):
    ch = _FakeChannel()
    monkeypatch.setattr(digest_service, "CHANNELS", {"fake": ch})
    monkeypatch.setattr(digest_service, "configured_channels", lambda: ["fake"])
    monkeypatch.setattr(digest_service, "build_digest", lambda kind, now, tz: build(kind))
    return ch


class TestRunDigest:
    def test_scheduled_period_is_delivered_once(self, fake_channel):
        first = digest_service.run_digest("daily", "scheduled", "2026-09-21", MON_0830_ET)
        second = digest_service.run_digest("daily", "scheduled", "2026-09-21", MON_0830_ET)
        assert first["status"] == "sent" and first["channels"]["fake"]["ok"] is True and "Daily Digest" in first["text"]
        assert second == {"skipped": True}
        assert len(fake_channel.sent) == 1

    def test_manual_runs_are_never_deduped(self, fake_channel):
        a = digest_service.run_digest("daily", now=MON_0830_ET)
        b = digest_service.run_digest("daily", now=MON_0830_ET + timedelta(seconds=1))
        assert a["status"] == b["status"] == "sent" and len(fake_channel.sent) == 2

    def test_failed_delivery_retries_after_gap_up_to_max_attempts(self, fake_channel):
        fake_channel.ok = False
        key, t = "2026-09-21", MON_0830_ET
        assert digest_service.run_digest("daily", "scheduled", key, t)["status"] == "failed"
        assert digest_service.run_digest("daily", "scheduled", key, t + timedelta(minutes=1)) == {"skipped": True}     # too soon
        second = digest_service.run_digest("daily", "scheduled", key, t + timedelta(minutes=11))
        assert second["status"] == "failed" and second["attempts"] == 2 and second["error"] == "boom"
        third = digest_service.run_digest("daily", "scheduled", key, t + timedelta(minutes=22))
        assert third["attempts"] == 3
        assert digest_service.run_digest("daily", "scheduled", key, t + timedelta(minutes=40)) == {"skipped": True}    # out of attempts

    def test_retry_that_succeeds_marks_sent(self, fake_channel):
        fake_channel.ok = False
        digest_service.run_digest("daily", "scheduled", "k", MON_0830_ET)
        fake_channel.ok = True
        res = digest_service.run_digest("daily", "scheduled", "k", MON_0830_ET + timedelta(minutes=11))
        assert res["status"] == "sent" and res["attempts"] == 2

    def test_stale_pending_row_from_a_dead_process_is_reclaimed(self, fake_channel):
        with database.db_session() as db:
            db.add(DigestLog(kind="daily", period_key="k", status="pending", attempts=1,
                             created_at=MON_0830_ET.replace(tzinfo=None), updated_at=MON_0830_ET.replace(tzinfo=None)))
        assert digest_service.run_digest("daily", "scheduled", "k", MON_0830_ET + timedelta(minutes=5)) == {"skipped": True}
        assert digest_service.run_digest("daily", "scheduled", "k", MON_0830_ET + timedelta(minutes=31))["status"] == "sent"

    def test_builder_exception_is_logged_as_failure(self, fake_channel, monkeypatch):
        monkeypatch.setattr(digest_service, "build_digest", lambda *a: (_ for _ in ()).throw(RuntimeError("yahoo down")))
        res = digest_service.run_digest("daily", now=MON_0830_ET)
        assert res["status"] == "failed" and "yahoo down" in res["error"] and fake_channel.sent == []

    def test_ai_summary_only_when_enabled(self, fake_channel, monkeypatch):
        monkeypatch.setattr(digest_service, "generate_ai_summary", lambda d: "AI OPENER")
        assert digest_service.get_settings()["use_ai"] is True       # on by default; a no-op without a working key
        digest_service.update_settings({"use_ai": False})
        digest_service.run_digest("daily", now=MON_0830_ET)
        assert "AI OPENER" not in fake_channel.sent[0]
        digest_service.update_settings({"use_ai": True})
        digest_service.run_digest("daily", now=MON_0830_ET + timedelta(seconds=1))
        assert "AI OPENER" in fake_channel.sent[1]


class TestTick:
    def test_quiet_and_unclaimed_when_no_channel_configured(self):
        digest_service.update_settings({"daily_enabled": True})
        assert digest_service.tick(MON_0830_ET) == []
        with database.db_session() as db:
            assert db.query(DigestLog).count() == 0

    def test_runs_what_is_due_exactly_once(self, fake_channel):
        digest_service.update_settings({"daily_enabled": True, "weekly_enabled": False})
        assert [r["kind"] for r in digest_service.tick(MON_0830_ET)] == ["daily"]
        assert digest_service.tick(MON_0830_ET + timedelta(minutes=1)) == []
        assert len(fake_channel.sent) == 1

    def test_nothing_enabled_nothing_sent(self, fake_channel):
        assert digest_service.tick(MON_0830_ET) == []


class TestSettings:
    def test_defaults_are_opt_in(self):
        s = digest_service.get_settings()
        assert s["daily_enabled"] is False and s["weekly_enabled"] is False
        assert s["timezone"] == "America/New_York" and s["daily_time"] == "08:00" and s["weekly_day"] == 6

    def test_update_persists_and_merges(self):
        digest_service.update_settings({"daily_enabled": True, "daily_time": "07:15"})
        s = digest_service.update_settings({"weekly_day": 4})
        assert s["daily_enabled"] is True and s["daily_time"] == "07:15" and s["weekly_day"] == 4


# ── API ───────────────────────────────────────────────────────────────────────

client = TestClient(app)


class TestDigestApi:
    def test_settings_roundtrip(self):
        assert client.get("/api/digest/settings").json()["daily_enabled"] is False
        r = client.put("/api/digest/settings", json={"daily_enabled": True, "daily_time": "07:30", "timezone": "Europe/London"})
        assert r.status_code == 200 and r.json()["daily_time"] == "07:30" and r.json()["timezone"] == "Europe/London"
        assert client.get("/api/digest/settings").json()["timezone"] == "Europe/London"

    @pytest.mark.parametrize("body", [
        {"daily_time": "8am"}, {"daily_time": "24:00"}, {"weekly_day": 7}, {"timezone": "Mars/Olympus"},
    ])
    def test_invalid_settings_rejected(self, body):
        assert client.put("/api/digest/settings", json=body).status_code == 422

    def test_status_reports_channels_and_next_runs(self):
        client.put("/api/digest/settings", json={"daily_enabled": True})
        s = client.get("/api/digest/status").json()
        assert s["channels"] == {"telegram": False} and s["next_daily"] and s["next_weekly"] is None
        assert s["scheduler_running"] is False     # TestClient never enters the lifespan

    def test_send_and_test_require_a_channel(self):
        assert client.post("/api/digest/send", json={"kind": "daily"}).status_code == 400
        assert client.post("/api/digest/test").status_code == 400

    def test_send_rejects_unknown_kind(self):
        assert client.post("/api/digest/send", json={"kind": "monthly"}).status_code == 422

    def test_preview_returns_digest_and_text_without_logging(self):
        with patch("routers.digest.build_digest", side_effect=lambda kind, now, tz: build(kind)):
            r = client.post("/api/digest/preview", json={"kind": "weekly"})
        assert r.status_code == 200 and r.json()["digest"]["kind"] == "weekly" and "Weekly Digest" in r.json()["text"]
        assert client.get("/api/digest/history").json() == []

    def test_send_history_and_detail(self, fake_channel, monkeypatch):
        monkeypatch.setattr("routers.digest.configured_channels", lambda: ["fake"])
        sent = client.post("/api/digest/send", json={"kind": "daily"})
        assert sent.status_code == 200 and sent.json()["status"] == "sent"
        hist = client.get("/api/digest/history").json()
        assert len(hist) == 1 and "text" not in hist[0] and hist[0]["trigger"] == "manual"
        detail = client.get(f"/api/digest/history/{hist[0]['id']}").json()
        assert "Daily Digest" in detail["text"]
        assert client.get("/api/digest/history/9999").status_code == 404

    def test_test_message_endpoint(self, monkeypatch):
        ch = _FakeChannel()
        monkeypatch.setattr("routers.digest.configured_channels", lambda: ["fake"])
        monkeypatch.setattr("routers.digest.CHANNELS", {"fake": ch})
        r = client.post("/api/digest/test")
        assert r.json()["ok"] is True and "test message" in ch.sent[0]
