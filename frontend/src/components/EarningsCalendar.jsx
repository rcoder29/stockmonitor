import { useState, useEffect } from 'react'

function urgencyClass(days) {
  if (days <= 3)  return { bg: 'bg-red-900/50',    border: 'border-red-700/60',   text: 'text-red-300',    badge: 'bg-red-600',    label: '🔴' }
  if (days <= 7)  return { bg: 'bg-amber-900/40',  border: 'border-amber-700/50', text: 'text-amber-300',  badge: 'bg-amber-500',  label: '🟡' }
  if (days <= 30) return { bg: 'bg-sky-900/30',    border: 'border-sky-800/40',   text: 'text-sky-400',    badge: 'bg-sky-700',    label: '🔵' }
  return              { bg: 'bg-gray-800/30',    border: 'border-gray-700/40',  text: 'text-gray-500',   badge: 'bg-gray-700',   label: '⚪' }
}

function fmtEPS(v) {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}

function fmtRevenue(v) {
  if (v == null) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toLocaleString()}`
}

function daysLabel(d) {
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  return `${d}d`
}

// ── Inline earnings badge for Watchlist rows ──────────────────────────────────

export function EarningsBadge({ daysUntil }) {
  if (daysUntil == null || daysUntil < 0 || daysUntil > 14) return null
  const { text, badge } = urgencyClass(daysUntil)
  return (
    <span
      title={`Earnings in ${daysLabel(daysUntil)}`}
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge} text-white`}
    >
      📅 {daysLabel(daysUntil)}
    </span>
  )
}

// ── Full earnings calendar widget ─────────────────────────────────────────────

export default function EarningsCalendar({ earnings = [], loading = false }) {
  const [open, setOpen] = useState(true)

  const upcoming = earnings.filter(e => e.daysUntil != null && e.daysUntil >= 0)

  if (!loading && upcoming.length === 0) return null

  return (
    <div className="mb-4 bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs uppercase tracking-widest font-medium">Upcoming Earnings</span>
          {upcoming.length > 0 && (
            <span className="bg-emerald-700 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
              {upcoming.length}
            </span>
          )}
          {upcoming.some(e => e.daysUntil <= 3) && (
            <span className="text-red-400 text-xs font-medium">⚠ Earnings this week</span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-800">
          {loading && (
            <div className="text-gray-600 text-sm text-center py-6">Loading earnings dates…</div>
          )}

          {!loading && upcoming.length === 0 && (
            <div className="text-gray-600 text-sm text-center py-6">
              No earnings in the next 30 days for tracked symbols
            </div>
          )}

          {!loading && upcoming.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Symbol', 'Date', 'In', 'EPS Est.', 'EPS Range', 'Rev Est.'].map((h, i) => (
                    <th key={h} className={`py-2 px-4 text-gray-600 font-medium tracking-wider uppercase ${i > 1 ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {upcoming.map(e => {
                  const u = urgencyClass(e.daysUntil)
                  return (
                    <tr key={e.symbol} className={`border-b border-gray-800/40 ${e.daysUntil <= 3 ? 'bg-red-950/20' : e.daysUntil <= 7 ? 'bg-amber-950/10' : ''}`}>
                      <td className="py-2.5 px-4">
                        <span className="text-white font-bold">{e.symbol}</span>
                      </td>
                      <td className="py-2.5 px-4 text-gray-400">
                        {new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`font-semibold px-2 py-0.5 rounded text-white text-[11px] ${u.badge}`}>
                          {daysLabel(e.daysUntil)}
                        </span>
                      </td>
                      <td className={`py-2.5 px-4 text-right tabular-nums font-medium ${u.text}`}>
                        {fmtEPS(e.epsEstimate)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-600 tabular-nums">
                        {e.epsLow != null && e.epsHigh != null
                          ? `${fmtEPS(e.epsLow)} – ${fmtEPS(e.epsHigh)}`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-400 tabular-nums">
                        {fmtRevenue(e.revenueEstimate)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
