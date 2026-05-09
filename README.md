# Stock Monitor

A personal stock watchlist app with live prices, key metrics, and fundamentals. Dark terminal aesthetic, Bloomberg-inspired layout.

![stack](https://img.shields.io/badge/backend-FastAPI-009688) ![stack](https://img.shields.io/badge/frontend-React%2018%20%2B%20Vite-61dafb) ![stack](https://img.shields.io/badge/data-yfinance%201.3-blue)

## Features

- Live price updates at a configurable refresh interval (countdown timer shown)
- Day range and 52-week range with a mini position bar
- Price flash animation (green/red) on each update
- Click any row to open a chart modal:
  - Candlestick chart (OHLC) with green/red wicks
  - Volume histogram overlaid in the bottom quarter, colored bullish/bearish
  - Period selector: 1D · 5D · 1M · 3M · 6M · 1Y · 2Y · 5Y
  - Fundamentals tab inside the same modal (P/E TTM, P/E Fwd, EPS, Div Yield, Beta, P/B, Revenue, Profit Margin, ROE, Debt/Equity)
- Watchlist persisted in `localStorage` — survives page reloads
- Default watchlist: AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA
- Server-side caching: fundamentals (5 min), chart data (1 min for 1D up to 24h for 5Y); parallel ticker fetching (up to 10 workers)

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.13 + FastAPI |
| Market data | yfinance 1.3 (via curl_cffi) |
| Frontend | React 18 + Vite + Tailwind CSS v3 |
| Charts | TradingView lightweight-charts v5 |
| Font | JetBrains Mono |
| Persistence | localStorage |

Data is sourced from Yahoo Finance (~15 min delay for free users).

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+

### Backend

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

> **Corporate / VPN users:** If you're behind a proxy with a self-signed certificate, npm may fail with an SSL error. Run `npm config set strict-ssl false` before `npm install`.

## API

| Endpoint | Description |
|---|---|
| `GET /api/quotes?symbols=AAPL,MSFT` | Returns price + fundamentals for a comma-separated list of tickers |
| `GET /api/chart/{symbol}?period=1d` | Returns OHLCV bars; periods: `1d` `5d` `1mo` `3mo` `6mo` `1y` `2y` `5y` |
| `GET /health` | Health check |

## Tests

```bash
# Backend — 20 tests, 95% coverage
cd backend
python -m pytest tests/ -v
python -m pytest tests/ --cov=main --cov-report=term-missing

# Frontend — 59 tests, 100% component/utils coverage
cd frontend
npm test
npm run test:coverage
```

## Project Structure

```
stockmonitor/
├── backend/
│   ├── main.py              FastAPI app — quotes, fundamentals, caching
│   ├── requirements.txt
│   └── tests/
│       └── test_main.py     20 pytest tests
└── frontend/
    ├── index.html
    ├── vite.config.js       /api proxy → localhost:8000
    └── src/
        ├── App.jsx          watchlist state, polling, flash logic
        ├── utils/format.js  price/volume/market cap formatters
        └── components/
            ├── Header.jsx            add-ticker form, interval selector
            ├── StockTable.jsx        main table; click row to open chart
            ├── ChartModal.jsx        candlestick + volume chart modal with period selector
            └── FundamentalsPanel.jsx metric cards (rendered inside ChartModal)
```

## Notes

- yfinance 1.3 uses `curl_cffi` internally, not `requests` — standard SSL context overrides have no effect. The backend passes a `curl_cffi` session with `impersonate="chrome"` (required; Yahoo rejects plain curl user agents).
- Fundamentals are cached server-side for 5 minutes to avoid Yahoo rate limits.
- Run uvicorn **without** `--reload` in production to avoid zombie worker processes on Windows.
