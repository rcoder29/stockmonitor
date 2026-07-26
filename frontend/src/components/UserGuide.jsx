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
      { type: 'p', text: 'The left sidebar organises all features into 8 groups. All groups start collapsed — click a group header to expand it. Only the group containing your current view opens automatically. Click any item to load that view. The ? User Guide button is always pinned to the bottom of the sidebar. On mobile, tap ☰ to open the sidebar drawer.' },
      { type: 'table', headers: ['Group', 'What\'s Inside'], rows: [
        ['Markets', 'Overview, Index Heatmap, Breadth, Sector Rotation, Sector Momentum, Yield Curve, Fed Watch, Macro Calendar, Analyst Picks, Short Squeeze, IPO & Lockups'],
        ['Research', 'Screener, Fundamentals, DCF Valuation, Chart Compare, Backtester, Signals, Unusual Options'],
        ['Watchlist', 'Watchlist, Price Targets, Earnings+, News Sentiment, Smart Alerts'],
        ['News', 'My News Feed'],
        ['Trading', 'Trade Ideas, Position Sizer, Day Trader'],
        ['Portfolio', 'Portfolio, Options P&L, Trade Journal'],
        ['AI Tools', 'Morning Briefing, Financial Advisor, Tax Advisor, AI Chat'],
        ['Retirement', 'FIRE Calculator, Coast FIRE & Roth, Monte Carlo, Social Security, Early Retirement Health, Roth Conversion Planner'],
      ]},
      { type: 'h3', text: 'Live Price Feed' },
      { type: 'p', text: 'Prices update via WebSocket during market hours. The green dot in the header means the live feed is connected. If it turns grey the app falls back to REST polling at your chosen refresh interval (5s to 5m). Price changes flash green (up) or red (down) in the Watchlist.' },
      { type: 'tip', text: 'Tip: set the refresh interval to 5s during active trading hours and 5m when you\'re monitoring passively to reduce API calls.' },
    ],
  },
  {
    id: 'market',
    title: 'Markets',
    icon: '◫',
    blocks: [
      { type: 'h3', text: 'Market Overview' },
      { type: 'p', text: 'A single-page snapshot of market health. Sortable tables show multi-timeframe performance (1D, 5D, 1M, 3M, 6M, 1Y, YTD) for major indices & ETFs, sector ETFs, and the Magnificent 7. Below the tables, top 10 gainers and losers update with each refresh. The right sidebar shows the latest market headlines with external links.' },
      { type: 'bullets', items: [
        'Click any column header to sort ascending / descending.',
        'Click any row to open the full chart modal for that ticker.',
        'Use the ↻ button or set a refresh interval to keep data current.',
      ]},
      { type: 'h3', text: 'Analyst Picks' },
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
      { type: 'h3', text: 'Fed Watch' },
      { type: 'p', text: 'Tracks FOMC meeting dates and derives rate-change probabilities from 30-day Fed Funds futures (CME ZQ contracts). The target range is fetched live from the 13-week T-bill rate, so it updates automatically when the Fed moves.' },
      { type: 'table', headers: ['Element', 'What it shows'], rows: [
        ['Current Target', 'Live Fed Funds target range (e.g. 3.75%–4.00%) derived from the 13-week T-bill.'],
        ['Next Meeting highlight', 'Date, days until meeting, and cut/hold/hike probability gauges.'],
        ['Meeting grid', 'Full calendar of all FOMC meetings with implied rate and probabilities for each.'],
        ['Probability gauges', 'Circular dials showing Cut %, Hold %, and Hike % derived from futures pricing.'],
        ['Rate history chart', '52-week 13-week T-bill rate chart showing the rate trend.'],
        ['Rate move reference', 'Table of scenarios (double cut, cut, hold, hike) and typical market impact.'],
      ]},
      { type: 'p', text: 'Implied rate = 100 − ZQ futures price. Probability of cut = (current midpoint − implied rate) ÷ 0.25 × 100. This is a simplified version of the CME FedWatch methodology.' },
      { type: 'tip', text: 'Tip: a high cut probability for the next meeting is generally bullish for growth/tech stocks and bonds. Check Fed Watch before trading rate-sensitive positions (utilities, REITs, financials).' },
      { type: 'h3', text: 'Short Squeeze Scanner' },
      { type: 'p', text: 'Scans a universe of ~120 high-short-interest stocks and scores each one on squeeze potential. Results are sorted by score, refreshed every 30 minutes.' },
      { type: 'table', headers: ['Score Component', 'Weight', 'What it measures'], rows: [
        ['Short % of Float', '40 pts', 'What percentage of available shares are sold short. Above 20% is elevated; above 40% is extreme.'],
        ['Days to Cover', '30 pts', 'Shares short ÷ average daily volume. Higher = shorts need more days to exit = more pain if squeezed.'],
        ['Price Momentum', '20 pts', 'Today\'s % change. Positive price action on high short interest suggests squeeze may be starting.'],
        ['SI Change (MoM)', '10 pts', 'Month-over-month change in shares short. Rising SI builds pressure; falling SI means shorts are covering.'],
      ]},
      { type: 'table', headers: ['Level', 'Score Range', 'Interpretation'], rows: [
        ['EXTREME', '70–100', 'Very high squeeze potential. All four factors are elevated simultaneously.'],
        ['HIGH',    '50–69',  'Strong squeeze setup. Multiple factors are elevated.'],
        ['MEDIUM',  '30–49',  'Elevated short interest but momentum or DTC is moderate.'],
        ['LOW',     '10–29',  'Some short interest present but squeeze conditions are not aligned.'],
      ]},
      { type: 'bullets', items: [
        'Click any column header to sort the table (score, short %, days to cover, etc.).',
        'Filter by level using the pill buttons (ALL / EXTREME / HIGH / MEDIUM / LOW).',
        'Add custom symbols in the input box to include them in the scan alongside the built-in universe.',
        'SI Change (MoM) positive (red) = shorts are adding — pressure building. Negative (green) = shorts covering.',
        'Note: short interest is reported bi-monthly by FINRA — data may be up to 2 weeks stale.',
      ]},
      { type: 'tip', text: 'Warning: short squeezes are highly unpredictable and can reverse violently. A high squeeze score is a risk signal, not a buy signal. Always size positions conservatively and set hard stops.' },
      { type: 'h3', text: 'IPO & Lockup Calendar' },
      { type: 'p', text: 'Tracks recent IPOs with live price performance vs IPO price, and counts down to lockup expiration dates. Lockup expiry is a known catalyst — insiders can sell freely once it passes, which can create short-term selling pressure.' },
      { type: 'table', headers: ['Column', 'What it tells you'], rows: [
        ['Since IPO %', 'Percentage gain or loss vs the IPO price. Green = above IPO price, red = below.'],
        ['Days Since IPO', 'How long the stock has been trading publicly.'],
        ['Lockup Progress bar', 'How far through the lockup period the stock is. Red = expiring ≤14 days, orange = ≤30 days, yellow = ≤60 days.'],
        ['Days to Lockup', 'Countdown to lockup expiry. Negative = already expired.'],
      ]},
      { type: 'bullets', items: [
        'Active Lockups tab: stocks where insiders are still restricted from selling.',
        'Expired tab: stocks where the lockup has passed — insiders may have sold.',
        'Summary cards show how many lockups are active, expiring within 30 days, and already expired.',
        'Stocks with strong post-IPO gains and an imminent lockup carry the highest insider-selling risk.',
      ]},
      { type: 'tip', text: 'Tip: combine IPO & Lockup Calendar with the Short Squeeze Scanner. A stock with high short interest and an imminent lockup expiry faces two opposing forces — shorts betting on post-lockup selling vs bulls expecting momentum to continue.' },
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
      { type: 'h3', text: 'Smart Alerts' },
      { type: 'p', text: 'Condition-based alert rules you scan on demand. Found under Watchlist → Smart Alerts.' },
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
      { type: 'tip', text: 'Tip: Smart Alerts complement the automatic Price Alerts (bell icon on watchlist rows). Price Alerts fire automatically; Smart Alerts require a manual scan click and support more complex technical conditions.' },
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
      { type: 'h3', text: 'Morning Briefing' },
      { type: 'p', text: 'A daily AI-generated market briefing personalised to your watchlist. Found under AI Tools → Morning Briefing. On load, live snapshot cards show the current price and daily change for S&P 500, Nasdaq, Dow, Russell 2000, VIX, and the 10-year Treasury yield. Click "Generate Morning Briefing" to pull live market data and stream a structured Claude analysis.' },
      { type: 'h3', text: 'How to Use' },
      { type: 'steps', items: [
        'The market snapshot cards load automatically — no action required.',
        'Review your watchlist (pre-filled with common tickers). Click "Edit" to add or remove symbols. Changes are saved to localStorage and persist across sessions.',
        'Click "Generate Morning Briefing". The backend collects live index prices, 11 sector ETF returns, watchlist stock prices, and recent news headlines, then streams them to Claude.',
        'The briefing streams in 6 structured sections (see below). A spinner shows while Claude is writing.',
        'The finished briefing is cached in localStorage for the trading day. Revisiting the page shows the cached version instantly. Click "Refresh Briefing" to regenerate with fresh data.',
      ]},
      { type: 'h3', text: 'Briefing Sections' },
      { type: 'table', headers: ['Section', 'What it covers'], rows: [
        ['Market Pulse', 'Executive summary of the day\'s market tone: risk-on vs risk-off, the dominant macro regime, and the single most important theme to carry into the session.'],
        ['Index & Sector Breakdown', 'Narrative interpretation of index and sector performance data — rotation signals, what\'s leading/lagging, and what that tells us about investor positioning.'],
        ['Watchlist Spotlight', 'For each watchlist symbol: momentum, key technical support/resistance levels, and any news catalysts. Specific price levels are called out.'],
        ['Key News & Market Implications', 'Top 4–5 market-relevant headlines with a 1–2 sentence note on the trading implication of each.'],
        ['Risk Radar', '2–3 specific risks or wildcards that could catch the market off-guard today — each with the trigger event and scenario.'],
        ['Today\'s Action Checklist', '5 bullet-point action items: concrete things to watch or do today, with tickers and levels where possible.'],
      ]},
      { type: 'bullets', items: [
        'Watchlist supports up to 15 symbols. Type a ticker in the "Add ticker…" input and press Enter or comma to add.',
        'The snapshot cards auto-refresh when you navigate to the page — market data is not cached.',
        'The briefing cache is per-day: generating on Monday stores a Monday briefing; the cache resets automatically on Tuesday.',
        'Sector data is ranked best-to-worst so Claude can identify rotation themes.',
      ]},
      { type: 'tip', text: 'Tip: generate the briefing before the market opens (pre-market) for an early read on overnight sentiment, or right at the open for the most current data.' },
      { type: 'tip', text: 'Disclaimer: Morning Briefing output is generated by AI and is for informational purposes only — not personalised financial advice. Always verify key data points before acting.' },
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
      { type: 'h3', text: 'Tax Advisor' },
      { type: 'p', text: 'AI-powered tax optimisation tool for Married Filing Jointly (MFJ) households. Enter your financial profile and Claude generates a personalised, dollar-quantified tax-saving plan covering federal and state taxes. Found under AI Tools → Tax Advisor.' },
      { type: 'h3', text: 'Input Sections' },
      { type: 'table', headers: ['Section', 'Fields'], rows: [
        ['Location & Filing', 'State of residence (all 50 states + DC), qualifying children, spouses aged 50+, self-employed checkbox, employer health insurance, HSA-eligible plan.'],
        ['Annual Income', 'W-2 wages, self-employment income, short-term capital gains, long-term capital gains, qualified dividends, rental income, other income. Live gross total updates as you type.'],
        ['Retirement & Tax-Advantaged', 'Traditional 401(k), Roth 401(k), IRA, HSA, FSA contributions — each with the 2025 contribution limit shown as a hint.'],
        ['Deductions & Credits', 'Mortgage interest, property taxes (SALT cap noted), charitable giving, student loan interest, child/dependent care expenses.'],
      ]},
      { type: 'h3', text: 'AI Analysis — 8 Sections' },
      { type: 'table', headers: ['Section', 'What Claude covers'], rows: [
        ['📊 Tax Snapshot', 'Estimated AGI, federal tax, LTCG rate, state tax, total burden, and effective rate — before optimisation.'],
        ['🎯 Priority Actions', 'Ranked list of specific moves by estimated dollar savings (e.g. "max HSA = save $2,490 in federal tax").'],
        ['💼 Retirement Optimisation', 'Gaps in 401k/IRA/HSA contributions, Roth vs Traditional analysis, backdoor Roth eligibility, catch-up contributions.'],
        ['📉 Deduction Strategy', 'Standard vs itemised comparison, bunching charitable gifts, SALT cap workarounds.'],
        ['💰 Investment Tax Efficiency', 'LTCG rate optimisation, tax-loss harvesting opportunities, asset location (what to hold in taxable vs tax-deferred).'],
        ['🏠 State Tax Tips', 'State-specific strategies — deductions, credits, and quirks unique to your state.'],
        ['⚠️ Watch-Out Situations', 'AMT exposure, NIIT (3.8% on investment income above $250k), Roth conversion phase-outs.'],
        ['📅 Year-End Checklist', 'Time-sensitive actions to take before Dec 31.'],
      ]},
      { type: 'tip', text: 'Tip: run the Tax Advisor alongside the Roth Conversion Planner (Retirement group) — together they show how converting Traditional IRA funds affects your federal bracket, state tax, and ACA premium subsidy in early retirement.' },
      { type: 'tip', text: 'Disclaimer: AI Tax Advisor output is educational and informational only — not personalised tax advice. Consult a CPA or tax professional before filing or making major tax decisions.' },
    ],
  },
  {
    id: 'news',
    title: 'News',
    icon: '▤',
    blocks: [
      { type: 'p', text: 'The News section delivers a personalised news feed built from topics you choose. Unlike the per-symbol news in the chart modal, this feed aggregates articles across your whole area of interest in one place.' },
      { type: 'h3', text: 'My News Feed' },
      { type: 'p', text: 'Found under News → My News Feed. Select any combination of preset market topics and custom ticker symbols. Your selections are saved in browser localStorage and pre-loaded on every visit.' },
      { type: 'h3', text: 'Preset Topics' },
      { type: 'table', headers: ['Topic', 'Data source'], rows: [
        ['S&P 500', '^GSPC — S&P 500 index news'],
        ['Nasdaq', '^IXIC — Nasdaq Composite news'],
        ['Dow Jones', '^DJI — Dow Jones Industrial Average news'],
        ['Technology', 'QQQ — Nasdaq 100 ETF news'],
        ['Financials', 'XLF — Financial Select Sector SPDR'],
        ['Healthcare', 'XLV — Health Care Select Sector SPDR'],
        ['Energy', 'XLE — Energy Select Sector SPDR'],
        ['Consumer', 'XLY — Consumer Discretionary Select SPDR'],
        ['Industrials', 'XLI — Industrial Select Sector SPDR'],
        ['Real Estate', 'VNQ — Vanguard Real Estate ETF'],
        ['Utilities', 'XLU — Utilities Select Sector SPDR'],
        ['Communications', 'XLC — Communication Services SPDR'],
        ['Materials', 'XLB — Materials Select Sector SPDR'],
        ['Rates / Fed', '^TNX — 10-Year Treasury Yield news'],
        ['Gold', 'GC=F — Gold futures news'],
        ['Oil', 'CL=F — Crude Oil futures news'],
        ['Crypto', 'BTC-USD — Bitcoin news'],
      ]},
      { type: 'h3', text: 'Custom Tickers' },
      { type: 'p', text: 'Type any stock ticker (e.g. AAPL, NVDA, TSLA) in the custom ticker input and press Enter or click "+ Add". The feed will include news from that symbol alongside your preset topics. Click × on a custom ticker chip to remove it.' },
      { type: 'h3', text: 'Filtering' },
      { type: 'p', text: 'The filter bar above the news cards lets you narrow to a single topic. Click a topic pill to show only articles tagged to that source. Click "All" or the same pill again to return to the full feed.' },
      { type: 'bullets', items: [
        'Each topic pill shows the article count in parentheses.',
        'Articles are sorted newest-first across all selected topics.',
        'Duplicate articles (same URL from multiple sources) are deduplicated automatically.',
        'Up to 60 articles are shown per refresh.',
      ]},
      { type: 'h3', text: 'Refreshing' },
      { type: 'p', text: 'Click the Refresh button to re-fetch the latest articles. The feed also auto-refreshes when you change your topic selection. The "Updated X ago" timestamp shows when the current feed was last loaded.' },
      { type: 'tip', text: 'Tip: add the tickers you\'re actively trading as custom topics so breaking news for those positions appears in your feed alongside broader market context.' },
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
    id: 'retirement',
    title: 'Retirement',
    icon: '⏱',
    blocks: [
      { type: 'p', text: 'Six tools for FIRE (Financial Independence, Retire Early) and retirement planning — covering accumulation, withdrawal risk, fund access, Social Security optimisation, healthcare gap coverage, and Roth conversion strategy.' },
      { type: 'h3', text: 'FIRE Calculator' },
      { type: 'p', text: 'Enter your current age, target retirement age (55 / 60 / 65 presets), annual expenses, current savings, monthly contribution, expected return, inflation, and Safe Withdrawal Rate. The calculator shows:' },
      { type: 'bullets', items: [
        'FIRE Number = annual expenses ÷ SWR (default 4%, the Trinity Study baseline).',
        'Progress bar: current savings vs FIRE number.',
        'Years to FIRE and projected year/age when portfolio crosses the threshold.',
        'Portfolio value and monthly income at your target retirement age.',
        'Retirement age comparison table: portfolio, % of FIRE #, monthly income, and status at ages 50–70.',
        'SVG projection chart showing portfolio growth curve against the FIRE target line.',
      ]},
      { type: 'h3', text: 'Coast FIRE & Roth Conversion Ladder' },
      { type: 'p', text: 'Two tools on one screen:' },
      { type: 'bullets', items: [
        'Coast FIRE: the amount you need invested today so that compound growth alone reaches your FIRE number by retirement — no further contributions required. Shows by-age table comparing coast numbers at each retirement age.',
        'Roth Conversion Ladder: for retiring before age 59½. Converts Traditional IRA/401k → Roth IRA each year; converted principal becomes penalty-free after a 5-year waiting period. The calculator shows suggested annual conversion amount, marginal tax bracket impact, estimated annual tax, and a year-by-year conversion schedule.',
      ]},
      { type: 'h3', text: 'Monte Carlo Simulator' },
      { type: 'p', text: 'Runs 1,000 simulations with randomised annual returns (Box-Muller normal distribution) to estimate the probability your portfolio survives your full retirement.' },
      { type: 'bullets', items: [
        'Inputs: starting portfolio, annual withdrawal, years in retirement, mean return, return standard deviation, inflation.',
        'Output: portfolio survival rate (%), median ending balance, worst-10% ending balance.',
        'Fan chart: 10th/25th/50th/75th/90th percentile paths over the full retirement horizon.',
        'Percentile table: final balance and % change vs starting portfolio for each scenario.',
        'Rule of thumb: 4% SWR with 7% mean / 15% std historically achieves ~90% success over 30 years.',
      ]},
      { type: 'h3', text: 'Social Security Optimizer' },
      { type: 'p', text: 'Enter your Full Retirement Age (FRA) benefit from your SSA.gov statement and compare all claiming ages from 62 to 70.' },
      { type: 'bullets', items: [
        'Claiming at 62: permanent reduction (~30% below FRA for those born 1960+).',
        'Claiming at FRA (67): 100% of your earned benefit, no reduction or bonus.',
        'Claiming at 70: +24% vs FRA (8%/year delayed credits for each year past FRA).',
        'Breakeven analysis: the age at which delaying overtakes claiming early in cumulative lifetime benefits.',
        'Cumulative chart: running total by claiming age — where lines cross is the breakeven point.',
        'Combined income column: SS monthly benefit + your portfolio withdrawal for a full retirement income picture.',
      ]},
      { type: 'h3', text: 'Early Retirement Health (ACA Estimator)' },
      { type: 'p', text: 'Estimates ACA Marketplace health insurance premiums and Premium Tax Credits for a family of 2 retiring early — covering the gap years between retirement (age 55) and Medicare eligibility (age 65).' },
      { type: 'bullets', items: [
        'Inputs: Age of Person 1, Age of Person 2, Annual MAGI (gross income), and annual income growth rate.',
        'Premium basis: 2025 CMS age-rating curve applied to a $310/month age-21 benchmark Silver plan. Premiums scale with age (age 64 = 3× age 21).',
        'Subsidy calculation: ARP/IRA extended rules — your required contribution is 0–8.5% of MAGI on a sliding scale based on % of Federal Poverty Level (FPL). ACA pays the rest.',
        'When one person turns 65 they shift to Medicare — only the younger person\'s premium remains in the ACA calculation.',
        'Outputs: Year 1 full premium, Year 1 subsidy, Year 1 net cost, 10-year total cost, and a year-by-year table through Medicare eligibility.',
        'SVG chart showing annual premium vs out-of-pocket cost for each gap year.',
        'Planning notes: Roth-vs-traditional withdrawal impact on MAGI, income management strategies to maximise subsidies.',
      ]},
      { type: 'tip', text: 'Tip: Roth IRA withdrawals are not counted as MAGI for ACA purposes, while Roth conversions are. Keeping MAGI below 400% FPL ($81,760 for a family of 2 in 2025) ensures you qualify for subsidies under the extended ARP rules.' },
      { type: 'h3', text: 'Roth Conversion Planner' },
      { type: 'p', text: 'Plans the optimal Roth IRA conversion strategy during the age 55–65 gap window — the low-income years between retirement and Social Security / RMDs when your tax bracket is at its lowest.' },
      { type: 'bullets', items: [
        'Inputs: Filing status (MFJ or Single), Traditional IRA balance, expected annual growth rate, other annual income, target tax bracket (12%, 22%, or 24%), and current age.',
        'Conversion room: the amount you can convert each year to stay within your target bracket without spilling into the next one.',
        'Year-by-year table: conversion amount, tax cost, running Roth balance, and remaining Traditional balance — projected to age 65.',
        'RMD impact: compares Traditional IRA balance at age 73 with and without conversions, showing the RMD reduction and estimated lifetime tax savings.',
        'Balance chart: SVG showing both balances growing to age 75 under both scenarios.',
        'Quick-reference bracket table for MFJ and Single filers.',
      ]},
      { type: 'table', headers: ['Why convert 55–65?', 'Explanation'], rows: [
        ['Low income window', 'No salary, no Social Security yet, no RMDs — your taxable income is at its career low.'],
        ['Fill the bracket', 'Convert just enough each year to reach the top of the 12% or 22% bracket without triggering the next rate.'],
        ['Reduce future RMDs', 'RMDs starting at 73 are calculated on your Traditional balance — smaller balance = smaller mandatory withdrawals.'],
        ['Tax torpedo prevention', 'Large RMDs + Social Security + Medicare IRMAA can stack into very high effective rates at 73+. Conversions now prevent that.'],
        ['5-year rule', 'Converted amounts are accessible penalty-free after 5 years, giving access before age 59½.'],
      ]},
      { type: 'tip', text: 'Tip: coordinate Roth conversions with the ACA Early Retirement Health calculator. Converting too much in a year raises your MAGI and reduces your ACA subsidy — find the sweet spot between conversion benefit and subsidy cost.' },
    ],
  },
  {
    id: 'changelog',
    title: 'Changelog',
    icon: '◉',
    blocks: [
      { type: 'p', text: 'A chronological log of features added to Stock Monitor, from initial build through ongoing development.' },
      { type: 'h3', text: '2026-07-26 — AI Morning Briefing' },
      { type: 'bullets', items: [
        'New Morning Briefing screen under AI Tools: daily personalised market briefing powered by Claude.',
        'Auto-loads live snapshot cards for S&P 500, Nasdaq, Dow, Russell 2000, VIX, and 10-year Treasury yield on page open.',
        'Editable watchlist (up to 15 symbols) stored in localStorage — pre-filled with common tickers, persists across sessions.',
        'Backend collects 6 major index prices, 11 sector ETF returns (ranked best-to-worst), watchlist stock prices, and news headlines in parallel before streaming to Claude.',
        'Claude generates a 6-section structured briefing: Market Pulse, Index & Sector Breakdown, Watchlist Spotlight, Key News & Implications, Risk Radar, Today\'s Action Checklist.',
        'Briefing cached in localStorage by date — revisiting the page shows cached result instantly; Refresh button regenerates with fresh data.',
      ]},
      { type: 'h3', text: '2026-07-25 — Trading & Market Intelligence' },
      { type: 'bullets', items: [
        'Short Squeeze Scanner: scans ~120 high-short-interest stocks, scores 0–100 (short % float 40%, days to cover 30%, momentum 20%, MoM SI change 10%). EXTREME/HIGH/MEDIUM/LOW badges, sortable table, add custom symbols. 30-min cache.',
        'IPO & Lockup Calendar: tracks recent IPOs with live price vs IPO price performance and lockup expiry countdown. Color-coded progress bars (red ≤14 days). Active/Expired tabs. Explains lockup mechanics.',
        'Fed Watch: FOMC meeting calendar with cut/hold/hike probability gauges derived from 30-day Fed Funds futures (ZQ contracts). Current target range fetched live from 13-week T-bill. Rate history chart. Rate move reference table.',
      ]},
      { type: 'h3', text: '2026-07-25 — AI Tax Advisor (MFJ)' },
      { type: 'bullets', items: [
        'New Tax Advisor under AI Tools: AI-powered tax optimisation for Married Filing Jointly households.',
        'Inputs: state (all 50 + DC with live top-marginal rates), income (7 types), retirement contributions (401k/IRA/HSA/FSA with 2025 limits), deductions (mortgage, SALT, charitable, student loan, childcare), filing flags.',
        'Backend pre-computes estimated AGI, federal tax (2025 brackets), LTCG rate, NIIT exposure, and state tax estimate before sending to Claude.',
        'Claude streams an 8-section analysis: Tax Snapshot, Priority Actions (ranked by $), Retirement Optimisation, Deduction Strategy, Investment Tax Efficiency, State Tax Tips, Watch-Outs, Year-End Checklist.',
      ]},
      { type: 'h3', text: '2026-07-25 — Customized News Feed' },
      { type: 'bullets', items: [
        'New News nav group with "My News Feed" screen.',
        '17 preset topic chips: S&P 500, Nasdaq, Dow, Technology, Financials, Healthcare, Energy, Consumer, Industrials, Real Estate, Utilities, Communications, Materials, Rates/Fed, Gold, Oil, Crypto.',
        'Custom ticker input: add any stock symbol to pull its news feed alongside preset topics.',
        'Per-topic filter bar with article counts. Newest-first sort, deduplication, up to 60 articles.',
        'Topic selections persisted in localStorage — remembered across sessions.',
        'Backend: /api/news-feed endpoint maps topic keys to yfinance symbols, fetches in parallel with ThreadPoolExecutor.',
      ]},
      { type: 'h3', text: '2026-07-25 — Early Retirement Health & Roth Conversion Planner' },
      { type: 'bullets', items: [
        'Early Retirement Health (ACA Estimator): estimates monthly premiums and Premium Tax Credits for a family of 2 in the 55–65 Medicare gap. Uses 2025 CMS age-rating curve (3:1 age band), ARP/IRA extended subsidy rules (0–8.5% of MAGI sliding scale), and FPL-based subsidy cliffs. Year-by-year table and SVG premium chart through Medicare eligibility.',
        'Roth Conversion Planner: models the optimal annual Roth conversion during the 55–65 low-income window. Supports MFJ and Single filing, 2025 tax brackets, target bracket selection (12%/22%/24%). Shows conversion room, year-by-year schedule, projected RMD reduction at 73, estimated lifetime tax savings, and dual-scenario balance chart to age 75.',
        'Both tools added to Retirement nav group.',
      ]},
      { type: 'h3', text: '2026-07-25 — Navigation Redesign' },
      { type: 'bullets', items: [
        'Navigation expanded to 8 groups: Markets, Research, Watchlist, News, Trading, Portfolio, AI Tools, Retirement.',
        'Group order rearranged to follow a logical investor workflow: understand market → research stocks → track watchlist → read news → trade → manage portfolio → get AI help → plan retirement.',
        'Items within each group reordered by natural decision sequence (e.g. Screener → Fundamentals → DCF → Chart Compare within Research).',
        'All sidebar groups now start collapsed by default. Only the group containing the active view auto-expands on load.',
        'Sidebar visual refresh: group labels lifted to text-slate-300, icons to text-slate-400, active group gets white text + left emerald border, active nav items are bold white. Width increased from w-48 to w-52.',
      ]},
      { type: 'h3', text: '2026-07-25 — Retirement Planning Module' },
      { type: 'bullets', items: [
        'New Retirement nav group with 4 tools: FIRE Calculator, Monte Carlo Simulator, Coast FIRE & Roth Conversion Ladder, Social Security Optimizer.',
        'FIRE Calculator: FIRE number, years-to-FIRE, portfolio projection chart, retirement-age comparison table. Presets for age 55/60/65.',
        'Monte Carlo: 1,000 simulations with normal random returns, fan chart (10th–90th percentile), survival rate, and scenario table.',
        'Coast FIRE: coast number by retirement age, coasted status indicator. Roth Ladder: annual conversion schedule, tax bracket impact, 5-year access table.',
        'Social Security Optimizer: claiming ages 62–70, breakeven analysis, cumulative lifetime benefit chart, combined portfolio+SS income column.',
      ]},
      { type: 'h3', text: '2026-07-25 — Navigation Restructure (6 groups)' },
      { type: 'bullets', items: [
        'Markets group expanded: absorbed Sector Rotation + Sector Momentum — now the single hub for all market-wide views.',
        'Sectors group eliminated.',
        'Smart Alerts moved from Trading → Watchlist.',
        'Trading trimmed to 3 items: Day Trader, Trade Ideas, Position Sizer.',
        'Recommendations renamed to Analyst Picks; Sentiment renamed to News Sentiment.',
        'Help group replaced by a ? User Guide button pinned to the sidebar bottom.',
      ]},
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
        'Markets → Overview: scan index futures and sector performance.',
        'Markets → Breadth: check VIX and A/D ratio for overall risk-on/risk-off.',
        'Markets → Sector Rotation: see which sectors are leading or lagging today.',
        'Watchlist: review overnight moves and earnings badges.',
        'Watchlist → Smart Alerts: click Scan to see if any rules triggered overnight.',
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
        'Set a Smart Alert (Watchlist → Smart Alerts) for Earnings Proximity so you don\'t miss the report date.',
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
