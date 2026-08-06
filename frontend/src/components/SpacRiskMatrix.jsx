import { useState, useEffect, useMemo } from 'react'
import { fmtPct } from './MergerDealDashboard'

const API = import.meta.env.VITE_API_URL || ''

const STATUS_COLOR = {
  searching:         '#94a3b8',
  deal_announced:    '#38bdf8',
  shareholder_vote:  '#facc15',
  redemption_period: '#fb923c',
  closing:           '#34d399',
}
const STATUS_LABELS = {
  searching:         'Searching',
  deal_announced:    'Deal Announced',
  shareholder_vote:  'Shareholder Vote',
  redemption_period: 'Redemption Period',
  closing:            'Closing',
}
const URGENCY_BUCKETS = [
  { key: 'urgent',   label: 'Urgent (<45d)',      test: d => d != null && d < 45 },
  { key: 'moderate', label: 'Moderate (45–120d)',  test: d => d != null && d >= 45 && d <= 120 },
  { key: 'distant',  label: 'Distant (>120d)',     test: d => d != null && d > 120 },
]

function urgencyBucket(days) {
  if (days == null) return null
  return URGENCY_BUCKETS.find(b => b.test(days))?.key ?? null
}

function yieldCls(v) {
  if (v == null) return 'text-slate-500'
  if (v >= 15) return 'text-emerald-400'
  if (v >= 5)  return 'text-yellow-400'
  return 'text-slate-300'
}

// ── Yield vs. Deadline Scatter ───────────────────────────────────────────────

function YieldDeadlineScatter({ spacs }) {
  const points = spacs.filter(s => s.daysToDeadline != null && s.annualizedYieldPct != null)
  if (points.length === 0) {
    return <div className="text-slate-500 text-sm py-12 text-center">No SPACs with both a deadline and live annualized yield available</div>
  }

  const W = 720, H = 360, PAD = 44
  const xs = points.map(p => p.daysToDeadline)
  const ys = points.map(p => p.annualizedYieldPct)
  const xMax = Math.max(...xs, 30) * 1.1
  const xMin = Math.min(0, ...xs)
  const yMax = Math.max(...ys, 5) * 1.15
  const yMin = Math.min(...ys, -5) * 1.15

  const sx = v => PAD + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD * 2)
  const sy = v => H - PAD - ((v - yMin) / (yMax - yMin || 1)) * (H - PAD * 2)

  const mags = points.map(p => Math.abs(p.discountPct || 1))
  const rMin = Math.min(...mags), rMax = Math.max(...mags)
  const radius = p => {
    const t = rMax > rMin ? (Math.abs(p.discountPct || 1) - rMin) / (rMax - rMin) : 0.5
    return 5 + t * 14
  }

  const zeroY = sy(0)
  const statuses = Array.from(new Set(points.map(p => p.status)))

  return (
    <div className="overflow-x-auto">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="min-w-[600px]">
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#334155" strokeWidth="1" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#334155" strokeWidth="1" />
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#334155" strokeWidth="1" strokeDasharray="4,3" />
        <text x={W - PAD} y={zeroY - 4} textAnchor="end" fontSize="9" fill="#64748b">0% ann. yield</text>

        <text x={W / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#94a3b8">Days to Deadline</text>
        <text x={12} y={H / 2} textAnchor="middle" fontSize="10" fill="#94a3b8" transform={`rotate(-90 12 ${H / 2})`}>Annualized Yield %</text>

        {points.map(p => (
          <g key={p.id}>
            <circle cx={sx(p.daysToDeadline)} cy={sy(p.annualizedYieldPct)} r={radius(p)}
              fill={STATUS_COLOR[p.status] || '#64748b'} fillOpacity="0.55"
              stroke={STATUS_COLOR[p.status] || '#64748b'} strokeWidth="1.5" />
            <text x={sx(p.daysToDeadline)} y={sy(p.annualizedYieldPct) - radius(p) - 4} textAnchor="middle" fontSize="10" fill="#cbd5e1">
              {p.ticker}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex gap-4 justify-center flex-wrap mt-2 text-xs text-slate-400">
        {statuses.map(s => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: STATUS_COLOR[s] || '#64748b' }} />
            {STATUS_LABELS[s] || s}
          </span>
        ))}
        <span className="text-slate-600">· Bubble size = |discount/premium to trust|</span>
      </div>
    </div>
  )
}

// ── Status × Urgency Grid ─────────────────────────────────────────────────────

function StatusUrgencyGrid({ spacs }) {
  const statuses = useMemo(() => Array.from(new Set(spacs.map(s => s.status))), [spacs])

  const grid = useMemo(() => {
    const g = {}
    for (const status of statuses) {
      g[status] = {}
      for (const bucket of URGENCY_BUCKETS) {
        const cell = spacs.filter(s => s.status === status && urgencyBucket(s.daysToDeadline) === bucket.key)
        if (cell.length === 0) { g[status][bucket.key] = null; continue }
        const yields = cell.filter(s => s.annualizedYieldPct != null).map(s => s.annualizedYieldPct)
        const avgYield = yields.length ? yields.reduce((a, b) => a + b, 0) / yields.length : null
        g[status][bucket.key] = { count: cell.length, avgYield: avgYield != null ? Math.round(avgYield * 10) / 10 : null }
      }
    }
    return g
  }, [spacs, statuses])

  if (statuses.length === 0) return null

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 border-b border-slate-700">
            <th className="text-left px-3 py-2">Status</th>
            {URGENCY_BUCKETS.map(b => <th key={b.key} className="text-center px-3 py-2">{b.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {statuses.map(status => (
            <tr key={status} className="border-b border-slate-700/50">
              <td className="px-3 py-2 text-slate-300 text-xs">{STATUS_LABELS[status] || status}</td>
              {URGENCY_BUCKETS.map(b => {
                const cell = grid[status][b.key]
                return (
                  <td key={b.key} className="px-1 py-1">
                    <div className="rounded text-center py-2 text-xs bg-slate-800/50">
                      {cell ? (
                        <>
                          <div className="font-bold text-white">{cell.count} SPAC{cell.count > 1 ? 's' : ''}</div>
                          <div className={`text-[10px] ${yieldCls(cell.avgYield)}`}>
                            {cell.avgYield != null ? `avg yield ${cell.avgYield}%` : 'yield n/a'}
                          </div>
                        </>
                      ) : <span className="text-slate-700">—</span>}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SpacRiskMatrix() {
  const [spacs, setSpacs]     = useState([])
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    fetch(`${API}/api/spac/deals`)
      .then(r => r.json())
      .then(setSpacs)
      .catch(() => setSpacs([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const urgencyCounts = { urgent: 0, moderate: 0, distant: 0 }
  spacs.forEach(s => { const b = urgencyBucket(s.daysToDeadline); if (b) urgencyCounts[b]++ })
  const nearestDeadlines = [...spacs].filter(s => s.daysToDeadline != null).sort((a, b) => a.daysToDeadline - b.daysToDeadline).slice(0, 3)
  const bestYield = [...spacs].filter(s => s.annualizedYieldPct != null).sort((a, b) => b.annualizedYieldPct - a.annualizedYieldPct).slice(0, 3)

  return (
    <div className="p-4 text-white max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">SPACs — Risk Matrix</h1>
          <p className="text-sm text-slate-400">Visualize yield vs. deadline timing across your tracked SPAC universe</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {spacs.length === 0 && !loading ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl text-center py-16">
          <div className="text-slate-500 text-sm mb-2">No tracked SPACs yet</div>
          <div className="text-slate-600 text-xs">Add SPACs on the Tracker to see them mapped here</div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {URGENCY_BUCKETS.map(b => (
              <div key={b.key} className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-center">
                <div className="text-xs text-slate-500 mb-1">{b.label}</div>
                <div className={`text-xl font-bold ${b.key === 'urgent' ? 'text-orange-400' : b.key === 'distant' ? 'text-slate-300' : 'text-yellow-400'}`}>{urgencyCounts[b.key]}</div>
              </div>
            ))}
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Annualized Yield vs. Deadline</h3>
            <YieldDeadlineScatter spacs={spacs} />
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Deal Stage × Deadline Urgency</h3>
            <StatusUrgencyGrid spacs={spacs} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Nearest Deadlines</h3>
              {nearestDeadlines.length === 0 ? <div className="text-xs text-slate-500">—</div> : (
                <div className="space-y-2">
                  {nearestDeadlines.map(s => (
                    <div key={s.id} className="flex items-center justify-between">
                      <span className="text-sm text-sky-400 font-medium">{s.ticker}</span>
                      <span className={s.daysToDeadline < 45 ? 'text-orange-400 font-semibold text-sm' : 'text-slate-300 text-sm'}>
                        {s.daysToDeadline < 0 ? 'Overdue' : `${s.daysToDeadline}d`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Best Annualized Yield</h3>
              {bestYield.length === 0 ? <div className="text-xs text-slate-500">—</div> : (
                <div className="space-y-2">
                  {bestYield.map(s => (
                    <div key={s.id} className="flex items-center justify-between">
                      <span className="text-sm text-sky-400 font-medium">{s.ticker}</span>
                      <span className="text-sm font-bold text-green-400">{fmtPct(s.annualizedYieldPct, 1)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
