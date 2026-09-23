import { useEffect, useState } from 'react'
import { fmt } from '../utils/format'

// Research → Range Screener. Finds names trading sideways between a support
// and resistance band over the last 30/60/90 days, and flags whether price
// is currently near either edge — a possible entry (near support) or
// exit/short (near resistance) for a range-trading strategy.

const WINDOWS = [30, 60, 90]
const SIGNALS = [
  { id: 'any',             label: 'Any' },
  { id: 'near_support',    label: 'Near support (buy zone)' },
  { id: 'near_resistance', label: 'Near resistance (sell zone)' },
  { id: 'neutral',         label: 'Mid-range' },
]
const SIGNAL_STYLE = {
  near_support:    'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
  near_resistance: 'bg-red-900/40 text-red-300 border-red-700/50',
  neutral:         'bg-gray-800 text-gray-500 border-gray-700',
}
const SIGNAL_TEXT = { near_support: 'Near support', near_resistance: 'Near resistance', neutral: 'Mid-range' }

const numInput = 'bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500 w-20 tabular-nums'
const selectCls = 'bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500'
const btnPrimary = 'text-xs font-medium rounded-lg px-4 py-1.5 bg-emerald-900/30 border border-emerald-700/60 text-emerald-300 hover:border-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

function SortArrow({ active, dir }) {
  return <span className={`ml-1 text-xs ${active ? 'text-emerald-400' : 'text-gray-700'}`}>{active ? (dir === 'asc' ? '↑' : '↓') : '⇅'}</span>
}

const SPARK_W = 120
const SPARK_H = 32
const SPARK_COLOR = { near_support: '#34d399', near_resistance: '#f87171', neutral: '#9ca3af' }

// Inline sparkline of the same close-price series the row's metrics were
// computed from — scaled so the low/high of the window sit exactly at the
// bottom/top of the box, matching the Position bar's 0–100% scale.
function Sparkline({ series, low, high, signal }) {
  if (!series || series.length < 2 || high <= low) {
    return <span className="text-gray-700">—</span>
  }
  const stroke = SPARK_COLOR[signal] || SPARK_COLOR.neutral
  const n = series.length
  const x = i => (i / (n - 1)) * SPARK_W
  const y = v => SPARK_H - ((v - low) / (high - low)) * SPARK_H
  const clampedY = v => Math.max(0, Math.min(SPARK_H, y(v))).toFixed(1)
  const points = series.map((v, i) => `${x(i).toFixed(1)},${clampedY(v)}`).join(' ')

  return (
    <svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} className="block" role="img" aria-label={`Price over the selected window, from $${low.toFixed(2)} to $${high.toFixed(2)}`}>
      {/* support/resistance edges of the detected range */}
      <line x1={0} y1={0.5} x2={SPARK_W} y2={0.5} stroke="#4b5563" strokeWidth={1} strokeDasharray="2,2" />
      <line x1={0} y1={SPARK_H - 0.5} x2={SPARK_W} y2={SPARK_H - 0.5} stroke="#4b5563" strokeWidth={1} strokeDasharray="2,2" />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1).toFixed(1)} cy={clampedY(series[n - 1])} r={2} fill={stroke} />
    </svg>
  )
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-[10.5px] text-gray-500 uppercase tracking-wider">
      {label}
      {children}
    </label>
  )
}

const DEFAULT_FILTERS = { window: 60, minWidth: 8, maxWidth: 60, minTouches: 2, minScore: 70, signal: 'any' }

export default function RangeScreener() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [symbolsInput, setSymbolsInput] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sortCol, setSortCol] = useState('rangeScore')
  const [sortDir, setSortDir] = useState('desc')

  function set(patch) {
    setFilters(f => ({ ...f, ...patch }))
  }

  async function run() {
    setLoading(true); setError(null)
    const params = new URLSearchParams({
      window: filters.window, min_width: filters.minWidth, max_width: filters.maxWidth,
      min_touches: filters.minTouches, min_score: filters.minScore, signal: filters.signal,
    })
    if (symbolsInput.trim()) params.set('symbols', symbolsInput.trim())
    try {
      const res = await fetch(`/api/screener/range-bound?${params}`)
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      setData(await res.json())
    } catch (e) {
      setError(e.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  // Load once on mount with the default filters.
  useEffect(() => { run() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  function handleSort(key) {
    if (sortCol === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(key); setSortDir(key === 'symbol' ? 'asc' : 'desc') }
  }

  const cols = [
    { label: 'Symbol',   key: 'symbol',       align: 'text-left' },
    { label: 'Price',    key: 'price',        align: 'text-right' },
    { label: 'Chart',    key: 'chart',        align: 'text-left', sortable: false },
    { label: 'Range Low',  key: 'low',        align: 'text-right' },
    { label: 'Range High', key: 'high',       align: 'text-right' },
    { label: 'Width %',  key: 'widthPct',     align: 'text-right' },
    { label: 'Position', key: 'positionPct',  align: 'text-right' },
    { label: 'Score',    key: 'rangeScore',   align: 'text-right' },
    { label: 'Touches',  key: 'touchesLow',   align: 'text-right' },
    { label: 'Signal',   key: 'signal',       align: 'text-left' },
    { label: 'Entry',    key: 'entry',        align: 'text-right' },
    { label: 'Target',   key: 'target',       align: 'text-right' },
    { label: 'Stop',     key: 'stop',         align: 'text-right' },
    { label: 'R:R',      key: 'riskReward',   align: 'text-right' },
  ]

  const sorted = [...(data || [])].sort((a, b) => {
    const av = a[sortCol] ?? null, bv = b[sortCol] ?? null
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortDir === 'asc' ? av - bv : bv - av
  })

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="px-6 py-5 space-y-4">
        <div>
          <h1 className="text-white font-bold text-xl mb-1">Range Screener</h1>
          <p className="text-gray-500 text-sm max-w-3xl">
            Finds names that have traded sideways between a support and resistance level over the last 30/60/90 days, rather than trending, and shows where the price sits in that range right now.
            "Score" measures how choppy vs. trending the window was (100 = pure back-and-forth, 0 = a steady trend) — it ranks names, it isn't a guarantee the range will hold.
            "Touches" is how many times price came near the low / near the high — more touches means the support and resistance levels are more established, not just a one-off spike.
            The inline chart shows the closing price over that same window, scaled so the dashed lines mark the detected low and high — the exact data the metrics beside it were computed from.
          </p>
        </div>

        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
          <div className="flex items-end gap-3 flex-wrap">
            <Field label="Window">
              <select className={selectCls} value={filters.window} onChange={e => set({ window: Number(e.target.value) })}>
                {WINDOWS.map(w => <option key={w} value={w}>{w} days</option>)}
              </select>
            </Field>
            <Field label="Min width %">
              <input type="number" className={numInput} value={filters.minWidth} onChange={e => set({ minWidth: e.target.value })} />
            </Field>
            <Field label="Max width %">
              <input type="number" className={numInput} value={filters.maxWidth} onChange={e => set({ maxWidth: e.target.value })} />
            </Field>
            <Field label="Min touches/side">
              <input type="number" className={numInput} value={filters.minTouches} onChange={e => set({ minTouches: e.target.value })} />
            </Field>
            <Field label="Min score">
              <input type="number" className={numInput} value={filters.minScore} onChange={e => set({ minScore: e.target.value })} />
            </Field>
            <Field label="Signal">
              <select className={selectCls} value={filters.signal} onChange={e => set({ signal: e.target.value })}>
                {SIGNALS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Symbols (optional, overrides universe)">
              <input
                type="text" placeholder="e.g. AAPL,MSFT,GME" value={symbolsInput}
                onChange={e => setSymbolsInput(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500 w-52"
              />
            </Field>
            <button className={btnPrimary} disabled={loading} onClick={run}>
              {loading ? 'Scanning…' : 'Run screen'}
            </button>
          </div>
          <p className="text-[11px] text-gray-600 mt-2">
            Universe: ~290 US-listed stocks (S&amp;P mega/large-caps plus the Short Squeeze and Insider Trading watchlists' small/mid-caps), or your own list above. The first scan can take up to ~15s; results are cached for 30 minutes.
          </p>
        </div>

        {loading && <div className="text-gray-500 text-sm text-center py-16 animate-pulse">Scanning the universe for range-bound names…</div>}
        {error && <div className="text-red-400 text-sm text-center py-10">Error: {error}</div>}
        {!loading && !error && data && data.length === 0 && (
          <div className="text-gray-600 text-sm text-center py-16">No names matched these filters — try loosening the width, touches, or score.</div>
        )}

        {!loading && !error && data && data.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  {cols.map(({ label, key, align, sortable = true }) => (
                    <th key={key} onClick={sortable ? () => handleSort(key) : undefined}
                      className={`py-2.5 px-3 text-gray-500 font-medium tracking-wider uppercase whitespace-nowrap ${align} ${sortable ? 'cursor-pointer select-none hover:text-gray-300' : ''}`}>
                      {label}{sortable && <SortArrow active={sortCol === key} dir={sortDir} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(row => (
                  <tr key={row.symbol} className="border-b border-gray-800/40 hover:bg-gray-800/40 transition-colors">
                    <td className="py-2.5 px-3">
                      <div className="text-white font-bold">{row.symbol}</div>
                      {row.name && <div className="text-gray-600 text-[10px] max-w-[140px] truncate">{row.name}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{fmt.price(row.price)}</td>
                    <td className="py-2.5 px-3">
                      <Sparkline series={row.series} low={row.low} high={row.high} signal={row.signal} />
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{fmt.price(row.low)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{fmt.price(row.high)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{row.widthPct.toFixed(1)}%</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      <div className="inline-flex items-center gap-1.5">
                        <div className="w-14 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                          <div
                            className={`h-full ${row.positionPct <= 20 ? 'bg-emerald-500' : row.positionPct >= 80 ? 'bg-red-500' : 'bg-gray-500'}`}
                            style={{ width: `${row.positionPct}%` }}
                          />
                        </div>
                        <span className="text-gray-400">{row.positionPct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums font-medium">{row.rangeScore.toFixed(0)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-500 tabular-nums">{row.touchesLow} / {row.touchesHigh}</td>
                    <td className="py-2.5 px-3">
                      <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 border ${SIGNAL_STYLE[row.signal]}`}>
                        {SIGNAL_TEXT[row.signal]}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{fmt.price(row.entry)}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-400 tabular-nums">{fmt.price(row.target)}</td>
                    <td className="py-2.5 px-3 text-right text-red-400 tabular-nums">{fmt.price(row.stop)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{row.riskReward != null ? `${row.riskReward.toFixed(2)}x` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 text-gray-700 text-xs border-t border-gray-800">
              {sorted.length} result{sorted.length !== 1 ? 's' : ''} · {filters.window}-day window
            </div>
          </div>
        )}

        <p className="text-[11px] text-gray-700 max-w-3xl">
          Entry/target/stop are mechanical levels derived from the detected range (buy near the low with a stop just below it, sell near the high with a stop just above it) — not a recommendation. A range can break down at any time; size positions accordingly and confirm with your own analysis before trading.
        </p>
      </div>
    </div>
  )
}
