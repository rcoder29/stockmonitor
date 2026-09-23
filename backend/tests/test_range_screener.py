"""
Tests for the Range-Bound Screener: window metrics (efficiency ratio, touches,
signal/entry-exit math), the universe/caching path, and the API.
Run: python -m pytest tests/test_range_screener.py -v
"""
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import routers.range_screener as rs
from main import app

client = TestClient(app)


def _series(vals, n=None, start="2026-01-01"):
    """Business-day-indexed Series from a list, or n cycles of it if longer is needed."""
    if n:
        vals = (list(vals) * (n // len(vals) + 1))[:n]
    idx = pd.bdate_range(start, periods=len(vals))
    return pd.Series(vals, index=idx, dtype=float)


@pytest.fixture(autouse=True)
def clear_cache(monkeypatch):
    # _compute_range_data / cache_get/cache_set touch the real sqlite cache table;
    # keep these tests independent of whatever main.py's tests left behind.
    monkeypatch.setattr(rs, "cache_get", lambda *a, **k: None)
    monkeypatch.setattr(rs, "cache_set", lambda *a, **k: None)


# ── _window_metrics: the core math ───────────────────────────────────────────

class TestWindowMetrics:
    def test_choppy_series_scores_high_and_flags_both_touch_zones(self):
        # Oscillates 100 <-> 110 for 20 bars, net-flat -> efficiency ratio near 0.
        vals = [100, 110] * 10
        s = _series(vals)
        m = rs._window_metrics(s, s, s, price=s.iloc[-1], days=30)
        assert m is not None
        assert m["rangeScore"] > 90          # ER ~ 0 -> score ~ 100
        assert m["touchesLow"] >= 2 and m["touchesHigh"] >= 2
        assert m["high"] == 110.0 and m["low"] == 100.0

    def test_steady_uptrend_scores_low(self):
        s = _series(list(np.linspace(100, 150, 20)))
        m = rs._window_metrics(s, s, s, price=s.iloc[-1], days=30)
        assert m is not None
        assert m["rangeScore"] < 10          # net move ~= total path -> ER ~ 1

    def test_position_pct_and_signal_near_support(self):
        s = _series([100] * 5 + [110] * 5 + [100.5] * 5)   # ends just above the low
        m = rs._window_metrics(s, s, s, price=100.5, days=30)
        assert m["positionPct"] == pytest.approx(5.0, abs=0.5)
        assert m["signal"] == "near_support"
        assert m["entry"] == 100.5 and m["target"] == 110.0
        assert m["stop"] < 100.0
        assert m["riskReward"] > 0

    def test_position_pct_and_signal_near_resistance(self):
        s = _series([100] * 5 + [110] * 5 + [109.5] * 5)   # ends just below the high
        m = rs._window_metrics(s, s, s, price=109.5, days=30)
        assert m["signal"] == "near_resistance"
        assert m["entry"] == 109.5 and m["target"] == 100.0
        assert m["stop"] > 110.0
        assert m["riskReward"] > 0

    def test_mid_range_is_neutral_with_no_trade_levels(self):
        s = _series([100] * 5 + [110] * 5 + [105] * 5)
        m = rs._window_metrics(s, s, s, price=105.0, days=30)
        assert m["signal"] == "neutral"
        assert m["entry"] is None and m["target"] is None and m["stop"] is None and m["riskReward"] is None

    def test_flat_series_has_no_range_and_is_rejected(self):
        s = _series([100.0] * 20)
        assert rs._window_metrics(s, s, s, price=100.0, days=30) is None

    def test_too_few_bars_is_rejected(self):
        s = _series([100, 101, 102])   # well under the 30d minimum
        assert rs._window_metrics(s, s, s, price=102, days=30) is None

    def test_min_bars_scales_with_window(self):
        assert rs._min_bars_for(30) < rs._min_bars_for(60) < rs._min_bars_for(90)


# ── _compute_range_data: batching, per-symbol windows, resilience ───────────

def _fake_download(symbols):
    """A yf.download(group_by='column')-shaped frame: 130 bdays, AAA range-bound,
    BBB trending, CCC too short a history, DDD present in the frame but with no data."""
    idx = pd.bdate_range("2025-01-01", periods=130)
    n = len(idx)
    cols = {}
    close_aaa = ([100, 108] * (n // 2 + 1))[:n]
    close_bbb = list(np.linspace(50, 90, n))
    close_ccc = [np.nan] * (n - 5) + [20, 21, 20.5, 21.5, 20]
    for sym, closes in (("AAA", close_aaa), ("BBB", close_bbb), ("CCC", close_ccc)):
        cols[("Close", sym)] = closes
        cols[("High", sym)] = [c + 1 if not np.isnan(c) else np.nan for c in closes]
        cols[("Low", sym)]  = [c - 1 if not np.isnan(c) else np.nan for c in closes]
    df = pd.DataFrame(cols, index=idx)
    df.columns = pd.MultiIndex.from_tuples(df.columns)
    return df


class TestComputeRangeData:
    def test_builds_a_window_per_symbol_and_skips_short_or_empty_history(self):
        with patch("routers.range_screener.yf.download", return_value=_fake_download(["AAA", "BBB", "CCC", "DDD"])):
            data = rs._compute_range_data(["AAA", "BBB", "CCC", "DDD"])
        by_sym = {r["symbol"]: r for r in data}
        assert set(by_sym) == {"AAA", "BBB"}       # CCC too short, DDD not in the frame at all
        assert set(by_sym["AAA"]["windows"]) == {"30", "60", "90"}
        assert by_sym["AAA"]["windows"]["30"]["rangeScore"] > by_sym["BBB"]["windows"]["30"]["rangeScore"]

    def test_download_failure_raises_http_500(self):
        with patch("routers.range_screener.yf.download", side_effect=RuntimeError("rate limited")):
            with pytest.raises(Exception) as exc:
                rs._compute_range_data(["AAA"])
        assert "rate limited" in str(exc.value)

    def test_empty_frame_returns_empty_list(self):
        with patch("routers.range_screener.yf.download", return_value=pd.DataFrame()):
            assert rs._compute_range_data(["AAA"]) == []


# ── API ───────────────────────────────────────────────────────────────────────

class TestApi:
    def test_rejects_bad_window_and_signal(self):
        assert client.get("/api/screener/range-bound?window=45").status_code == 400
        assert client.get("/api/screener/range-bound?signal=bogus").status_code == 400

    def test_custom_symbols_bypass_the_cached_universe(self):
        with patch("routers.range_screener.yf.download", return_value=_fake_download(["AAA", "BBB"])) as dl:
            r = client.get("/api/screener/range-bound?symbols=aaa,bbb&window=30&min_score=0&min_width=0&min_touches=0")
        assert r.status_code == 200
        syms = {row["symbol"] for row in r.json()}
        assert syms <= {"AAA", "BBB"}
        assert dl.call_args.args[0] == ["AAA", "BBB"]   # lowercased input upper-cased before the fetch

    def test_rejects_empty_symbols_string(self):
        assert client.get("/api/screener/range-bound?symbols=,,").status_code == 400

    def test_filters_narrow_the_result_and_response_shape(self):
        with patch("routers.range_screener._default_universe_data", return_value=[
            {"symbol": "AAA", "name": "Acme", "price": 104.0, "windows": {
                "60": {"high": 108.0, "low": 100.0, "widthPct": 8.0, "positionPct": 50.0,
                       "rangeScore": 95.0, "touchesLow": 3, "touchesHigh": 3, "signal": "neutral",
                       "entry": None, "target": None, "stop": None, "riskReward": None},
            }},
            {"symbol": "BBB", "name": None, "price": 50.0, "windows": {
                "60": {"high": 55.0, "low": 45.0, "widthPct": 22.0, "positionPct": 10.0,
                       "rangeScore": 20.0, "touchesLow": 1, "touchesHigh": 1, "signal": "near_support",
                       "entry": 50.0, "target": 55.0, "stop": 44.0, "riskReward": 1.5},
            }},
        ]):
            all_rows = client.get("/api/screener/range-bound?window=60&min_score=0&min_width=0&min_touches=0").json()
            assert {r["symbol"] for r in all_rows} == {"AAA", "BBB"}
            assert all_rows[0]["symbol"] == "AAA"     # higher rangeScore sorts first
            assert all_rows[0]["windowDays"] == 60 and all_rows[0]["name"] == "Acme"

            scored = client.get("/api/screener/range-bound?window=60&min_score=50&min_width=0&min_touches=0").json()
            assert [r["symbol"] for r in scored] == ["AAA"]

            touched = client.get("/api/screener/range-bound?window=60&min_score=0&min_width=0&min_touches=2").json()
            assert [r["symbol"] for r in touched] == ["AAA"]

            signaled = client.get("/api/screener/range-bound?window=60&min_score=0&min_width=0&min_touches=0&signal=near_support").json()
            assert [r["symbol"] for r in signaled] == ["BBB"]

    def test_uses_the_requested_window_key(self):
        with patch("routers.range_screener._default_universe_data", return_value=[
            {"symbol": "AAA", "name": None, "price": 100.0, "windows": {
                "30": {"high": 110, "low": 90, "widthPct": 22.0, "positionPct": 50.0, "rangeScore": 80.0,
                       "touchesLow": 3, "touchesHigh": 3, "signal": "neutral", "entry": None, "target": None, "stop": None, "riskReward": None},
            }},
        ]):
            assert client.get("/api/screener/range-bound?window=60&min_score=0&min_width=0&min_touches=0").json() == []
            assert len(client.get("/api/screener/range-bound?window=30&min_score=0&min_width=0&min_touches=0").json()) == 1
