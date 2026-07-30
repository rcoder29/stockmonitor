import { useState, useEffect, useMemo, useCallback } from 'react'

const PERIODS = [
  { key: 'rs1w',  retKey: 'ret1w',  label: '1W' },
  { key: 'rs1m',  retKey: 'ret1m',  label: '1M' },
  { key: 'rs3m',  retKey: 'ret3m',  label: '3M' },
  { key: 'rs6m',  retKey: 'ret6m',  label: '6M' },
  { key: 'rs1y',  retKey: 'ret1y',  label: '1Y' },
]

function rsColor(v) {
  if (v == null) return 'text-slate-500'
  if (v >= 1.5)  return 'text-emerald-300'
  if (v >= 1.0)  return 'text-emerald-400'
  if (v >= 0.5)  return 'text-yellow-400'
  if (v >= 0.0)  return 'text-orange-400'
  return 'text-red-400'
}

function retColor(v) {
  if (v == null) return 'text-slate-500'
  if (v > 0) return 'text-emerald-400'
  if (v < 0) return 'text-red-400'
  return 'text-slate-400'
}

function RsBar({ value, maxAbs }) {
  if (value == null) return <div className="w-24 h-3 bg-slate-700 rounded-full" />
  const pct = Math.min(Math.abs(value) / (maxAbs || 2) * 50, 50)
  const isPos = value >= 0
  return (
    <div className="w-24 h-3 bg-slate-700 rounded-full overflow-hidden relative">
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-500" />
      <div className={`absolute inset-y-0 rounded-full ${isPos ? 'bg-emerald-500' : 'bg-red-500'}`}
        style={isPos
          ? { left: '50%', width: `${pct}%` }
          : { right: '50%', width: `${pct}%` }} />
    </div>
  )
}

function CompositeGauge({ v }) {
  if (v == null) return <span className="text-slate-500 text-sm">—</span>
  const label = v >= 1.5 ? 'Leader' : v >= 1.0 ? 'Outperform' : v >= 0.5 ? 'Mixed' : v >= 0 ? 'Lagging' : 'Weak'
  const cls = v >= 1.0 ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40'
    : v >= 0.5 ? 'bg-yellow-900/30 text-yellow-300 border-yellow-700/30'
    : 'bg-red-900/30 text-red-300 border-red-700/30'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${cls}`}>{label}</span>
  )
}

export default function RelativeStrengthRanker({ watchlist = [] }) {
  const [symbols,   setSymbols]   = useState('')
  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [filter,    setFilter]    = useState('all')   // 'all' | 'leaders' | 'laggards'
  const [sortCol,   setSortCol]   = useState('composite')
  const [sortAsc,   setSortAsc]   = useState(false)
  const [focusPd,   setFocusPd]   = useState('rs3m')  // period to highlight

  const run = useCallback(async (symsStr) => {
    const cleaned = symsStr.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
    if (!cleaned.length) { setError('Enter at least one symbol'); return }
    setLoading(true); setError(''); setData(null)
    try {
      const res = await fetch(`/api/market/relative-strength?symbols=${cleaned.join(',')}`)
      if (!res.ok) throw new Error((await res.json()).detail || 'Error')
      setData(await res.json())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  function importWatchlist() {
    setSymbols(watchlist.join(', '))
  }

  function handleSort(col) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  const filtered = useMemo(() => {
    if (!data) return []
    let rows = [...data]
    if (filter === 'leaders')  rows = rows.filter(r => (r.composite ?? 0) >= 1.0)
    if (filter === 'laggards') rows = rows.filter(r => (r.composite ?? 0) < 1.0)
    rows.sort((a, b) => {
      const av = a[sortCol] ?? -Infinity
      const bv = b[sortCol] ?? -Infinity
      return sortAsc ? av - bv : bv - av
    })
    return rows
  }, [data, filter, sortCol, sortAsc])

  const maxAbs = useMemo(() => {
    if (!data) return 2
    return Math.max(...data.map(r => Math.abs(r[focusPd] ?? 0)), 2)
  }, [data, focusPd])

  function TH({ col, label, title }) {
    const active = sortCol === col
    return (
      <th title={title}
        className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-right cursor-pointer select-none hover:text-white whitespace-nowrap ${active ? 'text-white' : 'text-slate-400'}`}
        onClick={() => handleSort(col)}>
        {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  if (!data) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Relative Strength Ranker</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Rank stocks by how much they've outperformed or underperformed SPY over multiple timeframes.
            RS &gt; 1.0 = beating the market.
          </p>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 space-y-4">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              placeholder="AAPL, MSFT, GOOGL, NVDA, JNJ …"
              value={symbols}
              onChange={e => setSymbols(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run(symbols)}
            />
            {watchlist.length > 0 && (
              <button onClick={importWatchlist}
                className="px-3 py-2 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600 whitespace-nowrap">
                ⬇ Watchlist
              </button>
            )}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button onClick={() => run(symbols)} disabled={loading}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
            {loading ? 'Fetching…' : '▶ Rank'}
          </button>
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 text-xs text-slate-400 space-y-1.5">
          <p className="font-bold text-slate-300">How RS is calculated</p>
          <p>RS Ratio = stock's % return ÷ SPY's % return over the same period. RS = 1.5 means the stock returned 50% more than SPY. RS = 0.5 means it returned half as much. RS &lt; 0 means the stock moved opposite to SPY.</p>
          <p>The Composite score is the average RS ratio across all 5 time periods (1W, 1M, 3M, 6M, 1Y). Data cached for 30 minutes.</p>
        </div>
      </div>
    )
  }

  const leaders  = data.filter(r => (r.composite ?? 0) >= 1.0).length
  const laggards = data.filter(r => (r.composite ?? 0) < 1.0).length

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Relative Strength Ranker</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {data.length} stocks ranked vs SPY · 30-min cache
          </p>
        </div>
        <button onClick={() => { setData(null); setSymbols('') }}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 rounded-lg">
          ← Reset
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
        <div className="bg-emerald-900/20 rounded-xl p-3 border border-emerald-800/30 text-center">
          <p className="text-2xl font-bold text-emerald-400">{leaders}</p>
          <p className="text-xs text-slate-400 mt-0.5">Leaders</p>
        </div>
        <div className="bg-red-900/20 rounded-xl p-3 border border-red-800/30 text-center">
          <p className="text-2xl font-bold text-red-400">{laggards}</p>
          <p className="text-xs text-slate-400 mt-0.5">Laggards</p>
        </div>
        {data.length > 0 && (
          <>
            <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 text-center">
              <p className="text-sm font-bold text-emerald-400">{data[0]?.symbol}</p>
              <p className="text-xs text-slate-400">Top Performer</p>
              <p className="text-xs font-mono text-emerald-300">{data[0]?.composite?.toFixed(2)}x</p>
            </div>
            <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 text-center">
              <p className="text-sm font-bold text-red-400">{data[data.length - 1]?.symbol}</p>
              <p className="text-xs text-slate-400">Weakest</p>
              <p className="text-xs font-mono text-red-300">{data[data.length - 1]?.composite?.toFixed(2)}x</p>
            </div>
            <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 text-center">
              <p className="text-sm font-bold text-slate-200">
                {(data.reduce((s, r) => s + (r.composite ?? 0), 0) / data.length).toFixed(2)}x
              </p>
              <p className="text-xs text-slate-400">Avg RS</p>
            </div>
          </>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-2 flex-wrap items-center">
        {['all', 'leaders', 'laggards'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${filter === f ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            {f} {f === 'leaders' ? `(${leaders})` : f === 'laggards' ? `(${laggards})` : `(${data.length})`}
          </button>
        ))}
        <span className="text-xs text-slate-500 ml-2">Highlight period:</span>
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setFocusPd(p.key)}
            className={`px-2 py-1 rounded text-xs ${focusPd === p.key ? 'bg-slate-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/60">
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider text-left">#</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider text-left">Symbol</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider text-left">Sector</th>
                <TH col="composite" label="RS Score" title="Average RS ratio across 1W/1M/3M/6M/1Y" />
                {PERIODS.map(p => <TH key={p.key} col={p.key} label={`RS ${p.label}`} title={`Relative strength vs SPY over ${p.label}`} />)}
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider text-left">{PERIODS.find(p => p.key === focusPd)?.label} Bar</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={row.symbol} className={`border-b border-slate-700/40 hover:bg-slate-700/20 ${i % 2 ? 'bg-slate-900/10' : ''}`}>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-bold text-white">{row.symbol}</p>
                    <p className="text-[10px] text-slate-500 truncate max-w-[100px]">{row.name}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-400">{row.sector ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-sm font-bold tabular-nums ${rsColor(row.composite)}`}>
                        {row.composite?.toFixed(2) ?? '—'}x
                      </span>
                      <CompositeGauge v={row.composite} />
                    </div>
                  </td>
                  {PERIODS.map(p => (
                    <td key={p.key} className={`px-3 py-2.5 text-right tabular-nums text-xs font-bold ${p.key === focusPd ? 'bg-slate-700/30' : ''} ${rsColor(row[p.key])}`}>
                      {row[p.key]?.toFixed(2) ?? '—'}x
                      <br />
                      <span className={`text-[10px] font-normal ${retColor(row[p.retKey])}`}>
                        {row[p.retKey] != null ? `${row[p.retKey] > 0 ? '+' : ''}${row[p.retKey].toFixed(1)}%` : ''}
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-2.5">
                    <RsBar value={row[focusPd]} maxAbs={maxAbs} />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500 text-sm">No stocks match the current filter</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-600">
        RS Ratio = stock return ÷ SPY return over the period. Values &gt;1.0 = outperforming; &lt;1.0 = underperforming; negative = moving against market.
        The Composite score is the unweighted average of all 5 RS ratios. Data uses 1-year daily closes from Yahoo Finance; cached 30 minutes.
      </p>
    </div>
  )
}
