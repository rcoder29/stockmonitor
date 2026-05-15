import { useState, useEffect } from 'react'
import { fmt } from '../utils/format'

const ACTION_META = {
  up:   { label: 'UPGRADE',    cls: 'text-emerald-400 bg-emerald-900/40 border-emerald-800' },
  down: { label: 'DOWNGRADE',  cls: 'text-red-400    bg-red-900/40    border-red-800'     },
  init: { label: 'INITIATED',  cls: 'text-sky-400    bg-sky-900/40    border-sky-800'     },
  reit: { label: 'REITERATED', cls: 'text-gray-400   bg-gray-800/60  border-gray-700'     },
  main: { label: 'MAINTAINED', cls: 'text-gray-400   bg-gray-800/60  border-gray-700'     },
}

const PT_ACTION_CLS = {
  Raises:    'text-emerald-400',
  Lowers:    'text-red-400',
  Maintains: 'text-gray-500',
}

function ptArrow(ptAction) {
  if (!ptAction) return null
  if (ptAction.toLowerCase().includes('rais')) return <span className="text-emerald-400">↑</span>
  if (ptAction.toLowerCase().includes('lower')) return <span className="text-red-400">↓</span>
  return null
}

// Is this row within the last 30 days (i.e. a "current change")?
function isRecent(dateStr) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  return new Date(dateStr) >= cutoff
}

export default function AnalystDetailModal({ action, onClose }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [firmFilter, setFirmFilter] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`/api/analyst-history/${action.symbol}`)
      .then(r => { if (!r.ok) throw new Error(`Server error ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [action.symbol])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isPos = data?.changePct == null || data.changePct >= 0

  const firms = data ? [...new Set(data.history.map(h => h.firm))].sort() : []
  const visible = data
    ? (firmFilter ? data.history.filter(h => h.firm === firmFilter) : data.history)
    : []

  const recentCount = data ? data.history.filter(h => isRecent(h.date)).length : 0

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-lg font-bold text-white">{action.symbol}</span>
            {data?.name && <span className="text-gray-500 text-sm">{data.name}</span>}
            {data?.price != null && (
              <span className="text-xl font-semibold text-white">{fmt.price(data.price)}</span>
            )}
            {data?.changePct != null && (
              <span className={`text-sm font-medium ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                {isPos ? '+' : ''}{data.changePct.toFixed(2)}%
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-white text-2xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors"
          >×</button>
        </div>

        {/* Sub-header: summary + firm filter */}
        <div className="px-6 py-3 border-b border-gray-800 shrink-0">
          {data && (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>{data.history.length} ratings · last 2 years</span>
                {recentCount > 0 && (
                  <span className="text-amber-400 font-medium">
                    {recentCount} recent change{recentCount !== 1 ? 's' : ''} (last 30 days)
                  </span>
                )}
              </div>
              {/* Firm filter pills */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setFirmFilter(null)}
                  className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors ${
                    !firmFilter ? 'bg-gray-600 border-gray-500 text-white' : 'border-gray-700 text-gray-500 hover:text-gray-300'
                  }`}
                >All firms</button>
                {firms.map(f => (
                  <button
                    key={f}
                    onClick={() => setFirmFilter(firmFilter === f ? null : f)}
                    className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors ${
                      firmFilter === f
                        ? 'bg-sky-800 border-sky-600 text-sky-200'
                        : 'border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                  >{f}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto min-h-0">
          {loading && (
            <div className="py-16 text-center text-gray-500 text-sm animate-pulse">
              Loading sell-side coverage…
            </div>
          )}
          {error && (
            <div className="py-16 text-center text-red-400 text-sm">⚠ {error}</div>
          )}
          {!loading && !error && visible.length === 0 && (
            <div className="py-16 text-center text-gray-500 text-sm">No ratings found</div>
          )}
          {!loading && !error && visible.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 z-10">
                <tr className="border-b border-gray-800">
                  <th className="text-left text-gray-600 py-2.5 px-4 font-medium tracking-wider uppercase">Date</th>
                  <th className="text-left text-gray-600 py-2.5 px-4 font-medium tracking-wider uppercase">Firm</th>
                  <th className="text-left text-gray-600 py-2.5 px-4 font-medium tracking-wider uppercase">Action</th>
                  <th className="text-left text-gray-600 py-2.5 px-4 font-medium tracking-wider uppercase">From Grade</th>
                  <th className="text-left text-gray-600 py-2.5 px-4 font-medium tracking-wider uppercase">To Grade</th>
                  <th className="text-right text-gray-600 py-2.5 px-4 font-medium tracking-wider uppercase">Prior PT</th>
                  <th className="text-right text-gray-600 py-2.5 px-4 font-medium tracking-wider uppercase">Current PT</th>
                  <th className="text-left text-gray-600 py-2.5 px-4 font-medium tracking-wider uppercase">PT Change</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => {
                  const recent = isRecent(row.date)
                  const meta = ACTION_META[row.action] || ACTION_META.main
                  const gradeChanged = row.fromGrade && row.toGrade && row.fromGrade !== row.toGrade
                  return (
                    <tr
                      key={i}
                      className={`border-b border-gray-800/40 transition-colors ${
                        recent ? 'bg-amber-950/20 hover:bg-amber-950/30' : 'hover:bg-gray-800/40'
                      }`}
                    >
                      <td className="py-2.5 px-4 text-gray-400 whitespace-nowrap">
                        {recent && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-2 mb-0.5" />}
                        {row.date}
                      </td>
                      <td className="py-2.5 px-4 text-gray-300 whitespace-nowrap">{row.firm}</td>
                      <td className="py-2.5 px-4">
                        <span className={`font-bold px-1.5 py-0.5 rounded border text-xs ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className={`py-2.5 px-4 ${gradeChanged ? 'text-gray-500' : 'text-gray-400'}`}>
                        {row.fromGrade || '—'}
                      </td>
                      <td className={`py-2.5 px-4 font-medium ${gradeChanged ? 'text-white' : 'text-gray-400'}`}>
                        {row.toGrade || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-500 tabular-nums">
                        {row.priorPT ? fmt.price(row.priorPT) : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-300 tabular-nums font-medium">
                        {row.currentPT ? fmt.price(row.currentPT) : '—'}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {row.ptAction ? (
                          <span className={`${PT_ACTION_CLS[row.ptAction] || 'text-gray-500'} flex items-center gap-1`}>
                            {ptArrow(row.ptAction)}
                            {row.ptAction}
                            {row.priorPT && row.currentPT && row.priorPT !== row.currentPT && (
                              <span className="text-gray-600 ml-1">
                                ({row.currentPT > row.priorPT ? '+' : ''}
                                {fmt.price(row.currentPT - row.priorPT)})
                              </span>
                            )}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
