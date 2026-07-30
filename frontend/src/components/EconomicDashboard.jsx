import { useState, useEffect } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtVal(v, unit, mode) {
  if (v == null) return '—'
  if (mode === 'yoy' || unit === '%') return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
  if (mode === 'mom_abs') return `${v >= 0 ? '+' : ''}${v.toFixed(0)}K`
  if (unit === '$/oz' || unit === '$/bbl') return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
  if (unit === '$/lb' || unit === '$/MMBtu') return `$${v.toFixed(3)}`
  if (unit === 'K') return `${v.toFixed(0)}K`
  return v.toFixed(2)
}

function sentiment(indicator) {
  const { value, change, mode, hib } = indicator
  if (hib == null) return 'neutral'
  if (change == null && mode !== 'mom_abs') return 'neutral'
  const delta = mode === 'mom_abs' ? value : change
  if (delta == null) return 'neutral'
  const up = delta > 0
  if (hib && up)   return 'good'
  if (hib && !up)  return 'bad'
  if (!hib && up)  return 'bad'
  return 'good'
}

const COLOR = {
  good:    'text-emerald-400',
  bad:     'text-red-400',
  neutral: 'text-slate-400',
}
const BG = {
  good:    'border-emerald-700/40 bg-emerald-900/10',
  bad:     'border-red-700/40 bg-red-900/10',
  neutral: 'border-slate-700',
}
const DOT = {
  good:    'bg-emerald-400',
  bad:     'bg-red-400',
  neutral: 'bg-slate-500',
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ data, good }) {
  if (!data || data.length < 2) return null
  const w = 72, h = 26
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const color = good === true ? '#34d399' : good === false ? '#f87171' : '#94a3b8'
  return (
    <svg width={w} height={h} className="overflow-visible shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
    </svg>
  )
}

// ── Yield curve bar chart ─────────────────────────────────────────────────────

function YieldBar({ label, value, maxY }) {
  if (value == null) return (
    <div className="flex items-center gap-2">
      <span className="text-slate-500 text-xs w-6">{label}</span>
      <div className="flex-1 h-4 bg-slate-700/50 rounded" />
      <span className="text-slate-600 text-xs w-10 text-right">—</span>
    </div>
  )
  const pct = Math.min(100, (value / (maxY * 1.15)) * 100)
  const up = value >= 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400 text-xs w-6 shrink-0">{label}</span>
      <div className="flex-1 bg-slate-700/50 rounded overflow-hidden h-4">
        <div className="h-4 rounded bg-blue-500/70 transition-all"
          style={{ width: `${pct}%` }} />
      </div>
      <span className="text-white text-xs font-bold w-12 text-right tabular-nums">
        {value.toFixed(2)}%
      </span>
    </div>
  )
}

// ── FRED indicator card ───────────────────────────────────────────────────────

function FredCard({ ind }) {
  if (!ind || ind.error) return (
    <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 opacity-50">
      <p className="text-xs text-slate-400 mb-1">{ind?.name || '—'}</p>
      <p className="text-slate-600 text-xs">No data</p>
    </div>
  )
  const s   = sentiment(ind)
  const col = COLOR[s]
  const bg  = BG[s]
  const dot = DOT[s]
  const spark_good = ind.hib == null ? null : ind.hib
  // for yoy mode with hib=false (inflation), lower is better, so good sparkline goes down
  const sparkGood = ind.hib == null ? null : ind.hib

  const changeStr = (() => {
    if (ind.mode === 'mom_abs') return null
    if (ind.change == null) return null
    const sign = ind.change > 0 ? '+' : ''
    if (ind.unit === '%' || ind.mode === 'yoy') return `${sign}${ind.change.toFixed(2)}pp`
    return `${sign}${ind.change.toFixed(2)}`
  })()

  return (
    <div className={`bg-slate-800 rounded-xl p-3 border ${bg} flex flex-col gap-2`}>
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
          <p className="text-xs text-slate-400 truncate">{ind.name}</p>
        </div>
        {ind.date && <p className="text-xs text-slate-600 shrink-0">{ind.date.slice(0, 7)}</p>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className={`text-xl font-bold tabular-nums ${col}`}>
            {fmtVal(ind.value, ind.unit, ind.mode)}
          </p>
          {changeStr && (
            <p className={`text-xs tabular-nums mt-0.5 ${col}`}>
              {changeStr} <span className="text-slate-500">prev mo</span>
            </p>
          )}
        </div>
        <Sparkline data={ind.sparkline} good={sparkGood} />
      </div>
    </div>
  )
}

// ── Market macro card ─────────────────────────────────────────────────────────

function MacroCard({ m }) {
  const up = (m.changePct || 0) >= 0
  return (
    <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-slate-400 truncate">{m.name}</p>
        <p className="text-white font-bold text-sm tabular-nums mt-0.5">
          {m.unit === '%' ? `${m.price?.toFixed(2)}%`
            : m.unit === '$/oz' ? `$${m.price?.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            : m.price?.toFixed(m.price > 100 ? 1 : 3)}
          {m.unit && m.unit !== '%' && m.unit !== '$/oz' && m.unit !== '$/bbl'
            ? ` ${m.unit}` : ''}
        </p>
      </div>
      {m.changePct != null && (
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums shrink-0 ${
          up ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'
        }`}>
          {up ? '+' : ''}{m.changePct.toFixed(2)}%
        </span>
      )}
    </div>
  )
}

// ── Hero stat card ────────────────────────────────────────────────────────────

function HeroCard({ label, value, change, unit, mode, hib, date }) {
  const s   = hib == null ? 'neutral' : (change == null ? 'neutral'
    : ((change > 0) === hib ? 'good' : 'bad'))
  return (
    <div className={`bg-slate-800 rounded-xl p-4 border ${BG[s]}`}>
      <p className="text-xs text-slate-400 font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${COLOR[s]}`}>
        {value != null ? fmtVal(value, unit, mode) : '—'}
      </p>
      {change != null && mode !== 'mom_abs' && (
        <p className={`text-xs mt-1 tabular-nums ${COLOR[s]}`}>
          {change > 0 ? '+' : ''}{change.toFixed(2)}
          {mode === 'yoy' ? 'pp' : unit === '%' ? 'pp' : ''} vs prev
        </p>
      )}
      {date && <p className="text-xs text-slate-600 mt-1">{date.slice(0, 7)}</p>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const FRED_ORDER = [
  "FEDFUNDS","CPIAUCSL","CPILFESL","PCEPILFE",
  "UNRATE","PAYEMS","ICSA","GDPC1",
  "UMCSENT","HOUST","RSXFS","INDPRO",
]

export default function EconomicDashboard() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  function load() {
    setLoading(true)
    setError(null)
    fetch('/api/market/economic')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  const yields = data?.yields || {}
  const macro  = data?.macro  || []
  const fred   = data?.fred   || {}

  const yields_list  = macro.filter(m => m.group === 'yields')
  const macro_rest   = macro.filter(m => m.group !== 'yields')
  const maxY = Math.max(...yields_list.map(m => m.price || 0), 0.1)

  // Hero cards from FRED
  const hero_sids = ["FEDFUNDS","CPIAUCSL","UNRATE","GDPC1"]

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Economic Indicators</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Real-time market rates, yield curve, and US economic releases.
            {data?.asOf && <span className="text-slate-600 ml-2">Updated {data.asOf}</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-xl transition-colors disabled:opacity-50 shrink-0">
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {error && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>}

      {loading && !data && (
        <div className="py-20 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-slate-600 border-t-blue-500 animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Loading economic data…</p>
        </div>
      )}

      {data && (
        <>
          {/* FRED hero cards (if available) */}
          {data.hasFred && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {hero_sids.map(sid => {
                const ind = fred[sid]
                const meta = {
                  FEDFUNDS: { label: 'Fed Funds Rate', hib: null },
                  CPIAUCSL: { label: 'CPI Inflation (YoY)', hib: false },
                  UNRATE:   { label: 'Unemployment', hib: false },
                  GDPC1:    { label: 'Real GDP Growth', hib: true },
                }[sid]
                if (!ind || ind.error) return (
                  <div key={sid} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                    <p className="text-xs text-slate-400">{meta.label}</p>
                    <p className="text-2xl font-bold text-slate-600 mt-1">—</p>
                  </div>
                )
                return <HeroCard key={sid} label={meta.label}
                  value={ind.value} change={ind.change}
                  unit={ind.unit} mode={ind.mode} hib={meta.hib} date={ind.date} />
              })}
            </div>
          )}

          {/* Two-column: yield curve + market indicators */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Yield Curve */}
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-white">US Treasury Yield Curve</h2>
                {yields.inverted && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-900/50 text-red-400 border border-red-700/40">
                    ⚠ Inverted
                  </span>
                )}
              </div>
              <div className="space-y-2.5">
                {[
                  { label: '3M',  key: '3M',  sym: '^IRX' },
                  { label: '5Y',  key: '5Y',  sym: '^FVX' },
                  { label: '10Y', key: '10Y', sym: '^TNX' },
                  { label: '30Y', key: '30Y', sym: '^TYX' },
                ].map(({ label, key }) => (
                  <YieldBar key={key} label={label} value={yields[key]} maxY={maxY} />
                ))}
              </div>
              {yields.spread10y3m != null && (
                <div className={`mt-4 pt-3 border-t border-slate-700 flex items-center justify-between text-xs`}>
                  <span className="text-slate-400">10Y–3M Spread (recession signal)</span>
                  <span className={`font-bold tabular-nums ${yields.inverted ? 'text-red-400' : 'text-emerald-400'}`}>
                    {yields.spread10y3m > 0 ? '+' : ''}{yields.spread10y3m.toFixed(2)}%
                  </span>
                </div>
              )}
              {yields.inverted && (
                <p className="mt-2 text-xs text-red-300/80">
                  An inverted 10Y–3M yield curve has preceded every US recession since 1969. It signals the market expects the Fed to cut rates due to slowing growth.
                </p>
              )}
            </div>

            {/* Market Indicators grid */}
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-white px-0.5">Market Indicators</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {macro_rest.map(m => <MacroCard key={m.sym} m={m} />)}
              </div>
              <p className="text-xs text-slate-600">
                DXY: US Dollar strength. VIX: market fear index (above 30 = high volatility). Copper is a leading economic indicator ("Dr. Copper" often signals growth before official data).
              </p>
            </div>
          </div>

          {/* FRED economic indicators grid */}
          {data.hasFred && Object.keys(fred).length > 0 ? (
            <div>
              <h2 className="text-sm font-bold text-white mb-3">Economic Releases (FRED)</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {FRED_ORDER.filter(sid => fred[sid]).map(sid => (
                  <FredCard key={sid} ind={fred[sid]} />
                ))}
              </div>
              <div className="mt-3 grid sm:grid-cols-3 gap-3 text-xs text-slate-500 bg-slate-800/40 rounded-xl p-4 border border-slate-700/40">
                <div>
                  <p className="text-slate-300 font-semibold mb-1">Inflation (lower = better)</p>
                  <p>CPI / Core CPI / Core PCE show YoY % change. Core strips out food &amp; energy. PCE is the Fed's preferred inflation gauge (2% target).</p>
                </div>
                <div>
                  <p className="text-slate-300 font-semibold mb-1">Labor Market (higher = better)</p>
                  <p>Nonfarm Payrolls shows monthly jobs added (K). Initial Claims shows weekly new unemployment filings — above 300K signals weakness.</p>
                </div>
                <div>
                  <p className="text-slate-300 font-semibold mb-1">Growth (higher = better)</p>
                  <p>Real GDP growth YoY. Consumer Sentiment, Housing Starts, Retail Sales, and Industrial Production are leading/coincident indicators. Cached 30 minutes.</p>
                </div>
              </div>
            </div>
          ) : !data.hasFred && (
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-base font-bold text-white mb-2">Unlock Economic Data</h2>
              <p className="text-sm text-slate-400 mb-4">
                Add a free FRED API key to see CPI, unemployment, GDP, payrolls, housing starts, consumer sentiment, and more — with historical sparklines.
              </p>
              <ol className="space-y-2 text-sm text-slate-300">
                <li><span className="text-blue-400 font-bold">1.</span> Visit <span className="font-mono text-blue-300">fred.stlouisfed.org</span> → sign up (free) → copy your API key</li>
                <li><span className="text-blue-400 font-bold">2.</span> Open <span className="font-mono text-slate-400">backend/.env</span> and add:</li>
              </ol>
              <pre className="mt-2 mb-4 bg-slate-900 rounded-lg p-3 text-xs text-emerald-300 font-mono overflow-x-auto">
                FRED_API_KEY=your_key_here
              </pre>
              <ol className="space-y-2 text-sm text-slate-300">
                <li><span className="text-blue-400 font-bold">3.</span> Restart the backend and click ↻ Refresh</li>
              </ol>
              <p className="mt-4 text-xs text-slate-500">
                FRED (Federal Reserve Bank of St. Louis) is the authoritative source for US economic data. The free tier has no rate limits for personal use.
              </p>
            </div>
          )}

          <p className="text-xs text-slate-600">
            Market rates via Yahoo Finance (yfinance). Economic data via FRED API (St. Louis Fed). Cached 30 minutes. For informational purposes only.
          </p>
        </>
      )}
    </div>
  )
}
