# StockMonitor — Product Enhancement Roadmap

> Audience: retail investor who day-trades, invests long-term, monitors markets, and tracks portfolio risk/P&L.
> Last reviewed: 2026-09-23

---

## What exists today

The app has grown from 7 tabs to 90+ views across 11 sidebar groups, plus an in-app Investor Education module (5-layer onion map of investing concepts, unrelated to the tab count below). Nearly everything proposed in the original (2026-05-27) version of this roadmap has since shipped. Current state by group:

| Group | Views |
|-------|-------|
| **Home** | Aggregated dashboard (P&L, market pulse, movers, earnings, alerts, recents) + ⌘K command palette |
| **Markets** | Overview, Sentiment, Reddit Trending, Index Heatmap, Breadth, Sector Rotation, Sector Momentum, Yield Curve, Fed Watch, Macro Calendar, Analyst Picks, Short Squeeze, IPO & Lockups, Insider Trading, Crypto, Economic Indicators |
| **Research** | Screener (preset + custom), Range Screener (30/60/90-day support/resistance scan), Fundamentals, DCF Valuation, Chart Compare, Backtester, Earnings Surprise, Earnings Strategy, Analyst Ratings, Fund Holdings, Activist Tracker (13D/13G), Relative Strength, Seasonal Patterns, ETF Overlap, Signals, Unusual Options Activity |
| **Watchlist** | Watchlist, Heatmap, Correlation Matrix, Price Targets, Earnings+, News Sentiment, Smart Alerts |
| **News** | Custom multi-ticker news feed |
| **Trading** | Trade Ideas, Position Sizer, Wheel Tracker, Day Trader (plan calculator, scanner, playbooks) |
| **Merger Arb** | Overview, Deal Dashboard, Opportunity Scanner, Deal Analyzer, Arb Portfolio, Risk Matrix, Alerts |
| **SPACs** | Overview, Tracker, Discovery, Deal Analyzer, Portfolio, Alerts, Risk Matrix |
| **Portfolio** | Portfolio (heatmap/table), Options P&L, Tax Lots, Dividend Tracker, Stress Test, Attribution, Trade Journal, CPPI Allocator, Net Market Exposure |
| **AI Tools** | Morning Briefing, Digests (scheduled daily/weekly recap, delivered to Telegram), Stock Analyzer, Portfolio Review, Financial Advisor, Tax Advisor, AI Chat |
| **Retirement** | FIRE Calculator, Coast FIRE & Roth, Monte Carlo, Social Security, Early Retirement Health, Roth Conversion Planner, Medicare Estimator, Estate & RMD |

Chart modal (used across Watchlist/Portfolio/Research) includes SMA 20/50/200, Bollinger Bands, RSI(14), MACD sub-panes, a Volume Profile overlay (20-period avg volume line + >2x-average surge highlighting), and S/R + trend-line drawing tools persisted per symbol. Data sources: yfinance + Yahoo Finance, SEC EDGAR (13D/13G, N-PORT, S-1/S-11 for IPOs), FRED-style macro series, Reddit. Alerts (price/volume/earnings) persist to SQLite but are still only *evaluated* client-side (see Remaining gaps). Portfolio snapshots persist nightly for drawdown/benchmark tracking. WebSocket push exists for live watchlist prices. CSV export exists for portfolio/trade data. The backend itself was fully modularized in September 2026 (main.py: ~12,300 lines → ~550-line core + ~90 router files) — see `ARCHITECTURE.md`.

---

## Remaining gaps

Everything below was in the original roadmap (or a natural extension of it) and is still genuinely unbuilt, based on a code audit last updated 2026-09-23.

### P1
- **Backend-evaluated price/condition alerts** — alerts (price, % change, 52-week break, volume spike, Smart Alert rules) persist to SQLite but are only ever *checked* by the browser (`PATCH /api/alerts/{id}/trigger` is called from the frontend), so nothing fires unless a tab is open. The daily/weekly Digest (shipped 2026-09-19) works around this once a day by checking alerts server-side when it builds, but a real-time backend scheduler that evaluates rules continuously and pushes through the same Telegram channel is still unbuilt. Explicitly proposed and deferred by the user on 2026-09-22 ("skip alerts for now") — worth revisiting.

### P2
- **Extended-hours prices surfaced in Watchlist/Portfolio rows** — the backend already fetches pre/post-market prices (`_fetch_premarket`, used by the standalone Pre-Market Movers view), but Watchlist and Portfolio row data don't show pre/post-market price or change inline.
- **Mobile / responsive layout** — the app is desktop-first (wide tables, dense panels); only sparse responsive breakpoints exist. No card-view fallback for small screens.
- **Portfolio-aware digest/research sections** — analyst rating changes, insider selling, and new SEC filings for the user's actual holdings, plus distance from 52-week high/low, surfaced in the Digest or as a dedicated view. The underlying routers (analyst ratings, insider trading feed, SEC filings) already exist per-symbol; nothing currently rolls them up across a whole portfolio.
- **Broker/CSV import** — `csv_export_import.py` exports; there's no import path (Schwab/Fidelity/IBKR position exports) to get an existing portfolio in without manual entry. With ~190 hand-entered positions in the live portfolio, this would also likely catch bad/delisted tickers at import time instead of silently carrying them at cost.

### P3
- **Fibonacci retracement drawing tool** — the chart modal already has S/R and trend-line drawing (persisted per-symbol to localStorage); Fibonacci levels are the one drawing type from the original roadmap still missing.
- **PDF export** — CSV export exists (portfolio, trade journal) but there's no PDF export for the Financial Advisor plan or AI Advisor output.
- **Trade Journal analytics** — win rate, expectancy, and P&L by strategy/holding-period exist as raw log data (`trade_journal` table) but aren't summarized anywhere.
- **Level 2 / order flow** — would require a brokerage API (Alpaca, IBKR, TD Ameritrade); out of scope for the yfinance-based stack. Noted for future consideration only.

---

## Suggested next build

Two candidates, depending on priority: **backend-evaluated alerts** (P1, previously deferred — the highest-value remaining gap since four existing alert features depend on it) or **extended-hours row data** (still the smallest remaining item — the backend plumbing (`_fetch_premarket`) already exists, it just needs to be surfaced in the Watchlist and Portfolio row UI).
