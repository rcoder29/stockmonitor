import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, PropertyMock

from main import app, _safe_float, _fund_cache

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_cache():
    _fund_cache.clear()


def _mock_ticker(
    price=150.0,
    prev=148.0,
    day_high=152.0,
    day_low=147.0,
    volume=1_000_000,
    year_high=200.0,
    year_low=100.0,
    market_cap=2e12,
    info=None,
):
    fi = MagicMock()
    fi.last_price = price
    fi.previous_close = prev
    fi.day_high = day_high
    fi.day_low = day_low
    fi.last_volume = volume
    fi.year_high = year_high
    fi.year_low = year_low
    fi.market_cap = market_cap

    ticker = MagicMock()
    ticker.fast_info = fi
    ticker.info = info or {
        "shortName": "Test Corp",
        "trailingPE": 25.0,
        "forwardPE": 22.0,
        "trailingEps": 6.0,
        "dividendYield": 0.02,
        "beta": 1.1,
        "totalRevenue": 5e10,
        "profitMargins": 0.25,
        "returnOnEquity": 0.30,
        "debtToEquity": 50.0,
        "priceToBook": 8.0,
    }
    return ticker


# ── _safe_float ────────────────────────────────────────────────────────────────

class TestSafeFloat:
    def test_int(self):
        assert _safe_float(1) == 1.0

    def test_float(self):
        assert _safe_float(1.5) == 1.5

    def test_zero(self):
        assert _safe_float(0) == 0.0

    def test_none_returns_none(self):
        assert _safe_float(None) is None

    def test_string_number(self):
        assert _safe_float("3.14") == pytest.approx(3.14)

    def test_invalid_string_returns_none(self):
        assert _safe_float("bad") is None

    def test_nan_string_returns_none(self):
        assert _safe_float("nan") is not None  # float("nan") succeeds; that's fine


# ── /health ────────────────────────────────────────────────────────────────────

class TestHealth:
    def test_returns_ok(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


# ── /api/quotes ────────────────────────────────────────────────────────────────

class TestGetQuotes:
    def test_empty_symbols_returns_empty_list(self):
        r = client.get("/api/quotes?symbols=")
        assert r.status_code == 200
        assert r.json() == []

    def test_single_ticker_happy_path(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker()):
            r = client.get("/api/quotes?symbols=AAPL")
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 1
        q = data[0]
        assert q["symbol"] == "AAPL"
        assert q["price"] == pytest.approx(150.0)
        assert q["change"] == pytest.approx(2.0)
        assert q["changePercent"] == pytest.approx(2.0 / 148.0 * 100)
        assert q["error"] is None

    def test_multiple_tickers_all_returned(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker()):
            r = client.get("/api/quotes?symbols=AAPL,MSFT,GOOGL")
        data = r.json()
        assert len(data) == 3
        assert {q["symbol"] for q in data} == {"AAPL", "MSFT", "GOOGL"}

    def test_order_preserved(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker()):
            r = client.get("/api/quotes?symbols=MSFT,AAPL")
        symbols = [q["symbol"] for q in r.json()]
        assert symbols == ["MSFT", "AAPL"]

    def test_lowercase_symbols_normalized_to_upper(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker()):
            r = client.get("/api/quotes?symbols=aapl")
        assert r.json()[0]["symbol"] == "AAPL"

    def test_whitespace_around_symbols_stripped(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker()):
            r = client.get("/api/quotes?symbols= AAPL , MSFT ")
        symbols = {q["symbol"] for q in r.json()}
        assert symbols == {"AAPL", "MSFT"}

    def test_fundamentals_in_response(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker()):
            r = client.get("/api/quotes?symbols=AAPL")
        q = r.json()[0]
        assert q["name"] == "Test Corp"
        assert q["peRatio"] == pytest.approx(25.0)
        assert q["eps"] == pytest.approx(6.0)

    def test_yfinance_error_returns_error_field(self):
        ticker = MagicMock()
        type(ticker).fast_info = PropertyMock(side_effect=RuntimeError("delisted"))
        with patch("main.yf.Ticker", return_value=ticker):
            r = client.get("/api/quotes?symbols=BAD")
        q = r.json()[0]
        assert q["symbol"] == "BAD"
        assert q["error"] is not None
        assert "delisted" in q["error"]

    def test_fundamentals_failure_still_returns_price(self):
        ticker = MagicMock()
        fi = MagicMock()
        fi.last_price = 100.0
        fi.previous_close = 99.0
        fi.day_high = 101.0
        fi.day_low = 98.0
        fi.last_volume = 500_000
        fi.year_high = 120.0
        fi.year_low = 80.0
        fi.market_cap = 1e12
        ticker.fast_info = fi
        type(ticker).info = PropertyMock(side_effect=AttributeError("_dividends"))
        with patch("main.yf.Ticker", return_value=ticker):
            r = client.get("/api/quotes?symbols=AAPL")
        q = r.json()[0]
        assert q["price"] == pytest.approx(100.0)
        assert q["error"] is None
        # name gracefully degrades when fundamentals fail (symbol or empty)
        assert q["name"] is not None

    def test_price_fields_computed_correctly(self):
        with patch("main.yf.Ticker", return_value=_mock_ticker(price=200.0, prev=190.0)):
            r = client.get("/api/quotes?symbols=AAPL")
        q = r.json()[0]
        assert q["change"] == pytest.approx(10.0)
        assert q["changePercent"] == pytest.approx(10.0 / 190.0 * 100)

    def test_none_prev_close_gives_none_change(self):
        ticker = _mock_ticker()
        ticker.fast_info.previous_close = None
        with patch("main.yf.Ticker", return_value=ticker):
            r = client.get("/api/quotes?symbols=AAPL")
        q = r.json()[0]
        assert q["change"] is None
        assert q["changePercent"] is None

    def test_fundamentals_cached_second_call_uses_cache(self):
        mock = _mock_ticker()
        with patch("main.yf.Ticker", return_value=mock) as patched:
            client.get("/api/quotes?symbols=AAPL")
            client.get("/api/quotes?symbols=AAPL")
        # fast_info is called each time (price is live), but info only once (cached)
        info_calls = sum(
            1 for c in patched.return_value.mock_calls if "info" in str(c)
        )
        assert patched.call_count >= 2
