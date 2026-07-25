import { useState, useEffect } from 'react'

function daysLabel(days) {
  if (days < 0) return { text: 'Expired', cls: 'text-slate-500' }
  if (days === 0) return { text: 'Today', cls: 'text-red-400 font-bold' }
  if (days <= 14) return { text: `${days}d`, cls: 'text-red-400 font-semibold' }
  if (days <= 30) return { text: `${days}d`, cls: 'text-orange-400 font-semibold' }
  if (days <= 60) return { text: `${days}d`, cls: 'text-yellow-400' }
  return { text: `${days}d`, cls: 'text-slate-400' }
}

function perfColor(v) {
  if (v == null) return 'text-slate-400'
  return v >= 0 ? 'text-emerald-400' : 'text-red-400'
}

function LockupBar({ days }) {
  if (days < 0) return <span className="text-xs text-slate-500">Expired</span>
  const pct = Math.max(0, Math.min(100, (1 - days / 180) * 100))
  let color = 'bg-emerald-500'
  if (days <= 30) color = 'bg-red-500'
  else if (days <= 60) color = 'bg-orange-500'
  else if (days <= 90) color = 'bg-yellow-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 bg-slate-700 rounded-full h-1.5 shrink-0">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs tabular-nums ${daysLabel(days).cls}`}>{daysLabel(days).text}</span>
    </div>
  )
}

export default function IpoCalendar() {
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [sortKey, setSortKey] = useState('daysToLockup')
  const [sortAsc, setSortAsc] = useState(true)
  const [tab, setTab]         = useState('active')  // active | expired

  useEffect(() => {
    fetch('/api/market/ipo-calendar')
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function sort(key) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(key === 'daysToLockup') }
  }

  const filtered = data.filter(r => tab === 'active' ? !r.lockupExpired : r.lockupExpired)
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? (sortAsc ? Infinity : -Infinity)
    const bv = b[sortKey] ?? (sortAsc ? Infinity : -Infinity)
    return sortAsc ? av - bv : bv - av
  })

  function ColHeader({ label, k, right }) {
    const active = sortKey === k
    return (
      <th
        onClick={() => sort(k)}
        className={`px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-white select-none whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      >
        {label}{active ? (sortAsc ? ' ▲' : ' ▼') : ''}
      </th>
    )
  }

  const activeCnt  = data.filter(r => !r.lockupExpired).length
  const expiredCnt = data.filter(r => r.lockupExpired).length
  const expiringCnt = data.filter(r => !r.lockupExpired && r.daysToLockup <= 30).length

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">IPO & Lockup Calendar</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Recent IPO performance and lockup expiration countdowns. Lockup expiry can trigger insider selling pressure.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Active Lockups', value: activeCnt, sub: 'insiders still locked', color: 'text-white' },
          { label: 'Expiring ≤ 30d', value: expiringCnt, sub: 'watch for selling pressure', color: expiringCnt > 0 ? 'text-red-400' : 'text-white' },
          { label: 'Lockups Expired', value: expiredCnt, sub: 'insiders may sell freely', color: 'text-slate-400' },
        ].map(c => (
          <div key={c.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800 rounded-xl p-1 w-fit">
        {[['active', `Active Lockups (${activeCnt})`], ['expired', `Expired (${expiredCnt})`]].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === v ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {l}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300 text-sm">{error}</div>}
      {loading && <div className="text-center py-16 text-slate-500">Loading IPO data…</div>}

      {!loading && (
        <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/60">
                  <ColHeader label="Company" k="company" />
                  <ColHeader label="Sector" k="sector" />
                  <ColHeader label="IPO Date" k="ipoDate" />
                  <ColHeader label="Days Since IPO" k="daysSinceIpo" right />
                  <ColHeader label="IPO Price" k="ipoPrice" right />
                  <ColHeader label="Current" k="currentPrice" right />
                  <ColHeader label="Since IPO" k="perfPct" right />
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                    {tab === 'active' ? 'Lockup Expiry' : 'Expired'}
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">Lockup Progress</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(row => {
                  const urgency = !row.lockupExpired && row.daysToLockup <= 14
                  return (
                    <tr key={row.symbol}
                      className={`border-b border-slate-700/50 transition-colors ${urgency ? 'bg-red-900/10 hover:bg-red-900/20' : 'hover:bg-slate-700/30'}`}>
                      <td className="px-3 py-2.5">
                        <div className="font-bold text-white">{row.symbol}</div>
                        <div className="text-xs text-slate-400">{row.company}</div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-400">{row.sector}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-300 tabular-nums">{row.ipoDate}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-400 tabular-nums text-right">{row.daysSinceIpo}d</td>
                      <td className="px-3 py-2.5 text-xs text-slate-300 tabular-nums text-right">${row.ipoPrice.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-sm font-semibold text-white tabular-nums text-right">
                        {row.currentPrice ? `$${row.currentPrice.toFixed(2)}` : '—'}
                      </td>
                      <td className={`px-3 py-2.5 text-sm font-semibold tabular-nums text-right ${perfColor(row.perfPct)}`}>
                        {row.perfPct != null ? `${row.perfPct >= 0 ? '+' : ''}${row.perfPct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-300 tabular-nums">{row.lockupDate}</td>
                      <td className="px-3 py-2.5">
                        <LockupBar days={row.daysToLockup} />
                      </td>
                    </tr>
                  )
                })}
                {sorted.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-500">No IPOs in this view.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 text-xs text-slate-500 bg-slate-800/40 rounded-xl p-4 border border-slate-700/40">
        <div>
          <p className="text-slate-300 font-semibold mb-1">What is a lockup period?</p>
          <p>Company insiders (founders, employees, early investors) are typically barred from selling shares for 90–180 days after an IPO. When the lockup expires, they can sell — which can create short-term selling pressure on the stock price.</p>
        </div>
        <div>
          <p className="text-slate-300 font-semibold mb-1">How to use this data</p>
          <p>Watch for stocks with lockup expiry within 14–30 days — increased supply from insider selling can weigh on price. Stocks with strong performance since IPO and imminent lockup expiry carry the most risk.</p>
        </div>
      </div>
    </div>
  )
}
