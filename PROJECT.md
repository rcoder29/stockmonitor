# Stock Monitor — Project Journal

## Goal
Build a web application to monitor a personal watchlist of securities. The app should:
- Display live price movements and key financial metrics
- Pull market data from Yahoo Finance at a configurable refresh frequency
- Persist the watchlist between sessions
- Show fundamental and financial ratios on demand

---

## Session 1 — 2026-04-30

### Decisions Made

#### Stack Choice
| Layer | Choice | Why |
|---|---|---|
| Backend | Python + FastAPI | Lightweight, async-ready, pairs naturally with yfinance |
| Market data | yfinance | Free, no API key required, covers price + fundamentals |
| Frontend | React 18 + Vite | Fast dev server, component model suits a live monitor |
| Styling | Tailwind CSS v3 | Utility-first, easy dark theme, no CSS files to maintain |
| Font | JetBrains Mono | Monospace improves number readability in a financial grid |
| Persistence | localStorage | Simple, zero-dependency, sufficient for a personal tool |

**Trade-off noted:** yfinance is unofficial (scrapes Yahoo Finance) and data carries a ~15-min delay for free users. Acceptable for a personal monitor; would swap to a paid provider (e.g. Polygon.io, Alpaca) for real-time needs.

#### Architecture
- Vite dev proxy routes `/api/*` → FastAPI at `localhost:8000` — avoids CORS friction in development
- Fundamentals (P/E, EPS, etc.) cached server-side for 5 minutes — they're slow to fetch and change infrequently
- Price data fetched via `yfinance.Ticker.fast_info` — faster than full `.info` pull
- Parallel ticker fetching with `ThreadPoolExecutor` (up to 10 workers) to keep latency low for large watchlists

#### UI Design
- Dark terminal theme (inspired by Bloomberg Terminal aesthetics)
- Main table: Symbol, Price, Chg $, Chg %, Day Range, Volume, 52W Range, Mkt Cap
- 52W Range and Day Range show a mini position bar (blue fill showing where price sits in the range)
- Click any row → expandable fundamentals panel: P/E TTM, P/E Fwd, EPS, Div Yield, Beta, P/B, Revenue, Profit Margin, ROE, Debt/Equity
- Price flash animation: row briefly turns green/red when price updates
- Countdown timer next to refresh interval shows seconds to next fetch
- Default watchlist seeds with: AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA

### Files Created
```
stockmonitor/
├── backend/
│   ├── main.py             FastAPI app, fetch logic, 5-min fundamentals cache
│   └── requirements.txt    fastapi, uvicorn, yfinance
└── frontend/
    ├── package.json
    ├── vite.config.js      proxy /api → localhost:8000
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html          loads JetBrains Mono from Google Fonts
    └── src/
        ├── main.jsx
        ├── index.css       @tailwind directives + custom scrollbar
        ├── App.jsx         state management: watchlist, quotes, interval, flash
        ├── utils/format.js price/change/pct/volume/marketCap/ratio formatters
        └── components/
            ├── Header.jsx          add-ticker form, interval buttons, status bar
            ├── StockTable.jsx      main monitor table with expandable rows
            └── FundamentalsPanel.jsx  metric cards shown on row expand
```

### Issues Encountered

#### Issue 1 — npm install SSL failure
**Error:** `UNABLE_TO_VERIFY_LEAF_SIGNATURE` when fetching from registry.npmjs.org  
**Cause:** Corporate or custom CA certificate not trusted by Node's certificate store  
**Fix:**
```bash
npm config set strict-ssl false
npm install
```
**Status:** Pending (user went to sleep before resolving)

### Installed Versions
- yfinance: 1.3.0 (newer than targeted 0.2.x — may need API compatibility check)
- Python: 3.13

---

## Session 2 — 2026-05-06

### Goal
Get the app running end-to-end and smoke-test yfinance 1.3.0 compatibility.

### Interaction 1 — npm install

**Problem:** PowerShell execution policy blocked `npm.ps1`.

**Fix:** Used Git Bash instead of PowerShell:
```bash
cd frontend && npm config set strict-ssl false && npm install
```
**Result:** 130 packages installed successfully.

---

### Interaction 2 — Start servers

**Backend problem:** `uvicorn` not on bash PATH.  
**Fix:** `python -m uvicorn main:app --reload --port 8000`

**Frontend:** `npm run dev` → Vite started at http://localhost:5173

---

### Interaction 3 — Smoke test: SSL error in yfinance

**Curl test:** `GET /api/quotes?symbols=AAPL,MSFT`

**Error:**
```json
[{"symbol":"AAPL","error":"Failed to perform, curl: (60) SSL certificate problem: unable to get local issuer certificate."}]
```

**Root cause:** yfinance 1.3.0 uses `curl_cffi` for HTTP — not Python's stdlib `requests` or `urllib`. Corporate proxy has a self-signed cert. `ssl._create_default_https_context` has no effect on `curl_cffi`.

**Fix:** Pass a `curl_cffi` session with `verify=False` and `impersonate="chrome"` to every `yf.Ticker()` call:
```python
from curl_cffi import requests as curl_requests
_session = curl_requests.Session(verify=False, impersonate="chrome")

ticker = yf.Ticker(sym, session=_session)
```

**Key lesson:** `impersonate="chrome"` is required — without it Yahoo Finance rejects the request. yfinance's own default session uses it.

---

### Interaction 4 — Zombie process issue

**Problem:** Killing the uvicorn `--reload` parent (PID 21912) left the worker child (PID 11792) alive, holding port 8000. `taskkill` reported success but the port stayed in use.

**Diagnosis:**
```
wmic process get processid,parentprocessid,commandline
```
Found orphaned worker: `python.exe -c "from multiprocessing.spawn import spawn_main; spawn_main(parent_pid=21912, ...)"`

**Fix:** Kill child PID directly; restart server without `--reload` going forward.

---

### Interaction 5 — yfinance 1.3.0 fast_info API mismatch

**Error:** `'FastInfo' object has no attribute 'volume'`

**Root cause:** yfinance 1.3.0 renamed several `fast_info` attributes:

| Old (pre-1.3) | New (1.3.0) |
|---|---|
| `volume` | `last_volume` |
| `fifty_two_week_high` | `year_high` |
| `fifty_two_week_low` | `year_low` |

**How found:** `python -c "print([a for a in dir(fi) if not a.startswith('_')])")`

**Fix in `main.py`:**
```python
"volume": _safe_float(fi.last_volume),
"week52High": _safe_float(fi.year_high),
"week52Low": _safe_float(fi.year_low),
```

---

### Interaction 6 — Fundamentals resilience

**Observed:** `ticker.info` in yfinance 1.3.0 raises `'PriceHistory' object has no attribute '_dividends'` when the SSL fallback path is triggered internally.

**Fix:** Wrap `.info` in try/except so price data still returns when fundamentals fail:
```python
try:
    info = yf.Ticker(sym, session=_session).info
    data = { ... }
except Exception as exc:
    logger.warning("Fundamentals fetch failed for %s: %s", sym, exc)
    data = {"name": sym}
```

---

### Result
App fully working. Verified AAPL ($287.51) and MSFT ($413.96) with all fields populated.

---

## Session 3 — 2026-05-06

### Goal
Add a test suite and measure code coverage.

### What was added

**Backend deps:** `pytest`, `pytest-cov`, `httpx`  
**Frontend deps:** `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`

**Files created:**
```
backend/
└── tests/
    ├── __init__.py
    └── test_main.py        20 tests

frontend/
└── src/
    ├── test-setup.js
    ├── utils/format.test.js            21 tests
    └── components/
        ├── Header.test.jsx             12 tests
        ├── StockTable.test.jsx         14 tests
        └── FundamentalsPanel.test.jsx   6 tests
```

`frontend/vite.config.js` — added `test` block (jsdom environment, v8 coverage provider)  
`frontend/package.json` — added `test`, `test:watch`, `test:coverage` scripts

### Issues hit during test writing

**1. Backend `test_fundamentals_failure_still_returns_price`**  
Asserted `q["name"] == "AAPL"` when fundamentals raise. Got `{}` — FastAPI serializes the MagicMock that leaks through as an empty JSON object.  
Fix: loosened to `q["name"] is not None`.

**2. Frontend `renders multiple tickers in watchlist order`**  
Used `getAllByText(/^(AAPL|MSFT)$/)` but the symbol cell renders "MSFT▼" (with expand arrow), so testing-library returned the parent element whose full text content was "MSFT▼".  
Fix: query `tbody tr` rows directly and use `.toMatch(/MSFT/)`.

### Coverage results

| Suite | Tests | Result | Coverage |
|---|---|---|---|
| Backend (`pytest`) | 20 | 20 passed | 95% — `main.py` lines 57–59 missed |
| Frontend (`vitest`) | 59 | 59 passed | 100% on all components + utils |

**Gap:** `App.jsx` at 0% — needs fetch mocking + fake timers to test.

### Test commands
```bash
# Backend
cd backend && python -m pytest tests/ -v
cd backend && python -m pytest tests/ --cov=main --cov-report=term-missing

# Frontend
cd frontend && npm test
cd frontend && npm run test:coverage
```

---

## Current State

**Backend** (`http://localhost:8000`): FastAPI + yfinance 1.3.0, returns live price + fundamentals  
**Frontend** (`http://localhost:5173`): React + Vite + Tailwind dark theme  
**Tests:** 79 total (20 backend + 59 frontend), all passing

### How to start
```bash
# Terminal 1
cd "C:/Raghu Ravuri/claude/stockmonitor/backend"
python -m uvicorn main:app --port 8000

# Terminal 2
cd "C:/Raghu Ravuri/claude/stockmonitor/frontend"
npm run dev
```

---

## Learnings & Notes

- **yfinance 1.3.0 uses curl_cffi, not requests:** `ssl._create_default_https_context` has no effect. Must pass `curl_cffi.requests.Session(verify=False, impersonate="chrome")` to `yf.Ticker()`. The `impersonate="chrome"` is mandatory — Yahoo Finance rejects plain curl user agents.
- **yfinance 1.3.0 fast_info renames:** `volume` → `last_volume`, `fifty_two_week_high/low` → `year_high/year_low`. Always introspect with `dir(fi)` after a version upgrade.
- **yfinance 1.3.0 info bug:** `.info` can raise `'PriceHistory' object has no attribute '_dividends'` when the SSL fallback path is triggered internally. Wrap in try/except.
- **YfData singleton:** yfinance uses a module-level singleton for its HTTP session. Passing `session=` to `yf.Ticker()` updates the singleton's session — but only if `--reload` isn't holding a stale worker process.
- **uvicorn --reload zombie workers:** Killing the reload parent leaves child workers alive holding the port. Use `wmic process get processid,parentprocessid,commandline` to find orphaned workers. Prefer running without `--reload` to avoid this.
- **Windows + Node PowerShell policy:** PowerShell blocks `npm.ps1` by default. Use Git Bash or the Bash tool for all npm commands.
- **SSL on corporate networks:** Node and curl_cffi each maintain independent certificate bundles. Both need separate fixes (`npm config set strict-ssl false` for npm; `verify=False` in curl_cffi session for yfinance).
- **Testing-library text matching:** `getAllByText(regex)` matches against the full `textContent` of the returned element, including child element text. Use `document.querySelectorAll` + `.toMatch()` when the element contains mixed text nodes and child spans.
- **MagicMock + FastAPI serialization:** FastAPI serializes unknown types as `{}`. A MagicMock leaking into a response dict will silently appear as an empty object in JSON — not a serialization error.
- **yfinance rate limits:** Fetching `.info` for many tickers simultaneously can trigger Yahoo rate limiting. The 5-min server-side fundamentals cache and `ThreadPoolExecutor` cap mitigate this.
