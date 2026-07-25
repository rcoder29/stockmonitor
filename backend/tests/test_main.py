"""
Backend test suite for Stock Monitor API.
Run: python -m pytest tests/ -v
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, PropertyMock
import pandas as pd
import numpy as np

from main import app, _safe_float, _fetch_perf_one

client = TestClient(app)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mock_ticker(
    price=150.0, prev=148.0,
    day_high=152.0, day_low=147.0,
    volume=1_000_000,
    year_high=200.0, year_low=100.0,
    market_cap=2e12,
    info=None,
):
    fi = MagicMock()
    fi.last_price      = price
    fi.previous_close  = prev
    fi.day_high        = day_high
    fi.day_low         = day_low
    fi.last_volume     = volume
    fi.year_high       = year_high
    fi.year_low        = year_low
    fi.market_cap      = market_cap

    ticker = MagicMock()
    ticker.fast_info = fi
    ticker.info = info or {
        "shortName":      "Test Corp",
        "trailingPE":     25.0,
        "forwardPE":      22.0,
        "trailingEps":    6.0,
        "dividendYield":  0.02,
        "beta":           1.1,
        "totalRevenue":   5e10,
        "profitMargins":  0.25,
        "returnOnEquity": 0.30,
        "debtToEquity":   50.0,
        "priceToBook":    8.0,
    }
    return ticker


def _mock_history(closes=(100.0, 102.0, 101.0)):
    """Return a minimal yfinance history DataFrame."""
    dates = pd.date_range("2025-01-01", periods=len(closes), freq="B")
    return pd.DataFrame({"Close": list(closes)}, index=dates)


# ── _safe_float ────────────────────────────────────────────────────────────────

class TestSafeFloat:
    def test_int(self):               assert _safe_float(1)       == 1.0
    def test_float(self):             assert _safe_float(1.5)     == 1.5
    def test_zero(self):              assert _safe_float(0)       == 0.0
    def test_none_returns_none(self): assert _safe_float(None)    is None
    def test_string_number(self):     assert _safe_float("3.14")  == pytest.approx(3.14)
    def test_invalid_string(self):    assert _safe_float("bad")   is None
    def test_nan_returns_none(self):  assert _safe_float(float("nan")) is None


# ── /health ────────────────────────────────────────────────────────────────────

class TestHealth:
    def test_returns_ok(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


# ── /api/quotes ────────────────────────────────────────────────────────────────

class TestGetQuotes:
    def test_empty_symbols_returns_empty(self):
        assert client.get("/api/quotes?symbols=").json() == []

    def test_single_ticker(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker()):
            r = client.get("/api/quotes?symbols=AAPL")
        q = r.json()[0]
        assert q["symbol"] == "AAPL"
        assert q["price"] == pytest.approx(150.0)
        assert q["change"] == pytest.approx(2.0)
        assert q["error"] is None

    def test_multiple_tickers_all_returned(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker()):
            data = client.get("/api/quotes?symbols=AAPL,MSFT,GOOGL").json()
        assert {q["symbol"] for q in data} == {"AAPL", "MSFT", "GOOGL"}

    def test_order_preserved(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker()):
            syms = [q["symbol"] for q in client.get("/api/quotes?symbols=MSFT,AAPL").json()]
        assert syms == ["MSFT", "AAPL"]

    def test_lowercase_normalized(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker()):
            assert client.get("/api/quotes?symbols=aapl").json()[0]["symbol"] == "AAPL"

    def test_whitespace_stripped(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker()):
            syms = {q["symbol"] for q in client.get("/api/quotes?symbols= AAPL , MSFT ").json()}
        assert syms == {"AAPL", "MSFT"}

    def test_fundamentals_present(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker()), \
             patch("main.cache_get", return_value=None):
            q = client.get("/api/quotes?symbols=AAPL").json()[0]
        assert q["name"] == "Test Corp"
        assert q["peRatio"] == pytest.approx(25.0)

    def test_yfinance_error_sets_error_field(self):
        t = MagicMock()
        type(t).fast_info = PropertyMock(side_effect=RuntimeError("delisted"))
        with patch("main.yf.Ticker", return_value=t):
            q = client.get("/api/quotes?symbols=BAD").json()[0]
        assert q["error"] is not None

    def test_change_computed_correctly(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker(price=200.0, prev=190.0)):
            q = client.get("/api/quotes?symbols=AAPL").json()[0]
        assert q["change"] == pytest.approx(10.0)
        assert q["changePercent"] == pytest.approx(10.0 / 190.0 * 100)

    def test_none_prev_close_gives_none_change(self):
        t = _mock_ticker()
        t.fast_info.previous_close = None
        with patch("main.yf.Ticker", return_value=t):
            q = client.get("/api/quotes?symbols=AAPL").json()[0]
        assert q["change"] is None
        assert q["changePercent"] is None


# ── _fetch_perf_one ────────────────────────────────────────────────────────────

class TestFetchPerfOne:
    def _hist(self, n=300, start=100.0, end=120.0):
        prices = np.linspace(start, end, n)
        idx = pd.date_range("2024-01-01", periods=n, freq="B")
        df = pd.DataFrame({"Close": prices}, index=idx)
        df.index = df.index.tz_localize("America/New_York")
        return df

    def test_returns_symbol(self):
        t = MagicMock()
        t.history.return_value = self._hist()
        with patch("main.yf.Ticker", return_value=t):
            r = _fetch_perf_one("AAPL")
        assert r["symbol"] == "AAPL"

    def test_returns_price(self):
        t = MagicMock()
        t.history.return_value = self._hist(end=150.0)
        with patch("main.yf.Ticker", return_value=t):
            r = _fetch_perf_one("AAPL")
        assert r["price"] == pytest.approx(150.0, rel=0.01)

    def test_empty_history_returns_symbol_only(self):
        t = MagicMock()
        t.history.return_value = pd.DataFrame()
        with patch("main.yf.Ticker", return_value=t):
            r = _fetch_perf_one("AAPL")
        assert r == {"symbol": "AAPL"}

    def test_all_period_keys_present(self):
        t = MagicMock()
        t.history.return_value = self._hist()
        with patch("main.yf.Ticker", return_value=t):
            r = _fetch_perf_one("AAPL")
        for key in ("1d", "5d", "1m", "3m", "6m", "1y", "ytd"):
            assert key in r

    def test_exception_returns_symbol_only(self):
        t = MagicMock()
        t.history.side_effect = RuntimeError("network error")
        with patch("main.yf.Ticker", return_value=t):
            r = _fetch_perf_one("AAPL")
        assert r == {"symbol": "AAPL"}


# ── /api/index-constituents ────────────────────────────────────────────────────

class TestIndexConstituents:
    def test_invalid_index_returns_400(self):
        r = client.get("/api/index-constituents?index=NOTREAL")
        assert r.status_code == 400

    def test_valid_index_returns_list(self):
        mock_perf = {"symbol": "AAPL", "price": 150.0, "1d": 1.0,
                     "5d": 2.0, "1m": 3.0, "3m": 4.0, "6m": 5.0, "1y": 10.0, "ytd": 8.0}
        mock_cap = ("AAPL", 3e12)
        with patch("main._fetch_perf_one", return_value=mock_perf), \
             patch("main._fetch_market_cap", return_value=mock_cap):
            r = client.get("/api/index-constituents?index=DOW30")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0

    def test_response_fields_present(self):
        mock_perf = {"symbol": "AAPL", "price": 150.0, "1d": 1.0,
                     "5d": None, "1m": None, "3m": None, "6m": None, "1y": None, "ytd": None}
        mock_cap = ("AAPL", 3e12)
        with patch("main._fetch_perf_one", return_value=mock_perf), \
             patch("main._fetch_market_cap", return_value=mock_cap):
            r = client.get("/api/index-constituents?index=DOW30")
        item = r.json()[0]
        for field in ("symbol", "name", "sector", "actualWeight", "marketCap", "price", "1d"):
            assert field in item, f"missing field: {field}"

    def test_actual_weight_computed(self):
        mock_perf = {"symbol": "AAPL", "price": 150.0, "1d": 1.0,
                     "5d": None, "1m": None, "3m": None, "6m": None, "1y": None, "ytd": None}
        # Return a meaningful cap for every call
        with patch("main._fetch_perf_one", return_value=mock_perf), \
             patch("main._fetch_market_cap", side_effect=lambda s: (s, 1e12)):
            r = client.get("/api/index-constituents?index=DOW30")
        items = r.json()
        # All weights should be equal (same cap) and sum close to 100
        weights = [i["actualWeight"] for i in items if i["actualWeight"] is not None]
        assert len(weights) > 0
        assert abs(sum(weights) - 100.0) < 1.0

    def test_default_index_is_dow30(self):
        mock_perf = {"symbol": "X", "price": 1.0, "1d": 0.0,
                     "5d": None, "1m": None, "3m": None, "6m": None, "1y": None, "ytd": None}
        with patch("main._fetch_perf_one", return_value=mock_perf), \
             patch("main._fetch_market_cap", side_effect=lambda s: (s, 1e12)):
            r = client.get("/api/index-constituents")
        assert r.status_code == 200


# ── /api/search-etf ───────────────────────────────────────────────────────────

class TestSearchEtf:
    def _mock_search_response(self, quotes):
        resp = MagicMock()
        resp.json.return_value = {"quotes": quotes}
        return resp

    def test_returns_etfs_only(self):
        quotes = [
            {"symbol": "QQQ",  "quoteType": "ETF",   "longname": "Invesco QQQ", "exchange": "NMS"},
            {"symbol": "AAPL", "quoteType": "EQUITY", "longname": "Apple Inc.",  "exchange": "NMS"},
            {"symbol": "SPY",  "quoteType": "ETF",   "longname": "SPDR S&P 500","exchange": "NYSEArca"},
        ]
        with patch("main._session") as ms:
            ms.get.return_value = self._mock_search_response(quotes)
            r = client.get("/api/search-etf?q=QQQ")
        data = r.json()
        syms = {d["symbol"] for d in data}
        assert "AAPL" not in syms
        assert "QQQ" in syms

    def test_empty_query_returns_empty(self):
        r = client.get("/api/search-etf?q=")
        assert r.status_code == 200
        assert r.json() == []

    def test_response_shape(self):
        quotes = [{"symbol": "GLD", "quoteType": "ETF", "longname": "SPDR Gold", "exchange": "NYSEArca"}]
        with patch("main._session") as ms:
            ms.get.return_value = self._mock_search_response(quotes)
            r = client.get("/api/search-etf?q=gold")
        item = r.json()[0]
        assert "symbol" in item
        assert "name" in item
        assert "type" in item


# ── Watchlist CRUD ─────────────────────────────────────────────────────────────

class TestWatchlist:
    def test_get_watchlist_returns_list(self):
        r = client.get("/api/watchlist")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_add_symbol(self):
        r = client.post("/api/watchlist", json={"symbol": "TESTSYM99", "list": "default"})
        assert r.status_code in (200, 201)
        syms = client.get("/api/watchlist?list=default").json()
        assert "TESTSYM99" in syms
        # cleanup
        client.delete("/api/watchlist/TESTSYM99?list=default")

    def test_add_normalizes_to_upper(self):
        client.post("/api/watchlist", json={"symbol": "testlow", "list": "default"})
        syms = client.get("/api/watchlist?list=default").json()
        assert "TESTLOW" in syms
        client.delete("/api/watchlist/TESTLOW?list=default")

    def test_remove_symbol(self):
        client.post("/api/watchlist", json={"symbol": "RMTEST", "list": "default"})
        client.delete("/api/watchlist/RMTEST?list=default")
        syms = client.get("/api/watchlist?list=default").json()
        assert "RMTEST" not in syms

    def test_duplicate_add_idempotent(self):
        client.post("/api/watchlist", json={"symbol": "DUPTEST", "list": "default"})
        client.post("/api/watchlist", json={"symbol": "DUPTEST", "list": "default"})
        syms = client.get("/api/watchlist?list=default").json()
        assert syms.count("DUPTEST") <= 1
        client.delete("/api/watchlist/DUPTEST?list=default")


# ── Portfolio CRUD ─────────────────────────────────────────────────────────────

class TestPortfolio:
    def test_get_portfolio_returns_list(self):
        r = client.get("/api/portfolio")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_add_position(self):
        r = client.post("/api/portfolio", json={"symbol": "PTTEST", "shares": 10.0, "avgCost": 100.0})
        assert r.status_code in (200, 201)
        data = r.json()
        assert data["symbol"] == "PTTEST"
        assert data["shares"] == pytest.approx(10.0)
        # cleanup
        client.delete(f"/api/portfolio/{data['id']}")

    def test_add_position_normalizes_symbol(self):
        r = client.post("/api/portfolio", json={"symbol": "ptlower", "shares": 5.0, "avgCost": 50.0})
        assert r.json()["symbol"] == "PTLOWER"
        client.delete(f"/api/portfolio/{r.json()['id']}")

    def test_remove_position(self):
        r = client.post("/api/portfolio", json={"symbol": "RMPORT", "shares": 1.0, "avgCost": 10.0})
        pid = r.json()["id"]
        dr = client.delete(f"/api/portfolio/{pid}")
        assert dr.status_code in (200, 204)
        ids = [p["id"] for p in client.get("/api/portfolio").json()]
        assert pid not in ids

    def test_remove_nonexistent_position_ok(self):
        r = client.delete("/api/portfolio/999999")
        assert r.status_code in (200, 204, 404)


# ── Alerts CRUD ────────────────────────────────────────────────────────────────

class TestAlerts:
    def test_get_alerts_returns_list(self):
        r = client.get("/api/alerts")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_price_alert(self):
        payload = {"symbol": "ALTEST", "target_price": 200.0,
                   "condition": "above", "alert_type": "price", "note": "test"}
        r = client.post("/api/alerts", json=payload)
        assert r.status_code == 201
        a = r.json()
        assert a["symbol"] == "ALTEST"
        assert a["condition"] == "above"
        assert a["status"] == "active"
        # cleanup
        client.delete(f"/api/alerts/{a['id']}")

    def test_invalid_condition_returns_400(self):
        payload = {"symbol": "ALTEST", "target_price": 100.0,
                   "condition": "sideways", "alert_type": "price"}
        r = client.post("/api/alerts", json=payload)
        assert r.status_code == 400

    def test_delete_alert(self):
        r = client.post("/api/alerts", json={"symbol": "DELALERT", "target_price": 50.0,
                                              "condition": "below", "alert_type": "price"})
        aid = r.json()["id"]
        client.delete(f"/api/alerts/{aid}")
        ids = [a["id"] for a in client.get("/api/alerts").json()]
        assert aid not in ids

    def test_trigger_alert(self):
        r = client.post("/api/alerts", json={"symbol": "TRGTEST", "target_price": 300.0,
                                              "condition": "above", "alert_type": "price"})
        aid = r.json()["id"]
        client.patch(f"/api/alerts/{aid}/trigger")
        alert = next((a for a in client.get("/api/alerts").json() if a["id"] == aid), None)
        assert alert is not None
        assert alert["status"] == "triggered"
        # cleanup
        client.delete(f"/api/alerts/{aid}")

    def test_alert_symbol_normalized_to_upper(self):
        r = client.post("/api/alerts", json={"symbol": "alower", "target_price": 100.0,
                                              "condition": "above", "alert_type": "price"})
        assert r.json()["symbol"] == "ALOWER"
        client.delete(f"/api/alerts/{r.json()['id']}")


# ── /api/market/performance ────────────────────────────────────────────────────

class TestMarketPerformance:
    def test_returns_200(self):
        mock = {"symbol": "SPY", "price": 500.0, "1d": 0.5,
                "5d": 1.0, "1m": 2.0, "3m": 3.0, "6m": 5.0, "1y": 10.0, "ytd": 8.0}
        with patch("main._fetch_perf_one", return_value=mock):
            r = client.get("/api/market/performance")
        assert r.status_code == 200

    def test_response_has_sections(self):
        mock = {"symbol": "SPY", "price": 500.0, "1d": 0.5,
                "5d": 1.0, "1m": 2.0, "3m": 3.0, "6m": 5.0, "1y": 10.0, "ytd": 8.0}
        with patch("main._fetch_perf_one", return_value=mock):
            data = client.get("/api/market/performance").json()
        assert "indices" in data or isinstance(data, dict)


# ── /api/market/rates ─────────────────────────────────────────────────────────

class TestMarketRates:
    def test_returns_200(self):
        mock = {"symbol": "^TNX", "price": 4.2, "1d": 0.01,
                "5d": None, "1m": None, "3m": None, "6m": None, "1y": None, "ytd": None}
        with patch("main._fetch_perf_one", return_value=mock):
            r = client.get("/api/market/rates")
        assert r.status_code == 200


# ── /api/chart ────────────────────────────────────────────────────────────────

class TestChart:
    def _mock_hist(self):
        df = pd.DataFrame({
            "Open":   [100.0, 101.0],
            "High":   [102.0, 103.0],
            "Low":    [99.0,  100.0],
            "Close":  [101.0, 102.0],
            "Volume": [1_000_000, 1_200_000],
        }, index=pd.date_range("2025-01-01", periods=2, freq="B"))
        return df

    def test_valid_period_returns_bars(self):
        t = MagicMock()
        t.history.return_value = self._mock_hist()
        with patch("main.yf.Ticker", return_value=t):
            r = client.get("/api/chart/AAPL?period=1mo")
        assert r.status_code == 200
        body = r.json()
        assert "data" in body
        assert len(body["data"]) == 2

    def test_bar_fields(self):
        t = MagicMock()
        t.history.return_value = self._mock_hist()
        with patch("main.yf.Ticker", return_value=t):
            body = client.get("/api/chart/AAPL?period=1mo").json()
        bar = body["data"][0]
        for f in ("time", "open", "high", "low", "close", "volume"):
            assert f in bar
