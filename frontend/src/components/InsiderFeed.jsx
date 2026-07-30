import { useState, useEffect } from 'react'

const FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'buys',    label: 'Buys Only' },
  { key: 'csuite',  label: 'C-Suite' },
  { key: 'large',   label: '$500k+' },
  { key: 'cluster', label: 'Cluster Buys' },
]

const WINDOWS = [
  { days: 7,  label: '7d' },
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
  { days: 60, label: '60d' },
]

function fmt(n) {
  if (n == null) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

function timeAgo(isoStr) {
  if (!isoStr) return ''
  const diff = Date.now() - new Date(isoStr).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function TypeBadge({ isBuy }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${
      isBuy
        ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40'
        : 'bg-red-900/40 text-red-400 border-red-700/40'
    }`}>
      {isBuy ? '▲ Buy' : '▼ Sale'}
    </span>
  )
}

function ClusterBadge({ count }) {
  if (count < 2) return null
  return (
    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-orange-900/50 text-orange-300 border border-orange-700/40">
      ×{count}
    </span>
  )
}

function CSuiteBadge() {
  return (
    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-blue-900/50 text-blue-300 border border-blue-700/40">
      C
    </span>
  )
}

function SortIcon({ active, asc }) {
  if (!active) return <span className="text-slate-700 ml-1">⇅</span>
  return <span className="text-blue-400 ml-1">{asc ? '▲' : '▼'}</span>
}

export default function InsiderFeed() {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [filter, setFilter]     = useState('buys')
  const [days, setDays]         = useState(30)
  const [sortKey, setSortKey]   = useState('date')
  const [sortAsc, setSortAsc]   = useState(false)
  const [search, setSearch]     = useState('')

  function load(d = days) {
    setLoading(true)
    setError(null)
    fetch(`/api/market/insider-feed?days=${d}`)
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function handleSort(key) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  function changeWindow(d) {
    setDays(d)
    setData(null)
    load(d)
  }

  const txs = data?.transactions || []

  const filtered = txs.filter(t => {
    if (search) {
      const q = search.toUpperCase()
      if (!t.symbol.includes(q) && !t.insider.toUpperCase().includes(q) && !t.company.toUpperCase().includes(q)) return false
    }
    if (filter === 'buys')    return t.isBuy
    if (filter === 'csuite')  return t.isBuy && t.isCsuite
    if (filter === 'large')   return t.isBuy && (t.value || 0) >= 500000
    if (filter === 'cluster') return t.isBuy && t.clusterCount >= 2
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey]
    if (sortKey === 'value' || sortKey === 'shares') {
      av = av ?? (sortAsc ? Infinity : -Infinity)
      bv = bv ?? (sortAsc ? Infinity : -Infinity)
      return sortAsc ? av - bv : bv - av
    }
    av = av ?? ''
    bv = bv ?? ''
    return sortAsc ? av.localeCompare?.(bv) ?? 0 : bv.localeCompare?.(av) ?? 0
  })

  const s = data?.summary

  function Th({ label, k, right }) {
    return (
      <th onClick={() => handleSort(k)}
        className={`px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-white select-none whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
        {label}<SortIcon active={sortKey === k} asc={sortAsc} />
      </th>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Insider Trading Feed</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Open-market purchases and sales by corporate insiders across a large-cap universe — reported via SEC Form 4.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Time window */}
          <div className="flex gap-1 bg-slate-800 rounded-xl p-1">
            {WINDOWS.map(w => (
              <button key={w.days} onClick={() => changeWindow(w.days)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${days === w.days ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {w.label}
              </button>
            ))}
          </div>
          <button onClick={() => load(days)} disabled={loading}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-xl transition-colors disabled:opacity-50">
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: `Buys (${days}d)`,     value: s.totalBuys,                          color: 'text-emerald-400' },
            { label: `Sales (${days}d)`,    value: s.totalSales,                         color: 'text-red-400' },
            { label: 'Total Buy Value',     value: fmt(s.totalBuyValue),                 color: 'text-emerald-400' },
            { label: 'Cluster Buy Stocks',  value: s.clusterSymbols,                     color: 'text-orange-400' },
          ].map(c => (
            <div key={c.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-xs text-slate-400">{c.label}</p>
              <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Largest buy callout */}
      {s?.largestBuy && (
        <div className="bg-emerald-900/15 border border-emerald-700/40 rounded-xl p-4 flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs text-emerald-400 uppercase tracking-wider font-semibold mb-0.5">Largest Open-Market Purchase ({days}d)</p>
            <p className="text-white font-bold text-lg">{s.largestBuy.symbol} <span className="text-slate-400 font-normal text-sm">{s.largestBuy.company}</span></p>
            <p className="text-xs text-slate-400 mt-0.5">{s.largestBuy.insider} — {s.largestBuy.title}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-emerald-400 font-bold text-xl">{fmt(s.largestBuy.value)}</p>
            <p className="text-xs text-slate-400">{s.largestBuy.shares?.toLocaleString()} shares @ {s.largestBuy.price ? `$${s.largestBuy.price}` : '—'}</p>
            <p className="text-xs text-slate-500">{s.largestBuy.date}</p>
          </div>
        </div>
      )}

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-slate-800 rounded-xl p-1">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f.key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {f.label}
              {data && f.key !== 'all' && (
                <span className="ml-1 opacity-60">
                  ({txs.filter(t => {
                    if (f.key === 'buys')    return t.isBuy
                    if (f.key === 'csuite')  return t.isBuy && t.isCsuite
                    if (f.key === 'large')   return t.isBuy && (t.value || 0) >= 500000
                    if (f.key === 'cluster') return t.isBuy && t.clusterCount >= 2
                    return true
                  }).length})
                </span>
              )}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search ticker, insider, company…"
          className="flex-1 min-w-[180px] bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
      </div>

      {error && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>}

      {loading && (
        <div className="py-16 text-center space-y-2">
          <div className="w-8 h-8 rounded-full border-2 border-slate-600 border-t-blue-500 animate-spin mx-auto" />
          <p className="text-slate-400 text-sm">Scanning {days}-day insider filings across ~150 companies…</p>
          <p className="text-slate-500 text-xs">This may take 15–30 seconds on first load (cached for 4 hours)</p>
        </div>
      )}

      {!loading && data && (
        <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/60">
                  <Th label="Ticker"   k="symbol" />
                  <Th label="Company"  k="company" />
                  <Th label="Insider"  k="insider" />
                  <Th label="Title"    k="title" />
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                  <Th label="Shares"   k="shares"  right />
                  <Th label="Price"    k="price"   right />
                  <Th label="Value"    k="value"   right />
                  <Th label="Date"     k="date"    right />
                </tr>
              </thead>
              <tbody>
                {sorted.map((t, i) => (
                  <tr key={i}
                    className={`border-b border-slate-700/50 transition-colors ${
                      t.isBuy
                        ? t.clusterCount >= 2
                          ? 'bg-orange-900/8 hover:bg-orange-900/15'
                          : 'hover:bg-emerald-900/10'
                        : 'hover:bg-red-900/10'
                    }`}>
                    <td className="px-3 py-2.5 font-bold text-white">{t.symbol}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400 max-w-[140px] truncate">{t.company}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-300">
                      {t.insider}
                      {t.isCsuite && <CSuiteBadge />}
                      {t.isBuy && t.clusterCount >= 2 && <ClusterBadge count={t.clusterCount} />}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-400 max-w-[130px] truncate">{t.title}</td>
                    <td className="px-3 py-2.5"><TypeBadge isBuy={t.isBuy} /></td>
                    <td className="px-3 py-2.5 text-slate-300 tabular-nums text-right text-xs">
                      {t.shares ? t.shares.toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300 tabular-nums text-right text-xs">
                      {t.price ? `$${t.price.toFixed(2)}` : '—'}
                    </td>
                    <td className={`px-3 py-2.5 tabular-nums text-right font-semibold text-sm ${t.isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmt(t.value)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 tabular-nums text-right text-xs">{t.date}</td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-12 text-center text-slate-500">
                      No transactions match this filter in the last {days} days.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {sorted.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-700 text-xs text-slate-500">
              Showing {sorted.length} transactions · Updated {data.asOf}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="grid sm:grid-cols-3 gap-4 text-xs text-slate-500 bg-slate-800/40 rounded-xl p-4 border border-slate-700/40">
        <div>
          <p className="text-slate-300 font-semibold mb-1">What to look for</p>
          <p>Open-market purchases (insider spending their own cash) are the most bullish signal. Cluster buys — multiple insiders at the same company — historically precede outperformance. C-suite purchases carry more weight than director purchases.</p>
        </div>
        <div>
          <p className="text-slate-300 font-semibold mb-1">Badge legend</p>
          <p><span className="bg-blue-900/50 text-blue-300 border border-blue-700/40 px-1.5 py-0.5 rounded text-xs font-bold mr-1">C</span> C-Suite insider (CEO, CFO, COO, President, Chairman)</p>
          <p className="mt-1"><span className="bg-orange-900/50 text-orange-300 border border-orange-700/40 px-1.5 py-0.5 rounded text-xs font-bold mr-1">×N</span> N insiders buying the same stock in this period (cluster buy)</p>
        </div>
        <div>
          <p className="text-slate-300 font-semibold mb-1">What to ignore</p>
          <p>Option exercises, automatic 10b5-1 plan transactions, and stock grants are excluded — they aren't discretionary signals. Sales from insiders are shown for completeness but are less informative than purchases.</p>
        </div>
      </div>

      <p className="text-xs text-slate-600">
        Data sourced from SEC Form 4 filings via yfinance. Covers ~150 large and mid-cap companies; not a complete market scan. Cached for 4 hours. For informational purposes only — not investment advice.
      </p>
    </div>
  )
}
