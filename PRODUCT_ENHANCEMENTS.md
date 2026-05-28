# StockMonitor — Product Enhancement Roadmap

> Audience: retail investor who day-trades, invests long-term, monitors markets, and tracks portfolio risk/P&L.  
> Last reviewed: 2026-05-27

---

## What exists today

| Tab | Core capability |
|-----|----------------|
| Market Summary | Index/ETF/Mag7/sector performance tables, top gainers/losers, headlines |
| Market Recommendations | AI Growth Watch List (full-stack tech coverage), analyst upgrades & downgrades |
| Day Trader | Trading plan calculator, 6 strategy playbooks, live scanner (gainers/losers/most active), trade alerts, news feed |
| Portfolio | Heatmap + table view, unrealised P&L, day P&L, position weight |
| Watchlist | Real-time quotes, candlestick charts (1D–5Y), fundamentals, per-symbol news |
| AI Advisor | Streaming Claude chat — open-ended market/strategy questions |
| Financial Advisor | Structured portfolio strategy generator with allocation pie chart and full written plan |

The foundation is solid. The gaps below are organised by theme and rated **P1** (high impact, build next) → **P3** (nice-to-have).

---

## 1. Portfolio Intelligence — Risk, Attribution & Exposure

*The single biggest gap. Right now the portfolio only shows position-level P&L. A serious retail investor needs to understand risk at the portfolio level.*

### 1a. Risk Metrics Panel — P1
Add a **Risk** view mode alongside Heatmap and Table that shows:

| Metric | What it tells you |
|--------|--------------------|
| Portfolio Beta | Sensitivity to broad market moves (target: near 1.0 for neutral) |
| Weighted average P/E | Is the portfolio cheap or expensive vs market? |
| Sharpe Ratio (est.) | Return per unit of risk vs risk-free rate |
| Max Drawdown | Worst peak-to-trough decline across the holding period |
| Value at Risk (95%) | Estimated 1-day loss at 95% confidence (parametric, using beta × SPY vol) |
| Concentration | Top-3 positions as % of portfolio; Herfindahl index |

*Implementation*: most of these can be derived from existing yfinance data (beta per position) + a lightweight SPY historical vol fetch.

### 1b. Sector & Style Exposure Breakdown — P1
Add a **Exposure** section to the Portfolio tab:
- **Sector donut chart** — e.g. 40% Technology, 20% Healthcare, etc. (using `sector` field from yfinance `info`)
- **Market-cap style bar** — Large / Mid / Small based on market cap thresholds
- **Geographic exposure** — US vs International (where data is available)
- **Factor tilts** — Growth vs Value based on P/E and P/B relative to market median

This answers "am I accidentally over-concentrated in tech?" — a critical question for any long-term investor.

### 1c. Benchmark Comparison — P1
- Plot portfolio cumulative return vs SPY (and optionally QQQ) since inception of the oldest position
- Show alpha (excess return) and tracking error vs the chosen benchmark
- Display as a simple line chart inside a new "Performance" tab within Portfolio

### 1d. Drawdown Tracker — P2
- Track portfolio value over time (persist daily snapshots to SQLite)
- Chart drawdown from all-time high
- Mark entry dates of positions on the chart

### 1e. Dividend Income Tracker — P2
- Pull `dividendYield` and `nextDividendDate` per position
- Project annual dividend income based on current shares
- Show monthly income calendar

### 1f. Correlation Matrix — P2
- Pairwise 90-day rolling correlation between all portfolio positions
- Colour-coded heatmap: red = highly correlated (concentration risk), green = diversifying
- Flag pairs with correlation > 0.85 as a concentration warning

### 1g. Realized P&L & Trade History — P2
- Currently only unrealised P&L is tracked; no record of closed trades
- Add a "Trades" table where you log buy/sell lots with date and price
- Compute realised P&L, average cost per lot (FIFO/LIFO), and annualised return (XIRR)

---

## 2. Market Intelligence — Macro & Breadth

*A retail investor needs macro context to time entries and understand regime.*

### 2a. Economic Calendar — P1
- Show upcoming high-impact macro events: Fed meetings (FOMC), CPI, PCE, NFP (jobs), GDP, earnings season start
- Mark each event with expected vs prior reading and market consensus
- Source: FRED API (free) or a static curated list updated weekly via Claude
- Display as a sidebar on the Market Summary tab or a dedicated widget

### 2b. VIX & Fear Gauge — P1
- Add a persistent VIX display in the header or Market Summary
- Colour-coded: green < 15, amber 15–25, red > 25
- Contextualize: "VIX at 22 — elevated uncertainty, options are expensive"
- Include VIX 1-month chart via existing chart infrastructure

### 2c. Market Breadth — P2
- Advance/Decline ratio for S&P 500 (% stocks above 50-day MA, % above 200-day MA)
- % of S&P 500 at 52-week highs vs lows
- New highs vs new lows — useful for confirming or diverging from index moves
- Source: yfinance screener data (already wired up)

### 2d. Yield Curve & Rates — P2
- Display 2-year vs 10-year Treasury yields and the spread (inversion signal)
- Show Fed Funds Rate target and probability of next move (from CME FedWatch, scraped or manually updated)
- DXY (dollar index) — matters for international and commodity exposure

### 2e. Sector Rotation Model — P3
- Visualise where each sector sits in the economic cycle (early/mid/late expansion, contraction)
- Overlay current 1-month and 3-month relative performance of sector ETFs
- Suggest which sectors historically outperform in the current phase

---

## 3. Stock Screener & Opportunity Discovery

*Neither the day trader nor the long-term investor has a structured way to find new ideas beyond the AI watch list.*

### 3a. Fundamental Screener — P1
A filterable table across a broad universe (e.g. S&P 500 or Russell 1000) with columns:
- P/E < X, Forward P/E < X
- Revenue growth YoY > X%
- EPS growth YoY > X%
- Profit margin > X%
- Debt/Equity < X
- Dividend yield range
- Market cap range (Large / Mid / Small)

Preset screens to ship day 1:
- "Quality Growth" — high margins, low debt, consistent earnings
- "Deep Value" — low P/E, low P/B, positive free cash flow
- "Dividend Aristocrats" — yield > 2%, 5-yr dividend growth
- "Momentum + Quality" — strong 6-month price momentum + high ROE

### 3b. Technical / Momentum Screener — P1
Scan for stocks hitting:
- 52-week highs (breakout candidates)
- Golden cross (50-day MA crossing above 200-day MA)
- RSI oversold (< 30) or overbought (> 70)
- High relative volume (today's volume > 2× 20-day average)
- Price consolidation (tight range for 10+ days then expanding volume)

Source: yfinance batch downloads for the universe; compute indicators client-side or in FastAPI.

### 3c. Earnings Calendar & Screener — P1
- Show upcoming earnings dates for watchlist + portfolio positions (next 2 weeks)
- Flag "earnings in 3 days" warning on the Watchlist tab
- Historical EPS beats/misses for a symbol (in the chart modal Fundamentals tab)
- Screener filter: "reports this week" as a filter toggle
- Source: yfinance `.calendar` endpoint

### 3d. Unusual Options Activity — P3
- Show large options flow (high open interest changes, unusual put/call ratios)
- Source: requires a dedicated options data provider (e.g. Unusual Whales free tier, Tradier API)

---

## 4. Technical Analysis — Chart Enhancements

*The charts are candlestick + volume today. Serious traders and investors need indicators.*

### 4a. Indicator Overlays — P1
Add a toggle panel in ChartModal to enable/disable:
- **SMA 20 / 50 / 200** — key moving averages (most requested by retail traders)
- **EMA 8 / 21** — short-term momentum
- **Bollinger Bands** (20-period, 2 SD) — volatility squeeze identification
- **VWAP** — intraday only (1D period)

All computable client-side from the OHLC data already fetched. Use `lightweight-charts`'s `LineSeries`.

### 4b. RSI & MACD Sub-pane — P2
- Add an optional RSI (14-period) sub-chart below the main price chart
- Add MACD histogram as a second optional sub-pane
- Show overbought/oversold zones on RSI (dashed lines at 30/70)

### 4c. Volume Profile & Average Volume — P2
- Show 20-day average volume as a horizontal line on the volume histogram
- Highlight bars where volume > 2× average in a brighter colour
- This is the most common "confirmation" signal retail traders look for

### 4d. Drawing Tools — P3
- Horizontal support/resistance lines (click-and-drag on chart)
- Trend lines
- Fibonacci retracement levels
- Persist drawings to localStorage per symbol

---

## 5. Alerts & Notifications

*Currently the Day Trader tab shows ephemeral client-side alerts from the scanner. There's no persistent, user-defined alert system.*

### 5a. Price Alert System — P1
- User sets a target price (above or below current) for any symbol
- App polls prices on the existing 30-second cycle and fires an in-app notification when hit
- Persist alerts to SQLite so they survive page reloads
- UI: a bell icon in the Watchlist row, a modal to manage all active alerts
- Alert states: Active → Triggered → Dismissed

### 5b. Volume Surge Alerts — P2
- Alert when a watchlist symbol's volume exceeds X × its 20-day average
- Configurable multiplier per symbol

### 5c. Earnings Proximity Alerts — P2
- Warn when a portfolio or watchlist stock reports earnings within 3 days
- Highlight in yellow on the Watchlist tab; show as a banner alert

### 5d. Browser Push Notifications — P2
- Upgrade in-app alerts to browser push notifications using the Notifications API
- Useful when the user is on another tab or window

### 5e. Technical Trigger Alerts — P3
- Alert on 52-week high break
- Alert on golden/death cross (50/200-day MA crossover)
- Alert on RSI crossing into overbought/oversold territory

---

## 6. Fundamentals & Research Depth

*The chart modal's Fundamentals tab shows key ratios. Research depth can go further.*

### 6a. Earnings History Chart — P1
- In the chart modal, add an "Earnings" sub-tab showing:
  - Last 8 quarters: EPS estimate vs actual (beat/miss bar chart)
  - Revenue estimate vs actual
  - YoY growth trend
- Source: yfinance `.quarterly_earnings` and `.quarterly_financials`

### 6b. Peer Comparison — P2
- Given a symbol, fetch 3–5 sector peers automatically
- Side-by-side table: P/E, EV/EBITDA, revenue growth, profit margin, ROE
- Show where the stock sits relative to peers on a bar chart ("cheap vs peers")

### 6c. Insider & Institutional Activity — P2
- Recent insider buys/sells (last 90 days) for portfolio and watchlist stocks
- Institutional ownership % and recent changes (13F data)
- Source: yfinance `.insider_transactions`, `.institutional_holders`

### 6d. DCF Valuation Calculator — P2
Add a simple DCF tool in the AI Advisor tab or as a chart modal tab:
- Inputs: current EPS, growth rate (5yr), terminal growth rate, discount rate
- Output: intrinsic value estimate, margin of safety vs current price
- Pre-fill with yfinance data where available

### 6e. Short Interest & Borrow Rate — P3
- Short interest as % of float (squeeze potential indicator)
- Requires a dedicated data source (e.g. FINRA short interest reports, updated twice monthly)

---

## 7. Day Trader Enhancements

*The Day Trader tab is well-structured. These additions would make it more actionable.*

### 7a. Pre-Market & After-Hours Movers — P1
- Add a "Pre-Market" section showing stocks with significant pre-market price moves (> ±3%)
- Show catalyst (earnings, news) where available
- Source: yfinance `preMarketPrice` from fast_info

### 7b. Intraday Chart in Candidates Table — P2
- Embed a tiny sparkline (1D) in the candidates table for quick visual context
- Show direction of move without opening the full chart modal

### 7c. Trade Journal — P2
- Let the user log executed trades (symbol, direction, entry price, shares, time, strategy used)
- Track win rate, average R (realized R-multiple), largest win/loss
- Daily and weekly P&L summary
- This closes the loop on the trading plan calculator — you set a plan, then log results

### 7d. Options Chain Viewer — P3
- For a given symbol and expiry, show calls and puts with strike, bid/ask, OI, delta, IV
- Highlight in-the-money strikes
- Source: yfinance `.option_chain`

### 7e. Level 2 / Order Flow — P3
- Would require a brokerage API integration (TD Ameritrade, Alpaca, Interactive Brokers)
- Out of scope for yfinance-based stack, but worth noting as a future integration

---

## 8. UX, Navigation & Polish

### 8a. Customisable Dashboard / Home Screen — P2
- Let the user pin widgets to a "Home" tab: VIX, portfolio summary, top watchlist movers, upcoming earnings, latest alerts
- Drag-and-drop widget layout saved to localStorage

### 8b. Tab Reorganisation — P2
Current 7 tabs could be grouped more intuitively:

| Group | Tabs |
|-------|------|
| **Market** | Market Overview · Recommendations · Screener |
| **Trade** | Day Trader · Watchlist |
| **Portfolio** | Portfolio · Risk & Exposure |
| **Research** | AI Advisor · Financial Advisor |

Consider a sidebar navigation instead of a flat tab bar to accommodate growth.

### 8c. Dark / Light Mode Toggle — P3
- All styling is dark today; add a light mode for readability in bright environments

### 8d. Keyboard Shortcuts — P2
- `1–7` to switch tabs
- `/` to focus search bar
- `Escape` to close any modal (already implemented for chart)
- `R` to refresh current tab

### 8e. Mobile / Responsive Layout — P2
- Current layout is desktop-only (horizontal tables, wide panels)
- Add responsive breakpoints: stack columns, collapse tables to card views on small screens
- Priority views for mobile: Portfolio summary, Watchlist, Alerts

### 8f. Export & Sharing — P3
- Export portfolio positions and P&L to CSV
- Export financial plan / AI advisor output to PDF
- Share a watchlist via URL (encoded in query string)

---

## 9. Data & Infrastructure

### 9a. WebSocket / Real-Time Prices — P2
- Current polling is 30-second intervals via REST
- Upgrade to WebSocket streaming for watchlist prices during market hours
- Significant UX improvement for day trading use case
- yfinance doesn't support WebSockets; would need Yahoo Finance WebSocket or Alpaca data stream

### 9b. Prompt Caching for AI Features — P1 (quick win)
- The AI Advisor and Financial Advisor endpoints create a fresh Anthropic client on every call
- Add Anthropic prompt caching (`cache_control: {"type": "ephemeral"}`) on the long system prompts
- Reduces latency and cost for repeated interactions by ~80% on cache hits
- See: Anthropic SDK prompt caching docs

### 9c. Extended Hours Data — P2
- Show pre-market (4–9:30 AM ET) and after-hours (4–8 PM ET) prices in the Watchlist and Portfolio
- yfinance supports `preMarketPrice` and `postMarketPrice` in fast_info

### 9d. Historical Portfolio Snapshots — P2
- Nightly job: persist total portfolio value to SQLite
- Powers the benchmark comparison chart and drawdown tracker

### 9e. Rate Limit & Error Handling — P2
- yfinance can return stale or empty data under load; add retry logic and staleness indicators
- Show a "data stale" badge if last successful fetch > 5 minutes ago
- Handle market-closed state gracefully (prices won't move — indicate this clearly)

---

## Summary: Suggested Build Order

### Phase 1 — Portfolio Intelligence (highest user value)
1. Sector & style exposure breakdown (donut chart)
2. Portfolio risk metrics panel (beta, VaR, concentration)
3. Benchmark comparison vs SPY/QQQ
4. Price alert system (persistent, SQLite-backed)
5. Earnings calendar widget

### Phase 2 — Discovery & Research
6. Momentum/technical screener (52W highs, golden cross, high relative volume)
7. Fundamental screener with preset screens
8. Earnings history chart in the chart modal
9. Pre-market movers on Day Trader tab
10. Prompt caching for AI endpoints (quick win)

### Phase 3 — Technical Analysis & Day Trading
11. Moving average overlays on charts (SMA 20/50/200, VWAP)
12. RSI sub-pane
13. Trade journal for day traders
14. Intraday sparklines in candidates table

### Phase 4 — UX & Platform
15. Tab reorganisation / sidebar nav
16. Mobile responsive layout
17. Customisable home dashboard
18. WebSocket real-time prices
19. Export to CSV/PDF
