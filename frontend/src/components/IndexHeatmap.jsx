import { useState, useEffect, useCallback, useRef } from 'react'
import ChartModal from './ChartModal'

const INDICES = [
  { id: 'DOW30',     label: 'Dow Jones 30',   etf: 'DIA' },
  { id: 'NASDAQ100', label: 'Nasdaq 100',      etf: 'QQQ' },
  { id: 'SP100',     label: 'S&P Top 100',     etf: 'SPY' },
  { id: 'ARKK',      label: 'ARK Innovation',  etf: 'ARKK' },
]

const PERIODS = ['1d', '5d', '1m', '3m', '6m', '1y', 'ytd']
const PERIOD_LABELS = { '1d': '1D', '5d': '5D', '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y', 'ytd': 'YTD' }

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

      {/* All tiles, largest weight first */}
      <div className="flex flex-wrap">
        {[...data]
          .sort((a, b) => effectiveWeight(b) - effectiveWeight(a))
          .map(row => (
            <HeatTile key={row.symbol} row={row} onSymbolClick={onSymbolClick} />
          ))}
      </div>
    </div>
  )
}

// ── ETF search autocomplete ───────────────────────────────────────────────────

function EtfSearch({ onSelect }) {
  const [query,       setQuery]       = useState('')
  const [results,     setResults]     = useState([])
  const [searching,   setSearching]   = useState(false)
  const [open,        setOpen]        = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef  = useRef(null)
  const timerRef  = useRef(null)
  const wrapperRef = useRef(null)

  // Debounced search
  useEffect(() => {
    clearTimeout(timerRef.current)
    if (query.length < 1) { setResults([]); setOpen(false); return }
    timerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await window.fetch(`/api/search-etf?q=${encodeURIComponent(query)}`)
        const json = await res.json()
        setResults(json)
        setOpen(json.length > 0)
        setHighlighted(0)
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(timerRef.current)
  }, [query])

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function select(item) {
    onSelect(item)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  function onKeyDown(e) {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); if (results[highlighted]) select(results[highlighted]) }
    if (e.key === 'Escape')    { setOpen(false) }
  }

  const TYPE_BADGE = { ETF: 'bg-blue-900/60 text-blue-300', INDEX: 'bg-purple-900/60 text-purple-300', MUTUALFUND: 'bg-amber-900/40 text-amber-300' }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex items-center bg-gray-800 border border-gray-700 rounded overflow-hidden focus-within:border-emerald-500 transition-colors">
        <span className="pl-2.5 text-gray-600 text-xs">⌕</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search ETF / Index…"
          className="bg-transparent text-gray-200 text-xs px-2 py-1.5 w-44 outline-none placeholder-gray-600"
        />
        {searching && <span className="pr-2 text-gray-600 text-[10px] animate-pulse">…</span>}
        {query && !searching && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false) }} className="pr-2 text-gray-600 hover:text-gray-300 text-xs">✕</button>
        )}
      </div>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-80 bg-gray-900 border border-gray-700 rounded shadow-xl overflow-hidden">
          {results.map((item, i) => (
            <div
              key={item.symbol}
              onMouseEnter={() => setHighlighted(i)}
              onMouseDown={() => select(item)}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-xs transition-colors ${
                i === highlighted ? 'bg-gray-700' : 'hover:bg-gray-800'
              }`}
            >
              <span className="font-bold text-emerald-400 w-14 shrink-0">{item.symbol}</span>
              <span className="text-gray-300 truncate flex-1">{item.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${TYPE_BADGE[item.type] ?? 'bg-gray-800 text-gray-400'}`}>
                {item.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function IndexHeatmap() {
  // selection: { mode: 'predefined'|'dynamic', id, label, symbol }
  const [selection,  setSelection]  = useState({ mode: 'predefined', id: 'DOW30', label: 'Dow Jones 30', symbol: 'DOW30' })
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
      let url
      if (selection.mode === 'predefined') {
        url = `/api/index-constituents?index=${selection.id}`
      } else {
        url = `/api/etf-holdings?etf=${selection.symbol}`
      }
      const res  = await window.fetch(url)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `HTTP ${res.status}`)
      }
      const json = await res.json()
      setData(json)
      setLastFetch(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [selection])

  useEffect(() => { doFetch() }, [doFetch])

  function selectPredefined(id) {
    const found = INDICES.find(i => i.id === id)
    setSelection({ mode: 'predefined', id, label: found?.label ?? id, symbol: id })
    setData([])
  }

  function selectDynamic(item) {
    setSelection({ mode: 'dynamic', id: item.symbol, label: item.name || item.symbol, symbol: item.symbol })
    setData([])
  }

  const liveWeights = data.some(r => r.actualWeight != null)

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">Index / ETF Heatmap</h2>
          <p className="text-xs text-gray-600 mt-0.5">Constituent weight &amp; performance</p>
        </div>

        {/* Predefined quick-select */}
        <div className="ml-auto flex rounded border border-gray-700 overflow-hidden">
          {INDICES.map(i => (
            <button
              key={i.id}
              onClick={() => selectPredefined(i.id)}
              className={`px-3 py-1.5 text-xs transition-colors whitespace-nowrap ${
                selection.id === i.id && selection.mode === 'predefined'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {i.etf}
            </button>
          ))}
        </div>

        {/* Dynamic search */}
        <EtfSearch onSelect={selectDynamic} />

        {/* View toggle */}
        <div className="flex rounded border border-gray-700 overflow-hidden">
          {['heatmap', 'table'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs transition-colors ${
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

      {/* Active selection badge + meta */}
      <div className="flex items-center gap-3 text-xs text-gray-600 flex-wrap">
        <div className="flex items-center gap-1.5">
          {selection.mode === 'dynamic' && (
            <span className="bg-blue-900/50 text-blue-300 text-[10px] px-1.5 py-0.5 rounded">ETF</span>
          )}
          <span className="text-gray-400 font-medium">{selection.label}</span>
          {selection.mode === 'dynamic' && (
            <span className="text-gray-700">({selection.symbol})</span>
          )}
        </div>
        <span>·</span>
        <span>{data.length} constituents</span>
        {lastFetch && <span>· Updated {lastFetch.toLocaleTimeString()}</span>}
        <span className={liveWeights ? 'text-emerald-700' : 'text-gray-700'}>
          {liveWeights ? '● Live weights' : ''}
        </span>
        {selection.mode === 'dynamic' && (
          <button
            onClick={() => selectPredefined('DOW30')}
            className="text-gray-700 hover:text-gray-400 text-[10px] underline"
          >
            ← back to presets
          </button>
        )}
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800/40 rounded p-3">
          {error}
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
