# Stock Monitor — Changelog

A running log of features built and changes made, in reverse-chronological order.

---

## 2026-09-22 — Fix: test_main.py database isolation

Fixed the issue flagged in the Range Screener entry below: `test_main.py`'s 52 tests ran against the real `backend/stockmonitor.db` (unlike `test_digest.py` / `test_range_screener.py`, which already use a throwaway DB), so its mocked fixtures were writing directly into the database the running app also reads from — e.g. a mocked quote's name ("Test Corp") could sit in the real quote cache for its TTL, and a CRUD test that crashed before its cleanup call could leave test rows (`TESTSYM99`, `PTTEST`, `ALTEST`, …) in the user's real watchlist, portfolio, or alerts.

Added `tests/conftest.py` with an autouse `isolated_db` fixture (the same throwaway-SQLite-plus-monkeypatched-`SessionLocal` pattern `test_digest.py` already used) that now applies to every test file automatically, since every router reaches the database only through `db_session()`/`cache_get()`/`cache_set()` in `database.py`, which resolve `SessionLocal` by name at call time — no per-router changes needed. `test_digest.py` keeps its own same-named `isolated_db` fixture (it also clears delivery-channel env vars); pytest resolves a test module's own fixture in place of the conftest one, so the two never both run for that file.

### Fixed
- `backend/tests/conftest.py` — new, autouse `isolated_db` fixture applied to `test_main.py` and `test_range_screener.py` (the latter didn't strictly need it — it already patches `cache_get`/`cache_set` directly — but is now covered for any future test that touches the DB directly).

### Verified
- Snapshotted real-DB row counts (`watchlist`, `portfolio_positions`, `price_alerts`, `cache_entries`) before and after a full `pytest` run — identical, confirming nothing was written. Full suite: 133/133 passing, ruff clean.
- The stale `quote:AAPL` → `"Test Corp"` row left in the real cache by *previous* (pre-fix) test runs is still there — it wasn't touched by this fix and will only clear on its own TTL or an explicit cleanup, not addressed here.

---

## 2026-09-22 — Range Screener

New **Research -> Range Screener**: scans a ~290-name universe (the app's existing SCREENER_UNIVERSE, Short Squeeze, and Insider Trading Feed lists, deduped — mega-caps trend too often to range much, so the smaller/mid caps the latter two already cover matter here) for stocks trading sideways within a support/resistance band over the last 30, 60, or 90 days, and flags names currently near either edge as a possible range-trade entry or exit.

"Range-bound" is quantified two ways over the same window: a Kaufman efficiency ratio (net price change / the sum of every day's move — near 0 for a choppy, going-nowhere stock, near 1 for a steady trend), and a touch count (how many days price actually came back within 15% of the window's high and low) so a single outlier spike or dip can't pass as a "range" on its own. Both feed each row alongside where the price currently sits in the band (0-100%), with a mechanical entry/target/stop for the "near support" / "near resistance" rows.

### New
- `backend/routers/range_screener.py`: `GET /api/screener/range-bound` (window, min/max width %, min touches, min score, signal, optional custom `symbols` list); results for the default universe cached 30 min
- `backend/tests/test_range_screener.py` (16 tests: window-metrics math, batch computation, the API)
- `frontend/src/components/RangeScreener.jsx` + `RangeScreener.test.jsx` (8 tests); new Research -> Range Screener nav item
- User Guide section and changelog entry; README feature table, endpoint, and file-structure entries

### Verified
- 133 backend tests (117 existing + 16 new) and 109 frontend tests (101 + 8); ruff and `vite build` clean.
- Live against real Yahoo data across the full ~293-symbol universe: cold scan ~9s, warm (cached) scan ~10ms. Sanity-checked the near-support/near-resistance picks (e.g. BSX 60-day: price $43.72 against a $42.50-$52.99 range, 11/8 touches, 4.62x risk:reward to the stop) and a custom-symbols override (GME, AAPL, TSLA) against expected shapes.
- Noted for anyone tuning filters: over real daily closes, the efficiency-ratio score saturates high for most names within any 60-day window (normal noise, not just genuine ranges) — width % and touch count end up doing most of the real filtering; score is more useful for ranking than as a hard cutoff. Documented in the UI as a tip.

### Aside (not part of this feature, flagged while testing it live)
- `backend/tests/test_main.py` runs against the real `stockmonitor.db` (no test-DB isolation, unlike `test_digest.py` / `test_range_screener.py`), and its mocked fixtures write fake data — e.g. a `quote:AAPL` cache row with `name: "Test Corp"` — into that live cache table. Surfaced when a manual curl against the real running app showed "Test Corp" as AAPL's name. Not touched here since it's pre-existing test infrastructure, out of scope for this feature, and a deliberate fix (isolating `test_main.py` the way the two newer suites already are) is its own separate change — but worth knowing the real dev DB can pick up stale test fixtures for a few hours after any `pytest` run.

---

## 2026-09-19 — Daily & Weekly Digests (scheduled, delivered to Telegram)

New **AI Tools → Digests** feature: a pre-market daily digest and a Sunday-evening weekly recap, sent to Telegram on a schedule. Motivated by a gap found while scoping it: the app had no backend scheduler and price alerts were only ever evaluated by the browser (`PATCH /api/alerts/{id}/trigger` is called from the frontend), so nothing fired unless a tab was open.

Each digest covers: index/VIX/10Y/sector moves; the user's portfolio value, unrealized and period P&L, return vs. SPY, and top movers (daily) or best/worst holdings (weekly); watchlist gainers/losers; economic releases and earnings for holdings + watchlist (next 2 days / next 7); price alerts already through their target, near it, or recently triggered; and, weekly only, price targets that are close or have a near deadline. An optional AI-written summary (Claude Haiku) tops it and is skipped silently if the key is missing or rejected.

Design notes:
- **At most once per period.** Scheduled runs claim a `digest_log` row keyed `(kind, date | ISO week)` before doing any work; the unique constraint makes a duplicate tick lose the race. Manual sends get unique keys and are never deduped.
- **Catch-up for a laptop that sleeps.** A digest missed while the app was off is sent on startup if within 6h (daily) or the same day (weekly) of its scheduled time — never a stale morning digest in the afternoon. Failed deliveries retry every 10 min, up to 3 attempts; a `pending` row from a crashed process is reclaimed after 30 min.
- **Quiet until configured.** With no delivery channel, nothing is claimed or logged, so the digest stays due until one is set up. Schedules default to off.
- **Section isolation.** Each section is built independently; a failing data source drops that section (named in a footnote) instead of the digest. Positions Yahoo can't price are named and carried at cost rather than dropped.
- **Secrets stay out of the DB, logs, and UI.** The Telegram token/chat id come from `backend/.env`; the token is part of Telegram's request URL, and `requests` exception text includes the URL, so every error path redacts it (covered by a test).
- **Labels say "Last session" / "Past 5 sessions"**, not "Today", since a pre-market digest reports the previous close.

### New
- Backend: `digest_builder.py`, `digest_render.py`, `digest_channels.py`, `digest_service.py`, `routers/digest.py` (`/api/digest/{settings,status,preview,send,test,history}`); `DigestSettings` and `DigestLog` tables
- Frontend: `DigestCenter.jsx` (Delivery setup with Telegram steps, Schedule, Preview & send, History) and an AI Tools → Digests nav item
- `backend/tests/test_digest.py` (65 tests, run against a throwaway SQLite DB rather than the real one) and `DigestCenter.test.jsx` (11)
- User Guide section and changelog entry; README endpoints, structure, and notes

### Changed
- `main.py`: registers the digest router and adds a FastAPI `lifespan` that starts/stops the scheduler thread (`DIGEST_SCHEDULER=0` disables it). `TestClient` without a `with` block never enters the lifespan, so tests don't start it.
- `requirements.txt`: `requests` declared explicitly (was only a transitive dependency of yfinance).

### Verified
- 117 backend tests (52 existing + 65 new) and 101 frontend tests (90 + 11); ruff and `vite build` clean.
- Live against real Yahoo data and the real portfolio (187 holdings): both digests build in ~4s warm (~37s cold, dominated by first-time earnings-date lookups, which are then cached).
- End-to-end scheduler run on a *copy* of the real database with a fake channel: a due tick sent once, the next tick did nothing, Sunday triggered the weekly digest, history was logged, and the real database was untouched.

### Not verified
- **Real Telegram delivery.** No bot credentials were available, so `TelegramChannel` is covered by mocked-`requests` tests only (request shape, error handling, message splitting, token redaction) — not by an actual send. Use "Send test message" after adding the credentials.
- **The AI summary against the live API** — the configured Anthropic key is rejected (401); the failure path is tested, the success path only with a mock.
- The Digests page was not exercised in a browser (component tests only).

---

## 2026-09-19 — Investor Education: new "Valuation & Analysis" layer (5 core topics)

Added a fifth, innermost onion layer covering how to analyze a single company, complementing the existing layers' focus on how the financial system is organized. It's a drill-down chain: **Reading the Three Financial Statements → Profitability, Quality & Moats → Valuation Ratios & Multiples → Intrinsic Value & Discounted Cash Flow → Earnings, Expectations & Guidance**.

Each topic has a live data snapshot using AAPL as a fixed worked example (so the numbers stay comparable across topics): margin waterfall and ROE-vs-ROA and P/E/EV-EBITDA/P/S from `/api/compare/fundamentals`, DCF starting inputs from `/api/dcf/prefill`, and beat history from `/api/market/earnings-surprise`. Each deep-links to the matching tab (Fundamentals, DCF Valuation, Earnings Surprise). Existing *Equities* and *The Risk-Free Rate* topics now link into the new layer.

The onion map was hardcoded for four layers; ring radii are now derived from `LAYERS` so a sixth layer needs no geometry changes, and the layer cards wrap 3-up to fit five.

### New
- 5 topics in `data/investorEducationTopics.js`: `financial-statements`, `profitability-quality`, `valuation-multiples`, `dcf-intrinsic-value`, `earnings-expectations`
- `analysis` layer (rose) in `LAYERS` and `LAYER_COLORS`

### Changed
- `InvestorEducation.jsx` — onion map: computed radii, center label, layer count, card grid
- README: live-snapshot topic count corrected (was 6, is now 12)

### Verified
- Topic-graph integrity script and all 5 `parse` functions run against the live backend (also confirmed null-safe on empty payloads); `vite build` clean; 90/90 frontend tests. Not verified visually in a browser.

### Fixed
- Three orphaned topics: `central-banks`, `spacs-concept`, and `mergers-acquisitions` named a `parentId` but were missing from that parent's `childIds`, so they never appeared in the sidebar outline or "Go Deeper" and were reachable only via Related Concepts. Each is now listed under its parent (Global Economy, Going Public, and Public vs. Private Markets respectively), and the redundant Related Concepts entries that pointed at them from those parents were dropped.

---

## 2026-09-18 — Backend Modularization: the final batch — 15 sections, effort complete

Extracted every remaining "safe" section in one pass: Index Constituent Heatmap, Tax Advisor, Short Squeeze Scanner, IPO & Lockup Calendar, Fed Watch, AI Morning Briefing, Crypto Dashboard, AI Portfolio Review, Economic Dashboard, AI Stock Analyzer, Dividend Tracker, Watchlist Heatmap, Earnings Surprise Tracker, Earnings Strategy Analyzer, and a second, differently-routed Correlation Matrix (`GET /api/market/correlation`, now `routers/market_correlation.py` — distinct from `routers/correlation_matrix.py`'s `POST /api/portfolio/correlation`, confirmed no cache-key collision despite both starting with `corr:`).

**`main.py` is now 532 lines, down from 12,269 at the start of this effort (96% reduction).** What's left is exactly what was scoped out from the beginning as the permanent core: `_fetch_quote`, `_fetch_fundamentals`, `_fetch_perf_one`, `_fetch_screener_quotes`, `_fetch_feed` and their TTLs (TTLs, Fundamentals, Market performance, Market summary sections) — used by nearly every router in the app via the function-scoped deferred-import pattern — plus the trivial Health check and the Serve React Build (SPA catchall) sections. This is the natural floor for this architecture; extracting the core itself would just move the "everything imports from here" problem to a different file without reducing complexity.

Found a fourth instance of the stale DataFrame-shaped `.calendar` bug, this time in AI Stock Analyzer's `_build_snapshot` (used by both the stock snapshot and AI analysis endpoints) — fixed with the same dict-based access pattern used in the three earlier fixes. Also confirmed, by reading it closely, that Earnings Strategy Analyzer's own `.calendar` handling was already correct (it has a defensive `isinstance(cal, dict)` branch) — good evidence the fix pattern is now the right one to reach for whenever `.calendar` shows up.

### New
- 15 new router files: `index_constituents.py`, `tax_advisor.py`, `short_squeeze_scanner.py`, `ipo_lockup_calendar.py`, `fed_watch.py`, `ai_morning_briefing.py`, `crypto_dashboard.py`, `ai_portfolio_review.py`, `economic_dashboard.py`, `ai_stock_analyzer.py`, `dividend_tracker.py`, `watchlist_heatmap.py`, `earnings_surprise_tracker.py`, `earnings_strategy_analyzer.py`, `market_correlation.py`

### Fixed
- `routers/ai_stock_analyzer.py` — `_build_snapshot`'s earnings-date lookup rewritten to the proven dict-based `.calendar` access.
- `backend/tests/test_main.py` — `TestIndexConstituents`'s mocks patched `main._fetch_market_cap`, which moved entirely into `routers/index_constituents.py` during this batch (a local helper, not deferred-imported) — updated to `patch("routers.index_constituents._fetch_market_cap", ...)`. The `_fetch_perf_one` mocks in the same tests correctly stay pointed at `main` since that one is still deferred-imported from there.

### Verified
- 52/52 backend tests (after the mock-target fix above, found by actually running the suite — not caught by ruff or static checks); audited every `from main import` across all routers; live smoke tests on 13 of the 15 endpoints with real data. The remaining two (`/api/market/stock-snapshot`, `/api/ai/stock-analyze`) hit an active Yahoo Finance rate limit from this session's cumulative testing volume (confirmed via direct `YFRateLimitError` from a raw function call, not an application bug) — verified the `.calendar` fix logic in isolation instead, against the exact dict shape observed live earlier this session, with the same code path already proven correct in three prior fixes. Full route sweep shows the same baseline set of param-required 422s plus three new timeouts on previously-working, untouched endpoints (`/api/portfolio/net-exposure`, `/api/home/summary`, `/api/portfolio/optimize`) consistent with the same rate limit, not a regression.

### Files changed
- The 15 new router files above — new
- `backend/main.py` — all 15 sections removed; dead imports cleaned up (`HTTPException`, `StreamingResponse`, `BaseModel`, `pandas`, `json`, `Anthropic`, `db_session`, `PortfolioPosition`, `_finite_or_none`, `_edgar_req`, `_TICKER_RE`)
- `backend/tests/test_main.py` — `TestIndexConstituents` mock target fix

---

## 2026-09-18 — Backend Modularization: AI News Sentiment, News Sentiment Engine, Custom News Feed, Market Sentiment Dashboard (the `_SENTIMENT_TTL` cluster)

Continued the router extraction (see prior entries below) with the other TTL-name-collision cluster: `_SENTIMENT_TTL` was defined three times in `main.py` (`hours=1` for per-symbol AI sentiment, `hours=2` for batch news sentiment, `minutes=30` for the market-wide sentiment dashboard) with three genuinely different intended cadences. Unlike the `_ANALYST_TTL` fix two batches ago (where both definitions meant "the same concept" and got unified into one shared constant), these three are unrelated features that happened to reuse a generic name — so each got its own distinctly-named constant (`_AI_SENTIMENT_TTL`, `_NEWS_SENTIMENT_TTL`, `_MARKET_SENTIMENT_TTL`) restoring its originally-intended value, since Market Sentiment Dashboard's `minutes=30` (the last one assigned in the file) had been silently winning for all three at runtime.

Also found a second cache-key collision of the same shape as the analyst one: `/api/sentiment/{symbol}` and `/api/news/sentiment` both built a cache key as `f"sentiment:{...}"`, which collapsed to the identical string for a single-symbol batch request (`sentiment:AAPL`) despite the two endpoints returning completely different response shapes. Fixed by giving the batch endpoint its own `news_sentiment:{symbols}` key.

### New
- `backend/routers/ai_news_sentiment.py`, `news_sentiment_engine.py`, `custom_news_feed.py`, `market_sentiment_dashboard.py` — new

### Fixed
- `_SENTIMENT_TTL` naming collision resolved into three distinct constants, each scoped to its own router, restoring each section's originally-intended cache duration.
- `news_sentiment_engine.py`'s cache key changed from the colliding `sentiment:{symbols}` to `news_sentiment:{symbols}`.

### Verified
- 52/52 backend tests; cleared existing `sentiment:*`/`mkt_sentiment_v1` cache rows before testing; live smoke tests on all 4 endpoints — `/api/news/sentiment` reached the real Anthropic call and hit only the pre-existing invalid API key, confirming the cache-key fix and deferred `_fetch_feed` import both work; full route sweep, zero new regressions.

### Files changed
- The 4 new router files above — new
- `backend/main.py` — all four sections removed; dead imports cleaned up (`Query`, `asyncio`, `List`)

---

## 2026-09-18 — Backend Modularization: Insider Transactions, Analyst Ratings, Insider Trading Feed, Analyst Rating Tracker (the `_ANALYST_TTL`/`_INSIDER_TTL` cluster)

Finally tackled the cluster that had been deliberately deferred across every prior batch: four sections sharing `_ANALYST_TTL`/`_INSIDER_TTL`, including the known pre-existing bug where `_ANALYST_TTL` was defined twice in `main.py` with different values (`hours=4` near Insider Transactions, `hours=6` near Analyst Rating Tracker) — Python module-level execution meant the later assignment silently won everywhere, so `hours=6` was already the value actually in effect at runtime for both consumers. Moved both TTLs into `edgar_utils.py` as a single source of truth (kept at `hours=6`/`hours=4` respectively, preserving actual current behavior rather than "fixing" it to a guessed original intent) — this makes the whole class of bug structurally impossible going forward.

Also found and fixed a second, more serious pre-existing bug while reading these sections closely: `routers/analyst_ratings.py`'s `/api/analyst/{symbol}` and `routers/analyst_rating_tracker.py`'s `/api/market/analyst-ratings` used the **identical** cache key (`analyst:{symbol}`) despite returning completely different response shapes — whichever endpoint was hit first would silently poison the cache for the other for up to 6 hours. Fixed by giving the tracker its own `analyst_tracker:{symbol}` key. Verified live: hit both endpoints, confirmed each now caches under its own key with its own correct shape.

Also discovered and fixed a smaller mistake from two batches ago: a `sed` line-range deletion for Smart Alerts 2.0 had collaterally swallowed the `# ── News Sentiment Engine ──` header comment on the following section — the actual code was untouched and fully functional, just its label was gone, which had been silently corrupting the section-boundary triage script's counts. Restored the header; added a note to the standing deferred-import-audit process to catch this class of mistake going forward (an unexpected jump in an adjacent section's line/def count after a batch is the tell).

### New
- `backend/routers/insider_transactions.py`, `analyst_ratings.py`, `insider_trading_feed.py`, `analyst_rating_tracker.py` — new

### Fixed
- `backend/edgar_utils.py` — added `_INSIDER_TTL`/`_ANALYST_TTL` as the single source of truth, eliminating the double-definition bug.
- `backend/routers/analyst_rating_tracker.py` — cache key changed from the colliding `analyst:{symbol}` to `analyst_tracker:{symbol}`.
- `backend/main.py` — restored the `# ── News Sentiment Engine ──` header comment lost in a previous batch's deletion.

### Verified
- 52/52 backend tests; cleared all `analyst:*`/`insider:*` cache rows before testing (some were already populated with pre-fix, possibly-collided data) and confirmed both analyst endpoints now cache independently with correct shapes; live smoke tests on all 4 endpoints; full route sweep, zero new regressions.

### Files changed
- The 4 new router files above — new
- `backend/edgar_utils.py` — `_INSIDER_TTL`, `_ANALYST_TTL` added
- `backend/main.py` — all four sections removed; News Sentiment Engine header restored

---

## 2026-09-18 — Backend Modularization: AI Stocks, AI Analyst Actions, Day Trader Scanners, Screener, Options Chain, Dividends, Correlation Matrix, Sector Rotation, WebSocket Live Quotes, Smart Alerts 2.0

Continued the router extraction (see prior entries below) with 10 more sections. `routers/ai_analyst_actions.py` imports `_AI_STOCKS` directly from the new `routers/ai_stocks.py` (module-level, no cycle) rather than deferring through `main.py` — the same trick used earlier for Custom Screener/NLP Screener. `_fetch_screener_quotes` and `_fetch_feed` (Day Trader Scanners) and `_fetch_fundamentals` (Screener) are still main.py-anchored, so those got the usual function-scoped deferred import.

Split the three TTL constants clustered under the old "Options Chain" section header (`_OPTIONS_TTL`, `_DIVIDEND_TTL`, `_CORRELATION_TTL`) to live locally with the section that actually consumes each one, since each turned out to be single-consumer despite being defined together.

Live verification surfaced and fixed a third instance of the "today's incomplete trading session leaves a NaN Close" bug class (same root cause as the Position Sizing ATR fix two batches ago, different call sites):
- **`_fetch_perf_one`** (still in `main.py`, shared by AI Stocks, Home Summary, and Market Performance) took `hist["Close"].iloc[-1]` without dropping NaN — broken for every symbol whenever called mid-session. Fixed by dropping NaN before indexing; this also fixed `/api/home/summary` and `/api/market/performance`, which had been intermittently 500ing and were wrongly attributed to a Yahoo Finance rate limit in the previous batch's notes.
- **`routers/sector_rotation.py`**'s `_fetch_sector_perf` had the identical unguarded `closes.iloc[-1]` pattern for its `chg1w`/`chg1m`/`chg3m` deltas.

Both fixes were masked for a while during testing by the app's own DB-backed response cache still holding NaN-containing results from before the fix — a good reminder to clear the relevant `cache_entries` rows before trusting a "still failing" result while iterating on a fix.

### New
- `backend/routers/ai_stocks.py`, `ai_analyst_actions.py`, `day_trader_scanners.py`, `screener.py`, `options_chain.py`, `dividends.py`, `correlation_matrix.py`, `sector_rotation.py`, `websocket_quotes.py`, `smart_alerts.py` — new

### Fixed
- `backend/main.py` — `_fetch_perf_one` now drops NaN closes before indexing.
- `backend/routers/sector_rotation.py` — same NaN-guard for `_fetch_sector_perf`.
- `backend/routers/smart_alerts.py` — `earnings_proximity` rule now uses the dict-based `.calendar` access (matching the `rich_earnings_calendar.py` fix from the previous batch) instead of the old DataFrame-shaped API; this rule silently never fired before.

### Verified
- 52/52 backend tests; audited every `from main import` across all routers; live smoke tests on all endpoints in this batch, including re-testing after clearing stale cache rows to confirm the NaN fixes actually took effect (not just a cache hit hiding the old bug); full route sweep confirms `/api/home/summary`, `/api/ai-stocks`, and `/api/market/sectors` — all previously 500ing — are now clean, with zero new regressions.

### Files changed
- The 10 new router files above — new
- `backend/main.py` — all 10 sections removed; `_fetch_perf_one` NaN fix; dead imports/constants cleaned up (`WebSocket`, `WebSocketDisconnect`, `numpy`, `SmartAlertRule`, `_calc_rsi`, `_SECTOR_ETFS`, `SCREENER_UNIVERSE`, dead `_AI_TTL`/`_AI_ANLST_TTL` duplicates in the TTLs block)

---

## 2026-09-18 — Backend Modularization: Position Sizing, Portfolio Optimizer, Rich Earnings Calendar, Options P&L, Portfolio X-Ray, Sector Momentum, Market Breadth, Fundamental Comparison, Price Target Tracker, Earnings Call Summarizer, DCF Valuation, Yield Curve & Rates

Continued the router extraction (see prior entries below) with the largest batch yet — 12 sections. Moved two more small, dependency-free constants into `edgar_utils.py` (`_SECTOR_ETFS`, shared by Sector Rotation and Sector Momentum Ranker; `SCREENER_UNIVERSE`, shared by Screener and Market Breadth Dashboard) so both consumers could be handled without deferred imports. Also found and merged in an unlabeled endpoint (`/api/options/unusual`, no `# ── ` section header) that a line-range-based extraction would otherwise have silently swept into Yield Curve & Rates — it's a second, explicit-symbols options-unusual-activity scanner, so it now lives alongside the existing scanner in `routers/unusual_options.py`.

Options P&L Tracker's `_live_option_price` is exactly what `net_exposure.py` deferred-imports from `main` — caught by the now-standard post-batch audit, fixed the same way as the prior `_fetch_day_quote`/`_compute_portfolio_risk` cases: `net_exposure.py` now imports it directly from `routers/options_pnl_tracker.py`.

Live verification surfaced two genuine pre-existing bugs, both fixed (found only because this batch's live-endpoint testing exercised code paths that hadn't been curl-tested end-to-end before):
- **Position Sizing Calculator** 500'd on every call: the 14-day ATR calculation can produce NaN when the most recent trading session's data is incomplete, and Starlette refuses to serialize a bare NaN. Fixed with `edgar_utils._finite_or_none` (the same helper already used elsewhere for exactly this).
- **Rich Earnings Calendar** silently returned `[]` for every symbol: `_enrich_earnings` still used the old DataFrame-shaped `.calendar` API (`cal.columns`, `cal[col].dropna()`), but current yfinance returns `.calendar` as a plain dict. Rewrote to the dict-based access already used correctly in `earnings_play_calculator.py` (`cal["Earnings Date"]`, `cal["Earnings Average"]` for the EPS consensus).

### New
- `backend/routers/position_sizing.py`, `portfolio_optimizer.py`, `rich_earnings_calendar.py`, `options_pnl_tracker.py`, `portfolio_xray.py`, `sector_momentum.py`, `market_breadth.py`, `fundamental_comparison.py`, `price_target_tracker.py`, `earnings_call_summarizer.py`, `dcf_valuation.py`, `yield_curve.py` — new
- `backend/edgar_utils.py` — added `_SECTOR_ETFS` and `SCREENER_UNIVERSE`

### Fixed
- `backend/routers/position_sizing.py` — NaN-guard the ATR calculation.
- `backend/routers/rich_earnings_calendar.py` — dict-based `.calendar` access matching current yfinance.
- `backend/routers/net_exposure.py` — `_live_option_price` now imported from `routers/options_pnl_tracker.py` instead of a stale deferred `main` import.
- `backend/routers/unusual_options.py` — gained the second `/api/options/unusual` scanner (previously an unlabeled block in `main.py`).

### Verified
- 52/52 backend tests; audited every `from main import` across all routers before and after; live smoke tests on all 13 endpoints in this batch (both bugs above were only caught this way, not by ruff/tests/static checks); full route sweep — the only new failures were `/api/home/summary` and `/api/ai-stocks` intermittently 500ing on a transient Yahoo Finance rate limit from this session's cumulative testing volume today (confirmed via direct `_fetch_perf_one` calls returning "Too Many Requests" — neither endpoint's code was touched by this batch).

### Files changed
- The 12 new router files above — new
- `backend/edgar_utils.py` — `_SECTOR_ETFS`, `SCREENER_UNIVERSE` added
- `backend/main.py` — all 12 sections (+ the unlabeled UOA scan) removed; dead imports cleaned up (`OptionsPosition`, `PriceTarget`, `_get_cik`)
- `backend/routers/net_exposure.py`, `backend/routers/unusual_options.py` — modified as described above

---

## 2026-09-18 — Investor Education: Capital Structure & Derivatives (with a worked tree example)

Enriched the Market Structure and Asset Classes layers (see prior entries below) with the piece the module was missing: how an issuer's different securities rank against each other, and how derivatives relate to an issuer without being a claim on it at all.

Two new topics: **Capital Structure** (child of The Issuer Concept) explains the seniority stack — secured debt → senior unsecured debt → subordinated debt → preferred stock → common equity — and why the same issuer's securities carry very different risk/yield purely from where they sit in that stack. **Derivatives** (a new 8th asset class) explains that options, futures, swaps, and Credit Default Swaps (CDS) are side contracts between two *other* parties that derive their value from an issuer's securities or default risk — the issuer isn't a party to them and raises no capital from their trading.

The Capital Structure topic centers on a worked example: a visual tree of a hypothetical issuer ("Acme Corp") showing every tier of its capital stack as a ranked, colored box (paid-first at top, paid-last at bottom), with a convertible-notes branch showing its embedded option, and a separate "Derivatives" zone below with dashed-style cross-references (Listed Options → Common Stock, CDS → Senior Unsecured Debt) showing exactly how a derivative *references* a tier without belonging to it.

Existing topics got cross-links to both new ones: Equities, Corporate Bonds, Convertible Bonds (plus a new keyPoint on its embedded-option nature), and Credit Spread (plus a new keyPoint on CDS as the derivative-market parallel to a cash bond's credit spread).

### New
- Topics: `capital-structure` (structure layer) and `derivatives` (assets layer) in `investorEducationTopics.js`, each with `relatedIds` back to `issuer-concept`, `equities`, `corporate-bonds`, `convertible-bonds`.
- `InvestorEducation.jsx`: a small `diagram` mechanism (`topic.diagram` key → `DIAGRAMS` registry) and the `CapitalStructureTree` component — a data-driven capital-stack visualization keyed off `CAPITAL_STACK`/`DERIVATIVE_EXAMPLES` constants, rendered only for the Capital Structure topic.

### Verified
- A Node script walked every topic's `parentId`/`childIds`/`relatedIds`/`layer` and confirmed all 30 topics resolve to real IDs with no dangling references, each layer still has exactly one root, and every child's `parentId` points back correctly.
- `npx vite build` — new `fuchsia-*` Tailwind classes (used for the "this is a derivative reference" annotations) confirmed present in the built CSS.
- `npx vitest run` — 90/90 existing frontend tests still pass.

### Files changed
- `frontend/src/data/investorEducationTopics.js`, `frontend/src/components/InvestorEducation.jsx` — modified

---

## 2026-09-18 — Investor Education: Onion Map + Live Data Snapshots

Enriched the Investor Education module (see prior entry below) with two additions: a visual "onion map" landing view, and live data grounding six of the topics in real current numbers.

The module now opens on a concentric-circle diagram — outermost ring Macro & Geography, innermost Risk & Valuation — literally the "layers of an onion" framing from the original request, alongside a clickable card per layer. Clicking a ring or card drops into that layer's drill-down tree (the existing sidebar/breadcrumb browsing from the first version); a "◎ Onion Map" button returns to it from anywhere.

Six topics — Currencies (DXY), Central Banks (Fed funds target + next FOMC odds), Treasuries & the Risk-Free Rate (10Y yield + curve inversion), Going Public (count of tracked IPOs), Crypto (BTC price/24h change), and Volatility & Beta (VIX) — now show a small "Live" stat card pulled from the app's own existing endpoints (`/api/market/rates`, `/api/market/fed-watch`, `/api/market/crypto`, `/api/market/ipo-calendar`, `/api/home/summary`) rather than only linking out. Each topic's `liveStat.parse(json)` returns `null` on missing/malformed data so the block disappears cleanly instead of showing a broken stat.

### New
- `InvestorEducation.jsx`: `OnionMap` (SVG concentric circles + legend cards) and `LiveStat` (fetch-on-mount, loading/error/empty states) components; a `view` state (`'map' | 'topic'`) makes the map the default landing screen; `LAYER_COLORS` gives each layer a consistent accent (sky/violet/emerald/amber) across the map, sidebar layer picker, and topic header badge.
- `investorEducationTopics.js`: `liveStat: { endpoint, parse }` added to the 6 topics above.

### Verified
- Hit all 4 backend endpoints directly with curl and confirmed every field each `parse` function reads (`dxy`, `yields.t10y`, `inverted`, `spread_10y_13w`, `currentTarget`, `meetings[].status/date/cutProb/holdProb/hikeProb`, `coins[].symbol/price/change24h`, IPO array length, `market.vix.price/label`) matches the real live response shape — not just the code that produces it.
- `npx vite build` — new Tailwind fill/hover classes for the SVG rings (`fill-sky-700`, `fill-violet-700`, `fill-emerald-700`, `fill-amber-700` + hover variants) confirmed present in the built CSS, since dynamically-interpolated class names wouldn't have been picked up by Tailwind's scanner.
- `npx vitest run` — 90/90 existing frontend tests still pass.

### Files changed
- `frontend/src/components/InvestorEducation.jsx`, `frontend/src/data/investorEducationTopics.js` — modified

---

## 2026-09-18 — Investor Education module

A new "Learn" area (pinned in the sidebar, next to User Guide) teaching financial-market concepts as a navigable graph rather than a flat article list — four layers (Macro & Geography, Market Structure, Asset Classes, Risk & Valuation), each a parent/child drill-down tree you can traverse top-down (broad concept → specifics) or bottom-up (via breadcrumbs back to broader context), plus lateral "Related Concepts" links that cross layers (e.g. Credit Spread → Corporate Bonds, Currencies → Currencies as an Asset Class). Where a live tool already exists for a concept, the topic links straight to it — e.g. Treasury bonds/risk-free rate link to the Yield Curve tab, IPOs link to the IPO & Lockup Calendar, SPACs link to the SPACs module, credit spread links to Corporate Bonds' credit-spread-vs-Treasury feature.

Content is hand-authored static data (not AI-generated) to keep it fast, free, and accurate — 28 topics tracing global economy → regions → countries → currencies; public/private markets → issuer concept → private placement/VC → IPO/SPAC → secondary markets → M&A; the 7 major asset classes framed by liquid vs. illiquid; and risk-free rate → credit spread → duration → volatility/beta → liquidity risk.

### New
- `frontend/src/data/investorEducationTopics.js` — the topic graph (`LAYERS` + `TOPICS`), pure data.
- `frontend/src/components/InvestorEducation.jsx` — layer picker, nested outline sidebar (desktop) / dropdowns (mobile), breadcrumb trail, "Go Deeper" children, "Related Concepts" cross-links, and deep-links into existing tabs via the same `navigate()` used by the Home dashboard.

### Verified
- `npx vite build` — new component code-splits into its own lazy chunk, no errors.
- `npx vitest run` — 90/90 existing frontend tests still pass.

### Files changed
- `frontend/src/data/investorEducationTopics.js`, `frontend/src/components/InvestorEducation.jsx` — new
- `frontend/src/App.jsx` — lazy import, `learn` nav entry, pinned sidebar button next to User Guide, render branch

---

## 2026-09-18 — Backend Modularization: Custom Screener, Multi-timeframe Technical Signals, Options Strategy Builder, Claude Trade Idea Generator, Portfolio Risk Dashboard

Continued the router extraction (see prior entries below) with five more sections, and fixed a real regression found by auditing all cross-router deferred imports before starting: the previous batch moved `_fetch_day_quote` out of `main.py` into `routers/portfolio.py`, but `routers/net_exposure.py`'s deferred import (`from main import _fetch_day_quote, ...`) still pointed at `main` — silently broken until that endpoint was actually hit. Fixed by pointing it at `routers.portfolio` instead. This is now a mandatory check on every future batch: after moving anything out of `main.py`, grep every router for `from main import` and confirm each name still resolves there.

Also moved `_calc_rsi` (a pure, dependency-free RSI calculation) into `edgar_utils.py` — it's shared by three sections (Screener, Multi-timeframe Technical Signals, Smart Alerts 2.0), so a shared home avoids yet another deferred import. And updated `routers/nlp_screener.py` to import `FilterCondition`/`CustomScreenRequest`/`run_custom_screener` from the new `routers/custom_screener.py` directly (no longer deferred through `main.py`, since neither router depends on the other).

### New
- `backend/routers/custom_screener.py` — `/api/screener/custom`, moved verbatim; deferred import of `_fetch_fundamentals` from `main.py`.
- `backend/routers/technical_signals.py` — `/api/screener/signals`, moved verbatim; imports `_calc_rsi` from `edgar_utils.py`.
- `backend/routers/options_strategy_builder.py` — `/api/options/strategies/{symbol}`, moved verbatim.
- `backend/routers/trade_idea_generator.py` — `/api/trade-ideas`, moved verbatim.
- `backend/routers/portfolio_risk_dashboard.py` — `/api/portfolio/risk`, moved verbatim; `_compute_portfolio_risk`/`_sanitize_nan` also consumed by `routers/net_exposure.py` (direct import, no circularity).

### Fixed
- `backend/routers/net_exposure.py` — stale `from main import _fetch_day_quote` (broken since the Watchlist/Portfolio/AI Chat/Financial Advisor batch moved `_fetch_day_quote` to `routers/portfolio.py`) now imports it from there instead; `_compute_portfolio_risk`/`_sanitize_nan` similarly switched from a deferred `main` import to a direct import from the new `routers/portfolio_risk_dashboard.py`.
- `backend/routers/nlp_screener.py` — `FilterCondition`/`CustomScreenRequest`/`run_custom_screener` now imported directly from `routers/custom_screener.py` instead of deferred through `main.py`.

### Verified
- 52/52 backend tests; audited every `from main import` across all routers against main.py's current definitions before and after this batch; live smoke tests on all 6 new/touched endpoints including `/api/portfolio/net-exposure` (confirms the net_exposure.py fix) and `/api/screener/nlp` (confirms the custom_screener.py re-point, reaching the real Anthropic call and hitting only the pre-existing invalid API key); full route sweep, zero new regressions.

### Files changed
- `backend/routers/custom_screener.py`, `backend/routers/technical_signals.py`, `backend/routers/options_strategy_builder.py`, `backend/routers/trade_idea_generator.py`, `backend/routers/portfolio_risk_dashboard.py` — new
- `backend/edgar_utils.py` — added `_calc_rsi` + `numpy` import
- `backend/main.py` — all five sections removed; `_calc_rsi` now imported from `edgar_utils`; dead `math` import removed
- `backend/routers/net_exposure.py` — deferred-import fixes described above
- `backend/routers/nlp_screener.py` — import re-pointed to `routers/custom_screener.py`

---

## 2026-09-18 — Backend Modularization: Watchlist, Portfolio, AI Chat, Financial Advisor

Continued the router extraction (see prior entries below) with four foundational sections, handled carefully given how core Watchlist and Portfolio are to the rest of the app. Portfolio's Home Summary endpoint needed the function-scoped deferred-import pattern for `_fetch_perf_one` (still in `main.py`, shared by several other not-yet-extracted sections). Also found and removed a dead duplicate: `_HOME_TTL` was left behind in `main.py`'s shared TTLs block after its only consumer (Home Summary) moved to `routers/portfolio.py` with its own local copy — pyflakes doesn't flag unused module-level constants, so this was caught by manual diffing.

### New
- `backend/routers/watchlist.py` — `/api/watchlists`, `/api/watchlist` (GET/POST/DELETE), moved verbatim.
- `backend/routers/portfolio.py` — `/api/portfolio` (GET/POST/DELETE), `/api/home/summary`; deferred import of `_fetch_perf_one` from `main.py`.
- `backend/routers/ai_chat.py` — `/api/ai-chat` (Gemini or Claude streaming chat), moved verbatim, including the `google.genai` optional-import guard.
- `backend/routers/financial_advisor.py` — `/api/financial-plan` (CFP-persona streaming plan generator), moved verbatim.

### Verified
- 52/52 backend tests; live smoke tests on all 6 endpoints — `/api/home/summary` confirmed the deferred `_fetch_perf_one` import resolves correctly at request time with real SPY/QQQ/DIA/VIX data; `/api/ai-chat` and `/api/financial-plan` both reached their real external API calls (Gemini returned a pre-existing "model deprecated" 404, Anthropic hit the already-known invalid API key) — neither is a regression from this move; full route sweep, zero new regressions.

### Files changed
- `backend/routers/watchlist.py`, `backend/routers/portfolio.py`, `backend/routers/ai_chat.py`, `backend/routers/financial_advisor.py` — new
- `backend/main.py` — all four sections removed; dead imports cleaned up (`WatchlistSymbol`, `WatchlistGroup`, the `google.genai` try/except guard); dead `_HOME_TTL` constant removed from the shared TTLs block

---

## 2026-09-18 — Backend Modularization: Backtester, CSV Export/Import, SEC Filings, Options UOA, Portfolio Equity Curve, Earnings Play Calculator, NLP Screener

Continued the router extraction (see the six prior entries below) with a larger, mixed batch of seven sections. Two of them needed the function-scoped deferred-import pattern established for CPPI/Net Exposure: Portfolio Equity Curve's snapshot endpoint calls `_fetch_quote` (still in `main.py`, too widely shared to move), and NLP Screener calls `FilterCondition`/`CustomScreenRequest`/`run_custom_screener` (the Custom Screener's shared filter-execution core).

### New
- `backend/routers/backtester.py` — `/api/backtest`, moved verbatim (MA Crossover / RSI Reversal / Bollinger Bands vs. buy & hold).
- `backend/routers/csv_export_import.py` — `/api/portfolio/export`, `/api/portfolio/import`, `/api/journal/export`, moved verbatim.
- `backend/routers/sec_filings.py` — `/api/filings/{symbol}`, moved verbatim.
- `backend/routers/unusual_options.py` — `/api/market/options-uoa`, moved verbatim.
- `backend/routers/portfolio_equity_curve.py` — `/api/portfolio/snapshots`, `/api/portfolio/snapshot`; deferred import of `_fetch_quote` from `main.py`.
- `backend/routers/earnings_play_calculator.py` — `/api/earnings/play/{symbol}`, moved verbatim (fixed a self-inflicted duplicate `_PLAY_TTL` introduced during extraction, already defined in the original section body).
- `backend/routers/nlp_screener.py` — `/api/screener/nlp`; deferred import of `FilterCondition`/`CustomScreenRequest`/`run_custom_screener` from `main.py`.

### Verified
- 52/52 backend tests; live smoke tests on all 7 endpoints with real data (backtest equity curve on AAPL, portfolio/journal CSV export, AAPL SEC filings, options UOA scan, a real portfolio snapshot write, AAPL earnings play straddle calc); both deferred imports confirmed resolving correctly at actual request time, not just at module import — NLP Screener's request reached the Anthropic API call itself and failed only on the pre-existing invalid API key, not a `NameError`; full route sweep, zero new regressions (all failures pre-existing endpoints needing query params/POST bodies).

### Files changed
- `backend/routers/backtester.py`, `backend/routers/csv_export_import.py`, `backend/routers/sec_filings.py`, `backend/routers/unusual_options.py`, `backend/routers/portfolio_equity_curve.py`, `backend/routers/earnings_play_calculator.py`, `backend/routers/nlp_screener.py` — new
- `backend/main.py` — all seven sections removed; dead imports cleaned up (`Response` from `fastapi.responses`, `csv`, `io`, `PortfolioSnapshot`, `TradeJournalEntry`)
- `backend/tests/test_main.py` — no changes needed this batch

---

## 2026-09-18 — Backend Modularization: Chart, News, Analyst History, Earnings Calendar, Portfolio Risk Data, Price Alerts, Portfolio Performance, Earnings History, Pre-Market Movers, Trade Journal, Economic Calendar, Institutional Ownership

Continued the router extraction with a 12-section batch across the Chart Modal, Watchlist, and Portfolio areas. Found and fixed a real, pre-existing test bug in the same pass: `TestChart`'s two tests patched `main.yf.Ticker`, which silently stopped mocking anything once Chart's code moved to `routers/chart.py` (which has its own separate `yfinance` import) — the test was quietly hitting live/cached real data instead of the mock. Caught by actually running the suite after the move, not by any static check.

### New
- `backend/routers/chart.py` — `/api/chart/{symbol}`, moved verbatim.
- `backend/routers/news.py` — `/api/news/{symbol}`, moved verbatim.
- `backend/routers/analyst_history.py` — `/api/analyst-history/{symbol}`, moved verbatim.
- `backend/routers/earnings_calendar.py` — `/api/earnings/upcoming`, moved verbatim.
- `backend/routers/portfolio_risk_data.py` — `/api/market/risk-data`, moved verbatim.
- `backend/routers/price_alerts.py` — `/api/alerts` (GET/POST/DELETE/PATCH), moved verbatim.
- `backend/routers/portfolio_performance.py` — `/api/portfolio/performance`, moved verbatim.
- `backend/routers/earnings_history.py` — `/api/earnings/history/{symbol}`, moved verbatim.
- `backend/routers/premarket_movers.py` — `/api/market/premarket-movers`, moved verbatim.
- `backend/routers/trade_journal.py` — `/api/journal` (GET/POST/DELETE) + `/api/journal/stats`, moved verbatim.
- `backend/routers/economic_calendar.py` — `/api/market/economic-calendar`, moved verbatim.
- `backend/routers/institutional_ownership.py` — `/api/institutional/{symbol}`, moved verbatim.

### Fixed
- `backend/tests/test_main.py` — `TestChart::test_valid_period_returns_bars` and `test_bar_fields` now patch `routers.chart.yf.Ticker` instead of the now-stale `main.yf.Ticker`.

### Verified
- 52/52 backend tests (after the mock-target fix); live smoke tests on all 12 endpoints with real data; full route sweep with no new regressions.

### Files changed
- The 12 router files above — new
- `backend/main.py` — all twelve sections removed
- `backend/tests/test_main.py` — `TestChart` mock target fix

---

## 2026-09-18 — Backend Modularization: Seasonal Patterns, ETF Overlap, Relative Strength

Continued the router extraction (see the five prior entries below) with three adjacent Research-group scanners — all clean, zero external cross-references, and this time not even any dead imports left behind in `main.py` (their shared dependencies like `pd`/`yf`/`_safe_float` are heavily used elsewhere).

### New
- `backend/routers/seasonal_patterns.py` — `/api/market/seasonal`, moved verbatim.
- `backend/routers/etf_overlap.py` — `/api/market/etf-overlap`, moved verbatim.
- `backend/routers/relative_strength.py` — `/api/market/relative-strength`, moved verbatim.

### Verified
- 52/52 backend tests; live smoke tests with real data on all three (AAPL 5yr seasonality, SPY/QQQ overlap correctly finding NVDA at ~8% weight in both, AAPL/MSFT/NVDA ranked by composite RS vs. SPY); full 105-route sweep — cleanest yet, only the pre-existing invalid Anthropic API key issue remains.

### Files changed
- `backend/routers/seasonal_patterns.py`, `backend/routers/etf_overlap.py`, `backend/routers/relative_strength.py` — new
- `backend/main.py` — all three sections removed

---

## 2026-09-18 — Backend Modularization: Activist Tracker & Reddit Trending

Continued the router extraction (see the four prior entries below) with 13D/13G Activist Tracker and Reddit Trending Stocks — both clean, self-contained single-route scanners with zero external cross-references either direction.

### New
- `backend/routers/activist_tracker.py` — `/api/activist/tracker`, moved verbatim.
- `backend/routers/reddit_trending.py` — `/api/reddit/trending`, moved verbatim.

### Verified
- 52/52 backend tests; live smoke tests with real data (120 current 13D/13G filings with correct ticker extraction, live r/wallstreetbets mention data), both with price enrichment working; full 105-route sweep with no new regressions (one 400 on `/api/portfolio/risk` turned out to be a legitimate, unrelated "not enough overlapping price history" error for the current portfolio holdings).

### Files changed
- `backend/routers/activist_tracker.py`, `backend/routers/reddit_trending.py` — new
- `backend/main.py` — both sections removed; 3 now-dead imports cleaned up (`urllib.parse`, `html`, `_fetch_opp_quote`)

---

## 2026-09-18 — Backend Modularization: CPPI Allocator & Net Exposure

Continued the router extraction (see the three prior entries below) with CPPI Allocator and Net Market Exposure — the pair surfaced a genuine architectural wrinkle the earlier extractions didn't: Net Exposure depends on 5 core helpers (`_compute_portfolio_risk`, `_fetch_day_quote`, `_fetch_fundamentals`, `_live_option_price`, `_sanitize_nan`) that live in `main.py` and are used by many unrelated features elsewhere, too widely-shared to move in this pass.

### New
- `backend/routers/cppi.py` — full CPPI Allocator (config, live state, rebalance, backtest), moved verbatim.
- `backend/routers/net_exposure.py` — Net Market Exposure, moved verbatim. Imports `_cppi_price`/`_cppi_state` from `routers.cppi` and `get_arb_positions`/`get_spac_positions` from `routers.merger_arb`/`routers.spacs` at module level (no circularity, same pattern as before). The 5 main.py-only helpers are imported with a **function-scoped deferred import** instead (`from main import ...` inside the route handler, not at module level) — the standard fix when a genuine two-way dependency exists: main.py needs to import this router to register it, and the router needs things from main.py, so deferring the import to request-time (long after both modules finish loading) breaks the cycle without moving the 5 shared helpers.

### Verified
- 52/52 backend tests; created a real CPPI strategy, confirmed `/api/cppi` computed correct live state, confirmed Net Exposure's CPPI sleeve picked it up correctly through the full cross-router chain, then deleted it with no residue left; backtest endpoint verified separately; full 105-route sweep — cleanest yet, zero new failures.

### Files changed
- `backend/routers/cppi.py`, `backend/routers/net_exposure.py` — new
- `backend/main.py` — CPPI Allocator and Net Market Exposure sections removed; 2 dead imports (`CppiStrategy`, `CppiRebalanceLog`) cleaned up

---

## 2026-09-18 — Backend Modularization: Fund Holdings Explorer

Continued the router extraction (see the two 2026-09-17 entries below) with Fund Holdings Explorer — cleaner than Merger Arb/SPACs since a thorough cross-reference check found zero external dependencies either direction before moving anything.

### New
- `backend/routers/fund_holdings.py` — `/api/edgar/fund-search`, `/api/edgar/fund-holdings`, `/api/edgar/popular-funds`, moved from `main.py`.

### Fixed
- A dead duplicate `_EDGAR_ASSET_CATS` dict got copied into the new router file (leftover from when `_parse_nport_xml` moved to `edgar_utils.py` earlier) — `ruff`/`pyflakes` don't flag unused *module-level* constants, only unused imports and undefined names, so this needed a manual diff against `edgar_utils.py`'s own top-level names to catch. Removed, along with 4 now-genuinely-dead imports in `main.py` that ruff did catch (`re`, `_edgar_filing_xml`, `_build_ticker_map`, `_parse_nport_xml`).

### Verified
- 52/52 backend tests; live smoke test on all 3 routes including the full holdings pipeline (SPY → 504 holdings, correctly enriched with live price/52-week range/performance); full 105-route sweep with no fund-holdings-related regressions.

### Files changed
- `backend/routers/fund_holdings.py` — new
- `backend/main.py` — Fund Holdings Explorer section removed; dead imports cleaned up

---

## 2026-09-18 — Lint Gate

New pre-commit hook that catches a specific bug class a modular codebase invites: a refactor that moves code between files can leave a name undefined at a call site that only executes on a request path tests don't happen to exercise — `python -c "import main"` and even a passing test suite can look clean while that path is still broken. Found and fixed 6 real instances of exactly this during the backend modularization work below before adding the gate.

### New
- `.githooks/pre-commit` runs `ruff check --select F` (undefined names, unused imports, duplicate definitions) on staged `backend/*.py` files, blocking the commit on failure. Enable once per clone: `git config core.hooksPath .githooks`.
- `backend/ruff.toml` scopes the rule set to `F` only — this codebase wasn't written to a style guide, so a broader rule set would flood with unrelated findings unrelated to what's actually being committed.
- `backend/requirements-dev.txt` (ruff, pytest) kept separate from `requirements.txt` so nothing extra ships to the Render deploy.

### Fixed
- Two dead local variables (`total_reported` in Fund Holdings Explorer, a `ff_dollars`/`ff_acct_pct` chain in Position Sizer) and a Python-level naming collision (`get_correlation` was reused by two unrelated routes — `/api/portfolio/correlation` and `/api/market/correlation` — renamed the latter to `get_market_correlation`, no route/URL change).

### Files changed
- `.githooks/pre-commit` (new), `backend/ruff.toml` (new), `backend/requirements-dev.txt` (new)
- `backend/main.py` — 3 pre-existing lint findings fixed
- `README.md` — new "Lint gate" setup section

---

## 2026-09-17 — Backend Modularization: Merger Arb & SPACs

Continued the backend split (see 2026-09-17 entry below) into Merger Arb and SPACs — the largest remaining chunk, and the one that surfaced how interconnected this file actually was: a static grep for known shared function names missed several real cross-references that only `pyflakes`/actually exercising every route caught (see Lint Gate above).

### New
- `backend/routers/merger_arb.py`, `backend/routers/spacs.py` — full CRUD (deals, positions, alerts, scan) for both features, moved verbatim from `main.py`.
- `edgar_utils.py` gained `_finite_or_none` and `_TICKER_RE`/`_fetch_opp_quote` — turned out to be shared not just within Merger Arb but with IPO & Lockup Calendar, Activist Tracker, and Reddit Trending Stocks in `main.py`, none of which were touched otherwise.
- `main.py`'s Net Market Exposure calls `get_arb_positions()`/`get_spac_positions()` directly as Python functions (not over HTTP) to report Merger Arb/SPAC capital as separate event-driven sleeves — now imported explicitly from the two new routers.

### Verified
- All 52 backend tests pass; full CRUD round-trip tested on both features' deals and alerts (create → update → verify → delete) with no residue left in the database; a systematic sweep of all 105 GET routes app-wide confirmed no regressions in unrelated features.

### Files changed
- `backend/main.py` — Merger Arb (807 lines) and SPACs (691 lines) sections removed; imports added for `get_arb_positions`/`get_spac_positions`/`_TICKER_RE`/`_fetch_opp_quote`/`_finite_or_none`
- `backend/edgar_utils.py` — `_finite_or_none`, `_TICKER_RE`, `_fetch_opp_quote` added
- `backend/routers/merger_arb.py`, `backend/routers/spacs.py` — new

---

## 2026-09-17 — Technical Refactor: Modularization, Code-Splitting, Light Theme

Three maintainability passes requested before building more features: `main.py` had grown to 12,269 lines in one file, the frontend shipped one 1.55MB JS bundle regardless of which tab was open, and the app's light/dark theme toggle silently did nothing on 55+ components that use Tailwind's `slate-*` palette instead of `gray-*`.

### New
- **Backend modularization (Phase 1)**: `backend/edgar_utils.py` — shared SEC/EDGAR helpers (`_get_cik`, `_edgar_req`, `_build_ticker_map`, `_parse_nport_xml`, etc.) extracted so both `main.py` and a new `backend/routers/` package can import them without a circular dependency. First routers extracted: `corporate_bonds.py`, `convertible_bonds.py`, `treasury.py` (~930 lines).
- **Frontend code-splitting**: 83 of 90 tab components in `App.jsx` converted to `React.lazy()` behind one `<Suspense>` boundary. Main bundle: 1.55MB → 447KB, split into ~85 per-tab chunks. Header/StockTable/ChartModal/HomeDashboard/CommandPalette/EarningsCalendar stay eager (always-mounted or highest-traffic tabs).
- **Light theme `slate-*` parity**: ~50 new CSS rules in `index.css` mirroring the existing `gray-*` light-theme mapping, so Corporate/Convertible/Treasury Bonds and 55+ other slate-based components now respect the theme toggle.

### Verified
- 52 backend tests + 90 frontend tests pass throughout; all 6 bond/treasury endpoints re-verified byte-identical to pre-refactor responses; 4 independent untouched features (Fund Holdings Explorer, SEC Filings, IPO Calendar, and others) spot-checked to confirm the shared-helper extraction didn't break anything outside its own scope.

### Known gap
- `hover:bg-slate-750` (used in `ActivistTracker.jsx`, `AnalystRatingTracker.jsx`, others) isn't a real Tailwind shade and generates no CSS in either theme — a pre-existing dark-theme bug, noted but not fixed here (out of scope for the light-theme parity work).

### Files changed
- `backend/edgar_utils.py`, `backend/routers/{corporate_bonds,convertible_bonds,treasury}.py` — new
- `backend/main.py` — Corporate/Convertible/Treasury Bonds sections removed, replaced with `app.include_router(...)`
- `frontend/src/App.jsx` — lazy imports, `<Suspense>` boundary
- `frontend/src/index.css` — `slate-*` light-theme rules

---

## 2026-09-17 — Export to PDF

New global "Export PDF" button (header, every page) that saves the currently active page's contents to a PDF via the browser's native print pipeline — no new dependencies, and it preserves the app's exact dark theme/colors in the exported file rather than converting to a light print theme.

### New
- **Export PDF** button in the header, next to the refresh button — visible on every page. Sets the browser tab title to `StockMonitor - <page name> - <date>` (used as the default filename in the print dialog), opens the browser's print dialog, and restores the original title afterward.
- Print stylesheet hides the sidebar, header, and mobile chrome (`.no-print`) so only the active page's content is included.
- `print-color-adjust: exact` forces the browser to render background/text colors exactly as shown on screen, even with the browser's own "background graphics" print option off — without this, a dark-themed page prints as invisible white-on-white text.
- The app's fixed-height scroll-region layout (`h-screen` + internal `overflow-y-auto`) is relaxed to natural document flow under print, so the full page prints across multiple PDF pages instead of being clipped to one viewport's worth of content.

### Known limitation
- Exports the active main-content tab. If a fixed-position overlay (Chart Modal, Command Palette) is open, printing captures whichever is on top but neither has had its own internal scroll region relaxed for print, so a long modal may still clip to one viewport — not addressed in this pass.

### Files changed
- `frontend/src/index.css` — print media query (`no-print`, `app-shell`/`app-body`/`app-main` overflow reset, color-adjust)
- `frontend/src/App.jsx` — `handleExportPdf`, `.no-print`/`.app-shell`/`.app-body`/`.app-main` classes on the layout wrappers
- `frontend/src/components/Header.jsx` — Export PDF button, `onExportPdf` prop, `.no-print` on the header itself

---

## 2026-09-17 — Corporate Bonds: Credit Spread vs. Treasury Curve

Corporate Bonds now computes an approximate yield-to-maturity for each fund-held bond and compares it against the Treasury par curve, so a bond's price is shown in credit-spread terms (bps over/under the government curve at the same maturity) rather than just coupon + price in isolation.

### New
- **vs. Treasury Curve** panel in each bond's expanded detail: approximate YTM, the Treasury yield interpolated at that bond's exact maturity, and the spread in basis points.
- Small chart plotting the current Treasury curve as a line with the bond's YTM marked as a point at its actual years-to-maturity — a continuous-years axis (not the ordinal tenor axis used on the Treasury Bonds page), since an arbitrary corporate maturity rarely lands on a published Treasury tenor.

### Backend
- `_bond_ytm` / `_bond_price_from_ytm` — bisection-based YTM solver (semiannual compounding, clean price, no accrued-interest adjustment) from coupon, maturity, and the largest holder's implied price.
- `_interpolate_treasury_yield` — linear interpolation of the current Treasury par curve at an arbitrary maturity in years.
- `/api/bonds/search` now returns `ytm`, `treasuryYield`, and `spreadBps` per fund-held bond, plus a `treasuryCurve` field (reusing `/api/treasury/current`) so the frontend doesn't need a second fetch. Prospectus-only bonds are skipped — YTM needs a live price.

### Files changed
- `backend/main.py` — YTM solver, curve interpolation, `bonds_search` extended
- `frontend/src/components/CorporateBonds.jsx` — `SpreadStats`, `TreasurySpreadChart` components, threaded `treasuryCurve` through `BondsTable`/`BondDetail`

---

## 2026-09-17 — Treasury Bonds

New standalone Research page for U.S. Treasury yields — current rates across the full curve, a historical trend chart per maturity, and a multi-curve yield curve view. Unlike corporate/convertible bonds, Treasury yields have a genuinely free, no-API-key, official daily source: the U.S. Treasury's own "Daily Treasury Par Yield Curve Rates" CSV — the same underlying data FRED's DGS* series are derived from, fetched straight from `home.treasury.gov` rather than through a paid/key-gated API (this app's `FRED_API_KEY` isn't configured, so building on the Treasury's own source instead of FRED avoids a dependency that wouldn't work out of the box).

### New
- **Treasury Bonds** under Research → Treasury Bonds.
- **Current Rates table**: all 14 tracked maturities (1 Mo through 30 Yr, including 1.5 Month and 4 Month once those bills existed) with today's yield and 1-day change. Click a row to chart that maturity below.
- **Historical Trend chart**: per-maturity yield history (1M/6M/1Y/5Y/10Y/Max ranges) as a time-series line chart.
- **Yield Curve chart**: yield vs. maturity, overlaying Today against ~1 Month Ago and ~1 Year Ago on one chart — the standard "how has the curve's shape changed" view (e.g. watching an inversion resolve), with a hover crosshair showing all three curves' values at any maturity.
- **2s10s spread badge** next to the Yield Curve heading — 10Y minus 2Y par yield, green "Normal" or red "Inverted" depending on sign — the classic recession-watch indicator, computed fresh on every `/api/treasury/current` call.

### Backend
- `GET /api/treasury/current` — latest yield + 1-day change for every tracked maturity, plus the 2s10s spread.
- `GET /api/treasury/history?maturity=&rng=` — historical yield series for one maturity.
- `GET /api/treasury/yield-curve` — today's curve plus 1-month-ago and 1-year-ago comparison curves.
- `_fetch_treasury_year_csv` — fetches and parses one calendar year of Treasury.gov's par yield curve CSV (cached per year; past years cached long, current year short since today's row updates).

### Files changed
- `backend/main.py` — Treasury Bonds section (three endpoints, CSV fetch/parse/cache)
- `frontend/src/components/TreasuryBonds.jsx` — new component (current-rates table, custom SVG yield curve chart, lightweight-charts history chart)
- `frontend/src/App.jsx` — import, nav item under Research, route

---

## 2026-09-17 — Convertible Bonds

New Research page for convertible corporate bond research by issuer, alongside Corporate Bonds. Reuses the Corporate Bonds pattern (fund N-PORT holdings + prospectus fallback), plus a third free source specific to converts: conversion economics (conversion price/ratio, call-trigger thresholds, if-converted value) are a defined part of the US-GAAP XBRL taxonomy, unlike credit ratings — so an issuer that tagged them exposes real structured terms straight from `data.sec.gov`'s company-facts API, no scraping required. Coverage still varies by issuer since tagging conversion terms isn't mandatory the way balance-sheet line items are.

### New
- **Convertible Bonds** under Research → Convertible Bonds. Search by ticker or company name to find an issuer's convertible bonds.
- **Bond search via convertible bond ETF N-PORT holdings**: scans the latest N-PORT filings from 3 major convertible bond ETFs (ICVT, CWB, FCVT) for holdings matching the issuer, reusing the exact same N-PORT/series-resolution plumbing built for Corporate Bonds.
- **Conversion terms from XBRL**: pulls the issuer's `companyfacts` XBRL data once and extracts a curated allowlist of convertible-debt concepts (conversion price, conversion ratio, shares issuable on conversion, call-trigger stock-price % and trading-day thresholds, if-converted value over principal, outstanding balance, proceeds/repayments) — each shown with its source filing and as-of date. Deliberately excludes convertible-*preferred stock* XBRL concepts, which are a different instrument.
- **SEC prospectus fallback**: same 424B2/3/5/FWP mining as Corporate Bonds, filtered to only keep matches whose note-type phrase mentions "convertible" so it doesn't surface an issuer's plain debt.
- **Standalone issuer profile**: when no tracked fund or prospectus match exists but the issuer has tagged conversion terms in its own filings (common for older or already-converted issues, e.g. Palo Alto Networks' 2014-2015 converts), the page shows those XBRL terms and ratings mentions directly instead of an empty "no bonds found" state.
- **Credit rating mentions**: reuses the existing `/api/bonds/ratings-mentions/{ticker}` endpoint from Corporate Bonds as-is — same company, same filings, no new backend needed.

### Backend
- `GET /api/convertibles/search?q=` — aggregates matching convertible bonds across the tracked convertible ETF universe by CUSIP, falling back to prospectus search, plus issuer XBRL conversion terms.
- `_fetch_convertible_xbrl_terms` — new helper: one `companyfacts` call per issuer, filtered against a curated allowlist of ~15 convertible-debt US-GAAP concepts.
- `_search_bond_prospectus` extended with a `require_convertible` flag to filter prospectus matches by note-type phrase, shared with Corporate Bonds' existing (default-off) behavior.

### Files changed
- `backend/main.py` — Convertible Bond Research section (search, XBRL terms, prospectus filter); `_search_bond_prospectus` extended
- `frontend/src/components/ConvertibleBonds.jsx` — new component
- `frontend/src/App.jsx` — import, nav item under Research, route

---

## 2026-09-16 — Corporate Bonds

New Research page for investment-grade and high-yield corporate bond research by issuer. There's no free per-CUSIP bond pricing API (unlike yfinance for equities), so this is built entirely on two public SEC data sources: N-PORT fund holdings for live characteristics, and full-text search over the issuer's own filings for everything a bulk data feed can't give for free.

### New
- **Corporate Bonds** under Research → Corporate Bonds. Search by ticker or company name to find an issuer's bonds.
- **Bond search via bond ETF N-PORT holdings**: scans the latest N-PORT filings from 7 major bond ETFs (LQD, VCIT, VCSH, USIG for investment grade; HYG, JNK, USHY for high yield) for holdings matching the issuer, resolving each ETF ticker to its specific SEC fund series (many ETFs, e.g. all iShares funds, share one filer CIK with hundreds of sibling funds — the series ID is what lets us pull just that one fund's filings) via SEC's `company_tickers_mf.json` reference file.
- **Bond characteristics on click**: CUSIP, ISIN, coupon rate & type (fixed/floating), maturity date, default flag, and every tracked fund currently holding it with its weight, market value, and an approximate clean price (market value ÷ par balance × 100).
- **SEC prospectus fallback**: when no tracked fund currently holds an issuer's bonds, falls back to searching the issuer's own 424B2/424B3/424B5/FWP prospectus filings and regex-extracting "X.XX% Notes due YYYY" terms from the cover page — labeled clearly as terms at issuance, not live pricing, with a link to the source filing. Filings older than ~12 years and bonds whose parsed maturity has already passed are excluded.
- **Credit rating mentions**: since NRSRO Rule 17g-7 disclosures (the only free ratings-history source) only cover a rolling 12–24 month window and aren't reliably scriptable, ratings history instead comes from full-text-searching the issuer's own 8-K/10-K/10-Q filings for rating-action language, requiring a named agency (Moody's/S&P/Fitch/DBRS/etc.) and an action word (downgraded/upgraded/affirmed/etc.) in the same sentence to filter out unrelated uses of "upgraded". Shown as excerpts with filing date and a link to the source filing.

### Backend
- `GET /api/bonds/search?q=` — aggregates matching bonds across the tracked bond ETF universe by CUSIP, falling back to prospectus search.
- `GET /api/bonds/ratings-mentions/{ticker}` — rating-action excerpts mined from the issuer's own EDGAR filings.
- `_parse_nport_xml` (existing, shared with Fund Holdings Explorer) extended to capture each debt holding's `debtSec` schedule (maturity, coupon type/rate, default flag, par balance).
- `_load_mf_ticker_map`, `_series_latest_nport`, `_fetch_bond_fund_holdings`, `_search_bond_prospectus` — new EDGAR plumbing described above.

### Files changed
- `backend/main.py` — Corporate Bond Research section (search, prospectus fallback, ratings mentions); debt fields added to `_parse_nport_xml`
- `frontend/src/components/CorporateBonds.jsx` — new component
- `frontend/src/App.jsx` — import, nav item under Research, route

---

## 2026-09-12 — Volume Profile Overlay

New chart indicator toggle: a 20-period average volume line on the volume histogram, with bars whose volume exceeds 2x that average lit up in full-brightness green/red instead of the default faded shade — the "is this move backed by real volume" signal from the product roadmap's chart-enhancements section.

### New
- **VOL** toggle in the Chart tab's indicator toolbar (alongside SMA/BB/RSI/MACD). Adds a thin amber line tracking the 20-period rolling average volume, drawn on the same price scale as the volume histogram.
- Volume bars where `volume > 2 × 20-period average` render at full opacity (up = `#10b981`, down = `#ef4444`) instead of the normal ~33% opacity, so surges are visually obvious at a glance without a separate sub-pane.

### Files changed
- `frontend/src/components/ChartModal.jsx` — `calcAvgVolume` helper, `volavg` indicator flag, volume-series color logic, avg-volume `LineSeries`, toolbar button
- `frontend/src/components/UserGuide.jsx` — VOL row added to the Technical Indicators table
- `PRODUCT_ENHANCEMENTS.md` — refreshed to reflect current app state; Volume Profile moved from "remaining gaps" to shipped

---

## 2026-08-17 — Net Market Exposure

New Portfolio page rolling Stocks, Options, and CPPI into one beta-adjusted "how much market risk am I carrying right now" number — previously the app had five separate risk tools (Portfolio Risk, Stress Test, Merger Risk Matrix, SPAC Risk Matrix, CPPI) that never talked to each other, so there was no single aggregate view for someone running multiple strategies at once.

### New
- **Net Exposure** under Portfolio → Net Exposure. Shows total capital deployed, net beta-adjusted market exposure ($ and % of capital — over 100% means effectively levered to the market), a composition bar, and a per-sleeve breakdown table.
- Stocks sleeve reuses the existing Portfolio Risk beta calc. Options sleeve computes delta via Black-Scholes from strike/expiry/IV (yfinance doesn't reliably supply live Greeks), converts to share-equivalent exposure, and beta-weights it by the underlying. CPPI sleeve uses the active strategy's live risky-sleeve value, beta-weighted by its risky asset.
- Merger Arb and SPAC capital is shown as separate "event-driven" sleeves, deliberately excluded from the beta sum — their risk is deal completion / trust redemption, not market direction, so folding them into a beta number would misrepresent what they actually expose you to.
- Stock-only VaR (95%/99%) carried through from the existing Portfolio Risk calc, labeled clearly as stocks-only rather than a fabricated unified figure (true cross-strategy VaR needs a correlation matrix this doesn't model).

### Fixed
- `/api/portfolio/risk` (existing Portfolio Risk tab) was crashing outright for portfolios containing a symbol with no usable 1-year price history (delisted tickers, non-equity tickers like `XAUUSD:CUR`, etc.) — `closes[sym].dropna().iloc[-1]` threw an out-of-bounds error instead of skipping the symbol. Also fixed `pct_change().dropna()` using `how="any"` across *all* holdings, which meant a single gappy symbol among many could wipe out nearly every row before returns were even computed. Both endpoints (Portfolio Risk and the new Net Exposure) share this calc and are fixed by the same change.
- Same function could also return NaN floats (e.g. `beta` from a symbol with fewer than 2 overlapping trading days vs. SPY), which crashed JSON serialization outright. Now sanitized to `null`, and NaN betas are excluded from the portfolio-beta sum instead of poisoning it.

### Backend
- `GET /api/portfolio/net-exposure` (new, 2-min cache) — aggregates the stocks risk calc, a new Black-Scholes options delta helper (`_bs_delta`, `_net_exposure_options_sleeve`), the active CPPI strategy, and the existing Merger Arb / SPAC position summaries.
- `_compute_portfolio_risk` (existing) — fixed empty-series crash, `dropna(how="all")`, NaN-safe beta, and a new `_sanitize_nan` recursive cleanup before caching/returning.

### Files changed
- `backend/main.py` — `_bs_delta`, `_norm_cdf`, `_net_exposure_options_sleeve`, `_sanitize_nan`, `GET /api/portfolio/net-exposure`; bug fixes in `_compute_portfolio_risk`
- `frontend/src/components/NetExposure.jsx` — new component
- `frontend/src/App.jsx` — import, nav item under Portfolio, route
- `frontend/src/components/UserGuide.jsx` — new "Net Exposure" section

---

## 2026-08-16 — Home Dashboard & Command Palette

Two navigation/UX additions: a landing dashboard that aggregates your account state, and a ⌘K command palette to jump to any of the app's 90+ tools instantly. Neither existed before — the app opened straight into Markets → Overview with no cross-cutting summary, and there was no way to jump between tabs other than scrolling the sidebar.

### New
- **Home dashboard**, pinned above the sidebar groups and now the default landing tab. Shows: portfolio value, day P&L, and total P&L; a market pulse strip (SPY/QQQ/DIA + VIX with a Low/Elevated/High label); today's biggest portfolio movers; watchlist gainers/losers; earnings reporting in the next 7 days (portfolio + watchlist); active price alerts; and a "Recently Visited" row of your most-used tabs. Every section links out to the relevant full tab.
- **Command palette** (⌘K / Ctrl+K, or the Search button in the header). Fuzzy-searches all nav items by label or group, ranks exact/prefix/substring matches, supports ↑/↓/Enter/Escape, and shows recently-visited tabs when the query is empty.
- Recently-visited tracking: every tab navigation (sidebar or palette) is recorded to `localStorage`, deduped, capped at 8, and surfaced in both Home and the palette's empty-query state.

### Backend
- `GET /api/home/summary` (new) — one aggregator call: portfolio total/day P&L and top day movers (parallel fast_info fetch per position, no fundamentals), plus SPY/QQQ/DIA/VIX performance via the existing `_fetch_perf_one` helper. Everything else on Home (watchlist quotes, earnings, alerts) reuses state the app already fetches — no duplicate endpoints.

### Files changed
- `backend/main.py` — added `_fetch_day_quote`, `GET /api/home/summary`
- `frontend/src/components/HomeDashboard.jsx` — new component
- `frontend/src/components/CommandPalette.jsx` — new component
- `frontend/src/App.jsx` — `FLAT_NAV_ITEMS`/`NAV_INDEX` (flattened, searchable nav index), pinned Home sidebar button, `navigate()` wrapper with recents tracking, global ⌘K/Ctrl+K listener, default tab changed to `home`
- `frontend/src/components/Header.jsx` — Search button (`onOpenSearch` prop)
- `frontend/src/components/UserGuide.jsx` — new "Home & Quick Search" section

---

## 2026-08-14 — CPPI Allocator

New Portfolio page: Constant Proportion Portfolio Insurance — a systematic strategy that dynamically rebalances between a risky asset and a safe asset so the portfolio is designed to never fall below a floor value, with a live dashboard and a standalone historical backtest.

### New
- **CPPI Allocator** under Portfolio → CPPI Allocator. Configure a risky asset symbol, initial capital, floor % (protected portion of capital), multiplier, safe-asset annual yield, and a rebalance drift band.
- Live dashboard: portfolio value, floor (grows at the safe rate), cushion, target vs. actual risky exposure, drift, and a specific buy/sell recommendation once drift exceeds the band. "Rebalance Now" executes the trade and logs it.
- Rebalance log with every allocation event (including the initial split), price, portfolio value, floor, and trade size at that point.
- **Backtest CPPI** panel: simulates the strategy over 6M-5Y of historical data for any symbol, rebalancing whenever simulated drift exceeds the band, and charts CPPI equity vs. buy & hold vs. the floor line. Reports total return, alpha, max drawdown (both series), rebalance count, and whether the floor was ever breached by an overnight gap (multiplier/gap risk).
- Single active strategy at a time — starting a new one replaces the current one; "Reset strategy…" clears it.

### Backend
- New tables `cppi_strategy` (one active strategy) and `cppi_rebalance_log` (full history) in `backend/database.py`.
- `GET /api/cppi` — active strategy config + live computed state (fetches current price, computes cushion/target exposure/drift) + rebalance log.
- `POST /api/cppi` — start a strategy (replaces any existing one); computes the initial split from the CPPI formula.
- `POST /api/cppi/rebalance` — recomputes target exposure at the current price and executes/logs the rebalance.
- `DELETE /api/cppi` — clears the strategy and its log.
- `POST /api/cppi/backtest` — stateless historical simulation (day-by-day CPPI mechanics with a growing floor and band-triggered rebalancing) vs. a buy & hold benchmark.

### Files changed
- `backend/database.py` — added `CppiStrategy`, `CppiRebalanceLog` models + migrate_db entries
- `backend/main.py` — added CPPI section: config/state helpers, `GET/POST/DELETE /api/cppi`, `POST /api/cppi/rebalance`, `POST /api/cppi/backtest`
- `frontend/src/components/CppiAllocator.jsx` — new component (setup form, live dashboard, allocation bars, rebalance log, backtest chart)
- `frontend/src/App.jsx` — import, nav item under Portfolio, route
- `frontend/src/components/UserGuide.jsx` — new CPPI Allocator section + updated Portfolio group summary

---

## 2026-08-06 — IPO & Lockup Calendar: now live from EDGAR

Replaced the hand-maintained static IPO list with a live SEC EDGAR feed — the list was frozen at whatever was last hand-entered and would go stale silently.

### New
- **Lockup tracker** now built from 424B4 (final prospectus) filings instead of a static list. Lockup date computed from filing date + the standard 180-day term.
- **"IPO Price" → "Day-1 Open"** — now the real first-trading-day open price fetched from Yahoo Finance (a proxy for the underwriting offer price, which isn't exposed in EDGAR's search metadata), replacing hand-entered values.
- **New "Upcoming — Filed, Not Yet Priced" panel** from S-1 registrations (last 60 days) — the forward-looking pipeline the old static list never had.
- SPACs excluded from both feeds via SIC code 6770 ("Blank Checks") plus a name-pattern fallback (`ACQUISITION CORP`, `BLANK CHECK`) — they're covered by the dedicated SPACs module.
- Sector labels derived from each filing's SIC code via a small range-to-sector mapping (`_sic_to_sector`).

### Backend
- `GET /api/market/ipo-calendar` — now live-sourced (424B4 scan + reference-price enrichment) instead of iterating a hardcoded list. Same response shape, so no breaking change for callers.
- `GET /api/market/ipo-pipeline` (new) — S-1 scan, deduped by CIK (keeps latest amendment).

### Files changed
- `backend/main.py` — replaced `_IPO_LIST` + `ipo_calendar()`; added `_edgar_ipo_scan`, `_sic_to_sector`, `_is_likely_spac`, `_fetch_ipo_reference_price`, `ipo_pipeline()`
- `frontend/src/components/IpoCalendar.jsx` — new pipeline panel, relabeled Day-1 Open column, updated explainer copy
- `frontend/src/components/UserGuide.jsx` — updated IPO & Lockup Calendar section + changelog entry

---

## 2026-08-06 — Reddit Trending Stocks

New Markets page: most-mentioned tickers across finance subreddits.

### New
- **Reddit Trending** under Markets → Reddit Trending. Direct Reddit scraping is blocked (403 even with Chrome TLS impersonation, same technique used elsewhere in the app) — sourced instead from ApeWisdom, a free, unauthenticated API aggregating mention counts and upvotes across r/wallstreetbets and other finance subreddits.
- Surfaces mention volume and 24h rank/mention momentum ("Rising Attention" / "Cooling Attention"), not bullish/bearish sentiment — the data source has no sentiment classification, so this is labeled honestly as attention momentum rather than a long/short call.
- Filter by subreddit source, sortable table, live price + 5D change per ticker.

### Backend
- `GET /api/reddit/trending` — paginated ApeWisdom fetch, rank/mention delta computation, live quote enrichment via `_fetch_opp_quote`. 30-minute cache.

### Bug fix
- `_fetch_opp_quote` (shared with the Merger Opportunity Scanner) could return a NaN price for thin/sparse-data tickers, which crashed FastAPI's JSON response encoder (`ValueError: Out of range float values are not JSON compliant: nan`). Reddit's noisier, more speculative ticker universe surfaced it. The bug was masked in ad-hoc testing because Python's `json.dumps` (used by the SQLite cache layer) silently allows NaN by default, so a broken result could get cached successfully and only fail on the stricter FastAPI response encoder on a later request — caught via `TestClient`, which exercises the full response-serialization path that a raw function call skips. Fixed with explicit `math.isfinite` guards; removed a near-duplicate helper (`_fetch_activist_quote`) in favor of the shared, now-fixed one.

### Files changed
- `backend/main.py` — `/api/reddit/trending` endpoint; `_fetch_opp_quote` NaN fix; consolidated `_fetch_activist_quote` into `_fetch_opp_quote`
- `frontend/src/components/RedditTrending.jsx` (new)
- `frontend/src/App.jsx` — new `reddittrending` tab under Markets
- `frontend/src/components/UserGuide.jsx` — new Reddit Trending section + changelog entry

---

## 2026-08-06 — Activist Tracker (13D/13G)

New Research page: scans EDGAR for Schedule 13D and 13G beneficial-ownership filings — the disclosure required whenever an investor crosses 5% ownership of a public company.

### New
- **Activist Tracker** under Research → Activist Tracker. 13D signals possible activist/control intent and is far lower-volume/higher-signal than 13G, which is dominated by routine index-fund threshold crossings — defaults to 13D-only.
- Parses both the subject company *and* the reporting person/fund from EDGAR's combined `display_names` field (`[0]` = subject, `[1]` = filer) — the first feature in the app to use the filer half of that field.
- "New filings only" toggle isolates fresh 5%+ stakes from amendments (13D/A, 13G/A, which reflect changes to an existing position). Search by ticker, company, or filer name — e.g. search a known activist fund to see its recent activity across companies.
- Live price + 5-day change per filing.

### Backend
- `GET /api/activist/tracker` — EDGAR scan across SCHEDULE 13D and SCHEDULE 13G (30-day window, 4h cache), live quote enrichment.

### Files changed
- `backend/main.py` — `/api/activist/tracker` endpoint
- `frontend/src/components/ActivistTracker.jsx` (new)
- `frontend/src/App.jsx` — new `activisttracker` tab under Research
- `frontend/src/components/UserGuide.jsx` — new Activist Tracker section + changelog entry

---

## 2026-08-06 — Merger Arb: Alerts

New Alerts page for Merger Arb, mirroring SPAC Alerts. Merger Arb's sidebar group is now 7 items.

### New
- **Alerts** — merger-arb-specific alert rules, separate from the general Smart Alerts since these read spread, days-to-close, and status directly from tracked deals rather than price history.
- Three alert types: **Days to Close Threshold** (fires on overdue too), **Spread Threshold** (directional — at-or-above or at-or-below a % vs. live spread), **Status Reached** (fires when a deal's status matches your pick — e.g. "Closing" as the completion catalyst, "Terminated" as the downside one).
- Same on-demand scan pattern as SPAC Alerts and the general Smart Alerts: rules are checked live when you click "Scan," no background polling, no dedup/already-seen tracking.

### Backend
- `MergerAlertRule` model (`merger_alert_rules` table): deal_id, alert_type, params JSON, active flag (soft-delete).
- `GET/POST/DELETE /api/merger/alerts` + `POST /api/merger/alerts/scan` — evaluates each active rule against `_enrich_deal` output for its linked deal.

### Files changed
- `backend/database.py` — `MergerAlertRule` model + migration
- `backend/main.py` — `/api/merger/alerts` endpoints + `_check_merger_alert`
- `frontend/src/components/MergerAlerts.jsx` (new)
- `frontend/src/App.jsx` — new `mergeralerts` tab route
- `frontend/src/components/UserGuide.jsx` — new Alerts section + changelog entry

---

## 2026-08-06 — SPACs: Overview (launching pad)

### New
- **Overview** — new first item in the SPACs sidebar group, mirroring Merger Arb's Overview hub.
- **Tracked SPACs** — every tracked SPAC sorted by soonest redemption deadline. Click a row to jump into the Deal Analyzer with that SPAC preloaded; click "Tracker" to jump to the Tracker, scrolled to and briefly highlighting that row.
- **Upcoming — Newly Filed, Not Yet Tracked** — the most recent untracked filings from the Discovery feed, with quick-add (reuses the shared `SpacFormModal`) and a link through to full Discovery.
- Cross-tab drill-in: `App.jsx` now lifts a `spacFocusId` + `goToSpac(tabId, spacId)` helper, matching the `mergerFocusDealId`/`goToMerger` pattern already used by Merger Arb. `SpacTracker` and `SpacDealAnalyzer` accept a `focusDealId` prop.

### Backend
- None — composes the existing `/api/spac/deals` and `/api/spac/discovery` responses client-side.

### Files changed
- `frontend/src/components/SpacOverview.jsx` (new)
- `frontend/src/App.jsx` — `spacoverview` nav item + tab route, lifted focus-SPAC state
- `frontend/src/components/SpacTracker.jsx` — accepts `focusDealId`/`onFocusConsumed`; scrolls to and highlights the row
- `frontend/src/components/SpacDealAnalyzer.jsx` — accepts `focusDealId`/`onFocusConsumed` to auto-select a SPAC
- `frontend/src/components/UserGuide.jsx` — new Overview section + changelog entry

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
