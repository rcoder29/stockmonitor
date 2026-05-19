import { useState, useEffect, useCallback } from 'react'
import { fmt } from '../utils/format'

// ── Strategy definitions ──────────────────────────────────────────────────────

const STRATEGIES = [
  {
    id: 'gap_go',
    name: 'Gap & Go',
    direction: 'LONG',
    dirCls: 'text-emerald-400 bg-emerald-900/40 border-emerald-800',
    timeframe: '1m / 5m',
    bestTime: '9:30 – 10:30 AM',
    risk: 'HIGH',
    scannerKey: 'gainers',
    description:
      'Gap & Go capitalizes on stocks that gap up significantly pre-market due to a clear catalyst — earnings beat, FDA approval, analyst upgrade, or breaking news. The strategy trades the continuation of that momentum immediately after the open rather than fading it.',
    setup:
      'Stock gaps >3% pre-market with volume at least 2× its daily average. Catalyst must be identifiable. Pre-market range holds and price does not fill the gap before the open.',
    entry:
      'Enter on the break of the pre-market high on a 1-min or 5-min candle with above-average volume. Do not chase — if you miss the initial break, wait for the first pullback to the breakout level and a bounce.',
    exit:
      'First target at 1R from entry (partial). Trail the stop on the remainder below each higher low. Hard stop below the pre-market low. Exit all by 11 AM if the target has not been reached.',
    riskNote:
      'Gaps can fill rapidly if there is no follow-through volume. Avoid stocks gapping >15% — spreads widen and slippage destroys the edge. Always size down on high-float stocks.',
  },
  {
    id: 'momentum',
    name: 'Momentum',
    direction: 'LONG / SHORT',
    dirCls: 'text-sky-400 bg-sky-900/40 border-sky-800',
    timeframe: '5m / 15m',
    bestTime: '9:45 AM – 12:00 PM',
    risk: 'MEDIUM',
    scannerKey: 'gainers',
    description:
      'Momentum trading follows the principle "buy strength, sell weakness." You trade in the direction of the established trend, entering on pullbacks to key moving averages (8 EMA, 20 EMA) or on continuation breakouts above consolidation patterns.',
    setup:
      'Stock trending strongly intraday — three or more consecutive higher highs and higher lows on the 5-min chart. Volume is above average. Price is above VWAP for longs, below for shorts. Relative strength vs. SPY.',
    entry:
      'Enter as price bounces off the 8 or 20 EMA on a 5-min chart after a pullback, with a volume spike and a bullish candle close. Alternatively enter on a bull-flag breakout with 1.5× average volume.',
    exit:
      'Trail stop below each new higher low on the 5-min chart. Target the next key resistance (prior day high, round number, Fibonacci level). Exit 100% before any scheduled news catalyst.',
    riskNote:
      'Momentum can reverse without warning, especially around market open volatility. Never hold a losing momentum trade hoping for recovery — a broken trend is your stop signal.',
  },
  {
    id: 'vwap',
    name: 'VWAP',
    direction: 'LONG / SHORT',
    dirCls: 'text-sky-400 bg-sky-900/40 border-sky-800',
    timeframe: '5m / 15m',
    bestTime: 'All day',
    risk: 'LOW',
    scannerKey: 'mostActive',
    description:
      'VWAP (Volume Weighted Average Price) is the institutional benchmark price for the day. Large orders are worked around VWAP, making it a magnet for price. The strategy trades reversions to VWAP after extended moves, or uses VWAP as dynamic support/resistance for continuation trades.',
    setup:
      'High-volume liquid stock (>$1B market cap, >2M shares/day). Price has moved at least 1 VWAP standard deviation away. Volume decelerates at the extreme. Ideal on range-bound or moderate trend days.',
    entry:
      'Long: Buy as price reclaims VWAP from below with increasing volume and a close above on a 5-min candle. Short: Short the rejection at VWAP from above with a bearish close. Use VWAP ±1 SD as targets.',
    exit:
      'Target: Opposite VWAP standard deviation band (VWAP ±1SD). Stop: 5-min close back below/above VWAP. Scale out at VWAP, trail remainder to ±1SD.',
    riskNote:
      'On strong trending days, VWAP strategies lose edge — the trend pushes relentlessly away from VWAP without reverting. Identify the day type (trend vs. range) before deploying this strategy.',
  },
  {
    id: 'orb',
    name: 'Opening Range',
    direction: 'LONG / SHORT',
    dirCls: 'text-sky-400 bg-sky-900/40 border-sky-800',
    timeframe: '5m / 15m',
    bestTime: '9:45 – 10:30 AM',
    risk: 'MEDIUM',
    scannerKey: 'mostActive',
    description:
      'The Opening Range Breakout (ORB) defines the price channel established in the first 15 or 30 minutes of the session. A decisive break beyond that range, typically accompanied by news or macro catalyst, tends to produce a directional move equal to the range width or more.',
    setup:
      'Identify the high and low of the first 15-min candle. Wait for a close outside the range with at least 1.5× average 15-min volume. Best results when combined with a pre-market catalyst or earnings.',
    entry:
      'Long: Enter on the 5-min close above the ORB high with surge in volume. Short: Enter on the 5-min close below the ORB low. Place the order at market immediately after the confirming candle closes — do not wait.',
    exit:
      'Target: 2× the opening range width projected from the breakout point. Stop: Midpoint of the opening range (for aggressive traders) or the opposite boundary (for conservative). Time stop: exit by noon if target not hit.',
    riskNote:
      'False breakouts are common on low-catalyst, low-volume days. The ORB requires a reason to break out. Avoid this strategy on options expiration days and around FOMC announcements.',
  },
  {
    id: 'fade',
    name: 'Mean Reversion',
    direction: 'COUNTER-TREND',
    dirCls: 'text-amber-400 bg-amber-900/40 border-amber-800',
    timeframe: '5m / 15m',
    bestTime: '10:00 AM – 2:00 PM',
    risk: 'HIGH',
    scannerKey: 'losers',
    description:
      'Mean Reversion (the "Fade") trades against an overextended intraday move, expecting price to revert toward VWAP or the 20 EMA. Best used on heavily shorted or oversold stocks that moved dramatically on thin or dubious catalyst.',
    setup:
      'Stock down >5% intraday with no fundamental catalyst. Volume drying up after the initial move (volume taper = exhaustion). RSI below 20 on 5-min chart. Price extended >2 standard deviations from VWAP.',
    entry:
      'Wait for the first reversal candle — a hammer, doji, or engulfing pattern on the 5-min chart at a key support level. Enter above the high of the reversal candle with volume confirmation. Avoid entering into straight-line drops.',
    exit:
      'Target: VWAP or the 20 EMA on the 5-min chart. Partial at +0.5R. Stop: Below the intraday low. Never let a mean-reversion trade become a trend-following loss.',
    riskNote:
      'Most dangerous strategy for beginners. A trending stock can continue far beyond any "oversold" reading. Confirm no hard catalyst (earnings miss, fraud, SEC halt risk) before fading a large drop.',
  },
  {
    id: 'scalping',
    name: 'Scalping',
    direction: 'LONG / SHORT',
    dirCls: 'text-sky-400 bg-sky-900/40 border-sky-800',
    timeframe: '1m / tick',
    bestTime: '9:30 – 10:30 AM & 3:00 – 4:00 PM',
    risk: 'VERY HIGH',
    scannerKey: 'mostActive',
    description:
      'Scalping targets tiny price moves (10–30 cents) with large position sizes on the highest-volume, most liquid names. It relies on reading Level 2 order book imbalances and time & sales to anticipate very short-term price direction.',
    setup:
      'Only trade the five most liquid names that day (SPY, QQQ, AAPL, NVDA, TSLA). Bid-ask spread must be <$0.02. Active price action with visible order flow on Level 2. Requires a direct-access broker.',
    entry:
      'Enter on a micro-support/resistance level visible on the 1-min chart when the order book shows absorption (large bids absorbing sells for longs). Size 3–5× larger than other strategies since target per share is small.',
    exit:
      'Take profit at $0.10–$0.30 per share. Exit immediately at $0.10 loss — no exceptions, no hoping. Total focus on execution speed; each second of hesitation costs real money.',
    riskNote:
      'Commission costs eliminate the edge on most retail brokers. Requires zero-commission direct-access execution and Level 2 data. Psychologically the most demanding strategy — high frequency of decisions.',
  },
]

const RISK_CLS = {
  'LOW':       'text-emerald-400',
  'MEDIUM':    'text-amber-400',
  'HIGH':      'text-red-400',
  'VERY HIGH': 'text-red-400 font-bold',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PlanInput({ label, value, onChange, prefix, suffix, min, max, step }) {
  return (
    <div>
      <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">{label}</div>
      <div className="flex items-center bg-gray-800 border border-gray-700 rounded px-2 py-1.5 gap-1">
        {prefix && <span className="text-gray-500 text-xs">{prefix}</span>}
        <input
          type="number" value={value} min={min} max={max} step={step ?? 1}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="bg-transparent text-white text-sm w-20 focus:outline-none tabular-nums text-right"
        />
        {suffix && <span className="text-gray-500 text-xs">{suffix}</span>}
      </div>
    </div>
  )
}

function MetricBox({ label, value, cls }) {
  return (
    <div className="bg-gray-800/50 rounded px-3 py-2 min-w-[100px]">
      <div className="text-gray-600 text-xs mb-0.5 whitespace-nowrap">{label}</div>
      <div className={`font-bold text-sm tabular-nums ${cls}`}>{value}</div>
    </div>
  )
}

function CandidateRow({ stock, plan }) {
  const { capitalPerTrade, stopPct, rrRatio } = plan
  const price = stock.price
  if (!price || price <= 0) return null

  const shares      = Math.floor(capitalPerTrade / price)
  const stopPrice   = price * (1 - stopPct / 100)
  const targetPrice = price * (1 + (stopPct * rrRatio) / 100)
  const expGain     = shares * (targetPrice - price)
  const maxLoss     = shares * (price - stopPrice)
  const isPos       = (stock.changePercent ?? 0) >= 0

  return (
    <tr className="border-b border-gray-800/40 hover:bg-gray-800/40 transition-colors">
      <td className="py-2.5 px-3 font-bold text-white">{stock.symbol}</td>
      <td className="py-2.5 px-3 text-gray-400 max-w-[160px] truncate">{stock.name}</td>
      <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{fmt.price(price)}</td>
      <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
        {stock.changePercent != null ? `${isPos ? '+' : ''}${stock.changePercent.toFixed(2)}%` : '—'}
      </td>
      <td className="py-2.5 px-3 text-right text-gray-500 tabular-nums">
        {stock.volume != null ? `${(stock.volume / 1e6).toFixed(1)}M` : '—'}
      </td>
      <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">
        ${capitalPerTrade.toLocaleString('en-US', { maximumFractionDigits: 0 })}
      </td>
      <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{shares.toLocaleString()}</td>
      <td className="py-2.5 px-3 text-right text-emerald-400 tabular-nums">{fmt.price(targetPrice)}</td>
      <td className="py-2.5 px-3 text-right text-red-400 tabular-nums">{fmt.price(stopPrice)}</td>
      <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-emerald-400">
        +${expGain.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
      </td>
      <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-red-400">
        -${maxLoss.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
      </td>
    </tr>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DayTrader() {
  const [capital,      setCapital]      = useState(10000)
  const [targetPct,    setTargetPct]    = useState(2)
  const [maxLossPct,   setMaxLossPct]   = useState(1)
  const [tradesPerDay, setTradesPerDay] = useState(5)
  const [stopPct,      setStopPct]      = useState(1)
  const [rrRatio,      setRrRatio]      = useState(2)
  const [activeId,     setActiveId]     = useState('gap_go')
  const [scanData,     setScanData]     = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [lastFetch,    setLastFetch]    = useState(null)
  const [error,        setError]        = useState(null)

  const fetchScanners = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/day-trader/scanners')
      if (!r.ok) throw new Error(`Server error ${r.status}`)
      setScanData(await r.json())
      setLastFetch(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchScanners() }, [fetchScanners])

  // Derived plan values
  const capitalPerTrade = capital / Math.max(tradesPerDay, 1)
  const targetDollar    = capital * targetPct / 100
  const maxLossDollar   = capital * maxLossPct / 100
  const targetPerTrade  = capitalPerTrade * stopPct * rrRatio / 100
  const stopPerTrade    = capitalPerTrade * stopPct / 100
  const winRateNeeded   = Math.round(100 / (1 + rrRatio))

  const plan = { capitalPerTrade, stopPct, rrRatio }

  const strategy   = STRATEGIES.find(s => s.id === activeId)
  const candidates = scanData
    ? (strategy.scannerKey === 'gainers'    ? scanData.gainers
     : strategy.scannerKey === 'losers'     ? scanData.losers
     : scanData.mostActive) ?? []
    : []

  return (
    <div className="p-4 max-w-7xl mx-auto">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Day Trader</div>
        <div className="flex items-center gap-3">
          {lastFetch && !loading && (
            <span className="text-gray-600 text-xs">
              Updated {lastFetch.toLocaleTimeString()} · scanners refresh every 5 min
            </span>
          )}
          <button onClick={fetchScanners} disabled={loading}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-400 hover:text-white px-3 py-1 text-xs rounded transition-colors">
            {loading ? <span className="animate-pulse">↻ Loading…</span> : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded px-4 py-3 mb-4">
          ⚠ {error}
        </div>
      )}

      {/* ── Trading Plan ── */}
      <section className="bg-gray-900/60 border border-gray-800 rounded-lg px-5 py-4 mb-6">
        <div className="text-gray-600 text-xs uppercase tracking-widest mb-4">Trading Plan</div>

        <div className="flex flex-wrap gap-4 items-end mb-5">
          <PlanInput label="Capital"       value={capital}      onChange={setCapital}      prefix="$" min={500}  max={10000000} step={500}  />
          <PlanInput label="Daily Target"  value={targetPct}    onChange={setTargetPct}    suffix="%" min={0.1}  max={20}       step={0.5}  />
          <PlanInput label="Max Daily Loss" value={maxLossPct}   onChange={setMaxLossPct}   suffix="%" min={0.1}  max={20}       step={0.5}  />
          <PlanInput label="Planned Trades" value={tradesPerDay} onChange={setTradesPerDay}            min={1}    max={20}       step={1}    />
          <PlanInput label="Stop/Trade"    value={stopPct}      onChange={setStopPct}      suffix="%" min={0.25} max={10}       step={0.25} />
          <PlanInput label="R/R Ratio"     value={rrRatio}      onChange={setRrRatio}      suffix=":1" min={1}   max={10}       step={0.5}  />
        </div>

        <div className="flex flex-wrap gap-3">
          <MetricBox label="Daily Target"    value={`+$${targetDollar.toLocaleString('en-US',{maximumFractionDigits:0})}`}    cls="text-emerald-400" />
          <MetricBox label="Max Daily Loss"  value={`-$${maxLossDollar.toLocaleString('en-US',{maximumFractionDigits:0})}`}   cls="text-red-400" />
          <MetricBox label="Capital / Trade" value={`$${capitalPerTrade.toLocaleString('en-US',{maximumFractionDigits:0})}`}  cls="text-white" />
          <MetricBox label="Target / Trade"  value={`+$${targetPerTrade.toLocaleString('en-US',{maximumFractionDigits:0})}`}  cls="text-emerald-400" />
          <MetricBox label="Stop / Trade"    value={`-$${stopPerTrade.toLocaleString('en-US',{maximumFractionDigits:0})}`}    cls="text-red-400" />
          <MetricBox label="Win Rate Needed" value={`${winRateNeeded}%`}                                                       cls="text-gray-300" />
          <MetricBox label="Trades to Target" value={`${Math.ceil(targetDollar / targetPerTrade)} wins`}                      cls="text-gray-300" />
        </div>

        <div className="mt-4 text-gray-700 text-xs border-t border-gray-800/60 pt-3">
          Disclaimer: Day trading involves substantial risk of loss. Trade sizing above is illustrative only — adjust per your broker's margin rules and your own risk tolerance.
        </div>
      </section>

      {/* ── Strategy selector ── */}
      <div className="flex flex-wrap gap-2 mb-6">
        {STRATEGIES.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveId(s.id)}
            className={`px-4 py-2 rounded-lg border text-xs font-medium transition-colors ${
              activeId === s.id
                ? 'bg-gray-700 border-gray-500 text-white'
                : 'bg-gray-900/60 border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700'
            }`}
          >
            {s.name}
            <span className={`ml-1.5 ${RISK_CLS[s.risk]}`}>[{s.risk}]</span>
          </button>
        ))}
      </div>

      {/* ── Strategy detail ── */}
      {strategy && (
        <div className="space-y-5">

          {/* Description + rules */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

            {/* Left: overview */}
            <div className="lg:col-span-2 bg-gray-900/60 border border-gray-800 rounded-lg px-5 py-4">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-white font-bold text-base">{strategy.name}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded border ${strategy.dirCls}`}>
                  {strategy.direction}
                </span>
                <span className={`text-xs font-semibold ml-auto ${RISK_CLS[strategy.risk]}`}>
                  {strategy.risk} RISK
                </span>
              </div>
              <p className="text-gray-400 text-xs leading-relaxed mb-4">{strategy.description}</p>
              <div className="flex gap-5 text-xs">
                <div>
                  <span className="text-gray-600 uppercase tracking-wide">Timeframe</span>
                  <div className="text-gray-300 mt-0.5">{strategy.timeframe}</div>
                </div>
                <div>
                  <span className="text-gray-600 uppercase tracking-wide">Best Window</span>
                  <div className="text-gray-300 mt-0.5">{strategy.bestTime}</div>
                </div>
              </div>
            </div>

            {/* Right: rules */}
            <div className="lg:col-span-3 space-y-2">
              {[
                { label: 'Setup',     cls: 'text-sky-400',     text: strategy.setup },
                { label: 'Entry',     cls: 'text-emerald-400', text: strategy.entry },
                { label: 'Exit',      cls: 'text-amber-400',   text: strategy.exit },
                { label: 'Risk Note', cls: 'text-red-400',     text: strategy.riskNote },
              ].map(({ label, cls, text }) => (
                <div key={label} className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3">
                  <div className={`text-xs font-bold uppercase tracking-wider mb-1 ${cls}`}>{label}</div>
                  <div className="text-gray-400 text-xs leading-relaxed">{text}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Candidates table */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="text-gray-600 text-xs uppercase tracking-widest">
                Live Candidates — {strategy.name}
              </div>
              <div className="text-gray-700 text-xs">
                Trade sizing based on your plan · Stop {stopPct}% · Target {(stopPct * rrRatio).toFixed(1)}% · {rrRatio}:1 R/R
              </div>
            </div>
            <div className="bg-gray-900/60 border border-gray-800 rounded-lg overflow-x-auto">
              {loading && (
                <div className="py-14 text-center text-gray-500 text-sm animate-pulse">
                  Scanning markets…
                </div>
              )}
              {!loading && candidates.length === 0 && (
                <div className="py-14 text-center text-gray-600 text-sm">
                  No candidates — markets may be closed or scanner returned no results
                </div>
              )}
              {!loading && candidates.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {[
                        ['Symbol',   'text-left'],
                        ['Name',     'text-left'],
                        ['Price',    'text-right'],
                        ['Chg %',    'text-right'],
                        ['Volume',   'text-right'],
                        ['Alloc',    'text-right'],
                        ['Shares',   'text-right'],
                        ['Target',   'text-right'],
                        ['Stop',     'text-right'],
                        ['Exp Gain', 'text-right'],
                        ['Max Loss', 'text-right'],
                      ].map(([h, align]) => (
                        <th key={h} className={`py-2.5 px-3 text-gray-600 font-medium tracking-wider uppercase ${align}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {candidates
                      .filter(s => s.price > 0)
                      .map(stock => (
                        <CandidateRow key={stock.symbol} stock={stock} plan={plan} />
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

        </div>
      )}
    </div>
  )
}
