# StockMonitor — Product Enhancement Roadmap

> Audience: retail investor who day-trades, invests long-term, monitors markets, and tracks portfolio risk/P&L.
> Last reviewed: 2026-09-12

---

## What exists today

The app has grown from 7 tabs to 90+ views across 11 sidebar groups. Nearly everything proposed in the original (2026-05-27) version of this roadmap has since shipped. Current state by group:

| Group | Views |
|-------|-------|
| **Home** | Aggregated dashboard (P&L, market pulse, movers, earnings, alerts, recents) + ⌘K command palette |
| **Markets** | Overview, Sentiment, Reddit Trending, Index Heatmap, Breadth, Sector Rotation, Sector Momentum, Yield Curve, Fed Watch, Macro Calendar, Analyst Picks, Short Squeeze, IPO & Lockups, Insider Trading, Crypto, Economic Indicators |
| **Research** | Screener (preset + custom), Fundamentals, DCF Valuation, Chart Compare, Backtester, Earnings Surprise, Earnings Strategy, Analyst Ratings, Fund Holdings, Activist Tracker (13D/13G), Relative Strength, Seasonal Patterns, ETF Overlap, Signals, Unusual Options Activity |
| **Watchlist** | Watchlist, Heatmap, Correlation Matrix, Price Targets, Earnings+, News Sentiment, Smart Alerts |
| **News** | Custom multi-ticker news feed |
| **Trading** | Trade Ideas, Position Sizer, Wheel Tracker, Day Trader (plan calculator, scanner, playbooks) |
| **Merger Arb** | Overview, Deal Dashboard, Opportunity Scanner, Deal Analyzer, Arb Portfolio, Risk Matrix, Alerts |
| **SPACs** | Overview, Tracker, Discovery, Deal Analyzer, Portfolio, Alerts, Risk Matrix |
| **Portfolio** | Portfolio (heatmap/table), Options P&L, Tax Lots, Dividend Tracker, Stress Test, Attribution, Trade Journal, CPPI Allocator, Net Market Exposure |
| **AI Tools** | Morning Briefing, Stock Analyzer, Portfolio Review, Financial Advisor, Tax Advisor, AI Chat |
| **Retirement** | FIRE Calculator, Coast FIRE & Roth, Monte Carlo, Social Security, Early Retirement Health, Roth Conversion Planner, Medicare Estimator, Estate & RMD |

Chart modal (used across Watchlist/Portfolio/Research) includes SMA 20/50/200, Bollinger Bands, RSI(14), MACD sub-panes, a Volume Profile overlay (20-period avg volume line + >2x-average surge highlighting), and S/R + trend-line drawing tools persisted per symbol. Data sources: yfinance + Yahoo Finance, SEC EDGAR (13D/13G, N-PORT, S-1/S-11 for IPOs), FRED-style macro series, Reddit. Alerts (price/volume/earnings) persist to SQLite. Portfolio snapshots persist nightly for drawdown/benchmark tracking. WebSocket push exists for live watchlist prices. CSV export exists for portfolio/trade data.

---

## Remaining gaps

Everything below was in the original roadmap (or a natural extension of it) and is still genuinely unbuilt, based on a code audit on 2026-09-12.

### P2
- **Extended-hours prices surfaced in Watchlist/Portfolio rows** — the backend already fetches pre/post-market prices (`_fetch_premarket`, used by the standalone Pre-Market Movers view), but Watchlist and Portfolio row data don't show pre/post-market price or change inline.
- **Mobile / responsive layout** — the app is desktop-first (wide tables, dense panels); only sparse responsive breakpoints exist. No card-view fallback for small screens.

### P3
- **Fibonacci retracement drawing tool** — the chart modal already has S/R and trend-line drawing (persisted per-symbol to localStorage); Fibonacci levels are the one drawing type from the original roadmap still missing.
- **PDF export** — CSV export exists (portfolio, trade journal) but there's no PDF export for the Financial Advisor plan or AI Advisor output.
- **Level 2 / order flow** — would require a brokerage API (Alpaca, IBKR, TD Ameritrade); out of scope for the yfinance-based stack. Noted for future consideration only.

---

## Suggested next build

Extended-hours row data is the smallest remaining item — the backend plumbing (`_fetch_premarket`) already exists, it just needs to be surfaced in the Watchlist and Portfolio row UI.
