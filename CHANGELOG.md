# Stock Monitor — Changelog

A running log of features built and changes made, in reverse-chronological order.

---

## 2026-08-06 — SPACs: Risk Matrix

Completes the SPACs module at parity with Merger Arb's shape: Tracker, Discovery, Deal Analyzer, Portfolio, Alerts, Risk Matrix.

### New
- **Risk Matrix** — scatter plot of annualized yield vs. days-to-deadline across tracked SPACs; bubble size reflects discount/premium magnitude, color reflects deal stage (Searching / Deal Announced / Shareholder Vote / Redemption Period / Closing).
- No synthetic risk score, unlike Merger Arb's Risk Matrix (which scores deal type, regulator, spread, size, time) — SPACs don't have an analogous risk model, so this maps the two things that actually drive the arb: entry attractiveness (discount to trust) and catalyst timing (deadline).
- Deal Stage × Deadline Urgency grid (Urgent <45d / Moderate 45–120d / Distant >120d buckets), plus Nearest Deadlines and Best Annualized Yield quick-list panels.

### Backend
- None — composes the existing `/api/spac/deals` response client-side.

### Files changed
- `frontend/src/components/SpacRiskMatrix.jsx` (new)
- `frontend/src/App.jsx` — new `spacrisk` tab route
- `frontend/src/components/UserGuide.jsx` — new Risk Matrix section + changelog entry

---

## 2026-08-06 — SPACs: Alerts

Rounds out the SPACs module: Tracker, Discovery, Deal Analyzer, Portfolio, Alerts.

### New
- **Alerts** — SPAC-specific alert rules, separate from the general Smart Alerts (Watchlist → Smart Alerts) since these read trust value, deadline, and status directly from tracked SPACs rather than price history.
- Three alert types: **Deadline Approaching** (days-to-redemption threshold, fires on overdue too), **Discount/Premium Threshold** (directional — at-or-below or at-or-above a % vs. live trust value), **Deal Announced** (fires as soon as status moves off "Searching for Target").
- Same on-demand scan pattern as the general Smart Alerts: rules are checked live when you click "Scan," not via background polling, and there's no dedup/already-seen tracking.

### Backend
- `SpacAlertRule` model (`spac_alert_rules` table): spac_id, alert_type, params JSON, active flag (soft-delete, matching the existing `SmartAlertRule` pattern).
- `GET/POST/DELETE /api/spac/alerts` + `POST /api/spac/alerts/scan` — evaluates each active rule against `_enrich_spac` output for its linked SPAC.

### Files changed
- `backend/database.py` — `SpacAlertRule` model + migration
- `backend/main.py` — `/api/spac/alerts` endpoints + `_check_spac_alert`
- `frontend/src/components/SpacAlerts.jsx` (new)
- `frontend/src/App.jsx` — new `spacalerts` tab route
- `frontend/src/components/UserGuide.jsx` — new Alerts section + changelog entry

---

## 2026-08-06 — SPACs: Portfolio

Completes the SPACs module (Tracker, Discovery, Deal Analyzer, Portfolio).

### New
- **Portfolio** — position sizing for common stock and/or warrants against tracked SPACs. Common and warrant legs of the same SPAC are tracked as independent positions with independent live pricing.
- Summary rolls up cost basis, market value, unrealized P&L, and a **Trust-Protected** figure: the redemption value of common positions at trust, recoverable regardless of deal outcome. Warrant positions are excluded from that figure since warrants carry no redemption right and can go to zero.
- Common vs. warrant exposure concentration breakdown.

### Backend
- `SpacPosition` model (`spac_positions` table): spac_id, security_type (common|warrant), shares, entry price/date.
- `GET/POST/PUT/DELETE /api/spac/positions` — CRUD with live enrichment (`_enrich_spac_position`), reusing `_enrich_spac` for pricing so common and warrant legs stay consistent with the Tracker.

### Files changed
- `backend/database.py` — `SpacPosition` model + migration
- `backend/main.py` — `/api/spac/positions` CRUD + enrichment
- `frontend/src/components/SpacPortfolio.jsx` (new)
- `frontend/src/App.jsx` — new `spacportfolio` tab route
- `frontend/src/components/UserGuide.jsx` — new Portfolio section + changelog entry

---

## 2026-08-06 — New SPACs module: Tracker, Discovery, Deal Analyzer

New top-level **SPACs** sidebar group — a separate strategy from Merger Arb. A SPAC's common stock has a floor at trust value (shareholders can redeem for trust value + accrued interest at a vote or by the deadline, independent of deal terms), so the trade is discount-to-trust capture with optional leveraged upside via warrants, not deal-completion risk against a fixed offer price.

### New
- **Tracker** — CRUD list of SPACs with live discount/premium-to-trust, annualized capture-yield-to-deadline, days to redemption deadline, and warrant price. Sorted by annualized yield (best opportunities first).
- **Discovery** — EDGAR scan for new SPAC IPOs (S-1 + "blank check") and de-SPAC merger announcements (425/DEFM14A/S-4 + "trust account"), 60-day window. Auto-parses common and warrant tickers from EDGAR's combined ticker listing in filer display names (e.g. `CDAQF, CDAUF, CDAWF` → common `CDAQF`, warrant `CDAWF`). Quick-add to Tracker.
- **Deal Analyzer** — capture-yield floor case (return if bought now and redeemed at trust by the deadline), warrant intrinsic/time value/breakeven, and a redeem-vs-hold scenario table (weak aftermarket through +200%-to-trust) showing both common and warrant returns — the asymmetric bounded-downside/leveraged-upside payoff that defines SPAC arb.

### Backend
- `SpacDeal` model (`spac_deals` table): ticker, warrant ticker/strike/ratio, trust value + as-of date, deadline, status, target/PIPE info.
- `GET/POST/PUT/DELETE /api/spac/deals` — CRUD with live enrichment (`_enrich_spac`).
- `GET /api/spac/discovery` — multi-form/keyword EDGAR scan, 4h cache, tracked cross-reference.
- `GET /api/spac/analyze` — deal_id or ad-hoc params in; discount/capture-yield/annualized-yield, warrant economics, and scenario table out.

### Bug fix
- All three EDGAR full-text-search scanners (new SPAC Discovery, the Merger Opportunity Scanner, and the original Deal Dashboard EDGAR panel) were omitting the `enddt` query parameter. Without it, EDGAR's API silently ignores `startdt` entirely and returns all-time, relevance-sorted results instead of the claimed recent window — e.g. Deal Dashboard's "last 90 days" panel could surface filings from 2019. Fixed by passing an explicit `enddt=today` alongside `startdt` in all three.

### Files changed
- `backend/database.py` — `SpacDeal` model + migration
- `backend/main.py` — SPAC endpoints; `enddt` fix in `scan_edgar_deals`, `merger_opportunities`, `spac_discovery`
- `frontend/src/components/SpacTracker.jsx` (new)
- `frontend/src/components/SpacDiscovery.jsx` (new)
- `frontend/src/components/SpacDealAnalyzer.jsx` (new)
- `frontend/src/App.jsx` — new SPACs nav group + 3 tab routes
- `frontend/src/components/UserGuide.jsx` — new SPACs section + changelog entry

---

## 2026-08-06 — Merger Arb: Overview (launching pad)

### New
- **Overview** — new first item in the Merger Arb sidebar group, acting as a hub across the other 5 components.
- **Active Deals In Progress** — every tracked deal, sorted by soonest expected close. Click a row to jump into the Deal Analyzer with that deal preloaded; click "Dashboard" to jump to the Deal Dashboard, scrolled to and briefly highlighting that row.
- **Upcoming — Newly Filed, Not Yet Tracked** — the most recent untracked filings from the Opportunity Scanner feed, with quick-add (reuses the shared `DealFormModal`) and a link through to the full Scanner.
- Cross-tab drill-in: `App.jsx` now lifts a `mergerFocusDealId` + `goToMerger(tabId, dealId)` helper so Overview can hand off a specific deal to the Analyzer or Dashboard tabs.

### Backend
- None — composes the existing `/api/merger/deals` and `/api/merger/opportunities` responses client-side.

### Files changed
- `frontend/src/components/MergerArbOverview.jsx` (new)
- `frontend/src/App.jsx` — `mergeroverview` nav item + tab route, lifted focus-deal state
- `frontend/src/components/MergerDealAnalyzer.jsx` — accepts `focusDealId`/`onFocusConsumed` to auto-select a deal
- `frontend/src/components/MergerDealDashboard.jsx` — accepts `focusDealId`/`onFocusConsumed`; scrolls to and highlights the row
- `frontend/src/components/UserGuide.jsx` — new Overview section + changelog entry

---

## 2026-08-06 — Merger Arb: Opportunity Scanner, Deal Analyzer, Arb Portfolio, Risk Matrix

Completes the 5-component Merger Arb sidebar group (Deal Dashboard shipped earlier today).

### New
- **Opportunity Scanner** — expands EDGAR discovery beyond Deal Dashboard's tender-offer-only feed to 6 merger-indicative form types (SC TO-T, SC 13E-3, DEFM14A, PREM14A, S-4, 425) over a 60-day window. Extracts ticker from EDGAR's `display_names` field, enriches each filing with live price + 5D/1M % change, cross-references against tracked deals ("Tracked" badge), and supports filter-by-form/search/hide-tracked plus one-click Add.
- **Deal Analyzer** — risk/reward calculator for a single deal (tracked or ad-hoc). Estimates a walk-away price from pre-announcement trading (or a 15% discount heuristic), computes upside/downside %, market-implied probability of close (`(current − walkaway) / (offer − walkaway)`), a full risk-factor point breakdown, and an expected-value table across close-probability scenarios (50–95%).
- **Arb Portfolio** — position sizing tracker. Add shares/entry price/date against any tracked deal; live cost basis, market value, unrealized P&L ($ and %), value-at-close, and portfolio-level concentration by deal type and by regulatory body.
- **Risk Matrix** — bubble scatter of tracked deals (days-to-close × annualized return, bubble size = deal value, color = risk level) plus a regulator × deal-type exposure grid shaded by average risk score.

### Backend
- `GET /api/merger/opportunities` — multi-form EDGAR scan with ticker extraction, live quote enrichment, and tracked-deal cross-reference. 4h cache.
- `GET /api/merger/analyze` — deal_id or ad-hoc query params in, full risk/reward analysis out.
- `GET/POST/PUT/DELETE /api/merger/positions` — new `ArbPosition` model (`arb_positions` table) with live enrichment joining against `merger_deals`.
- `_deal_risk` refactored into `_deal_risk_breakdown`, exposing per-factor scores (deal structure, spread size, regulatory scrutiny, deal size, time horizon) reused by both Deal Dashboard and Deal Analyzer.
- **Bug fix:** `db_session()` committed before closing, and SQLAlchemy's default `expire_on_commit=True` invalidated every attribute on committed ORM objects — any code reading them after the session closed (`_enrich_deal`, now also `_enrich_position`) hit a silently-swallowed `DetachedInstanceError`, so `/api/merger/deals` returned an empty list whenever deals existed. Fixed by setting `expire_on_commit=False` on the sessionmaker.

### Files changed
- `backend/database.py` — `ArbPosition` model + migration; `expire_on_commit=False` fix
- `backend/main.py` — new endpoints above; `_deal_risk_breakdown` helper
- `frontend/src/components/MergerDealDashboard.jsx` — exported shared `DealFormModal`, constants, and formatters for reuse
- `frontend/src/components/MergerOpportunityScanner.jsx` (new)
- `frontend/src/components/MergerDealAnalyzer.jsx` (new)
- `frontend/src/components/MergerArbPortfolio.jsx` (new)
- `frontend/src/components/MergerRiskMatrix.jsx` (new)
- `frontend/src/App.jsx` — routed `mergerscanner`, `mergeranalyzer`, `mergerportfolio`, `mergerrisk` tabs
- `frontend/src/components/UserGuide.jsx` — 4 new sections + changelog entry

---

## 2026-07-25 — Retirement Planning Module

New **Retirement** nav group with 4 tools:

- **FIRE Calculator** — FIRE number (expenses ÷ SWR), progress bar, years-to-FIRE, projection chart, retirement-age comparison table. Presets for age 55/60/65.
- **Monte Carlo Simulator** — 1,000 simulations with Box-Muller normal random returns. Fan chart (10th/25th/50th/75th/90th percentile paths), survival rate %, scenario table.
- **Coast FIRE & Roth Conversion Ladder** — Coast FIRE number by retirement age. Roth ladder: suggested annual conversion, marginal tax bracket impact, 10-year conversion schedule with 5-year access dates.
- **Social Security Optimizer** — Benefit at each claiming age 62–70. Breakeven analysis (62 vs FRA vs 70). Cumulative lifetime chart. Combined SS + portfolio income column.

---

## 2026-07-25 — Navigation Restructure (8 groups → 6)

### Changes
- **Markets** (was "Market") expanded to 8 items: absorbed Sector Rotation + Sector Momentum from the eliminated Sectors group. Now the single hub for all market-wide views.
- **Sectors group eliminated** — its two views merged into Markets.
- **Smart Alerts moved** from Trading → Watchlist. It monitors watchlist symbols under conditions, which is Watchlist's job. Watchlist now has 5 items.
- **Trading trimmed** to 3 execution-focused items: Day Trader, Trade Ideas, Position Sizer.
- **"Recommendations" → "Analyst Picks"** — clearer label for analyst actions + AI Growth Watch List.
- **"Sentiment" → "News Sentiment"** — clearer label.
- **Help group eliminated** — User Guide replaced with a `?` button pinned to the bottom of the sidebar; always visible without occupying a collapsible group.

### Files changed
- `frontend/src/App.jsx` — NAV_GROUPS restructured, Sidebar component updated with pinned guide button
- `frontend/src/components/UserGuide.jsx` — nav table updated, Sectors section merged into Markets, Smart Alerts moved to Watchlist section, Trading section updated, workflows updated, Changelog entry added

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
