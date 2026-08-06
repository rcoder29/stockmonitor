import { useState, useEffect, useMemo } from 'react'
import { fmtPct } from './MergerDealDashboard'

const API = import.meta.env.VITE_API_URL || ''

const RISK_COLOR = { Low: '#34d399', Medium: '#facc15', High: '#f87171' }
const RISK_ORDER = ['Low', 'Medium', 'High']

function riskCls(label) {
  if (label === 'Low')    return 'bg-emerald-900 text-emerald-300 border border-emerald-700'
  if (label === 'High')   return 'bg-red-900 text-red-300 border border-red-700'
  if (label === 'Medium') return 'bg-yellow-900 text-yellow-300 border border-yellow-700'
  return 'bg-slate-700 text-slate-400'
}

function cellCls(avgRisk) {
  if (avgRisk == null) return 'bg-slate-800/50 text-slate-600'
  if (avgRisk <= 3) return 'bg-emerald-900/60 text-emerald-300'
  if (avgRisk >= 7) return 'bg-red-900/60 text-red-300'
  return 'bg-yellow-900/60 text-yellow-300'
}

// ── Risk/Reward Scatter ──────────────────────────────────────────────────────

function RiskRewardScatter({ deals }) {
  const points = deals.filter(d => d.daysToClose != null && d.annualizedPct != null)
  if (points.length === 0) {
    return <div className="text-slate-500 text-sm py-12 text-center">No deals with both days-to-close and annualized return available</div>
  }

  const W = 720, H = 360, PAD = 44
  const xs = points.map(p => p.daysToClose)
  const ys = points.map(p => p.annualizedPct)
  const xMax = Math.max(...xs, 30) * 1.1
  const xMin = Math.min(0, ...xs)
  const yMax = Math.max(...ys, 5) * 1.15
  const yMin = Math.min(...ys, -5) * 1.15

  const sx = v => PAD + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD * 2)
  const sy = v => H - PAD - ((v - yMin) / (yMax - yMin || 1)) * (H - PAD * 2)

  const values = points.map(p => Math.sqrt(p.dealValueBn || 1))
  const rMin = Math.min(...values), rMax = Math.max(...values)
  const radius = v => {
    const t = rMax > rMin ? (Math.sqrt(v.dealValueBn || 1) - rMin) / (rMax - rMin) : 0.5
    return 5 + t * 14
  }

  const zeroY = sy(0)

  return (
    <div className="overflow-x-auto">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="min-w-[600px]">
        {/* Axes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#334155" strokeWidth="1" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#334155" strokeWidth="1" />
        {/* Zero return line */}
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#334155" strokeWidth="1" strokeDasharray="4,3" />
        <text x={W - PAD} y={zeroY - 4} textAnchor="end" fontSize="9" fill="#64748b">0% ann. return</text>

        {/* Axis labels */}
        <text x={(W) / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#94a3b8">Days to Close</text>
        <text x={12} y={H / 2} textAnchor="middle" fontSize="10" fill="#94a3b8" transform={`rotate(-90 12 ${H / 2})`}>Annualized Return %</text>

        {/* Points */}
        {points.map(p => (
          <g key={p.id}>
            <circle cx={sx(p.daysToClose)} cy={sy(p.annualizedPct)} r={radius(p)}
              fill={RISK_COLOR[p.riskLabel] || '#64748b'} fillOpacity="0.55"
              stroke={RISK_COLOR[p.riskLabel] || '#64748b'} strokeWidth="1.5" />
            <text x={sx(p.daysToClose)} y={sy(p.annualizedPct) - radius(p) - 4} textAnchor="middle" fontSize="10" fill="#cbd5e1">
              {p.targetTicker}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex gap-4 justify-center mt-2 text-xs text-slate-400">
        {RISK_ORDER.map(r => (
          <span key={r} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: RISK_COLOR[r] }} />
            {r} Risk
          </span>
        ))}
        <span className="text-slate-600">· Bubble size = deal value</span>
      </div>
    </div>
  )
}

// ── Regulator x Deal-Type Matrix ─────────────────────────────────────────────

function RegulatorMatrix({ deals }) {
  const dealTypes = ['cash', 'stock', 'mixed']
  const regulators = useMemo(() => {
    const set = new Set(deals.map(d => d.regulatoryBody || 'None/Unknown'))
    return Array.from(set).sort()
  }, [deals])

  const grid = useMemo(() => {
    const g = {}
    for (const reg of regulators) {
      g[reg] = {}
      for (const dt of dealTypes) {
        const cell = deals.filter(d => (d.regulatoryBody || 'None/Unknown') === reg && d.dealType === dt)
        if (cell.length === 0) { g[reg][dt] = null; continue }
        const avgRisk = cell.reduce((s, d) => s + (d.riskScore || 0), 0) / cell.length
        g[reg][dt] = { count: cell.length, avgRisk: Math.round(avgRisk * 10) / 10 }
      }
    }
    return g
  }, [deals, regulators])

  if (regulators.length === 0) return null

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 border-b border-slate-700">
            <th className="text-left px-3 py-2">Regulator</th>
            {dealTypes.map(dt => <th key={dt} className="text-center px-3 py-2">{dt.charAt(0).toUpperCase() + dt.slice(1)}</th>)}
          </tr>
        </thead>
        <tbody>
          {regulators.map(reg => (
            <tr key={reg} className="border-b border-slate-700/50">
              <td className="px-3 py-2 text-slate-300 text-xs">{reg}</td>
              {dealTypes.map(dt => {
                const cell = grid[reg][dt]
                return (
                  <td key={dt} className="px-1 py-1">
                    <div className={`rounded text-center py-2 text-xs ${cellCls(cell?.avgRisk)}`}>
                      {cell ? (
                        <>
                          <div className="font-bold">{cell.count} deal{cell.count > 1 ? 's' : ''}</div>
                          <div className="text-[10px] opacity-80">avg risk {cell.avgRisk}</div>
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

export default function MergerRiskMatrix() {
  const [deals, setDeals]     = useState([])
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    fetch(`${API}/api/merger/deals`)
      .then(r => r.json())
      .then(setDeals)
      .catch(() => setDeals([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const riskCounts = { Low: 0, Medium: 0, High: 0 }
  deals.forEach(d => { if (riskCounts[d.riskLabel] != null) riskCounts[d.riskLabel]++ })
  const highestRisk = [...deals].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0)).slice(0, 3)
  const bestReward   = [...deals].filter(d => d.annualizedPct != null).sort((a, b) => b.annualizedPct - a.annualizedPct).slice(0, 3)

  return (
    <div className="p-4 text-white max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Merger Arb — Risk Matrix</h1>
          <p className="text-sm text-slate-400">Visualize risk vs. reward across your tracked deal universe</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {deals.length === 0 && !loading ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl text-center py-16">
          <div className="text-slate-500 text-sm mb-2">No tracked deals yet</div>
          <div className="text-slate-600 text-xs">Add deals on the Deal Dashboard to see them mapped here</div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {RISK_ORDER.map(r => (
              <div key={r} className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-center">
                <div className="text-xs text-slate-500 mb-1">{r} Risk</div>
                <div className={`text-xl font-bold ${r === 'Low' ? 'text-emerald-400' : r === 'High' ? 'text-red-400' : 'text-yellow-400'}`}>{riskCounts[r]}</div>
              </div>
            ))}
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Risk vs. Reward</h3>
            <RiskRewardScatter deals={deals} />
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Exposure by Regulator × Deal Type</h3>
            <RegulatorMatrix deals={deals} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Highest Risk Deals</h3>
              {highestRisk.length === 0 ? <div className="text-xs text-slate-500">—</div> : (
                <div className="space-y-2">
                  {highestRisk.map(d => (
                    <div key={d.id} className="flex items-center justify-between">
                      <span className="text-sm text-sky-400 font-medium">{d.targetTicker}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${riskCls(d.riskLabel)}`}>{d.riskLabel} ({d.riskScore}/10)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Best Annualized Return</h3>
              {bestReward.length === 0 ? <div className="text-xs text-slate-500">—</div> : (
                <div className="space-y-2">
                  {bestReward.map(d => (
                    <div key={d.id} className="flex items-center justify-between">
                      <span className="text-sm text-sky-400 font-medium">{d.targetTicker}</span>
                      <span className="text-sm font-bold text-green-400">{fmtPct(d.annualizedPct, 1)}</span>
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
