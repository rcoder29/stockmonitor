# Stock Monitor

A full-featured real-time market intelligence platform for active traders and investors. Dark terminal aesthetic, Bloomberg-inspired layout — built on FastAPI, React, and Claude AI.

![backend](https://img.shields.io/badge/backend-FastAPI-009688)
![frontend](https://img.shields.io/badge/frontend-React%2018%20%2B%20Vite-61dafb)
![data](https://img.shields.io/badge/data-yfinance%20%2B%20Yahoo%20Finance-blue)
![ai](https://img.shields.io/badge/AI-Claude%20(Anthropic)-orange)
![db](https://img.shields.io/badge/persistence-SQLite-lightgrey)

---

## Overview

Stock Monitor started as a simple watchlist with live prices and has grown into a comprehensive dashboard covering market intelligence, portfolio management, deep-stock research, active trading tools, and AI-powered analysis — all in one dark-themed interface.

---

## Feature Overview

### Markets
| Feature | Description |
|---|---|
| **Overview** | Multi-timeframe performance tables for major indices, sector ETFs, and the Magnificent 7. Top-10 gainers/losers. Global news sidebar. |
| **Analyst Picks** | Sell-side analyst upgrades/downgrades (firm, prior/new rating, price target) + AI Growth Watch List across 9 AI stack layers. |
| **Breadth** | Large-cap market breadth: above-50/200MA %, A/D ratio, H/L ratio, put/call ratio, VIX sparkline, 60-day A/D line chart. |
| **Index Heatmap** | Constituent heatmap for any index or ETF. Search any ticker dynamically or use quick-access buttons (DIA, QQQ, SPY, ARKK). Tiles sized by live market-cap weight, coloured by 1D return. Market-cap-weighted index return + top contributor/drag summary. |
| **Sector Rotation** | Performance table and heatmap for 11 GICS sector ETFs across 1D/1W/1M/3M. |
| **Sector Momentum** | Composite momentum ranking with acceleration signals (▲▲/▲/▼/▼▼) and vs-SPY relative strength toggle. |
| **Macro Calendar** | Upcoming high-impact economic events: FOMC, CPI, PPI, PCE, NFP, GDP — with urgency badges. |
| **Yield Curve** | Live US Treasury curve (13W/5Y/10Y/30Y), inversion signal, DXY tracking, 60-day 10Y sparkline. |

### Watchlist
| Feature | Description |
|---|---|
| **Watchlist** | Live price feed via WebSocket (falls back to REST polling). Flash animations on price change. Day range, 52W range, volume, market cap, earnings countdown. Multi-list support. Price alerts (above/below, % change, 52W break, volume spike) with browser push notifications. |
| **Price Targets** | Set personal price targets with deadline, thesis note, and progress bar. Sorted by urgency. |
| **Earnings+** | Enriched earnings calendar: expected move (ATM straddle), beat-rate history, pre-earnings 5D drift for all watchlist + portfolio symbols. |
| **News Sentiment** | Fetches recent headlines for watchlist symbols and scores each Bullish / Neutral / Bearish with Claude AI (−1 to +1 score). |
| **Smart Alerts** | Condition-based alert rules scanned on demand: Volume Spike, Gap Up/Down, RSI Overbought/Oversold, Golden/Death Cross, Earnings Proximity. |

### Portfolio
| Feature | Description |
|---|---|
| **Portfolio** | Track positions with market value, unrealised P&L, and day P&L. Views: Heatmap, Table (CSV export), Equity Curve, Exposure, Risk, Optimizer, X-Ray, Performance vs SPY/QQQ, Dividends, Correlation, Rebalancer. |
| **Options P&L** | Log open options positions. Refresh live mid prices, Delta, Theta, IV via yfinance. DTE countdown with urgency badge. |
| **Trade Journal** | Log every trade by symbol/side/price/shares/strategy. Realised P&L matching. Win-rate breakdown by strategy. CSV export. |

### Research
| Feature | Description |
|---|---|
| **Screener** | Technical scans (52W High, Golden/Death Cross, RSI extremes, High Rel-Vol), fundamental presets (Quality Growth, Deep Value, Dividend Income, Momentum+Quality), and Claude NLP mode ("profitable tech with >20% revenue growth"). |
| **Signals** | Multi-timeframe technical summary (1D/1W/1M/3M) for all watchlist + portfolio symbols: Trend, RSI, MACD, Bollinger Band %. |
| **Chart Compare** | Normalised return chart for up to 5 stocks over 1M/3M/6M/1Y. Fundamentals side-by-side table. |
| **Fundamentals** | Side-by-side 21-metric comparison for up to 5 stocks. Best-in-class (green) / worst-in-class (red) highlighting. |
| **Backtester** | Test MA Crossover, RSI Reversal, or Bollinger Bands strategies on historical data. Returns total return, alpha, max drawdown, Sharpe, win rate, and full trade log. |
| **DCF Valuation** | Intrinsic value calculator: EPS, growth rate, WACC, terminal growth, margin of safety. Live 10-year projection table. Undervalued / Overvalued / Fairly Valued verdict. |
| **Unusual Options** | Scans options chains for abnormally high volume vs open interest across watchlist symbols (nearest 3 expiries). Vol/OI ≥ 10× highlighted in amber. |

### Trading
| Feature | Description |
|---|---|
| **Day Trader** | Trading plan calculator (capital, daily target %, max loss %, stop %, R:R). Six strategy playbooks (Gap & Go, Momentum, VWAP, Opening Range, Mean Reversion, Scalping). Live intraday scanner with trade alerts sidebar and pre-market movers. |
| **Trade Ideas** | Claude AI analyses your watchlist and generates bullish/bearish setups with specific entries, targets, and risk levels. |
| **Position Sizer** | Calculates share size using three simultaneous methods: Fixed Fractional, ATR-based (14), Half-Kelly. |

### AI Tools
| Feature | Description |
|---|---|
| **AI Chat** | Streaming Claude conversation for open-ended market questions, strategy discussion, and educational Q&A. |
| **Financial Advisor** | AI-generated portfolio strategy based on goal, horizon, capital, monthly contribution, risk tolerance, age, account type, and geographic focus. Includes asset allocation chart. |

### Chart Modal (available on any ticker)
11 tabs: Chart (candlestick + volume, 1D–5Y), Fundamentals, News, Earnings (AI earnings call summary from SEC 8-K + historical EPS/revenue chart + earnings play calculator), Options chain, Strategies (AI-generated options strategies with payoff charts), Insider transactions, Analyst ratings, Institutional holders, Sentiment, SEC Filings.

**Drawing tools:** horizontal S/R lines and trend lines — persisted in localStorage per symbol.

**Technical overlays:** SMA20/50/200, Bollinger Bands, RSI sub-pane, MACD sub-pane.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.13 + FastAPI + Uvicorn |
| Market data | yfinance 1.3 (via curl_cffi) + Yahoo Finance APIs |
| AI | Anthropic Claude API (claude-sonnet-4-6) — chat, sentiment, trade ideas, earnings summaries, screener NLP |
| Frontend | React 18 + Vite + Tailwind CSS v3 |
| Charts | TradingView Lightweight Charts v5 |
| Persistence | SQLite (positions, alerts, journal, watchlists) + localStorage (drawings, theme prefs) |
| Real-time | WebSocket (price feed) + Server-Sent Events (AI streaming) |
| Font | JetBrains Mono |

Data sourced from Yahoo Finance (free tier, ~15 min delay) and SEC EDGAR (filings, real-time).

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- Anthropic API key (required for AI features: AI Chat, Trade Ideas, News Sentiment, Earnings Summaries, Financial Advisor, NLP Screener)

### Backend

```bash
cd backend
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...   # required for AI features
python -m uvicorn main:app --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

> **Corporate / VPN users:** If behind a proxy with a self-signed certificate, run `npm config set strict-ssl false` before `npm install`.

---

## Key API Endpoints

### Market Data
| Endpoint | Description |
|---|---|
| `GET /api/quotes?symbols=AAPL,MSFT` | Live price + fundamentals |
| `GET /api/chart/{symbol}?period=1d` | OHLCV bars (1d/5d/1mo/3mo/6mo/1y/2y/5y) |
| `GET /api/market/performance` | Multi-timeframe returns for indices, sectors, Mag 7 |
| `GET /api/market/breadth` | A/D ratio, MA breadth, VIX, put/call ratio |
| `GET /api/market/rates` | Treasury yields (13W/5Y/10Y/30Y) + DXY |
| `GET /api/market/movers` | Top gainers and losers |
| `GET /api/market/news` | Global market headlines |

### Index & ETF
| Endpoint | Description |
|---|---|
| `GET /api/index-constituents?index=DOW30` | Constituent perf + market-cap weights for predefined indices |
| `GET /api/etf-holdings?etf=XLK` | Holdings for any ETF via yfinance funds_data |
| `GET /api/search-etf?q=technology` | Search ETFs/indices via Yahoo Finance |

### Watchlist & Alerts
| Endpoint | Description |
|---|---|
| `GET /api/watchlist` | Get watchlist symbols |
| `POST /api/watchlist` | Add a symbol |
| `DELETE /api/watchlist/{symbol}` | Remove a symbol |
| `GET /api/alerts` | Get all price alerts |
| `POST /api/alerts` | Create a price alert |
| `GET /api/earnings` | Upcoming earnings for watchlist |

### Portfolio
| Endpoint | Description |
|---|---|
| `GET /api/portfolio` | All positions |
| `POST /api/portfolio` | Add a position |
| `DELETE /api/portfolio/{symbol}` | Remove a position |
| `GET /api/portfolio/snapshot` | Historical equity curve snapshots |
| `GET /api/journal` | Trade journal entries |
| `POST /api/journal` | Add a trade |

### Research
| Endpoint | Description |
|---|---|
| `GET /api/screener/technical?scan=golden_cross` | Technical scans |
| `GET /api/screener/fundamental?preset=quality_growth` | Fundamental presets |
| `POST /api/screener/nlp` | NLP query → Claude → filter results |
| `GET /api/signals?symbols=AAPL,MSFT` | Multi-timeframe technical signals |
| `GET /api/fundamentals?symbols=AAPL,MSFT` | 21-metric fundamental comparison |
| `GET /api/dcf/{symbol}` | Pre-fill DCF inputs from yfinance |
| `GET /api/options/{symbol}` | Options chain (nearest expiry) |
| `GET /api/unusual-options` | Unusual options activity scan |
| `GET /api/backtest` | Run strategy backtest |

### AI
| Endpoint | Description |
|---|---|
| `POST /api/chat` | Streaming Claude chat (SSE) |
| `POST /api/advisor` | Financial advisor plan (SSE) |
| `POST /api/trade-ideas` | AI trade ideas for watchlist (SSE) |
| `GET /api/sentiment?symbols=AAPL,MSFT` | News sentiment scoring via Claude |
| `GET /api/earnings/summary/{symbol}` | AI earnings call summary from SEC 8-K |
| `GET /api/options/strategies/{symbol}` | AI-generated options strategies |

### Macro & Sectors
| Endpoint | Description |
|---|---|
| `GET /api/macro/calendar` | Upcoming economic events |
| `GET /api/sectors/performance` | Sector ETF performance |
| `GET /api/sectors/momentum` | Sector momentum scores |

---

## Project Structure

```
stockmonitor/
├── backend/
│   ├── main.py              FastAPI app (~5,500 lines) — all endpoints, helpers, cache, WebSocket
│   ├── requirements.txt
│   └── stockmonitor.db      SQLite database (auto-created on first run)
├── frontend/
│   ├── index.html
│   ├── vite.config.js       /api + /ws proxy → localhost:8000
│   └── src/
│       ├── App.jsx          Root: sidebar nav, routing, WebSocket, quote polling
│       └── components/
│           ├── Header.jsx               Add-ticker bar, refresh controls, WS status
│           ├── StockTable.jsx           Live watchlist table with flash animations
│           ├── ChartModal.jsx           11-tab chart modal (chart, fundamentals, news, earnings…)
│           ├── MarketSummary.jsx        Overview: indices, sectors, Mag 7, movers, news
│           ├── MarketRecommendations.jsx Analyst picks + AI Growth Watch List
│           ├── MarketBreadth.jsx        Breadth dashboard
│           ├── IndexHeatmap.jsx         Index/ETF constituent heatmap with dynamic search
│           ├── SectorDashboard.jsx      Sector rotation table + heatmap
│           ├── SectorMomentum.jsx       Sector momentum ranker
│           ├── MacroCalendar.jsx        Economic event calendar
│           ├── YieldCurve.jsx           Treasury curve + DXY
│           ├── PriceTargets.jsx         Personal price targets
│           ├── RichEarningsCalendar.jsx Earnings+ (expected move, beat rate, drift)
│           ├── NewsSentiment.jsx        AI news sentiment scoring
│           ├── SmartAlerts.jsx          Condition-based alert scanner
│           ├── PortfolioTracker.jsx     Portfolio (11 views: heatmap, risk, optimizer…)
│           ├── OptionsTracker.jsx       Options P&L tracker
│           ├── TradeJournal.jsx         Trade journal with P&L matching
│           ├── Screener.jsx             Technical/fundamental/NLP screener
│           ├── TechnicalSignals.jsx     Multi-timeframe signals dashboard
│           ├── StockComparison.jsx      Normalised return chart compare
│           ├── FundamentalComparison.jsx 21-metric side-by-side comparison
│           ├── Backtester.jsx           Strategy backtester
│           ├── DcfCalculator.jsx        DCF intrinsic value calculator
│           ├── UnusualOptions.jsx       Unusual options activity scanner
│           ├── DayTrader.jsx            Day trader dashboard + scanner
│           ├── TradeIdeas.jsx           AI-generated trade setups
│           ├── PositionSizer.jsx        Position sizing calculator
│           ├── AiBot.jsx               Streaming AI chat
│           ├── FinancialAdvisor.jsx    AI financial planning
│           ├── PriceAlerts.jsx         Alert modal + toast notifications
│           ├── EarningsCalendar.jsx    Inline earnings countdown
│           └── UserGuide.jsx           In-app documentation
├── CHANGELOG.md             Full feature history
└── README.md
```

---

## Caching

All backend API responses are cached in SQLite to avoid Yahoo Finance rate limits:

| Data | TTL |
|---|---|
| Live quotes | No cache (WebSocket / polling) |
| Chart data | 5 min (intraday), 1 hr (daily+) |
| Fundamentals | 2 hours |
| News / headlines | 30 minutes |
| Market breadth | 30 minutes |
| Treasury yields + DXY | 30 minutes |
| Earnings calendar | 12 hours |
| Options chain | 5 minutes |
| Index/ETF constituents | 15 minutes |
| Unusual options | 30 minutes |
| SEC filings | 12 hours |
| Earnings call summary | 24 hours |
| Sector momentum | 30 minutes |
| News sentiment | 2 hours |

---

## Notes

- **yfinance + curl_cffi:** yfinance 1.3 uses `curl_cffi` internally. The backend passes a session with `impersonate="chrome"` (required — Yahoo rejects plain curl user agents). Standard `requests` SSL overrides have no effect.
- **ANTHROPIC_API_KEY:** Required only for AI-powered features. All market data features work without it.
- **WebSocket:** Run uvicorn without `--reload` in production to avoid zombie worker processes on Windows.
- **SQLite DB:** Created automatically at `backend/stockmonitor.db` on first run. Contains watchlists, alerts, portfolio positions, trade journal, and price snapshots.
