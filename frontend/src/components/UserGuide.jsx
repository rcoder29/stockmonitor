import { useState, useMemo, useRef, useEffect } from 'react'

// ── Content definition ────────────────────────────────────────────────────────

const GUIDE = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: '◆',
    blocks: [
      { type: 'p', text: 'Stock Monitor is a real-time market intelligence platform for retail investors and active traders. It combines live price data, technical analysis, portfolio tracking, and AI-powered research into a single dark-themed dashboard.' },
      { type: 'h3', text: 'First-Time Setup' },
      { type: 'steps', items: [
        'Add tickers to your watchlist using the TICKER input in the top header bar, then click "+ Add" (or press Enter).',
        'Navigate to Portfolio → Portfolio to log your positions so the app can track P&L and exposure.',
        'Set price alerts by clicking the bell icon (🔔) on any watchlist row.',
        'Allow browser notifications when prompted — alerts fire even when you switch tabs.',
      ]},
      { type: 'h3', text: 'Navigation' },
      { type: 'p', text: 'The left sidebar organises all features into 7 groups. Click a group header to collapse or expand it. Click any item to load that view. On mobile, tap ☰ to open the sidebar drawer.' },
      { type: 'table', headers: ['Group', 'What\'s Inside'], rows: [
        ['Market', 'Overview, Recommendations, Breadth, Index Heatmap, Macro Calendar, Yield Curve'],
        ['Watchlist', 'Watchlist, Price Targets, Earnings+, Sentiment'],
        ['Portfolio', 'Portfolio, Options P&L, Trade Journal'],
        ['Research', 'Screener, Signals, Chart Compare, Fundamentals, Backtester, DCF Valuation, Unusual Options'],
        ['Sectors', 'Sector Rotation, Momentum'],
        ['Trading', 'Day Trader, Trade Ideas, Smart Alerts, Position Sizer'],
        ['AI Tools', 'AI Chat, Financial Advisor'],
      ]},
      { type: 'h3', text: 'Live Price Feed' },
      { type: 'p', text: 'Prices update via WebSocket during market hours. The green dot in the header means the live feed is connected. If it turns grey the app falls back to REST polling at your chosen refresh interval (5s to 5m). Price changes flash green (up) or red (down) in the Watchlist.' },
      { type: 'tip', text: 'Tip: set the refresh interval to 5s during active trading hours and 5m when you\'re monitoring passively to reduce API calls.' },
    ],
  },
  {
    id: 'market',
    title: 'Market',
    icon: '◫',
    blocks: [
      { type: 'h3', text: 'Market Overview' },
      { type: 'p', text: 'A single-page snapshot of market health. Sortable tables show multi-timeframe performance (1D, 5D, 1M, 3M, 6M, 1Y, YTD) for major indices & ETFs, sector ETFs, and the Magnificent 7. Below the tables, top 10 gainers and losers update with each refresh. The right sidebar shows the latest market headlines with external links.' },
      { type: 'bullets', items: [
        'Click any column header to sort ascending / descending.',
        'Click any row to open the full chart modal for that ticker.',
        'Use the ↻ button or set a refresh interval to keep data current.',
      ]},
      { type: 'h3', text: 'Market Recommendations' },
      { type: 'p', text: 'Two sections: AI-powered analyst upgrades/downgrades, and a curated AI Growth Watch List covering the full AI technology stack (Chips, Memory, Networking, Cloud, Models, Applications, and more).' },
      { type: 'bullets', items: [
        'Filter the watch list by AI layer using the pill buttons at the top.',
        'Click any stock row to open its chart modal.',
        'Analyst actions show firm, prior rating, new rating, and price target — click for a detail modal.',
      ]},
      { type: 'h3', text: 'Market Breadth' },
      { type: 'p', text: 'Scans a large-cap universe to measure overall market health beyond just index prices.' },
      { type: 'table', headers: ['Metric', 'What it means'], rows: [
        ['Above 50-day MA %', 'Percentage of stocks trading above their 50-day moving average. Above 70% = broad bull market. Below 30% = broad weakness.'],
        ['Above 200-day MA %', 'Long-term trend. Above 60% = healthy bull market.'],
        ['H/L Ratio', 'New 52-week highs vs lows. Above 0.6 = bullish breadth.'],
        ['A/D Ratio', 'Advances ÷ Declines. Above 1.5 = strong up day, below 0.7 = broad selling.'],
        ['Put/Call Ratio', 'Options market sentiment. Above 1.2 = fear/hedging; below 0.7 = complacency/greed.'],
        ['VIX', 'CBOE Volatility Index. Below 15 = calm, 15–25 = normal, 25–30 = elevated, above 30 = fear.'],
      ]},
      { type: 'p', text: 'The Advance/Decline Line chart shows 60 days of cumulative market momentum. Divergence from index prices is an early warning signal.' },
      { type: 'h3', text: 'Yield Curve & Rates' },
      { type: 'p', text: 'Tracks the US Treasury yield curve and Dollar Index, updated every 30 minutes.' },
      { type: 'bullets', items: [
        'The yield curve chart plots 13-week, 5-year, 10-year, and 30-year yields. A downward-sloping line (inverted) historically precedes recessions.',
        'The 10Y − 13W spread in basis points is the key inversion signal. A red "INVERTED" badge appears when this spread goes negative.',
        'DXY (US Dollar Index): rising dollar typically pressures commodities and international earnings.',
        'The 60-day 10Y sparkline shows the direction of long-term rate pressure.',
      ]},
      { type: 'h3', text: 'Macro Calendar' },
      { type: 'p', text: 'Upcoming high-impact economic events: FOMC decisions, CPI, PPI, PCE, NFP (jobs report), and GDP releases.' },
      { type: 'bullets', items: [
        'Filter by event type using the icon buttons (All, FOMC, CPI, PPI, Jobs, PCE, GDP).',
        'Events within 3 days show a red urgency badge; 4–7 days amber; 8+ days blue.',
        'Past events are greyed out and labelled "Passed".',
      ]},
      { type: 'tip', text: 'Tip: check the Macro Calendar before opening a new position — unexpected CPI or FOMC surprises cause outsized market moves.' },
      { type: 'h3', text: 'Index / ETF Heatmap' },
      { type: 'p', text: 'A constituent-level heatmap and performance table for any index or ETF. Tiles are sized by real-time market-cap weight, coloured by 1-day return, and show the stock\'s actual weight percentage inside the index.' },
      { type: 'h3', text: 'Selecting an Index' },
      { type: 'p', text: 'Two ways to choose what to display:' },
      { type: 'bullets', items: [
        'Quick-access buttons: DIA (Dow 30), QQQ (Nasdaq 100), SPY (S&P Top 100), ARKK (ARK Innovation) — click to load instantly.',
        'Search box: type any ETF or index ticker or name (e.g. "XLK", "SOXX", "GLD", "iShares"). A live dropdown shows matching results with type badges (ETF / INDEX). Select to load its constituent heatmap.',
      ]},
      { type: 'h3', text: 'Heatmap View' },
      { type: 'p', text: 'All constituents are displayed as a single flat grid sorted by weight — the largest position in the index occupies the widest tile in the top-left.' },
      { type: 'table', headers: ['Tile element', 'What it shows'], rows: [
        ['Tile width', 'Proportional to the stock\'s live market-cap weight in the index.'],
        ['Background colour', 'Green shades = positive 1D return; red shades = negative; grey = flat. Deeper colour = larger magnitude.'],
        ['Symbol (top)', 'Ticker symbol in bold.'],
        ['Weight % (middle)', 'Actual index weight derived from live market cap (or fund-reported weight for dynamic ETFs).'],
        ['1D % (bottom)', 'Day-over-day price change percentage.'],
        ['Tooltip (hover)', 'Full name, sector, weight, market cap, price, 1D return, and weighted contribution to the index.'],
      ]},
      { type: 'h3', text: 'Summary Bar' },
      { type: 'p', text: 'Four cards above the heatmap provide a quick read on the whole index:' },
      { type: 'table', headers: ['Card', 'Meaning'], rows: [
        ['Index 1D Return', 'Market-cap-weighted sum of all constituents\' 1D returns — this is what the index itself moved.'],
        ['Advancing / Declining', 'Number of constituents up vs down on the day.'],
        ['Top Contributor', 'The stock adding the most percentage points to the index return (weight × 1D).'],
        ['Top Drag', 'The stock subtracting the most from the index return.'],
      ]},
      { type: 'h3', text: 'Table View' },
      { type: 'p', text: 'Switch to Table for a sortable spreadsheet of all constituents. Columns include: Symbol, Name, Sector, Weight %, Market Cap, Price, 1D%, 1D Contribution, 5D%, 1M%, 3M%, 6M%, 1Y%, YTD%.' },
      { type: 'bullets', items: [
        'Click any column header to sort ascending / descending.',
        '"est" badge next to a weight means live market-cap data could not be fetched and an approximation is shown.',
        '1D Contribution = weight × 1D return / 100 — shows how many basis points each stock contributed to the index.',
        'Click any row to open the full chart modal for that stock.',
      ]},
      { type: 'tip', text: 'Tip: use the Index Heatmap with QQQ or SPY before trading to see which mega-caps are dragging or leading the market. A concentrated red tile on AAPL or NVDA (both >5% weight) can explain broad market weakness even when most stocks are green.' },
    ],
  },
  {
    id: 'watchlist',
    title: 'Watchlist',
    icon: '◎',
    blocks: [
      { type: 'h3', text: 'Managing Your Watchlist' },
      { type: 'p', text: 'The watchlist is the core of the app. All features that reference "your symbols" (Signals, Sentiment, Earnings+, Trade Ideas) draw from it.' },
      { type: 'steps', items: [
        'Add a ticker: type it in the header input and press Enter or click "+ Add".',
        'Remove a ticker: click the × on the right side of any watchlist row.',
        'Create named lists: click "+ New List" to organise symbols into separate watchlists (e.g. "Tech", "Options Plays"). Switch between lists using the list pills above the table.',
        'Delete a list: switch to it and click the × next to its name. The default list cannot be deleted.',
      ]},
      { type: 'h3', text: 'Watchlist Table Columns' },
      { type: 'table', headers: ['Column', 'Description'], rows: [
        ['Price', 'Last trade price. Flashes green on uptick, red on downtick.'],
        ['Chg ($) / Chg (%)', 'Day change in dollars and percentage, colour-coded.'],
        ['Day Range', 'Low–high bar showing where the current price sits within the day\'s range.'],
        ['Volume', 'Today\'s volume in millions.'],
        ['52W Range', 'Bar showing current price position within the 52-week high/low range.'],
        ['Mkt Cap', 'Market capitalisation.'],
        ['Earnings', 'Days until next earnings report (badge turns red when ≤ 3 days).'],
      ]},
      { type: 'p', text: 'Click any row to open the full chart modal for detailed analysis.' },
      { type: 'h3', text: 'Price Alerts' },
      { type: 'p', text: 'Click the 🔔 icon on any watchlist row to open the alert manager for that symbol.' },
      { type: 'bullets', items: [
        'Price alert: fires when the stock crosses above or below a specific price.',
        'Percent change alert: fires when the day\'s move exceeds a % threshold.',
        '52-week break: fires when the price breaks the 52-week high or low.',
        'Volume spike: fires when volume exceeds a multiple of the 20-day average.',
        'Alerts persist in the database and survive page reloads.',
        'Allow browser notifications for alerts to fire even when you\'re on another tab.',
        'Triggered alerts show a toast notification bottom-right and are marked in the alert list.',
      ]},
      { type: 'h3', text: 'Price Targets' },
      { type: 'p', text: 'Set personal price targets with optional deadlines and notes. Found under Watchlist → Price Targets.' },
      { type: 'steps', items: [
        'Fill in the symbol, target price, optional deadline date, and a note (e.g. your trade thesis).',
        'Click "+ Add". The target appears as a card showing current vs target price with a progress bar.',
        'Cards are sorted by distance to target (most urgent first).',
        'A "Target Reached!" badge appears when the current price meets or exceeds your target.',
        'Click ✕ on a card to remove the target.',
      ]},
      { type: 'table', headers: ['Indicator', 'Meaning'], rows: [
        ['▲ Long (green)', 'Target is above current price — bullish thesis.'],
        ['▼ Short (red)', 'Target is below current price — bearish thesis.'],
        ['Days badge red < 7d', 'Deadline approaching imminently.'],
        ['Days badge amber 7–30d', 'Moderate urgency.'],
        ['Passed (grey)', 'Deadline has passed without reaching target.'],
      ]},
      { type: 'h3', text: 'Earnings+' },
      { type: 'p', text: 'An enriched earnings calendar for your watchlist and portfolio symbols, showing historical context beyond just the date.' },
      { type: 'table', headers: ['Column', 'What it tells you'], rows: [
        ['EPS Estimate', 'Consensus analyst EPS estimate for the upcoming quarter.'],
        ['Beat Rate', 'Percentage of past quarters where EPS beat the estimate, with a progress bar.'],
        ['Pre-Drift 5d', 'Average stock return in the 5 days before earnings — shows if the stock typically runs into results.'],
        ['Expected Move ±%', 'Options-implied expected move (ATM straddle ÷ price) — the market\'s priced-in reaction.'],
      ]},
      { type: 'h3', text: 'News Sentiment' },
      { type: 'p', text: 'Click "Analyze Sentiment" to fetch recent headlines for all watchlist symbols and score them with Claude AI.' },
      { type: 'bullets', items: [
        'Each card shows a Bullish / Neutral / Bearish badge, a score from −1 to +1, a one-line AI summary, and the most recent headline.',
        'The score bar is centre-anchored: green extends right (bullish), red extends left (bearish).',
        'Results are cached for 2 hours. Click the button again to refresh.',
      ]},
    ],
  },
  {
    id: 'portfolio',
    title: 'Portfolio',
    icon: '▣',
    blocks: [
      { type: 'h3', text: 'Adding Positions' },
      { type: 'steps', items: [
        'Open Portfolio → Portfolio.',
        'Use the "Add Position" form: enter a ticker, number of shares, and your average cost basis.',
        'Click Add. The position appears in all views immediately.',
        'To remove a position, find it in the Table view and click the × button.',
      ]},
      { type: 'h3', text: 'Portfolio Views' },
      { type: 'p', text: 'Switch between views using the buttons at the top of the Portfolio tab.' },
      { type: 'table', headers: ['View', 'What you see'], rows: [
        ['Heatmap', 'Treemap of positions sized by market value, coloured by day change %. Green = up, red = down. Click any block to open the chart modal.'],
        ['Table', 'Full position table with Symbol, Shares, Avg Cost, Price, Market Value, Unrealised P&L ($/%),  Day P&L, and Portfolio Weight. Click headers to sort. Click "↓ CSV" to download.'],
        ['Equity Curve', 'Your total portfolio value over time vs cost basis. Requires at least two saved daily snapshots (click "Save Snapshot" each day).'],
        ['Exposure', 'Donut charts breaking down your portfolio by sector, market cap size (Mega/Large/Mid/Small), and geographic region. Answers: "am I too concentrated in tech?"'],
        ['Risk', 'Portfolio-level risk metrics: Beta, Concentration (Herfindahl index), Top-3 Weight, VaR 95% 1-day, Sharpe Ratio estimate.'],
        ['Optimizer', 'Efficient Frontier chart — plots the risk/return trade-off and finds the minimum-volatility and maximum-Sharpe portfolios given your current holdings.'],
        ['X-Ray', 'Sector, cap-style, and country exposure donut charts — similar to Exposure but with more granularity.'],
        ['Performance', 'Cumulative return vs SPY and QQQ benchmarks, with alpha and tracking error.'],
        ['Dividends', 'Dividend yield, annual income projection, and payment frequency per position.'],
        ['Correlation', 'Colour-coded pairwise correlation heatmap. Red = highly correlated (concentration risk). Green = diversifying.'],
        ['Rebalancer', 'Enter target weights per position to see how much to buy/sell to reach your target allocation.'],
      ]},
      { type: 'h3', text: 'Risk Metrics Explained' },
      { type: 'table', headers: ['Metric', 'Interpretation'], rows: [
        ['Portfolio Beta', 'Market sensitivity. 1.0 = moves with the market. >1.2 = aggressive, <0.8 = defensive.'],
        ['Herfindahl Index', 'Concentration measure. Below 0.15 = well diversified. Above 0.25 = high concentration.'],
        ['Top-3 Weight', 'If your top 3 positions exceed 60% of the portfolio, a single bad trade can be very damaging.'],
        ['VaR 95% (1-day)', 'Estimated maximum 1-day loss at 95% confidence based on portfolio beta and market volatility.'],
        ['Sharpe Ratio', 'Return per unit of risk. Above 1.0 is good, above 2.0 is excellent.'],
      ]},
      { type: 'h3', text: 'Options P&L' },
      { type: 'p', text: 'Track open options positions with live Greeks and P&L. Found under Portfolio → Options P&L.' },
      { type: 'steps', items: [
        'Add a position: enter Symbol, Type (Call/Put), Strike, Expiry, Quantity (negative for short), and Entry Premium per share.',
        'Click "Refresh P&L" to fetch live mid prices, Delta, Theta, and IV from yfinance.',
        'P&L = (Current Mid − Entry) × Quantity × 100 (one contract = 100 shares).',
        'DTE badge turns red when fewer than 7 days remain — time to decide: close, roll, or let expire.',
      ]},
      { type: 'h3', text: 'Trade Journal' },
      { type: 'p', text: 'Log every trade you execute to track performance over time. Found under Portfolio → Trade Journal.' },
      { type: 'steps', items: [
        'Fill in Symbol, Side (Buy/Sell), Price, Shares, Strategy, Date, and optional Notes.',
        'The journal computes realised P&L by matching buy and sell trades for the same symbol.',
        'Summary cards show total P&L, win rate, total entries, and closed trades.',
        'The by-strategy table breaks down win rate and P&L per strategy so you can see which setups work.',
        'Filter by strategy or search by symbol. Export to CSV with the "↓ CSV" button.',
      ]},
    ],
  },
  {
    id: 'research',
    title: 'Research',
    icon: '⊕',
    blocks: [
      { type: 'h3', text: 'Screener' },
      { type: 'p', text: 'Find stocks matching technical or fundamental criteria across a large-cap universe. Three modes:' },
      { type: 'table', headers: ['Mode', 'How to use'], rows: [
        ['Technical', 'Pick a scan: 52-Week High, Golden Cross, Death Cross, RSI Oversold (<30), RSI Overbought (>70), High Relative Volume. Click Run.'],
        ['Fundamental', 'Pick a preset screen: Quality Growth, Deep Value, Dividend Income, or Momentum + Quality. Click Run.'],
        ['Custom', 'Type a natural-language query ("profitable tech companies with revenue growth over 20%") or add filter rows manually. Claude translates NLP to filters.'],
      ]},
      { type: 'tip', text: 'Tip: Custom mode NLP query examples — "large cap financials with low P/E and high dividend yield", "beaten-down growth stocks with insider buying", "mega cap tech with expanding margins".' },
      { type: 'h3', text: 'Technical Signals' },
      { type: 'p', text: 'Multi-timeframe technical summary for every symbol in your watchlist and portfolio. Found under Research → Signals.' },
      { type: 'p', text: 'Each cell shows three indicators stacked:' },
      { type: 'table', headers: ['Indicator', 'How to read'], rows: [
        ['Trend (▲/▼/◆)', '▲ Bullish, ▼ Bearish, ◆ Neutral — based on price vs moving averages.'],
        ['RSI (14)', 'Green if < 30 (oversold), red if > 70 (overbought), grey if neutral.'],
        ['MACD', 'Arrow up = bullish crossover, arrow down = bearish crossover.'],
        ['BB%', 'Position within Bollinger Bands. Above 80% = overbought, below 20% = oversold.'],
      ]},
      { type: 'p', text: 'Timeframes: 1D (daily), 1W (weekly), 1M (monthly), 3M (quarterly). Use weekly/monthly signals to confirm trade direction before acting on daily signals.' },
      { type: 'h3', text: 'Chart Compare' },
      { type: 'p', text: 'Normalised return chart to compare up to 5 stocks over 1M, 3M, 6M, or 1Y. All lines start at 0% so you can see relative outperformance directly.' },
      { type: 'steps', items: [
        'Type a ticker and press Enter (or click Add) to add a stock.',
        'Add up to 5 stocks — each gets a distinct colour.',
        'Change the period with the buttons at the top.',
        'The table below the chart shows key fundamentals side by side.',
        'Click × next to a ticker to remove it.',
      ]},
      { type: 'h3', text: 'Fundamental Comparison' },
      { type: 'p', text: 'Side-by-side 21-metric fundamental comparison for up to 5 stocks. Enter symbols comma- or space-separated and click Compare.' },
      { type: 'bullets', items: [
        'Green cell = best in class for that metric.',
        'Red cell = worst in class.',
        'For valuation ratios (P/E, P/S, EV/EBITDA, Debt/Equity), lower is better.',
        'For profitability metrics (margins, ROE, ROA), higher is better.',
      ]},
      { type: 'h3', text: 'DCF Valuation' },
      { type: 'p', text: 'Discounted Cash Flow calculator to estimate intrinsic value. Found under Research → DCF Valuation.' },
      { type: 'steps', items: [
        'Enter a ticker and click "Load Data" — EPS, growth rate, and beta pre-fill from yfinance.',
        'Review and adjust inputs: EPS growth rate (5-year), terminal growth rate (default 2.5%), discount rate/WACC (auto-calculated from beta), margin of safety (default 25%), and years.',
        'The intrinsic value and buy-below price update live as you change any input.',
        'The 10-year projection table shows EPS and present value for each year.',
        'Verdict: Undervalued (green) if price < intrinsic − margin; Overvalued (red) if price > intrinsic + 15%; Fairly Valued (amber) otherwise.',
      ]},
      { type: 'tip', text: 'Tip: the DCF is highly sensitive to growth rate assumptions. Run it with a conservative (half the yfinance estimate), base, and optimistic scenario to get a valuation range rather than a single number.' },
      { type: 'h3', text: 'Backtester' },
      { type: 'p', text: 'Test a trading strategy on historical data for any symbol.' },
      { type: 'table', headers: ['Strategy', 'Parameters'], rows: [
        ['MA Crossover', 'Fast and slow MA periods. Buys when fast crosses above slow, sells on cross below.'],
        ['RSI Reversal', 'RSI period, oversold (buy) and overbought (sell) thresholds.'],
        ['Bollinger Bands', 'Period and standard deviation multiplier. Buys at lower band, sells at upper band.'],
      ]},
      { type: 'bullets', items: [
        'Results show: Total Return, Alpha vs Buy & Hold, Max Drawdown, Sharpe Ratio, Win Rate, and number of trades.',
        'The equity curve chart overlays the strategy return vs a simple buy-and-hold benchmark.',
        'The trade log lists every entry and exit with price, value, and P&L.',
      ]},
      { type: 'h3', text: 'Unusual Options Activity' },
      { type: 'p', text: 'Scans options chains for contracts with abnormally high volume relative to open interest — a signal that informed traders may be positioning.' },
      { type: 'bullets', items: [
        'Your watchlist symbols pre-populate the input. Edit or add more symbols (max 10).',
        'Click Scan. The scanner checks the nearest 3 expiries for each symbol.',
        'A contract appears if: Volume ≥ 2× Open Interest, OR Volume ≥ 1,000 on a fresh contract (OI = 0).',
        'Sort by Volume (default), Vol/OI Ratio, or Symbol.',
        'Filter to Calls only or Puts only.',
        'Vol/OI Ratio ≥ 10× is highlighted amber — extremely unusual activity.',
        'ITM contracts (in the money) are shown slightly brighter.',
      ]},
      { type: 'tip', text: 'Tip: unusual call activity on a stock you hold can be a bullish confirmation signal. Unusual put activity may indicate hedging or bearish positioning by informed players.' },
    ],
  },
  {
    id: 'sectors',
    title: 'Sectors',
    icon: '◑',
    blocks: [
      { type: 'h3', text: 'Sector Rotation' },
      { type: 'p', text: 'Performance table and heatmap for 11 major sector ETFs across multiple timeframes.' },
      { type: 'bullets', items: [
        'Select a period: 1D, 1W, 1M, or 3M to see relative performance.',
        'Switch between Table view (sortable, with relative bar charts) and Heatmap view (colour intensity grid).',
        'Sectors with the strongest recent momentum are candidates for rotation into; weakest sectors may be candidates for trimming.',
      ]},
      { type: 'h3', text: 'Sector Momentum' },
      { type: 'p', text: 'Ranks all 11 sectors by a composite momentum score and shows acceleration signals.' },
      { type: 'table', headers: ['Column', 'What it means'], rows: [
        ['Rank', 'Overall momentum rank. #1 = strongest momentum.'],
        ['Returns (1W/1M/3M/6M/YTD)', 'Raw absolute returns or Relative Strength vs SPY depending on mode toggle.'],
        ['Accel', '▲▲ = accelerating strongly, ▲ = accelerating, ▼ = decelerating, ▼▼ = decelerating sharply.'],
        ['Composite Score', 'Weighted combination of all timeframe returns.'],
      ]},
      { type: 'bullets', items: [
        'Toggle between Absolute (raw returns) and vs SPY (relative strength) using the button at top right.',
        'The bar chart below the table shows 1-month performance sorted descending for quick visual ranking.',
        'Top-ranked sectors (#1, #2, #3) are highlighted in gold, silver, and bronze.',
      ]},
      { type: 'tip', text: 'Tip: combine Sector Momentum with the Macro Calendar — rising rate environments tend to favour Financials and Energy; falling rates favour Utilities and REITs.' },
    ],
  },
  {
    id: 'trading',
    title: 'Trading',
    icon: '⚡',
    blocks: [
      { type: 'h3', text: 'Day Trader' },
      { type: 'p', text: 'A full intraday trading dashboard with planning tools, live scanner, and strategy playbooks.' },
      { type: 'h3', text: 'Trading Plan Calculator' },
      { type: 'p', text: 'Fill in your session parameters at the top to generate a personalised trading plan:' },
      { type: 'table', headers: ['Input', 'Purpose'], rows: [
        ['Capital', 'Total account size available for trading today.'],
        ['Daily Target %', 'Your profit target for the session as a % of capital.'],
        ['Max Daily Loss %', 'Your stop-out threshold — stop trading if this is hit.'],
        ['Planned Trades', 'How many setups you plan to take.'],
        ['Stop Loss %', 'Per-trade stop as a % of entry price.'],
        ['Risk/Reward', 'Your minimum acceptable reward per unit of risk (e.g. 2 = 2:1 R:R).'],
      ]},
      { type: 'p', text: 'The plan calculates: capital per trade, dollar target per trade, stop loss dollar amount, win rate needed to reach your target, and how many wins required.' },
      { type: 'h3', text: 'Strategy Playbooks' },
      { type: 'p', text: 'Six pre-defined intraday strategies with full setup criteria, entry/exit rules, and risk notes:' },
      { type: 'bullets', items: [
        'Gap & Go — pre-market gap plays with volume confirmation.',
        'Momentum — continuation trades on high relative volume.',
        'VWAP Reversion — mean-reversion trades around the VWAP line.',
        'Opening Range — breakout/breakdown from the first 15-minute range.',
        'Mean Reversion (Fade) — counter-trend trades on overextended moves.',
        'Scalping — quick in/out on level 2 momentum.',
      ]},
      { type: 'h3', text: 'Live Scanner' },
      { type: 'p', text: 'The candidate table auto-refreshes and shows stocks with significant intraday moves, volume surges, and pre-market gaps. Each row includes a calculated position size based on your trading plan.' },
      { type: 'bullets', items: [
        'Trade alerts sidebar: real-time alerts ranked by severity (SURGE, MOMENTUM, STRENGTH, SELL-OFF, etc.).',
        'Pre-market movers: top gainers and losers before the open with catalyst identification.',
        'News feed: timestamped headlines relevant to top movers.',
        'Click any symbol\'s chart icon to open the full chart modal.',
      ]},
      { type: 'h3', text: 'Trade Ideas' },
      { type: 'p', text: 'Click "Generate Ideas" for Claude AI to analyse your current watchlist and generate specific trade setups with entries, targets, and risk levels.' },
      { type: 'bullets', items: [
        'Ideas are generated based on current quotes and alert data from your watchlist.',
        'Output includes bullish setups (long entries), bearish setups (short/put entries), and key catalysts to watch.',
        'Click Stop at any time to interrupt generation.',
        'Results are not saved — regenerate each session for fresh ideas based on current prices.',
      ]},
      { type: 'tip', text: 'Disclaimer: AI-generated trade ideas are for informational purposes only and are not financial advice. Always apply your own analysis and risk management.' },
      { type: 'h3', text: 'Smart Alerts' },
      { type: 'p', text: 'Condition-based alert rules that you scan on demand. Unlike price alerts (which fire automatically), Smart Alerts require a manual scan click.' },
      { type: 'table', headers: ['Alert Type', 'Triggers when'], rows: [
        ['Volume Spike', 'Today\'s volume exceeds N × the 20-day average (configurable multiplier).'],
        ['Gap Up / Gap Down', 'Today\'s open is N% above/below the prior close.'],
        ['RSI Overbought', 'RSI(14) crosses above 70.'],
        ['RSI Oversold', 'RSI(14) crosses below 30.'],
        ['Golden Cross', '50-day MA crosses above 200-day MA.'],
        ['Death Cross', '50-day MA crosses below 200-day MA.'],
        ['Earnings Proximity', 'Earnings are within N days.'],
      ]},
      { type: 'steps', items: [
        'Add a rule: select symbol, alert type, and set the parameter (e.g. multiplier = 2.5).',
        'Click "Scan" to check all rules against current data.',
        'Triggered alerts appear in the results section with a detail message.',
        'Delete rules you no longer need by clicking × on the rule row.',
      ]},
      { type: 'h3', text: 'Position Sizer' },
      { type: 'p', text: 'Calculates how many shares to buy based on your risk parameters. Found under Trading → Position Sizer.' },
      { type: 'steps', items: [
        'Enter: Symbol, Account Size, Risk Per Trade (%), Entry Price, and Stop Price.',
        'Three sizing methods are calculated simultaneously:',
      ]},
      { type: 'table', headers: ['Method', 'Formula', 'Best for'], rows: [
        ['Fixed Fractional', 'Risk$ / (Entry − Stop)', 'Standard risk-based sizing for any setup.'],
        ['ATR-based (14)', 'Risk$ / ATR(14)', 'Volatility-adjusted sizing — smaller size on volatile stocks.'],
        ['Half-Kelly', 'Partial Kelly criterion using win rate and R:R', 'Long-term position sizing if you track win rate accurately.'],
      ]},
      { type: 'tip', text: 'Tip: always use the smaller of Fixed Fractional and ATR-based as a sanity check. If the ATR size is much smaller it means the stock is too volatile for your stop distance.' },
    ],
  },
  {
    id: 'ai-tools',
    title: 'AI Tools',
    icon: '✦',
    blocks: [
      { type: 'h3', text: 'AI Chat (AI Advisor)' },
      { type: 'p', text: 'An open-ended chat interface powered by Claude. Ask any question about markets, trading strategies, stock analysis, or economic concepts.' },
      { type: 'bullets', items: [
        'Type your question and press Enter or click Send.',
        'Responses stream in real time — click Stop to interrupt.',
        'Suggested prompts appear as clickable pills to get you started.',
        'Responses are formatted as markdown: headers, bullet points, code blocks.',
        'Previous messages stay visible in the session. Clear the chat with the reset button.',
      ]},
      { type: 'p', text: 'Example questions:' },
      { type: 'bullets', items: [
        '"What is the risk/reward of buying NVDA calls before earnings?"',
        '"Explain the difference between a golden cross and a death cross."',
        '"How do I calculate position size using the ATR method?"',
        '"What sectors historically outperform when the Fed cuts rates?"',
      ]},
      { type: 'tip', text: 'Disclaimer: AI Chat is for educational and informational purposes only — not personalised financial advice.' },
      { type: 'h3', text: 'Financial Advisor' },
      { type: 'p', text: 'Generates a structured, personalised portfolio strategy and asset allocation plan based on your financial profile.' },
      { type: 'steps', items: [
        'Select your Investment Goal: Retirement, Home Purchase, Education Fund, Wealth Building, Income Generation, or Capital Preservation.',
        'Set your Investment Horizon (1–40 years) using the slider.',
        'Enter Starting Capital and Monthly Contribution.',
        'Set Risk Tolerance: Conservative, Moderate, or Aggressive.',
        'Set Current Age (affects lifecycle allocation recommendations).',
        'Choose Account Type: Taxable, Roth IRA, Traditional IRA, 401(k), or Multiple.',
        'Choose Geographic Focus: US-Focused, Global Diversified, or Emerging Markets Tilt.',
        'Click "Generate Plan". The plan streams as markdown with an embedded asset allocation chart.',
      ]},
      { type: 'p', text: 'The generated plan includes: recommended asset allocation with percentages, specific ETF/fund suggestions by asset class, rationale based on your inputs, tax considerations by account type, and a projected growth narrative.' },
    ],
  },
  {
    id: 'charts',
    title: 'Chart Modal',
    icon: '◈',
    blocks: [
      { type: 'p', text: 'Open the chart modal by clicking any ticker in the Watchlist, Portfolio heatmap, or Market Summary tables. The modal has 11 tabs.' },
      { type: 'h3', text: 'Chart Tab' },
      { type: 'p', text: 'Interactive candlestick chart with volume histogram. Use the period buttons to switch timeframes:' },
      { type: 'bullets', items: [
        '1D = intraday (5-minute candles), 5D, 1M, 3M, 6M, 1Y, 2Y, 5Y.',
        'Drag to pan; scroll/pinch to zoom.',
        'Click outside the modal or press Escape to close.',
      ]},
      { type: 'h3', text: 'Technical Indicators' },
      { type: 'table', headers: ['Toggle', 'What it adds', 'Colour'], rows: [
        ['SMA20', '20-day Simple Moving Average overlay', 'Amber'],
        ['SMA50', '50-day Simple Moving Average overlay', 'Blue'],
        ['SMA200', '200-day Simple Moving Average overlay', 'Purple'],
        ['BB', 'Bollinger Bands (20-period, 2 SD) — upper, mid, and lower bands', 'Blue (transparent)'],
        ['RSI', 'RSI(14) sub-pane below the chart with 30/70 reference lines', 'Violet'],
        ['MACD', 'MACD histogram + signal line sub-pane', 'Blue/Amber'],
      ]},
      { type: 'tip', text: 'Tip: a common combo — turn on SMA50 + SMA200 to identify the long-term trend, then enable RSI to find oversold entries within an uptrend.' },
      { type: 'h3', text: 'Drawing Tools' },
      { type: 'bullets', items: [
        '─ S/R: click once on the chart to draw a horizontal support/resistance line at that price. The price label shows on the left edge.',
        '╱ Trend: click once to set the start point, click again to complete the trend line.',
        'Drawings are saved to your browser\'s local storage and reappear the next time you open the same symbol.',
        '✕ Clear: removes all drawings for the current symbol.',
      ]},
      { type: 'h3', text: 'Other Tabs' },
      { type: 'table', headers: ['Tab', 'Contents'], rows: [
        ['Fundamentals', 'P/E, EV/EBITDA, margins, ROE, debt ratios, growth rates, dividends — key valuation and quality metrics.'],
        ['News', 'Recent headlines for the symbol with sentiment indicators and external links.'],
        ['Earnings', 'Three sections: (1) Earnings Call Summary — AI summary of the latest SEC 8-K filing including beat/miss, guidance, management tone, key themes, and a notable quote. (2) Earnings Play Calculator — expected move and options strategy sizing. (3) Historical earnings chart — last 8 quarters of EPS and revenue estimates vs actuals.'],
        ['Options', 'Full options chain for the nearest expiry: calls and puts with strike, bid/ask, volume, OI, delta, and IV. ITM strikes are highlighted.'],
        ['Strategies', 'AI-generated options strategy recommendations (covered call, protective put, straddle, etc.) based on current price and IV, with payoff visualisation.'],
        ['Insider', 'Recent insider transactions (Form 4 filings) — who bought or sold, how many shares, and at what price.'],
        ['Analyst', 'Analyst ratings, price targets, and recent upgrades/downgrades. Shows consensus rating and average 12-month target.'],
        ['Institutional', 'Top institutional holders, ownership percentage, and recent changes in holdings.'],
        ['Sentiment', 'Short interest %, put/call ratio, and news sentiment score for the symbol.'],
        ['Filings', 'Recent SEC filings (10-K, 10-Q, 8-K) with links to the original documents on EDGAR.'],
      ]},
      { type: 'h3', text: 'Earnings Call Summary' },
      { type: 'p', text: 'The AI earnings summary fetches the most recent 8-K filing from SEC EDGAR, strips the HTML, and sends it to Claude for analysis. It extracts:' },
      { type: 'bullets', items: [
        'Quarter and filing date.',
        'EPS/Revenue beat or miss vs estimates.',
        'Guidance for the next period vs analyst consensus.',
        'Management tone: Bullish / Neutral / Cautious / Bearish.',
        'Key themes discussed (AI adoption, margin expansion, etc.).',
        'Risks mentioned by management.',
        'A notable verbatim quote from the call.',
        'A link to the original SEC filing.',
      ]},
    ],
  },
  {
    id: 'changelog',
    title: 'Changelog',
    icon: '◉',
    blocks: [
      { type: 'p', text: 'A chronological log of features added to Stock Monitor, from initial build through ongoing development.' },
      { type: 'h3', text: '2026-07-25 — Index / ETF Heatmap v2' },
      { type: 'bullets', items: [
        'Dynamic ETF/index search: type any ticker or name in the search box to load any ETF\'s constituent heatmap (not just the four predefined indices).',
        'Live market-cap weights: tile sizes now reflect real-time market-cap weights fetched in parallel at load time instead of hardcoded approximations.',
        'Weighted index return: summary bar now shows the market-cap-weighted 1D return for the whole index, plus top contributor and top drag.',
        'Flat layout: sector groupings removed in favour of a single grid sorted by weight — largest positions appear top-left.',
        'Weight % shown on every tile.',
        'Backend: two new endpoints — /api/search-etf (Yahoo Finance search) and /api/etf-holdings (yfinance funds_data).',
      ]},
      { type: 'h3', text: '2026-07-25 — Index / ETF Heatmap v1' },
      { type: 'bullets', items: [
        'New Market sidebar item: Index Heatmap.',
        'Four predefined indices: Dow Jones 30 (DIA), Nasdaq 100 (QQQ), S&P Top 100 (SPY), ARK Innovation (ARKK).',
        'Heatmap view: tiles coloured by 1D return, grouped by GICS sector.',
        'Sortable table view with 7 time periods: 1D, 5D, 1M, 3M, 6M, 1Y, YTD.',
        'Chart modal integration: click any tile or row to open the full chart.',
        'Backend: /api/index-constituents endpoint with 15-minute SQLite cache.',
      ]},
      { type: 'h3', text: '2026-05-28 — Phase 13 + Polish' },
      { type: 'bullets', items: [
        'Market Breadth Dashboard: A/D line (60d), VIX sparkline, above-50MA / above-200MA gauges, H/L ratio, put/call ratio.',
        'Fundamental Comparison: side-by-side 21-metric comparison table for up to 5 stocks with best/worst-in-class colour coding.',
        'Price Targets: set personal targets with deadlines, notes, and progress bars.',
        'SMA overlays (20/50/200) and Bollinger Bands added to the chart modal.',
        'DCF Valuation calculator with intrinsic value, margin of safety, and 10-year projection.',
        'Yield Curve & Rates: live Treasury curve, 10Y−13W inversion signal, DXY tracking.',
        'Mobile-responsive nav: hamburger drawer for small screens.',
        'CSV export for Portfolio and Trade Journal.',
        'Drawing tools in chart modal: horizontal S/R lines and trend lines (persisted in localStorage).',
        'Unusual Options Activity scanner across watchlist symbols.',
        'Earnings Call Summarizer: fetches latest 8-K from SEC EDGAR, summarises with Claude.',
        'Grouped collapsible sidebar replacing the flat 24-tab navigation.',
        'In-app User Guide (this document).',
      ]},
      { type: 'h3', text: '2026-05-28 — Phases 9–12' },
      { type: 'bullets', items: [
        'Phase 9: Options Strategy Builder with AI-generated strategies and payoff charts; multi-timeframe Technical Signals dashboard; AI Trade Ideas generator.',
        'Phase 10: Portfolio Risk Dashboard (beta, Herfindahl, VaR, Sharpe); Smart Alerts 2.0 with seven alert types; Position Sizer with three sizing methods.',
        'Phase 11: Portfolio Optimizer (efficient frontier, min-vol, max-Sharpe); rich Earnings Calendar with expected move and beat-rate history; News Sentiment with Claude scoring.',
        'Phase 12: Options P&L Tracker with live Greeks; Portfolio X-Ray (sector/cap/country donut charts); Sector Momentum Ranker with composite scores and acceleration signals.',
      ]},
      { type: 'h3', text: '2026-05-28 — Phases 3–8' },
      { type: 'bullets', items: [
        'Phase 3: Options chain viewer; Trade Journal with P&L matching; Dividends view; Correlation heatmap; Macro Calendar.',
        'Phase 4: Technical Indicators overlay; Insider Transactions (Form 4); Analyst Ratings and price targets; Portfolio Rebalancer; Short Interest.',
        'Phase 5: Earnings Calendar; Institutional Ownership; Sector Rotation table/heatmap; Smart Alerts (initial).',
        'Phase 6: Chart Compare (normalised returns); Strategy Backtester; Multi-Watchlist support; AI News Sentiment; CSV import/export.',
        'Phase 7: WebSocket live price feed; browser push notifications; SEC Filings viewer; NLP custom screener; Unusual Options Activity.',
        'Phase 8: Portfolio equity curve vs cost basis; Earnings Play Calculator (expected move + straddle sizing); Claude NLP screener.',
      ]},
      { type: 'h3', text: '2026-05-27 — Phase 1 Portfolio Intelligence' },
      { type: 'bullets', items: [
        'Portfolio tracker with positions table, market value, unrealised P&L, day P&L.',
        'Portfolio heatmap (treemap by market value, coloured by day change).',
        'Portfolio Exposure donut charts (sector, cap size, geography).',
        'Equity curve with snapshot-based history.',
        'Performance tracking vs SPY/QQQ benchmarks.',
      ]},
      { type: 'h3', text: '2026-05-18 — Day Trader + AI Tools' },
      { type: 'bullets', items: [
        'Day Trader tab: trading plan calculator, strategy playbooks, live scanner, trade alerts sidebar, pre-market movers.',
        'AI Advisor (AI Chat): streaming Claude chat for market questions.',
        'Financial Advisor: AI-generated portfolio strategy based on financial profile (goal, horizon, risk tolerance, account type).',
        'SQLite database for position persistence.',
      ]},
      { type: 'h3', text: '2026-05-15 — Market Intelligence' },
      { type: 'bullets', items: [
        'Market Overview: index, sector ETF, and Mag 7 performance tables.',
        'AI Growth Watch List: 41 stocks across 9 AI stack layers (Chips, Memory, Cloud, Models, Applications, Robotics, Quantum…).',
        'Market Recommendations: analyst upgrades/downgrades with firm/rating/target detail modal.',
        'Top-20 global news headlines sidebar (US, EU, Asia, Commodities).',
        'Screener: technical scans, fundamental presets.',
        'Sortable tables and search/filter bars across all views.',
      ]},
      { type: 'h3', text: '2026-05-08 — Initial Launch' },
      { type: 'bullets', items: [
        'FastAPI + React/Vite/Tailwind full-stack scaffold.',
        'Live watchlist with real-time price updates and flash animations.',
        'Candlestick chart modal (1D–5Y) with per-symbol news feed.',
        'Price alerts: above/below, percent change, 52-week break, volume spike.',
        'Multi-period performance data via yfinance.',
      ]},
    ],
  },
  {
    id: 'tips',
    title: 'Tips & Shortcuts',
    icon: '◇',
    blocks: [
      { type: 'h3', text: 'Keyboard Shortcuts' },
      { type: 'table', headers: ['Key', 'Action'], rows: [
        ['Escape', 'Close any open modal (chart, alert).'],
        ['Enter', 'Submit forms (add ticker, add alert, run screener, send chat message).'],
      ]},
      { type: 'h3', text: 'Data Caching' },
      { type: 'p', text: 'The app caches API responses in SQLite to avoid rate limits and reduce latency. Cache durations:' },
      { type: 'table', headers: ['Data', 'Cache Duration'], rows: [
        ['Live quotes', 'No cache — real-time via WebSocket or REST polling.'],
        ['Chart data', '5 minutes (intraday), 1 hour (daily periods).'],
        ['Fundamentals', '2 hours.'],
        ['News / headlines', '30 minutes.'],
        ['Market Breadth', '30 minutes.'],
        ['Treasury yields & DXY', '30 minutes.'],
        ['Earnings calendar', '12 hours.'],
        ['Options chain', '5 minutes.'],
        ['Unusual Options Activity', '30 minutes.'],
        ['SEC filings', '12 hours.'],
        ['Earnings call summary', '24 hours.'],
        ['DCF pre-fill data', '2 hours.'],
        ['Sector momentum', '30 minutes.'],
        ['News sentiment', '2 hours.'],
      ]},
      { type: 'h3', text: 'Common Workflows' },
      { type: 'h3', text: 'Morning Market Check (5 minutes)' },
      { type: 'steps', items: [
        'Market → Overview: scan index futures and sector performance.',
        'Market → Market Breadth: check VIX and A/D ratio for overall risk-on/risk-off.',
        'Watchlist: review overnight moves and earnings badges.',
        'Trading → Smart Alerts: click Scan to see if any rules triggered overnight.',
      ]},
      { type: 'h3', text: 'Evaluating a New Stock (10 minutes)' },
      { type: 'steps', items: [
        'Add to watchlist → click the row to open the chart modal.',
        'Chart tab: check SMA50/200 trend, RSI level, and volume pattern.',
        'Earnings tab: read the AI earnings call summary for the last quarter.',
        'Analyst tab: check consensus rating and price target distribution.',
        'Research → DCF Valuation: run a quick intrinsic value estimate.',
        'Research → Fundamental Comparison: compare vs 2–3 sector peers.',
      ]},
      { type: 'h3', text: 'Pre-Earnings Positioning' },
      { type: 'steps', items: [
        'Watchlist → Earnings+: check the Beat Rate and Expected Move for the symbol.',
        'Chart → Options tab: review the ATM straddle price to verify the expected move.',
        'Chart → Strategies tab: see AI-suggested options plays for the event.',
        'Trading → Position Sizer: calculate position size based on your risk budget.',
        'Set a Smart Alert for Earnings Proximity so you don\'t miss the report date.',
      ]},
    ],
  },
]

// ── Renderer ──────────────────────────────────────────────────────────────────

function Block({ block }) {
  switch (block.type) {
    case 'p':
      return <p className="text-gray-400 text-sm leading-relaxed">{block.text}</p>

    case 'h3':
      return <h3 className="text-white font-semibold text-sm mt-5 mb-2">{block.text}</h3>

    case 'tip':
      return (
        <div className="bg-sky-900/20 border border-sky-800/40 rounded-lg px-3 py-2.5 text-sky-300 text-xs leading-relaxed">
          {block.text}
        </div>
      )

    case 'steps':
      return (
        <ol className="space-y-1.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-gray-400 leading-relaxed">
              <span className="text-emerald-500 font-semibold tabular-nums shrink-0 w-4 text-right">{i + 1}.</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      )

    case 'bullets':
      return (
        <ul className="space-y-1.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-gray-400 leading-relaxed">
              <span className="text-gray-600 shrink-0 mt-1">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )

    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900/80 border-b border-gray-800">
                {block.headers.map(h => (
                  <th key={h} className="text-left px-3 py-2 text-gray-500 text-xs font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className={`border-b border-gray-800/50 ${ri % 2 ? 'bg-gray-900/20' : ''}`}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={`px-3 py-2 text-xs leading-relaxed ${ci === 0 ? 'text-gray-300 font-medium whitespace-nowrap' : 'text-gray-500'}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

    default:
      return null
  }
}

function Section({ section, query }) {
  const matchesQuery = !query ||
    section.title.toLowerCase().includes(query) ||
    section.blocks.some(b =>
      (b.text || '').toLowerCase().includes(query) ||
      (b.items || []).some(i => i.toLowerCase().includes(query)) ||
      (b.rows || []).some(r => r.some(c => c.toLowerCase().includes(query))) ||
      (b.headers || []).some(h => h.toLowerCase().includes(query))
    )

  if (!matchesQuery) return null

  return (
    <section id={section.id} className="scroll-mt-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-emerald-400 text-base">{section.icon}</span>
        <h2 className="text-white font-bold text-base">{section.title}</h2>
      </div>
      <div className="space-y-3">
        {section.blocks.map((block, i) => <Block key={i} block={block} />)}
      </div>
    </section>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UserGuide() {
  const [query, setQuery] = useState('')
  const contentRef = useRef(null)
  const q = query.toLowerCase().trim()

  function scrollTo(id) {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const visibleIds = useMemo(() => {
    if (!q) return GUIDE.map(s => s.id)
    return GUIDE
      .filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.blocks.some(b =>
          (b.text || '').toLowerCase().includes(q) ||
          (b.items || []).some(i => i.toLowerCase().includes(q)) ||
          (b.rows || []).some(r => r.some(c => c.toLowerCase().includes(q)))
        )
      )
      .map(s => s.id)
  }, [q])

  return (
    <div className="flex gap-0 h-full min-h-0">

      {/* TOC sidebar */}
      <aside className="hidden lg:flex flex-col w-44 shrink-0 border-r border-gray-800 overflow-y-auto py-4">
        <div className="text-gray-600 text-[10px] uppercase tracking-widest px-4 mb-3">Contents</div>
        {GUIDE.map(s => (
          <button
            key={s.id}
            onClick={() => scrollTo(s.id)}
            className={`w-full text-left px-4 py-1.5 text-xs transition-colors flex items-center gap-2 ${
              visibleIds.includes(s.id)
                ? 'text-gray-400 hover:text-emerald-400'
                : 'text-gray-700'
            }`}
          >
            <span className="text-gray-700 text-[10px]">{s.icon}</span>
            {s.title}
          </button>
        ))}
      </aside>

      {/* Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-10">

        {/* Header */}
        <div>
          <div className="text-gray-500 text-[10px] uppercase tracking-widest mb-1">Documentation</div>
          <h1 className="text-white font-bold text-xl mb-1">Stock Monitor — User Guide</h1>
          <p className="text-gray-500 text-sm">Complete reference for all features and workflows.</p>
        </div>

        {/* Search */}
        <div className="sticky top-0 bg-gray-950/90 backdrop-blur-sm py-2 -mx-6 px-6 z-10 border-b border-gray-800/50">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search the guide…"
            className="w-full max-w-sm bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-sky-600"
          />
          {q && (
            <span className="ml-3 text-gray-600 text-xs">
              {visibleIds.length} section{visibleIds.length !== 1 ? 's' : ''} match
            </span>
          )}
        </div>

        {/* Sections */}
        {visibleIds.length === 0 ? (
          <div className="py-16 text-center text-gray-600 text-sm">No results for "{query}"</div>
        ) : (
          GUIDE.map(s => <Section key={s.id} section={s} query={q} />)
        )}

        <div className="text-gray-700 text-xs pb-8">
          Stock Monitor · Built with FastAPI + React + Claude AI · Data from Yahoo Finance & SEC EDGAR
        </div>
      </div>
    </div>
  )
}
