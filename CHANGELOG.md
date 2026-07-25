# Stock Monitor — Changelog

A running log of features built and changes made, in reverse-chronological order.

---

## 2026-07-25 — Index / ETF Heatmap v2: Dynamic Search + Live Weights

### New
- **Dynamic ETF/index search** — search box with Yahoo Finance autocomplete lets users load any ETF or index (not just the four predefined ones). Results show symbol, full name, and type badge (ETF / INDEX / MUTUALFUND). Arrow-key and Enter navigation supported.
- **Live market-cap weights** — tile sizes now reflect real-time market caps fetched in parallel via `yf.fast_info.market_cap`, not hardcoded approximations. Actual weight % is displayed on every tile.
- **Weighted index return** — summary bar card shows the market-cap-weighted 1D return for the whole index (Σ weight × 1D / 100), plus Top Contributor and Top Drag cards.
- **Flat heatmap layout** — removed sector grouping; all tiles appear in a single grid sorted largest-weight-first.

### Backend
- `GET /api/search-etf?q=` — proxies Yahoo Finance search, filters to ETF/INDEX/MUTUALFUND types.
- `GET /api/etf-holdings?etf=` — fetches constituent holdings from `yf.funds_data.top_holdings`, then runs the same parallel perf + market-cap pipeline as the predefined endpoint. Fund-reported weight used when available; falls back to market-cap weight. Cached 15 min.

### Files changed
- `backend/main.py` — added `_fetch_market_cap`, updated `/api/index-constituents`, added `/api/search-etf` and `/api/etf-holdings`
- `frontend/src/components/IndexHeatmap.jsx` — added `EtfSearch` component, updated main component state to track predefined vs dynamic selection

---

## 2026-07-25 — Index / ETF Heatmap v1

### New
- **Index Heatmap** added to Market sidebar group (between Breadth and Macro Calendar).
- Four predefined indices: Dow Jones 30 (`DIA`), Nasdaq 100 (`QQQ`), S&P Top 100 (`SPY`), ARK Innovation (`ARKK`) — each with 30–100 constituent stocks, names, and GICS sectors.
- **Heatmap view**: tiles coloured green/red by 1D return, sized by index weight, grouped by GICS sector, with advance/decline summary bar.
- **Table view**: sortable across 7 periods (1D/5D/1M/3M/6M/1Y/YTD), with sector, weight, and price columns.
- Chart modal integration — click any tile or table row to open the full chart.

### Backend
- `GET /api/index-constituents?index=` — fetches perf data via `_fetch_perf_one` for all constituents, returns multi-period returns + price. Cached 15 min.

### Files changed
- `backend/main.py` — added `_INDEX_CONSTITUENTS` dict, `_INDEX_LABELS`, `/api/index-constituents`
- `frontend/src/components/IndexHeatmap.jsx` — new component (~270 lines)
- `frontend/src/App.jsx` — import + nav entry + tab render

---

## 2026-05-28 — Phase 13 + Polish Sprint

### New features
- **Market Breadth Dashboard** — scans large-cap universe for A/D ratio, above-50/200MA %, H/L ratio, put/call ratio, VIX sparkline, and 60-day A/D line chart.
- **Fundamental Comparison** — side-by-side 21-metric table for up to 5 stocks; best-in-class (green) / worst-in-class (red) highlighting.
- **Price Targets** — set personal targets with optional deadline, note, and progress bar. Cards sorted by urgency.
- **Earnings Call Summarizer** — fetches latest 8-K from SEC EDGAR, strips HTML, sends to Claude for beat/miss, guidance, management tone, key themes, risks, and notable quote.

### Enhancements
- Chart modal: SMA20/50/200 overlays, Bollinger Bands, drawing tools (S/R lines + trend lines, persisted in localStorage).
- DCF Valuation calculator with intrinsic value, margin of safety input, 10-year projection table.
- Yield Curve & Rates: live Treasury curve (13W/5Y/10Y/30Y), 10Y−13W inversion badge, DXY tracking.
- Mobile-responsive sidebar with hamburger drawer.
- CSV export for Portfolio table and Trade Journal.
- Unusual Options Activity scanner across watchlist symbols (vol ≥ 2× OI or vol ≥ 1,000 fresh).
- Replaced flat 24-tab nav with grouped collapsible sidebar (7 groups).
- In-app User Guide added (Market → Help).

---

## 2026-05-28 — Phase 12: Options P&L, Portfolio X-Ray, Sector Momentum

- **Options P&L Tracker** — log open options positions, refresh live mid prices, Delta, Theta, IV. DTE badge turns red < 7 days.
- **Portfolio X-Ray** — sector / cap-size / country exposure donut charts.
- **Sector Momentum Ranker** — composite score from 1W/1M/3M/6M/YTD; acceleration signal (▲▲/▲/▼/▼▼); toggle between absolute returns and vs-SPY relative strength.

---

## 2026-05-28 — Phase 11: Optimizer, Earnings+, Sentiment

- **Portfolio Optimizer** — efficient frontier chart; min-volatility and max-Sharpe portfolios via mean-variance optimisation.
- **Rich Earnings Calendar (Earnings+)** — expected move (ATM straddle), beat rate history, pre-earnings drift for watchlist + portfolio symbols.
- **News Sentiment** — fetches recent headlines for all watchlist symbols; Claude scores each Bullish / Neutral / Bearish with −1 to +1 score.

---

## 2026-05-28 — Phase 10: Risk, Smart Alerts 2.0, Position Sizer

- **Portfolio Risk Dashboard** — portfolio beta, Herfindahl concentration index, top-3 weight %, VaR 95% 1-day, Sharpe ratio estimate.
- **Smart Alerts 2.0** — seven alert types: Volume Spike, Gap Up/Down, RSI Overbought/Oversold, Golden/Death Cross, Earnings Proximity. Scan-on-demand.
- **Position Sizer** — three simultaneous sizing methods: Fixed Fractional, ATR-based (14), Half-Kelly.

---

## 2026-05-28 — Phase 9: Options Strategies, Signals, Trade Ideas

- **Options Strategy Builder** — AI-generated options strategies (covered call, protective put, straddle, strangle, spread) with payoff visualisation per symbol.
- **Multi-timeframe Technical Signals** — 1D/1W/1M/3M signals for all watchlist + portfolio symbols; Trend, RSI, MACD, Bollinger Band % per timeframe.
- **AI Trade Ideas** — Claude generates bullish/bearish setups with entry, target, and risk levels based on current watchlist quotes.

---

## 2026-05-28 — Phase 8: Equity Curve, Earnings Play Calc, NLP Screener

- **Portfolio Equity Curve** — total portfolio value vs cost basis over time using daily snapshots.
- **Earnings Play Calculator** — expected move from ATM straddle price; straddle/strangle cost and break-even levels.
- **Claude NLP Screener** — type a natural-language query ("profitable tech with >20% revenue growth"); Claude translates to filter criteria.

---

## 2026-05-28 — Phase 7: WebSocket, Push, SEC, UOA

- **WebSocket live price feed** — real-time tick updates during market hours; flash animations on price change.
- **Browser push notifications** — price alerts fire even when the tab is in the background.
- **SEC Filings viewer** — recent 10-K, 10-Q, 8-K with links to EDGAR.
- **Unusual Options Activity** — initial scanner (later enhanced in polish sprint).
- **Custom screener filters** — manual filter rows (metric / operator / value).

---

## 2026-05-28 — Phase 6: Comparison, Backtester, Multi-Watchlist, Sentiment, CSV

- **Chart Compare** — normalised return chart for up to 5 stocks over 1M/3M/6M/1Y.
- **Strategy Backtester** — MA Crossover, RSI Reversal, Bollinger Bands strategies on historical data; total return, alpha, max drawdown, Sharpe, win rate, trade log.
- **Multi-Watchlist** — create named lists; switch between them; default list always present.
- **AI News Sentiment** — first version (later upgraded with Claude scoring).
- **CSV import/export** — import positions from CSV; export watchlist and portfolio.

---

## 2026-05-28 — Phase 5: Earnings, Institutional, Sector Rotation, Alerts

- **Earnings Calendar** — upcoming earnings dates for watchlist symbols with time of day (BMO/AMC).
- **Institutional Ownership** — top institutional holders, ownership %, recent changes.
- **Sector Rotation** — 11 sector ETF performance table and heatmap across 1D/1W/1M/3M.
- **Smart Alerts (initial)** — price, percent-change, 52-week break, volume spike alert types with browser notification integration.

---

## 2026-05-28 — Phase 4: Technical Indicators, Insider, Analyst, Rebalancer

- **Technical Indicators overlay** — RSI(14), MACD, Bollinger Bands sub-panes added to chart modal.
- **Insider Transactions** — Form 4 filing data per symbol (buyer/seller, shares, price).
- **Analyst Ratings** — consensus rating, average price target, recent upgrades/downgrades.
- **Portfolio Rebalancer** — enter target weights; app shows buy/sell amounts to reach target allocation.
- **Short Interest** — short interest %, days-to-cover per symbol.

---

## 2026-05-28 — Phase 3: Options, Trade Journal, Dividends, Correlation, Macro

- **Options chain** — nearest expiry calls and puts with strike, bid/ask, volume, OI, delta, IV; ITM highlighting.
- **Trade Journal** — log trades by symbol/side/price/shares/strategy; realised P&L matching; win rate by strategy.
- **Dividends** — yield, annual income projection, payment frequency per position.
- **Correlation heatmap** — pairwise return correlation matrix across portfolio holdings.
- **Macro Calendar** — upcoming FOMC, CPI, PPI, PCE, NFP, GDP events with urgency badges.

---

## 2026-05-28 — Phase 2: Screener, Earnings History, Pre-Market, Caching

- **Stock Screener** — technical scans (52W high, golden/death cross, RSI oversold/overbought, high rel-vol) and fundamental presets (Quality Growth, Deep Value, Dividend Income, Momentum + Quality).
- **Earnings History Chart** — last 8 quarters of EPS and revenue estimates vs actuals.
- **Pre-Market Movers** — top gainers/losers before open with catalyst identification.
- **Prompt caching** — Anthropic prompt caching enabled for AI endpoints to reduce latency and cost.

---

## 2026-05-27 — Phase 1: Portfolio Intelligence

- Portfolio positions tracker (add/remove/view).
- Portfolio heatmap (treemap by market value, coloured by day change %).
- Exposure analysis: sector, market-cap size, geography donut charts.
- Performance tracking vs SPY/QQQ benchmarks with cumulative return chart.
- Portfolio equity curve with daily snapshot persistence.

---

## 2026-05-18 — Day Trader + AI Tools

- **Day Trader tab** — trading plan calculator (capital, target %, max loss %, stop %, R:R); strategy playbooks (Gap & Go, Momentum, VWAP Reversion, Opening Range, Mean Reversion, Scalping); live intraday scanner; trade alerts sidebar; pre-market movers table; news feed.
- **AI Chat (AI Advisor)** — streaming Claude conversation for open-ended market questions.
- **Financial Advisor** — structured portfolio strategy generator: goal, horizon, capital, monthly contribution, risk tolerance, age, account type, geographic focus → AI-generated plan with asset allocation chart.
- SQLite database introduced for position and journal persistence.

---

## 2026-05-15 — Market Intelligence Layer

- **Market Overview** — index futures performance, sector ETF table, Magnificent 7 table, top-10 gainers/losers, global news sidebar.
- **AI Growth Watch List** — 41 stocks across 9 AI stack layers (Chips, Memory, Networking, Cloud, Models, Applications, Robotics, Quantum, Energy Infrastructure) with thesis and 1Y return.
- **Market Recommendations** — sell-side analyst upgrades/downgrades with firm, prior/new rating, price target; detail modal with full coverage history.
- Sortable column headers across all tables; search/filter bars on Watchlist, Portfolio, and Day Trader.

---

## 2026-05-08 — Initial Launch

- FastAPI + React/Vite/Tailwind full-stack scaffold.
- Live watchlist with real-time price polling and flash animations.
- Interactive candlestick chart modal (1D–5Y timeframes) using Lightweight Charts.
- Per-symbol news feed (top 10 headlines with external links).
- Price alerts: above-price, below-price, percent-change, 52-week break, volume spike. Browser notification integration.
- Multi-period performance data (1D/5D/1M/3M/6M/1Y/YTD) via yfinance.
