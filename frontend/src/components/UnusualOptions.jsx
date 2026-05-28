import { useState, useMemo } from 'react'

function TypeBadge({ type }) {
  return type === 'call'
    ? <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-400 border border-emerald-700/40">CALL</span>
    : <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-900/50 text-red-400 border border-red-700/40">PUT</span>
}

function ItmBadge({ itm }) {
  if (!itm) return null
  return <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-sky-900/40 text-sky-400 border border-sky-700/30">ITM</span>
}

function RatioCell({ ratio }) {
  if (ratio == null) return <span className="text-amber-400 text-xs font-semibold">New</span>
  const isHigh = ratio >= 10
  return (
    <span className={`tabular-nums font-semibold ${isHigh ? 'text-amber-400' : 'text-gray-300'}`}>
      {ratio.toFixed(1)}x
    </span>
  )
}

const SORT_OPTIONS = [
  { id: 'volume',   label: 'Volume' },
  { id: 'ratio',    label: 'Vol/OI' },
  { id: 'symbol',   label: 'Symbol' },
]

const TYPE_FILTERS = [
  { id: 'all',  label: 'All' },
  { id: 'call', label: 'Calls' },
  { id: 'put',  label: 'Puts' },
]

export default function UnusualOptions({ symbols = [] }) {
  const [inputSymbols, setInputSymbols] = useState(symbols.join(', '))
  const [items,   setItems]   = useState([])
  const [scanned, setScanned] = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [hasScanned, setHasScanned] = useState(false)

  const [sortBy,     setSortBy]     = useState('volume')
  const [typeFilter, setTypeFilter] = useState('all')

  async function scan() {
    const syms = inputSymbols
      .split(/[,\s]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 10)

    if (!syms.length) return

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/options/unusual?symbols=${syms.join(',')}`)
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()
      setItems(data.items ?? [])
      setScanned(data.scanned ?? syms)
      setHasScanned(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    let rows = typeFilter === 'all' ? items : items.filter(r => r.type === typeFilter)
    rows = [...rows].sort((a, b) => {
      if (sortBy === 'symbol') return a.symbol.localeCompare(b.symbol)
      if (sortBy === 'ratio') {
        const ar = a.vol_oi_ratio ?? 9999
        const br = b.vol_oi_ratio ?? 9999
        return br - ar
      }
      return b.volume - a.volume
    })
    return rows
  }, [items, sortBy, typeFilter])

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <div className="text-gray-500 text-xs uppercase tracking-widest">Unusual Options Activity</div>
        <div className="text-gray-600 text-xs mt-0.5">Scan for contracts with volume significantly exceeding open interest — a signal of fresh, aggressive positioning.</div>
      </div>

      {/* Input row */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-48">
          <label className="text-gray-600 text-xs block mb-1">Symbols (comma-separated, max 10)</label>
          <input
            type="text"
            value={inputSymbols}
            onChange={e => setInputSymbols(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && scan()}
            placeholder="AAPL, TSLA, NVDA"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-600"
          />
        </div>
        <button
          onClick={scan}
          disabled={loading || !inputSymbols.trim()}
          className="px-5 py-1.5 rounded-lg text-sm font-medium bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40 transition-colors shrink-0"
        >
          {loading ? 'Scanning…' : 'Scan'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800/40 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Loading shimmer */}
      {loading && (
        <div className="py-12 text-center text-gray-500 text-sm animate-pulse">
          Scanning options chains for {inputSymbols.split(/[,\s]+/).filter(Boolean).slice(0, 10).join(', ')}…
        </div>
      )}

      {/* Results */}
      {!loading && hasScanned && (
        <>
          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="text-gray-500 text-xs">
              {filtered.length} contract{filtered.length !== 1 ? 's' : ''} found
              {scanned.length > 0 && <span className="ml-1 text-gray-700">· scanned: {scanned.join(', ')}</span>}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Type filter */}
              <div className="flex items-center gap-1">
                {TYPE_FILTERS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setTypeFilter(f.id)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      typeFilter === f.id
                        ? 'bg-gray-700 text-white'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {/* Sort */}
              <div className="flex items-center gap-1.5">
                <span className="text-gray-600 text-xs">Sort:</span>
                {SORT_OPTIONS.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setSortBy(s.id)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      sortBy === s.id
                        ? 'bg-violet-800/60 text-violet-300 border border-violet-700/40'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-gray-700 text-sm">
              No unusual activity found for the selected symbols and filter.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/80">
                    {['Symbol', 'Type', 'Strike', 'Expiry', 'Volume', 'OI', 'Vol/OI', 'Mid', 'IV%', 'ITM'].map((h, i) => (
                      <th
                        key={h}
                        className={`py-2.5 px-3 text-gray-500 font-medium text-xs uppercase tracking-wider ${i === 0 ? 'text-left' : 'text-right'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => {
                    const isCall = row.type === 'call'
                    const isHighRatio = row.vol_oi_ratio != null && row.vol_oi_ratio >= 10
                    const rowBase = isCall
                      ? 'hover:bg-emerald-900/10'
                      : 'hover:bg-red-900/10'
                    const itmBrighter = row.in_the_money
                      ? (isCall ? 'bg-emerald-900/10' : 'bg-red-900/10')
                      : (i % 2 ? 'bg-gray-900/20' : '')

                    return (
                      <tr
                        key={`${row.symbol}-${row.type}-${row.strike}-${row.expiry}-${i}`}
                        className={`border-b border-gray-800/40 transition-colors ${rowBase} ${itmBrighter}`}
                      >
                        <td className="py-2.5 px-3 text-white font-semibold">{row.symbol}</td>
                        <td className="py-2.5 px-3 text-right"><TypeBadge type={row.type} /></td>
                        <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">
                          ${row.strike != null ? row.strike.toFixed(2) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-gray-400 text-xs tabular-nums">{row.expiry}</td>
                        <td className="py-2.5 px-3 text-right text-gray-200 tabular-nums font-medium">
                          {row.volume.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">
                          {row.open_interest > 0 ? row.open_interest.toLocaleString() : <span className="text-gray-700">—</span>}
                        </td>
                        <td className={`py-2.5 px-3 text-right ${isHighRatio ? 'bg-amber-900/20' : ''}`}>
                          <RatioCell ratio={row.vol_oi_ratio} />
                        </td>
                        <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">
                          {row.mid != null ? `$${row.mid.toFixed(2)}` : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums text-xs">
                          {row.iv_pct != null ? `${row.iv_pct}%` : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <ItmBadge itm={row.in_the_money} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div className="text-gray-700 text-xs text-center pt-1">
            Unusual = volume ≥ 2× open interest · Cached 30min
          </div>
        </>
      )}
    </div>
  )
}
