# Stock Monitor — Architecture

## System Overview

```mermaid
flowchart TD
    Browser["Browser (React 18 + Vite)"]

    subgraph Frontend["Frontend — localhost:5173"]
        App["App.jsx\n(routing, WS, polling)"]
        Components["30+ Components\n(Watchlist, Heatmap, Portfolio, Research, Trading, AI)"]
        ChartModal["ChartModal.jsx\n(11-tab chart overlay)"]
        TLCharts["TradingView\nLightweight Charts v5"]
        App --> Components
        App --> ChartModal
        ChartModal --> TLCharts
    end

    subgraph Backend["Backend — localhost:8000 (FastAPI + Uvicorn)"]
        API["FastAPI app\nmain.py ~5500 lines"]
        WS["WebSocket\n/ws/prices"]
        SSE["SSE endpoints\n/api/chat\n/api/advisor\n/api/trade-ideas"]
        Cache["SQLite cache\ncache_get / cache_set"]
        DB["SQLite DB\nstockmonitor.db"]
        API --> WS
        API --> SSE
        API --> Cache
        Cache --> DB
        API --> DB
    end

    subgraph ExternalAPIs["External Data Sources"]
        YFinance["yfinance 1.3\n(curl_cffi, impersonate=chrome)\nQuotes, history, fundamentals,\noptions, fund holdings"]
        YahooSearch["Yahoo Finance\nsearch API\n/v1/finance/search"]
        SEC["SEC EDGAR\n/submissions API\nEarnings 8-K filings"]
        Anthropic["Anthropic API\nclaude-sonnet-4-6\nChat, sentiment, trade ideas,\nearnings summaries, screener NLP"]
    end

    Browser -->|HTTP + WebSocket| Frontend
    Frontend -->|REST /api/*| Backend
    Frontend -->|WebSocket /ws/prices| Backend
    Frontend -->|SSE /api/chat| Backend
    Backend --> YFinance
    Backend --> YahooSearch
    Backend --> SEC
    Backend --> Anthropic
```

## Data Flow — Live Price Feed

```mermaid
sequenceDiagram
    participant B as Browser
    participant F as React (App.jsx)
    participant WS as FastAPI WebSocket
    participant YF as yfinance

    F->>WS: connect /ws/prices?symbols=AAPL,MSFT,...
    loop every 5 seconds
        WS->>YF: fast_info.last_price (parallel)
        YF-->>WS: prices
        WS-->>F: JSON {AAPL: 195.2, MSFT: 421.0, ...}
        F->>F: update quotes state, flash animation
    end
    B-->>F: add/remove symbol
    F->>WS: reconnect with updated symbols list
```

## Data Flow — Index / ETF Heatmap

```mermaid
sequenceDiagram
    participant UI as IndexHeatmap.jsx
    participant API as FastAPI
    participant YF as yfinance
    participant Cache as SQLite Cache

    UI->>API: GET /api/index-constituents?index=DOW30
    API->>Cache: cache_get("idx:DOW30")
    alt cache hit (< 15 min)
        Cache-->>API: cached JSON
    else cache miss
        API->>YF: Ticker(sym).history() × N parallel
        API->>YF: Ticker(sym).fast_info.market_cap × N parallel
        YF-->>API: perf data + market caps
        API->>API: compute actualWeight = cap/total_cap*100
        API->>API: wtContribution = actualWeight * 1d_return / 100
        API->>Cache: cache_set("idx:DOW30", result, 15min)
        Cache-->>API: ok
    end
    API-->>UI: [{symbol, 1d, actualWeight, wtContribution, ...}]
    UI->>UI: render tiles sized by actualWeight
    UI->>UI: colour by 1D return (red/green)
    UI->>UI: summary bar: Σ(weight×1d)/100 = index return
```

## Data Flow — AI Streaming (Chat / Trade Ideas)

```mermaid
sequenceDiagram
    participant UI as AiBot.jsx
    participant API as FastAPI SSE
    participant Claude as Anthropic API

    UI->>API: POST /api/chat {messages:[...]}
    API->>Claude: stream=True request
    loop tokens
        Claude-->>API: token chunk
        API-->>UI: data: {"delta": "..."}\n\n
        UI->>UI: append to displayed message
    end
    Claude-->>API: stop_reason: end_turn
    API-->>UI: data: [DONE]
```

## Component Map (by Navigation Group)

```
Markets
├── MarketSummary.jsx         Overview: indices, sectors, Mag7, movers, news
├── MarketRecommendations.jsx Analyst picks + AI Growth Watch List
├── MarketBreadth.jsx         A/D ratio, MA breadth, VIX, put/call
├── IndexHeatmap.jsx          Constituent heatmap with dynamic ETF search
├── SectorDashboard.jsx       Sector rotation table + heatmap
├── SectorMomentum.jsx        Sector momentum ranker with acceleration signals
├── MacroCalendar.jsx         FOMC, CPI, PPI, PCE, NFP, GDP calendar
└── YieldCurve.jsx            Treasury curve + DXY

Watchlist
├── StockTable.jsx            Live watchlist with flash animations
├── PriceTargets.jsx          Personal price targets with progress bars
├── RichEarningsCalendar.jsx  Earnings+ (expected move, beat rate, drift)
├── NewsSentiment.jsx         AI news sentiment scoring (Claude)
└── SmartAlerts.jsx           Condition scanner (volume, RSI, crossovers)

Portfolio
├── PortfolioTracker.jsx      11 views: heatmap, risk, optimizer, correlation
├── OptionsTracker.jsx        Options P&L with live Greeks
└── TradeJournal.jsx          Trade log with P&L matching + win rate

Research
├── Screener.jsx              Technical/fundamental/NLP screener
├── TechnicalSignals.jsx      Multi-timeframe signals dashboard
├── StockComparison.jsx       Normalised return chart compare
├── FundamentalComparison.jsx 21-metric side-by-side comparison
├── Backtester.jsx            MA crossover / RSI / Bollinger backtest
├── DcfCalculator.jsx         DCF intrinsic value calculator
└── UnusualOptions.jsx        Unusual options activity scanner

Trading
├── DayTrader.jsx             Trading plan + playbooks + intraday scanner
├── TradeIdeas.jsx            AI-generated trade setups (Claude, SSE)
└── PositionSizer.jsx         Fixed fractional / ATR / Half-Kelly sizer

AI Tools
├── AiBot.jsx                 Streaming Claude chat (SSE)
└── FinancialAdvisor.jsx      AI portfolio strategy (SSE)

Shared
└── ChartModal.jsx            11-tab overlay (chart, fundamentals, news,
                              earnings, options, strategies, insider,
                              analyst, institutional, sentiment, SEC filings)
```

## Caching Architecture

```mermaid
flowchart LR
    req["Incoming request"] --> cg["cache_get(key, ttl)"]
    cg -->|hit| resp["Return cached JSON"]
    cg -->|miss| fetch["Fetch from external API"]
    fetch --> cs["cache_set(key, data)"]
    cs --> resp2["Return fresh JSON"]

    subgraph SQLite["stockmonitor.db — cache table"]
        rows["key (str) | value (JSON) | fetched_at (datetime)"]
    end
    cg -.->|read| SQLite
    cs -.->|write| SQLite
```

| Cache key prefix | TTL | Data |
|---|---|---|
| `fund:` | 2 hours | Fundamentals (PE, EPS, beta, …) |
| `chart:` | 5 min (1d/5d) / 1 hr (1mo+) | OHLCV bars |
| `news:` | 30 min | Headlines |
| `breadth:` | 30 min | A/D ratio, VIX, put/call |
| `rates:` | 30 min | Treasury yields, DXY |
| `earn:` | 4 hours | Earnings calendar |
| `opts:` | 5 min | Options chains |
| `idx:` | 15 min | Index/ETF constituents |
| `etf:` | 15 min | Dynamic ETF holdings |
| `uopts:` | 30 min | Unusual options |
| `filing:` | 12 hours | SEC 8-K filings |
| `earnsumm:` | 24 hours | AI earnings call summary |
| `secmom:` | 30 min | Sector momentum scores |
| `sent:` | 2 hours | News sentiment scores |

## Key Backend Patterns

**Parallel fetching with ThreadPoolExecutor**
```python
with ThreadPoolExecutor(max_workers=20) as ex:
    futures = {ex.submit(_fetch_perf_one, sym): sym for sym in symbols}
    for f in as_completed(futures):
        results[futures[f]] = f.result()
```
Used for: index constituent perf + market caps, market performance, signals.

**WebSocket price broadcaster**
```python
@app.websocket("/ws/prices")
async def price_feed(ws: WebSocket, symbols: str):
    await ws.accept()
    while True:
        prices = {s: fast_info_price(s) for s in symbol_list}
        await ws.send_json(prices)
        await asyncio.sleep(5)
```

**SSE streaming for AI endpoints**
```python
async def stream_claude(messages):
    with anthropic_client.messages.stream(...) as s:
        for text in s.text_stream:
            yield f"data: {json.dumps({'delta': text})}\n\n"

return StreamingResponse(stream_claude(messages), media_type="text/event-stream")
```
