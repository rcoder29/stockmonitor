import { useEffect, useState } from 'react'

function DaysChip({ days }) {
  if (days == null) return null
  let cls = 'bg-gray-800 text-gray-400'
  let label = `${days}d`
  if (days < 0)  { cls = 'bg-gray-800 text-gray-600'; label = 'past' }
  else if (days === 0) { cls = 'bg-red-900/60 text-red-300'; label = 'Today!' }
  else if (days <= 2)  cls = 'bg-red-900/40 text-red-400'
  else if (days <= 5)  cls = 'bg-amber-900/40 text-amber-400'
  else if (days <= 14) cls = 'bg-sky-900/30 text-sky-400'
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${cls}`}>{label}</span>
}

function BeatBar({ rate, count }) {
  if (rate == null) return <span className="text-gray-700 text-xs">—</span>
  const color = rate >= 75 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 bg-gray-800 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${rate}%` }} />
      </div>
      <span className={`text-xs tabular-nums ${rate >= 75 ? 'text-emerald-400' : rate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
        {rate}%
      </span>
      {count != null && <span className="text-gray-700 text-[10px]">({count}q)</span>}
    </div>
  )
}

function DriftBadge({ drift }) {
  if (drift == null) return <span className="text-gray-700 text-xs">—</span>
  const pos = drift >= 0
  return (
    <span className={`text-xs tabular-nums font-medium ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
      {drift >= 0 ? '+' : ''}{drift.toFixed(1)}%
    </span>
  )
}

export default function RichEarningsCalendar({ symbols }) {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [filter,  setFilter]  = useState('upcoming')  // upcoming | all

  useEffect(() => {
    const syms = [...new Set(symbols)].filter(Boolean)
    if (!syms.length) return
    setLoading(true); setError(null)
    fetch('/api/earnings/rich-calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: syms }),
    })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setRows)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbols.join(',')])

  const shown = filter === 'upcoming'
    ? rows.filter(r => r.days_away != null && r.days_away >= 0)
    : rows

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Earnings Calendar+</div>
        <div className="flex gap-1 bg-gray-900/60 rounded-lg p-1 border border-gray-800">
          {[['upcoming', 'Upcoming'], ['all', 'All']].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filter === v ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="py-10 text-center text-gray-500 text-sm animate-pulse">Loading earnings data…</div>}
      {error   && <div className="py-10 text-center text-red-400 text-sm">Failed: {error}</div>}

      {!loading && shown.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/80">
                {[
                  ['Symbol', 'text-left'],
                  ['Date', 'text-left'],
                  ['Due In', 'text-center'],
                  ['EPS Est', 'text-right'],
                  ['Beat Rate', 'text-center'],
                  ['Pre-Drift (5d)', 'text-right'],
                  ['Exp. Move ±', 'text-right'],
                ].map(([h, align]) => (
                  <th key={h} className={`py-2.5 px-4 text-gray-500 font-medium text-xs uppercase tracking-wider ${align}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                <tr key={row.symbol} className={`border-b border-gray-800/40 hover:bg-gray-800/20 ${i % 2 ? 'bg-gray-900/20' : ''}`}>
                  <td className="py-3 px-4 text-white font-semibold">{row.symbol}</td>
                  <td className="py-3 px-4 text-gray-400 text-xs">{row.next_date}</td>
                  <td className="py-3 px-4 text-center"><DaysChip days={row.days_away} /></td>
                  <td className="py-3 px-4 text-right text-gray-300 tabular-nums">
                    {row.eps_estimate != null ? `$${row.eps_estimate.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-3 px-4">
                    <BeatBar rate={row.beat_rate} count={row.total_count} />
                  </td>
                  <td className="py-3 px-4 text-right"><DriftBadge drift={row.pre_drift_pct} /></td>
                  <td className="py-3 px-4 text-right">
                    {row.expected_move_pct != null
                      ? <span className="text-amber-400 font-semibold tabular-nums">±{row.expected_move_pct.toFixed(1)}%</span>
                      : <span className="text-gray-700">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && shown.length === 0 && (
        <div className="py-10 text-center text-gray-600 text-sm">
          {filter === 'upcoming' ? 'No upcoming earnings found for your watchlist.' : 'No earnings data available.'}
        </div>
      )}

      <div className="text-gray-700 text-xs">
        Beat Rate: % of quarters EPS beat estimate · Pre-Drift: avg 5-day return before earnings · Exp. Move: ATM straddle ÷ price · Cached 2hr
      </div>
    </div>
  )
}
