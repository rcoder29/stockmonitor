import { useState, useEffect, useCallback } from 'react'
import ChartModal from './ChartModal'

const INDICES = [
  { id: 'DOW30',     label: 'Dow Jones 30',   etf: 'DIA' },
  { id: 'NASDAQ100', label: 'Nasdaq 100',      etf: 'QQQ' },
  { id: 'SP100',     label: 'S&P Top 100',     etf: 'SPY' },
  { id: 'ARKK',      label: 'ARK Innovation',  etf: 'ARKK' },
]

const PERIODS = ['1d', '5d', '1m', '3m', '6m', '1y', 'ytd']
const PERIOD_LABELS = { '1d': '1D', '5d': '5D', '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y', 'ytd': 'YTD' }

const SECTOR_ORDER = [
  'Technology', 'Communication Services', 'Consumer Discretionary',
  'Consumer Staples', 'Financials', 'Health Care', 'Industrials',
  'Energy', 'Materials', 'Real Estate', 'Utilities',
]

// effective weight: prefer live market-cap weight, fall back to hardcoded
function effectiveWeight(row) {
  return row.actualWeight ?? row.indexWeight ?? 1
}

function fmtCap(v) {
  if (v == null) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`
  return `$${(v / 1e6).toFixed(0)}M`
}

function pctBg(pct) {
  if (pct == null) return '#1f2937'
  if (pct <= -5)   return '#7f1d1d'
  if (pct <= -3)   return '#991b1b'
  if (pct <= -2)   return '#b91c1c'
  if (pct <= -1)   return '#dc2626'
  if (pct <= -0.3) return '#ef4444'
  if (pct < 0)     return '#fca5a5'
  if (pct === 0)   return '#374151'
  if (pct < 0.3)   return '#6ee7b7'
  if (pct < 1)     return '#34d399'
  if (pct < 2)     return '#10b981'
  if (pct < 3)     return '#059669'
  if (pct < 5)     return '#047857'
  return '#065f46'
}

function pctFg(pct) {
  if (pct == null) return '#9ca3af'
  return Math.abs(pct) < 0.3 ? '#d1d5db' : '#ffffff'
}

function PctCell({ v, bold }) {
  if (v == null) return <span className="text-gray-700 tabular-nums">—</span>
  const cls = v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400'
  return <span className={`tabular-nums ${bold ? 'font-semibold' : 'font-medium'} ${cls}`}>{v > 0 ? '+' : ''}{v.toFixed(2)}%</span>
}

function SortArrow({ active, dir }) {
  return (
    <span className={`ml-1 text-[10px] ${active ? 'text-emerald-400' : 'text-gray-700'}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '⇅'}
    </span>
  )
}

// ── Table view ────────────────────────────────────────────────────────────────

function TableView({ data, period, onSymbolClick }) {
  const [sortKey, setSortKey] = useState('actualWeight')
  const [sortDir, setSortDir] = useState('desc')

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...data].sort((a, b) => {
    const av = sortKey === 'weight' ? effectiveWeight(a) : a[sortKey]
    const bv = sortKey === 'weight' ? effectiveWeight(b) : b[sortKey]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const diff = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? diff : -diff
  })

  const cols = [
    { key: 'symbol',        label: 'Symbol',    align: 'text-left',  cls: 'w-20' },
    { key: 'name',          label: 'Name',      align: 'text-left',  cls: 'min-w-[140px]' },
    { key: 'sector',        label: 'Sector',    align: 'text-left',  cls: 'min-w-[150px]' },
    { key: 'weight',        label: 'Wt %',      align: 'text-right', cls: 'w-16' },
    { key: 'marketCap',     label: 'Mkt Cap',   align: 'text-right', cls: 'w-20' },
    { key: 'price',         label: 'Price',     align: 'text-right', cls: 'w-20' },
    { key: '1d',            label: '1D',        align: 'text-right', cls: 'w-16' },
    { key: 'wtContribution',label: '1D Contrib',align: 'text-right', cls: 'w-20' },
    ...PERIODS.slice(1).map(p => ({ key: p, label: PERIOD_LABELS[p], align: 'text-right', cls: 'w-16' })),
  ]

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-gray-800">
            {cols.map(c => (
              <th
                key={c.key}
                className={`py-2 px-2 font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-300 ${c.align} ${c.cls}`}
                onClick={() => handleSort(c.key)}
              >
                {c.label}<SortArrow active={sortKey === c.key} dir={sortDir} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => {
            const wt = effectiveWeight(row)
            return (
              <tr
                key={row.symbol}
                className="border-b border-gray-800/50 hover:bg-gray-800/40 cursor-pointer transition-colors"
                onClick={() => onSymbolClick(row)}
              >
                <td className="py-1.5 px-2 font-bold text-emerald-400">{row.symbol}</td>
                <td className="py-1.5 px-2 text-gray-300 truncate max-w-[160px]">{row.name}</td>
                <td className="py-1.5 px-2 text-gray-500">{row.sector}</td>
                <td className="py-1.5 px-2 text-right">
                  <span className="text-gray-200 font-medium tabular-nums">{wt.toFixed(2)}%</span>
                  {row.actualWeight == null && <span className="text-gray-700 text-[9px] ml-1">est</span>}
                </td>
                <td className="py-1.5 px-2 text-right text-gray-500 tabular-nums">{fmtCap(row.marketCap)}</td>
                <td className="py-1.5 px-2 text-right text-gray-300 tabular-nums">
                  {row.price != null ? `$${row.price.toFixed(2)}` : '—'}
                </td>
                <td className="py-1.5 px-2 text-right"><PctCell v={row['1d']} bold /></td>
                <td className="py-1.5 px-2 text-right">
                  {row.wtContribution != null
                    ? <span className={`tabular-nums text-[11px] ${row.wtContribution >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {row.wtContribution > 0 ? '+' : ''}{row.wtContribution.toFixed(3)}%
                      </span>
                    : <span className="text-gray-700">—</span>}
                </td>
                {PERIODS.slice(1).map(p => (
                  <td key={p} className="py-1.5 px-2 text-right"><PctCell v={row[p]} /></td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Heatmap tile ──────────────────────────────────────────────────────────────

function HeatTile({ row, onSymbolClick }) {
  const pct = row['1d']
  const wt  = effectiveWeight(row)
  const bg  = pctBg(pct)
  const fg  = pctFg(pct)

  // Tile width strictly proportional to index weight (clamped for readability)
  const px = Math.max(58, Math.min(280, wt * 22))

  const tooltip = [
    `${row.name}`,
    `Sector: ${row.sector}`,
    `Weight: ${wt.toFixed(2)}%${row.actualWeight != null ? ' (live)' : ' (est)'}`,
    `Market Cap: ${fmtCap(row.marketCap)}`,
    `Price: $${row.price?.toFixed(2) ?? '—'}`,
    `1D: ${pct != null ? (pct > 0 ? '+' : '') + pct.toFixed(2) + '%' : '—'}`,
    row.wtContribution != null
      ? `1D Contrib: ${row.wtContribution > 0 ? '+' : ''}${row.wtContribution.toFixed(3)}%`
      : '',
  ].filter(Boolean).join('\n')

  return (
    <div
      title={tooltip}
      onClick={() => onSymbolClick(row)}
      style={{ backgroundColor: bg, color: fg, flexBasis: `${px}px`, minWidth: `${px}px` }}
      className="m-0.5 rounded p-1.5 cursor-pointer hover:brightness-125 hover:z-10 hover:scale-105 transition-all flex-shrink-0 flex-grow"
    >
      <div className="font-bold text-[11px] leading-tight truncate">{row.symbol}</div>
      <div className="text-[9px] opacity-80 tabular-nums mt-0.5">{wt.toFixed(2)}%</div>
      <div className="text-[10px] font-semibold mt-0.5 tabular-nums">
        {pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'}
      </div>
    </div>
  )
}

// ── Heatmap view ──────────────────────────────────────────────────────────────

function HeatmapView({ data, onSymbolClick }) {
  const bySector = {}
  for (const row of data) {
    const sec = row.sector || 'Other'
    if (!bySector[sec]) bySector[sec] = []
    bySector[sec].push(row)
  }

  const sectors = [
    ...SECTOR_ORDER.filter(s => bySector[s]),
    ...Object.keys(bySector).filter(s => !SECTOR_ORDER.includes(s)).sort(),
  ]

  const withData   = data.filter(r => r['1d'] != null)
  const advancing  = withData.filter(r => r['1d'] > 0).length
  const declining  = withData.filter(r => r['1d'] < 0).length

  // Weighted index return = Σ(actualWeight × 1D) / 100
  const wtReturn = data.reduce((sum, r) => {
    const w = r.actualWeight ?? r.indexWeight
    return (w != null && r['1d'] != null) ? sum + (w * r['1d'] / 100) : sum
  }, 0)

  // Largest positive and negative contributors
  const byContrib = [...data]
    .filter(r => r.wtContribution != null)
    .sort((a, b) => Math.abs(b.wtContribution) - Math.abs(a.wtContribution))
  const topAdder   = byContrib.find(r => r.wtContribution > 0)
  const topDragger = byContrib.find(r => r.wtContribution < 0)

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-gray-800/60 border border-gray-700/40 rounded-lg p-2.5 text-center">
          <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-0.5">Index 1D Return</div>
          <div className={`text-lg font-bold tabular-nums ${wtReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {wtReturn >= 0 ? '+' : ''}{wtReturn.toFixed(3)}%
          </div>
          <div className="text-gray-600 text-[10px]">market-cap weighted</div>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/40 rounded-lg p-2.5 text-center">
          <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-0.5">Advancing / Declining</div>
          <div className="text-sm font-bold">
            <span className="text-emerald-400">{advancing}</span>
            <span className="text-gray-600"> / </span>
            <span className="text-red-400">{declining}</span>
          </div>
          <div className="text-gray-600 text-[10px]">of {withData.length} with data</div>
        </div>
        {topAdder && (
          <div className="bg-gray-800/60 border border-gray-700/40 rounded-lg p-2.5 text-center">
            <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-0.5">Top Contributor</div>
            <div className="text-emerald-400 font-bold text-sm">{topAdder.symbol}</div>
            <div className="text-emerald-600 text-[10px] tabular-nums">+{topAdder.wtContribution.toFixed(3)}%</div>
          </div>
        )}
        {topDragger && (
          <div className="bg-gray-800/60 border border-gray-700/40 rounded-lg p-2.5 text-center">
            <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-0.5">Top Drag</div>
            <div className="text-red-400 font-bold text-sm">{topDragger.symbol}</div>
            <div className="text-red-600 text-[10px] tabular-nums">{topDragger.wtContribution.toFixed(3)}%</div>
          </div>
        )}
      </div>

      {/* Color legend */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-gray-600 text-[10px] mr-1">1D return:</span>
        {[
          ['≤−5%', '#7f1d1d'], ['−3%', '#991b1b'], ['−2%', '#b91c1c'],
          ['−1%', '#dc2626'],  ['~0%', '#374151'],  ['+1%', '#10b981'],
          ['+2%', '#059669'],  ['+3%', '#047857'],  ['≥+5%', '#065f46'],
        ].map(([lbl, bg]) => (
          <div key={lbl} className="flex items-center gap-0.5">
            <div className="w-4 h-3 rounded-sm" style={{ backgroundColor: bg }} />
            <span className="text-[10px] text-gray-600">{lbl}</span>
          </div>
        ))}
        <span className="text-gray-700 text-[10px] ml-3">Tile size = % weight in index · Hover for detail</span>
      </div>

      {/* Sectors */}
      {sectors.map(sec => {
        const rows = bySector[sec].sort((a, b) => effectiveWeight(b) - effectiveWeight(a))
        const secWt = rows.reduce((s, r) => s + effectiveWeight(r), 0)
        const secRet = rows.reduce((s, r) => {
          const w = r.actualWeight ?? r.indexWeight
          return (w != null && r['1d'] != null) ? s + (w * r['1d'] / 100) : s
        }, 0)
        return (
          <div key={sec}>
            <div className="flex items-center gap-2 mb-0.5 px-0.5">
              <span className="text-[10px] uppercase tracking-widest text-gray-600">{sec}</span>
              <span className="text-[10px] text-gray-700">{secWt.toFixed(1)}%</span>
              {secRet !== 0 && (
                <span className={`text-[10px] tabular-nums ${secRet >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {secRet >= 0 ? '+' : ''}{secRet.toFixed(3)}%
                </span>
              )}
            </div>
            <div className="flex flex-wrap">
              {rows.map(row => (
                <HeatTile key={row.symbol} row={row} onSymbolClick={onSymbolClick} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function IndexHeatmap() {
  const [index,      setIndex]      = useState('DOW30')
  const [view,       setView]       = useState('heatmap')
  const [period,     setPeriod]     = useState('1d')
  const [data,       setData]       = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [lastFetch,  setLastFetch]  = useState(null)
  const [chartStock, setChartStock] = useState(null)

  const doFetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await window.fetch(`/api/index-constituents?index=${index}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setLastFetch(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [index])

  useEffect(() => { doFetch() }, [doFetch])

  const selected    = INDICES.find(i => i.id === index)
  const liveWeights = data.some(r => r.actualWeight != null)

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">Index Heatmap</h2>
          <p className="text-xs text-gray-600 mt-0.5">Constituent weight &amp; performance</p>
        </div>

        <select
          value={index}
          onChange={e => setIndex(e.target.value)}
          className="ml-auto bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-3 py-1.5 focus:outline-none focus:border-emerald-500 cursor-pointer"
        >
          {INDICES.map(i => (
            <option key={i.id} value={i.id}>{i.label} ({i.etf})</option>
          ))}
        </select>

        <div className="flex rounded border border-gray-700 overflow-hidden">
          {['heatmap', 'table'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                view === v ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {v === 'heatmap' ? '⬛ Heatmap' : '≡ Table'}
            </button>
          ))}
        </div>

        {view === 'table' && (
          <div className="flex rounded border border-gray-700 overflow-hidden">
            {PERIODS.map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1.5 text-xs transition-colors ${
                  period === p ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={doFetch}
          disabled={loading}
          className="px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 rounded transition-colors disabled:opacity-40"
        >
          {loading ? '...' : '↻ Refresh'}
        </button>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-3 text-xs text-gray-600 flex-wrap">
        <span>{selected?.label} · {data.length} constituents</span>
        {lastFetch && <span>Updated {lastFetch.toLocaleTimeString()}</span>}
        <span className={liveWeights ? 'text-emerald-700' : 'text-gray-700'}>
          {liveWeights ? '● Live market-cap weights' : '○ Estimated weights (loading…)'}
        </span>
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800/40 rounded p-3">
          Failed to load: {error}
        </div>
      )}

      {loading && data.length === 0 && (
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 30 }).map((_, i) => (
            <div key={i} className="rounded bg-gray-800 animate-pulse" style={{ width: 80, height: 56 }} />
          ))}
        </div>
      )}

      {data.length > 0 && (
        view === 'heatmap'
          ? <HeatmapView data={data} onSymbolClick={setChartStock} />
          : <TableView   data={data} period={period} onSymbolClick={setChartStock} />
      )}

      {chartStock && (
        <ChartModal
          symbol={chartStock.symbol}
          quote={{
            symbol:        chartStock.symbol,
            name:          chartStock.name,
            price:         chartStock.price,
            changePercent: chartStock['1d'],
            change:        null,
          }}
          onClose={() => setChartStock(null)}
        />
      )}
    </div>
  )
}
