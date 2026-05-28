import { Fragment, useState } from 'react'
import { fmt } from '../utils/format'
import { AlertBellButton } from './PriceAlerts'

function ChangeCell({ value, isPercent }) {
  if (value == null) return <span className="text-gray-600">—</span>
  const pos = value >= 0
  const text = isPercent ? fmt.pct(value) : fmt.change(value)
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
        pos ? 'text-emerald-400 bg-emerald-900/40' : 'text-red-400 bg-red-900/40'
      }`}
    >
      {text}
    </span>
  )
}

function RangeCell({ lo, hi, current }) {
  const pct =
    lo != null && hi != null && hi !== lo
      ? Math.min(100, Math.max(0, ((current - lo) / (hi - lo)) * 100))
      : null

  return (
    <div className="text-right">
      <span className="text-red-400/80">{fmt.num(lo)}</span>
      <span className="text-gray-700 mx-1">–</span>
      <span className="text-emerald-400/80">{fmt.num(hi)}</span>
      {pct != null && (
        <div className="mt-1 h-0.5 bg-gray-700 rounded" style={{ width: '100%' }}>
          <div
            className="h-full bg-sky-500 rounded"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

function SortArrow({ active, dir }) {
  return (
    <span className={`ml-1 text-xs ${active ? 'text-emerald-400' : 'text-gray-700'}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '⇅'}
    </span>
  )
}

const COLS = [
  { label: 'SYMBOL',    align: 'text-left',  width: 'w-40', key: 'symbol' },
  { label: 'PRICE',     align: 'text-right', width: 'w-28', key: 'price' },
  { label: 'CHG ($)',   align: 'text-right', width: 'w-28', key: 'change' },
  { label: 'CHG (%)',   align: 'text-right', width: 'w-28', key: 'changePercent' },
  { label: 'DAY RANGE', align: 'text-right', width: 'w-44', key: null },
  { label: 'VOLUME',    align: 'text-right', width: 'w-28', key: 'volume' },
  { label: '52W RANGE', align: 'text-right', width: 'w-44', key: null },
  { label: 'MKT CAP',  align: 'text-right', width: 'w-28', key: 'marketCap' },
  { label: '',          align: 'text-right', width: 'w-10', key: null },
]

export default function StockTable({ watchlist, quotes, priceFlash, onRemove, onChartOpen, alerts = [], onAlertBell }) {
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [query,   setQuery]   = useState('')

  function handleSort(key) {
    if (!key) return
    if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(key); setSortDir('asc') }
  }

  const q = query.trim().toLowerCase()
  const filtered = q
    ? watchlist.filter(sym => {
        if (sym.toLowerCase().includes(q)) return true
        const name = quotes[sym]?.name ?? ''
        return name.toLowerCase().includes(q)
      })
    : watchlist

  const sortedList = sortCol
    ? [...filtered].sort((a, b) => {
        const av = sortCol === 'symbol' ? a : (quotes[a]?.[sortCol] ?? null)
        const bv = sortCol === 'symbol' ? b : (quotes[b]?.[sortCol] ?? null)
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
        return sortDir === 'asc' ? av - bv : bv - av
      })
    : filtered

  if (watchlist.length === 0) {
    return (
      <div className="text-center text-gray-600 py-24 text-sm">
        Add a ticker above to start monitoring
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Search / filter bar */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by symbol or company name…"
          className="w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 pl-9 pr-8 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 transition-colors"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
          >
            ×
          </button>
        )}
      </div>

      {/* Results count when filtering */}
      {q && (
        <div className="text-xs text-gray-500">
          {sortedList.length === 0
            ? `No matches for "${query}"`
            : `${sortedList.length} of ${watchlist.length} stocks`}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              {COLS.map(({ label, align, width, key }) => (
                <th
                  key={label || '_action'}
                  onClick={() => handleSort(key)}
                  className={`py-2 px-3 ${align} ${width} text-gray-500 text-xs font-semibold tracking-wider${key ? ' cursor-pointer select-none hover:text-gray-300' : ''}`}
                >
                  {label}
                  {key && <SortArrow active={sortCol === key} dir={sortDir} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedList.length === 0 && q ? (
              <tr>
                <td colSpan={COLS.length} className="py-16 text-center text-gray-600 text-sm">
                  No stocks match &ldquo;{query}&rdquo;
                </td>
              </tr>
            ) : (
              sortedList.map((sym, idx) => {
                const qt = quotes[sym]
                const flash = priceFlash[sym]
                let rowBg = idx % 2 === 0 ? 'bg-gray-900/20' : 'bg-transparent'
                if (flash === 'up') rowBg = 'bg-emerald-900/25'
                if (flash === 'down') rowBg = 'bg-red-900/25'

                return (
                  <Fragment key={sym}>
                    <tr
                      onClick={() => onChartOpen(sym)}
                      className={`border-b border-gray-800/60 cursor-pointer transition-colors duration-300 hover:bg-gray-800/50 ${rowBg}`}
                    >
                      {/* Symbol + Name */}
                      <td className="py-3 px-3">
                        <div className="font-bold text-white flex items-center gap-2">
                          {sym}
                          <svg className="w-3.5 h-3.5 text-gray-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1,12 5,7 8,9 12,4 15,6" />
                            <line x1="3" y1="2" x2="3" y2="12" />
                            <line x1="3" y1="12" x2="15" y2="12" />
                          </svg>
                          {onAlertBell && (
                            <AlertBellButton symbol={sym} alerts={alerts} onClick={onAlertBell} />
                          )}
                        </div>
                        {qt?.name && (
                          <div className="text-xs text-gray-500 truncate max-w-[140px]">{qt.name}</div>
                        )}
                        {!qt && (
                          <div className="text-xs text-yellow-600 animate-pulse">Loading…</div>
                        )}
                        {qt?.error && (
                          <div className="text-xs text-red-500" title={qt.error}>Error</div>
                        )}
                      </td>

                      {/* Price */}
                      <td className="py-3 px-3 text-right">
                        <span
                          className={`font-bold text-base transition-colors duration-300 ${
                            flash === 'up'
                              ? 'text-emerald-300'
                              : flash === 'down'
                              ? 'text-red-300'
                              : 'text-white'
                          }`}
                        >
                          {fmt.price(qt?.price)}
                        </span>
                      </td>

                      {/* Change $ */}
                      <td className="py-3 px-3 text-right">
                        <ChangeCell value={qt?.change} isPercent={false} />
                      </td>

                      {/* Change % */}
                      <td className="py-3 px-3 text-right">
                        <ChangeCell value={qt?.changePercent} isPercent={true} />
                      </td>

                      {/* Day Range */}
                      <td className="py-3 px-3">
                        <RangeCell lo={qt?.dayLow} hi={qt?.dayHigh} current={qt?.price} />
                      </td>

                      {/* Volume */}
                      <td className="py-3 px-3 text-right text-gray-300">
                        {fmt.volume(qt?.volume)}
                      </td>

                      {/* 52W Range */}
                      <td className="py-3 px-3">
                        <RangeCell lo={qt?.week52Low} hi={qt?.week52High} current={qt?.price} />
                      </td>

                      {/* Market Cap */}
                      <td className="py-3 px-3 text-right text-gray-300">
                        {fmt.marketCap(qt?.marketCap)}
                      </td>

                      {/* Remove */}
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); onRemove(sym) }}
                          className="text-gray-700 hover:text-red-400 transition-colors text-xl leading-none"
                          title="Remove"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
