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
      'Long: Enter on the 5-min close above the ORB high with surge in volume. Short: Enter on the 5-min close below the ORB low similarly.',
    exit:
      'Target: 2× the opening range width projected from the breakout point. Stop: Midpoint of the opening range (aggressive) or the opposite boundary (conservative). Time stop: exit by noon if target not hit.',
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
      'Mean Reversion (the "Fade") trades against an overextended intraday move, expecting price to revert toward VWAP or the 20 EMA. Best used on stocks that have moved dramatically without a fundamental catalyst.',
    setup:
      'Stock down >5% intraday with no fundamental catalyst. RSI below 20 on 5-min chart. Volume drying up after the initial move. Price extended >2 standard deviations from VWAP.',
    entry:
      'Wait for the first reversal candle — a hammer, doji, or engulfing pattern at a key support level on the 5-min chart. Enter above the high of the reversal candle with volume confirmation.',
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
      'Only trade the five most liquid names that day (SPY, QQQ, AAPL, NVDA, TSLA). Bid-ask spread must be <$0.02. Active price action with visible order flow on Level 2.',
    entry:
      'Enter on a micro-support/resistance level visible on the 1-min chart when the order book shows absorption (large bids absorbing sells for longs). Size 3–5× larger than other strategies since target per share is small.',
    exit:
      'Take profit at $0.10–$0.30 per share. Exit immediately at $0.10 loss — no exceptions, no hoping. Total focus on execution speed.',
    riskNote:
      'Commission costs eliminate the edge on most retail brokers. Requires zero-commission direct-access execution and Level 2 data. Psychologically the most demanding strategy.',
  },
]

const RISK_CLS = {
  'LOW':       'text-emerald-400',
  'MEDIUM':    'text-amber-400',
  'HIGH':      'text-red-400',
  'VERY HIGH': 'text-red-400 font-bold',
}

// ── Alert generation (client-side from scanner data) ─────────────────────────

function generateAlerts(scanData) {
  if (!scanData) return []
  const seen = new Set()
  const alerts = []

  const push = (alert) => {
    if (!seen.has(alert.symbol)) {
      seen.add(alert.symbol)
      alerts.push(alert)
    }
  }

  ;(scanData.gainers || []).forEach(s => {
    const chg = s.changePercent ?? 0
    if (chg >= 8)
      push({ ...s, alertType: 'SURGE',    severity: 'high',   bull: true,
             message: `Up +${chg.toFixed(1)}% — prime Gap & Go candidate`,          strategy: 'Gap & Go' })
    else if (chg >= 4)
      push({ ...s, alertType: 'MOMENTUM', severity: 'medium', bull: true,
             message: `Up +${chg.toFixed(1)}% — momentum breakout forming`,          strategy: 'Momentum' })
    else if (chg >= 2)
      push({ ...s, alertType: 'STRENGTH', severity: 'low',    bull: true,
             message: `Up +${chg.toFixed(1)}% — early intraday strength`,            strategy: 'Momentum / ORB' })
  })

  ;(scanData.losers || []).forEach(s => {
    const chg = s.changePercent ?? 0
    if (chg <= -8)
      push({ ...s, alertType: 'SELL-OFF', severity: 'high',   bull: false,
             message: `Down ${chg.toFixed(1)}% — fade / mean-reversion setup`,       strategy: 'Mean Reversion' })
    else if (chg <= -4)
      push({ ...s, alertType: 'WEAKNESS', severity: 'medium', bull: false,
             message: `Down ${chg.toFixed(1)}% — short momentum candidate`,          strategy: 'Momentum Short' })
    else if (chg <= -2)
      push({ ...s, alertType: 'DECLINE',  severity: 'low',    bull: false,
             message: `Down ${chg.toFixed(1)}% — selling pressure building`,         strategy: 'Mean Reversion' })
  })

  ;(scanData.mostActive || []).forEach(s => {
    const vol = s.volume ?? 0
    if (vol > 10e6)
      push({ ...s, alertType: 'HIGH VOL', severity: 'medium', bull: null,
             message: `${(vol / 1e6).toFixed(0)}M shares — extreme liquidity`,        strategy: 'Scalping / VWAP' })
    else if (vol > 5e6)
      push({ ...s, alertType: 'ACTIVE',   severity: 'low',    bull: null,
             message: `${(vol / 1e6).toFixed(1)}M shares — strong liquidity`,         strategy: 'VWAP / ORB' })
  })

  const sevOrder = { high: 0, medium: 1, low: 2 }
  const bullOrder = (v) => (v === true ? 0 : v === false ? 1 : 2)
  return alerts.sort((a, b) => {
    const s = sevOrder[a.severity] - sevOrder[b.severity]
    return s !== 0 ? s : bullOrder(a.bull) - bullOrder(b.bull)
  })
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
    <div className="bg-gray-800/50 rounded px-3 py-2">
      <div className="text-gray-600 text-xs mb-0.5 whitespace-nowrap">{label}</div>
      <div className={`font-bold text-sm tabular-nums ${cls}`}>{value}</div>
    </div>
  )
}

function AlertCard({ alert }) {
  const typeCls =
    alert.bull === true  ? 'text-emerald-400 bg-emerald-900/40 border-emerald-800' :
    alert.bull === false ? 'text-red-400    bg-red-900/40    border-red-800'     :
                           'text-sky-400    bg-sky-900/40    border-sky-800'

  const dotCls =
    alert.severity === 'high'   ? (alert.bull === false ? 'bg-red-400' : 'bg-emerald-400') :
    alert.severity === 'medium' ? 'bg-amber-400' : 'bg-sky-500'

  const chg = alert.changePercent

  return (
    <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg px-3 py-2.5 hover:bg-gray-800 transition-colors">
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
        <span className="text-white text-xs font-bold">{alert.symbol}</span>
        {alert.price != null && (
          <span className="text-gray-500 text-xs tabular-nums">{fmt.price(alert.price)}</span>
        )}
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ml-auto ${typeCls}`}>
          {alert.alertType}
        </span>
      </div>
      <div className="text-gray-400 text-xs leading-relaxed">{alert.message}</div>
      <div className="flex items-center gap-2 mt-1.5">
        {chg != null && (
          <span className={`text-xs font-medium tabular-nums ${chg >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
          </span>
        )}
        <span className="text-gray-700 text-xs ml-auto">{alert.strategy}</span>
      </div>
    </div>
  )
}

function DayNewsItem({ article }) {
  const time = article.publishedAt
    ? (() => {
        const d = new Date(article.publishedAt)
        return isNaN(d) ? null : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      })()
    : null

  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-gray-800/50 border border-gray-700/40 rounded-lg px-3 py-2.5 hover:bg-gray-800 hover:border-gray-600 transition-colors group"
    >
      {article.symbol && (
        <span className="text-sky-400 text-xs font-bold mr-1.5">{article.symbol}</span>
      )}
      <div className="text-white text-xs font-medium leading-snug group-hover:text-sky-300 transition-colors mt-0.5">
        {article.title}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        {article.publisher && <span className="text-gray-500 text-xs">{article.publisher}</span>}
        {time && <span className="text-gray-600 text-xs ml-auto">{time}</span>}
        <span className={`text-gray-700 text-xs group-hover:text-sky-600 transition-colors ${!time ? 'ml-auto' : ''}`}>↗</span>
      </div>
    </a>
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
      <td className="py-2.5 px-3 text-gray-400 max-w-[140px] truncate">{stock.name}</td>
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
      <td className="py-2.5 px-3 text-right text-red-400    tabular-nums">{fmt.price(stopPrice)}</td>
      <td className="py-2.5 px-3 text-right text-emerald-400 font-semibold tabular-nums">
        +${expGain.toLocaleString('en-US', { maximumFractionDigits: 0 })}
      </td>
      <td className="py-2.5 px-3 text-right text-red-400 font-semibold tabular-nums">
        -${maxLoss.toLocaleString('en-US', { maximumFractionDigits: 0 })}
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
  const [newsData,     setNewsData]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [newsLoading,  setNewsLoading]  = useState(true)
  const [lastFetch,    setLastFetch]    = useState(null)
  const [error,        setError]        = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true); setNewsLoading(true); setError(null)
    try {
      const [rScan, rNews] = await Promise.all([
        fetch('/api/day-trader/scanners'),
        fetch('/api/day-trader/news'),
      ])
      if (!rScan.ok) throw new Error(`Scanner error ${rScan.status}`)
      setScanData(await rScan.json())
      if (rNews.ok) setNewsData(await rNews.json())
      setLastFetch(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false); setNewsLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Derived plan values
  const capitalPerTrade = capital / Math.max(tradesPerDay, 1)
  const targetDollar    = capital * targetPct / 100
  const maxLossDollar   = capital * maxLossPct / 100
  const targetPerTrade  = capitalPerTrade * stopPct * rrRatio / 100
  const stopPerTrade    = capitalPerTrade * stopPct / 100
  const winRateNeeded   = Math.round(100 / (1 + rrRatio))

  const plan       = { capitalPerTrade, stopPct, rrRatio }
  const alerts     = generateAlerts(scanData)
  const strategy   = STRATEGIES.find(s => s.id === activeId)
  const candidates = scanData
    ? (strategy.scannerKey === 'gainers'  ? scanData.gainers
     : strategy.scannerKey === 'losers'   ? scanData.losers
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
              Updated {lastFetch.toLocaleTimeString()} · refreshes every 5 min
            </span>
          )}
          <button onClick={fetchAll} disabled={loading}
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

      {/* ── Trading Plan (full width) ── */}
      <section className="bg-gray-900/60 border border-gray-800 rounded-lg px-5 py-4 mb-6">
        <div className="text-gray-600 text-xs uppercase tracking-widest mb-4">Trading Plan</div>
        <div className="flex flex-wrap gap-4 items-end mb-5">
          <PlanInput label="Capital"        value={capital}      onChange={setCapital}      prefix="$"  min={500}  max={10000000} step={500}  />
          <PlanInput label="Daily Target"   value={targetPct}    onChange={setTargetPct}    suffix="%"  min={0.1}  max={20}       step={0.5}  />
          <PlanInput label="Max Daily Loss" value={maxLossPct}   onChange={setMaxLossPct}   suffix="%"  min={0.1}  max={20}       step={0.5}  />
          <PlanInput label="Planned Trades" value={tradesPerDay} onChange={setTradesPerDay}             min={1}    max={20}       step={1}    />
          <PlanInput label="Stop / Trade"   value={stopPct}      onChange={setStopPct}      suffix="%"  min={0.25} max={10}       step={0.25} />
          <PlanInput label="R/R Ratio"      value={rrRatio}      onChange={setRrRatio}      suffix=":1" min={1}    max={10}       step={0.5}  />
        </div>
        <div className="flex flex-wrap gap-3">
          <MetricBox label="Daily Target"     value={`+$${targetDollar.toLocaleString('en-US',{maximumFractionDigits:0})}`}   cls="text-emerald-400" />
          <MetricBox label="Max Daily Loss"   value={`-$${maxLossDollar.toLocaleString('en-US',{maximumFractionDigits:0})}`}  cls="text-red-400" />
          <MetricBox label="Capital / Trade"  value={`$${capitalPerTrade.toLocaleString('en-US',{maximumFractionDigits:0})}`} cls="text-white" />
          <MetricBox label="Target / Trade"   value={`+$${targetPerTrade.toLocaleString('en-US',{maximumFractionDigits:0})}`} cls="text-emerald-400" />
          <MetricBox label="Stop / Trade"     value={`-$${stopPerTrade.toLocaleString('en-US',{maximumFractionDigits:0})}`}   cls="text-red-400" />
          <MetricBox label="Win Rate Needed"  value={`${winRateNeeded}%`}                                                      cls="text-gray-300" />
          <MetricBox label="Wins to Target"   value={`${Math.ceil(targetDollar / targetPerTrade)} trades`}                     cls="text-gray-300" />
        </div>
        <div className="mt-4 text-gray-700 text-xs border-t border-gray-800/60 pt-3">
          Disclaimer: Day trading involves substantial risk of loss. Sizing above is illustrative only — adjust per your broker's margin rules and your own risk tolerance.
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

      {/* ── Main content + sidebar ── */}
      <div className="flex gap-5 items-start">

        {/* ── Left: strategy + candidates ── */}
        <div className="flex-1 min-w-0 space-y-5">
          {strategy && (
            <>
              {/* Description + rules */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
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
                      <div className="text-gray-600 uppercase tracking-wide text-xs">Timeframe</div>
                      <div className="text-gray-300 mt-0.5">{strategy.timeframe}</div>
                    </div>
                    <div>
                      <div className="text-gray-600 uppercase tracking-wide text-xs">Best Window</div>
                      <div className="text-gray-300 mt-0.5">{strategy.bestTime}</div>
                    </div>
                  </div>
                </div>

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
                    Stop {stopPct}% · Target {(stopPct * rrRatio).toFixed(1)}% · {rrRatio}:1 R/R
                  </div>
                </div>
                <div className="bg-gray-900/60 border border-gray-800 rounded-lg overflow-x-auto">
                  {loading && (
                    <div className="py-12 text-center text-gray-500 text-sm animate-pulse">Scanning markets…</div>
                  )}
                  {!loading && candidates.length === 0 && (
                    <div className="py-12 text-center text-gray-600 text-sm">
                      No candidates — markets may be closed or scanner returned no results
                    </div>
                  )}
                  {!loading && candidates.length > 0 && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-800">
                          {[
                            ['Symbol', 'text-left'], ['Name', 'text-left'],
                            ['Price', 'text-right'], ['Chg %', 'text-right'],
                            ['Volume', 'text-right'], ['Alloc', 'text-right'],
                            ['Shares', 'text-right'], ['Target', 'text-right'],
                            ['Stop', 'text-right'], ['Exp Gain', 'text-right'],
                            ['Max Loss', 'text-right'],
                          ].map(([h, align]) => (
                            <th key={h} className={`py-2.5 px-3 text-gray-600 font-medium tracking-wider uppercase ${align}`}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.filter(s => s.price > 0).map(stock => (
                          <CandidateRow key={stock.symbol} stock={stock} plan={plan} />
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </>
          )}
        </div>

        {/* ── Right sidebar: alerts + news ── */}
        <aside className="w-80 shrink-0 space-y-5">

          {/* Trade Alerts */}
          <section>
            <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">
              Trade Alerts
              {alerts.length > 0 && (
                <span className="ml-2 text-amber-400 font-bold">{alerts.length}</span>
              )}
            </div>
            {loading && (
              <div className="text-gray-600 text-xs text-center py-6 animate-pulse">Scanning…</div>
            )}
            {!loading && alerts.length === 0 && (
              <div className="text-gray-700 text-xs text-center py-6">
                No alerts — markets may be closed
              </div>
            )}
            <div className="space-y-2">
              {alerts.map((alert, i) => (
                <AlertCard key={`${alert.symbol}-${alert.alertType}-${i}`} alert={alert} />
              ))}
            </div>
          </section>

          {/* News Feed */}
          <section>
            <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">News Feed</div>
            {newsLoading && (
              <div className="text-gray-600 text-xs text-center py-6 animate-pulse">Loading news…</div>
            )}
            {!newsLoading && newsData.length === 0 && (
              <div className="text-gray-700 text-xs text-center py-6">No news available</div>
            )}
            <div className="space-y-2 max-h-[calc(100vh-12rem)] overflow-y-auto pr-0.5 scrollbar-thin">
              {newsData.map((article, i) => (
                <DayNewsItem key={i} article={article} />
              ))}
            </div>
          </section>

        </aside>
      </div>
    </div>
  )
}
