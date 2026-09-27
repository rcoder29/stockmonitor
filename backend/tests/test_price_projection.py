"""
Tests for the Price Projection model: the pure percentile/interpolation math,
and the credit-spread-proxy / risk-free-rate helpers against mocked dependencies.
Run: python -m pytest tests/test_price_projection.py -v
"""
import pytest

import routers.price_projection as pp


@pytest.fixture(autouse=True)
def clear_cache(monkeypatch):
    monkeypatch.setattr(pp, "cache_get", lambda *a, **k: None)
    monkeypatch.setattr(pp, "cache_set", lambda *a, **k: None)


# ── _interp_sigma ─────────────────────────────────────────────────────────────

class TestInterpSigma:
    def test_exact_point_returns_that_iv(self):
        curve = [(30, "2026-01-01", 0.20), (90, "2026-03-01", 0.25)]
        assert pp._interp_sigma(curve, 30) == 0.20
        assert pp._interp_sigma(curve, 90) == 0.25

    def test_between_points_interpolates_linearly(self):
        curve = [(0, "a", 0.20), (100, "b", 0.30)]
        assert pp._interp_sigma(curve, 50) == pytest.approx(0.25)

    def test_before_first_point_clamps_to_first(self):
        curve = [(30, "a", 0.20), (90, "b", 0.25)]
        assert pp._interp_sigma(curve, 5) == 0.20

    def test_after_last_point_clamps_to_last(self):
        curve = [(30, "a", 0.20), (90, "b", 0.25)]
        assert pp._interp_sigma(curve, 400) == 0.25

    def test_empty_curve_returns_none(self):
        assert pp._interp_sigma([], 30) is None


# ── _credit_stress_factor ────────────────────────────────────────────────────

class TestCreditStressFactor:
    def test_no_spread_is_zero(self):
        assert pp._credit_stress_factor(None) == 0.0
        assert pp._credit_stress_factor(0) == 0.0

    def test_scales_linearly_with_bps(self):
        assert pp._credit_stress_factor(100) == pytest.approx(0.1)
        assert pp._credit_stress_factor(250) == pytest.approx(0.25)

    def test_saturates_at_cap(self):
        assert pp._credit_stress_factor(5000) == 0.3


# ── _project_percentiles ─────────────────────────────────────────────────────

class TestProjectPercentiles:
    def test_zero_vol_zero_rate_holds_price_flat(self):
        out = pp._project_percentiles(price=100.0, r=0.0, q=0.0, sigma=1e-9, t=1.0, credit_stress=0.0)
        for key in ("p10", "p25", "p50", "p75", "p90"):
            assert out[key] == pytest.approx(100.0, abs=0.01)

    def test_percentiles_are_monotonically_increasing(self):
        out = pp._project_percentiles(price=100.0, r=0.03, q=0.0, sigma=0.35, t=1.0, credit_stress=0.0)
        ordered = [out["p10"], out["p25"], out["p50"], out["p75"], out["p90"]]
        assert ordered == sorted(ordered)
        assert len(set(ordered)) == len(ordered)  # strictly increasing, not just non-decreasing

    def test_positive_drift_moves_median_above_spot(self):
        out = pp._project_percentiles(price=100.0, r=0.05, q=0.0, sigma=0.001, t=1.0, credit_stress=0.0)
        assert out["p50"] > 100.0

    def test_credit_stress_only_pulls_down_lower_percentiles(self):
        base = pp._project_percentiles(price=100.0, r=0.0, q=0.0, sigma=0.35, t=1.0, credit_stress=0.0)
        stressed = pp._project_percentiles(price=100.0, r=0.0, q=0.0, sigma=0.35, t=1.0, credit_stress=0.2)
        assert stressed["p10"] < base["p10"]
        assert stressed["p25"] < base["p25"]
        assert stressed["p50"] == base["p50"]
        assert stressed["p75"] == base["p75"]
        assert stressed["p90"] == base["p90"]

    def test_credit_stress_hits_p10_harder_than_p25(self):
        base = pp._project_percentiles(price=100.0, r=0.0, q=0.0, sigma=0.35, t=1.0, credit_stress=0.0)
        stressed = pp._project_percentiles(price=100.0, r=0.0, q=0.0, sigma=0.35, t=1.0, credit_stress=0.2)
        p10_drop_pct = 1 - stressed["p10"] / base["p10"]
        p25_drop_pct = 1 - stressed["p25"] / base["p25"]
        assert p10_drop_pct > p25_drop_pct > 0

    def test_prices_never_go_negative_even_under_high_vol_and_stress(self):
        out = pp._project_percentiles(price=50.0, r=-0.05, q=0.03, sigma=1.5, t=1.0, credit_stress=0.3)
        for key in ("p10", "p25", "p50", "p75", "p90"):
            assert out[key] > 0


# ── _risk_free_rate ───────────────────────────────────────────────────────────

class TestRiskFreeRate:
    def test_reads_1yr_key_and_converts_percent_to_decimal(self, monkeypatch):
        monkeypatch.setattr(pp, "treasury_current", lambda: {
            "rates": [
                {"key": "6mo", "yield": 4.10},
                {"key": "1yr", "yield": 4.25},
                {"key": "2yr", "yield": 4.05},
            ]
        })
        assert pp._risk_free_rate() == pytest.approx(0.0425)

    def test_missing_1yr_key_returns_none(self, monkeypatch):
        monkeypatch.setattr(pp, "treasury_current", lambda: {"rates": [{"key": "2yr", "yield": 4.05}]})
        assert pp._risk_free_rate() is None

    def test_treasury_fetch_error_returns_none(self, monkeypatch):
        def boom():
            raise RuntimeError("network down")
        monkeypatch.setattr(pp, "treasury_current", boom)
        assert pp._risk_free_rate() is None


# ── _credit_spread_proxy ──────────────────────────────────────────────────────

class TestCreditSpreadProxy:
    def test_takes_median_of_available_spreads(self, monkeypatch):
        monkeypatch.setattr(pp, "bonds_search", lambda q: {
            "bonds": [
                {"spreadBps": 120}, {"spreadBps": 140}, {"spreadBps": 200}, {"spreadBps": None},
            ]
        })
        result = pp._credit_spread_proxy("XYZ")
        assert result == {"bps": 140, "bondCount": 3}

    def test_no_bonds_with_spread_returns_none(self, monkeypatch):
        monkeypatch.setattr(pp, "bonds_search", lambda q: {"bonds": []})
        assert pp._credit_spread_proxy("XYZ") is None

    def test_lookup_error_returns_none_not_raise(self, monkeypatch):
        def boom(q):
            raise RuntimeError("edgar down")
        monkeypatch.setattr(pp, "bonds_search", boom)
        assert pp._credit_spread_proxy("XYZ") is None
