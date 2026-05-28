import { useEffect, useState } from 'react'

const W = 560
const H = 340
const PAD = { top: 20, right: 20, bottom: 44, left: 54 }

function sharpeColor(sh) {
  if (sh >= 1.5) return '#10b981'
  if (sh >= 0.8) return '#f59e0b'
  if (sh >= 0.2) return '#6366f1'
  return '#ef4444'
}

function toSVG(v, r, vMin, vMax, rMin, rMax) {
  const x = PAD.left + ((v - vMin) / (vMax - vMin || 1)) * (W - PAD.left - PAD.right)
  const y = H - PAD.bottom - ((r - rMin) / (rMax - rMin || 1)) * (H - PAD.top - PAD.bottom)
  return [x, y]
}

function AxisLabel({ x, y, text, anchor = 'middle' }) {
  return <text x={x} y={y} textAnchor={anchor} fill="#4b5563" fontSize={10}>{text}</text>
}

function WeightsTable({ label, portfolio, symbols, color }) {
  if (!portfolio) return null
  const weights = portfolio.weights || {}
  return (
    <div className="flex-1 min-w-[180px]">
      <div className={`text-xs font-semibold mb-2 ${color}`}>{label}</div>
      <div className="space-y-1.5">
        {symbols.map(s => {
          const w = weights[s] ?? 0
          return (
            <div key={s} className="flex items-center gap-2">
              <span className="text-gray-400 text-xs w-14 shrink-0">{s}</span>
              <div className="flex-1 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${w * 100}%`, backgroundColor: color.includes('emerald') ? '#10b981' : color.includes('violet') ? '#8b5cf6' : '#6b7280' }} />
              </div>
              <span className="text-gray-500 text-xs w-9 text-right tabular-nums">{(w * 100).toFixed(0)}%</span>
            </div>
          )
        })}
        <div className="flex justify-between text-xs pt-1 border-t border-gray-800 mt-1">
          <span className="text-gray-600">Return</span>
          <span className={color}>{portfolio.return_pct?.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-600">Vol</span>
          <span className="text-gray-400">{portfolio.vol_pct?.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-600">Sharpe</span>
          <span className={color}>{portfolio.sharpe?.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}

export default function EfficientFrontier() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch('/api/portfolio/optimize')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (d.detail) throw new Error(d.detail); setData(d) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="py-16 text-center text-gray-500 text-sm animate-pulse">Running optimization…</div>
  if (error)   return <div className="py-10 text-center text-red-400 text-sm">Failed: {error}</div>
  if (!data)   return null

  const pts   = data.monte_carlo || []
  const front = data.frontier    || []
  const cur   = data.current
  const ms    = data.max_sharpe
  const mv    = data.min_vol

  // Axis bounds (pad 10%)
  const allV = pts.map(p => p.v)
  const allR = pts.map(p => p.r)
  const vMin = Math.max(0, Math.min(...allV) * 0.9)
  const vMax = Math.max(...allV) * 1.05
  const rMin = Math.min(...allR) * (Math.min(...allR) < 0 ? 1.1 : 0.9)
  const rMax = Math.max(...allR) * 1.05

  const svg = (v, r) => toSVG(v, r, vMin, vMax, rMin, rMax)

  // Frontier polyline
  const frontPts = front.map(p => svg(p.v, p.r).join(','))
  const frontPath = frontPts.length ? `M${frontPts.join(' L')}` : ''

  // Sample MC points (max 600 already from backend)
  const SHOW = Math.min(pts.length, 600)
  const step = pts.length > SHOW ? Math.floor(pts.length / SHOW) : 1

  // Y-axis ticks
  const yTicks = 5
  const xTicks = 5

  return (
    <div className="space-y-6">
      <div className="text-gray-500 text-xs uppercase tracking-widest">Portfolio Optimizer — Efficient Frontier</div>

      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 overflow-x-auto">
        <svg width={W} height={H} className="block mx-auto">
          {/* Grid lines */}
          {Array.from({ length: yTicks }).map((_, i) => {
            const r = rMin + (rMax - rMin) * (i / (yTicks - 1))
            const [, y] = svg(vMin, r)
            return (
              <g key={i}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#1f2937" strokeWidth={1} />
                <AxisLabel x={PAD.left - 6} y={y + 3} text={`${r.toFixed(0)}%`} anchor="end" />
              </g>
            )
          })}
          {Array.from({ length: xTicks }).map((_, i) => {
            const v = vMin + (vMax - vMin) * (i / (xTicks - 1))
            const [x] = svg(v, rMin)
            return (
              <g key={i}>
                <line x1={x} x2={x} y1={PAD.top} y2={H - PAD.bottom} stroke="#1f2937" strokeWidth={1} />
                <AxisLabel x={x} y={H - PAD.bottom + 14} text={`${v.toFixed(0)}%`} />
              </g>
            )
          })}

          {/* Axis labels */}
          <AxisLabel x={W / 2} y={H - 4} text="Annualised Volatility (%)" />
          <text x={12} y={H / 2} textAnchor="middle" fill="#4b5563" fontSize={10}
            transform={`rotate(-90, 12, ${H / 2})`}>Return (%)</text>

          {/* Monte Carlo dots */}
          {pts.filter((_, i) => i % step === 0).map((p, i) => {
            const [x, y] = svg(p.v, p.r)
            return <circle key={i} cx={x} cy={y} r={2.5} fill={sharpeColor(p.sh)} opacity={0.35} />
          })}

          {/* Efficient frontier */}
          {frontPath && (
            <path d={frontPath} fill="none" stroke="#e2e8f0" strokeWidth={2} strokeLinejoin="round" />
          )}

          {/* Min vol */}
          {mv && (() => { const [x, y] = svg(mv.vol_pct, mv.return_pct); return (
            <g>
              <circle cx={x} cy={y} r={8} fill="#10b981" opacity={0.2} />
              <circle cx={x} cy={y} r={5} fill="#10b981" />
              <text x={x + 8} y={y - 6} fill="#10b981" fontSize={9}>Min Vol</text>
            </g>
          )})()}

          {/* Max sharpe */}
          {ms && (() => { const [x, y] = svg(ms.vol_pct, ms.return_pct); return (
            <g>
              <circle cx={x} cy={y} r={8} fill="#8b5cf6" opacity={0.2} />
              <circle cx={x} cy={y} r={5} fill="#8b5cf6" />
              <text x={x + 8} y={y - 6} fill="#8b5cf6" fontSize={9}>Max Sharpe</text>
            </g>
          )})()}

          {/* Current */}
          {cur && (() => { const [x, y] = svg(cur.vol_pct, cur.return_pct); return (
            <g>
              <circle cx={x} cy={y} r={8} fill="#f59e0b" opacity={0.25} />
              <circle cx={x} cy={y} r={5} fill="#f59e0b" />
              <text x={x + 8} y={y - 6} fill="#f59e0b" fontSize={9}>Current</text>
            </g>
          )})()}
        </svg>

        {/* Legend */}
        <div className="flex gap-4 justify-center mt-2 text-[10px] text-gray-600">
          {[['#10b981', 'Min Vol'], ['#8b5cf6', 'Max Sharpe'], ['#f59e0b', 'Current']].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: c }} />{l}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="w-8 h-0.5 inline-block bg-gray-300" />Frontier
          </span>
        </div>
      </div>

      {/* Weights comparison */}
      <div>
        <div className="text-gray-500 text-xs uppercase tracking-widest mb-4">Suggested Weight Changes</div>
        <div className="flex flex-wrap gap-8">
          <WeightsTable label="Current Portfolio"    portfolio={cur} symbols={data.symbols} color="text-amber-400" />
          <WeightsTable label="▲ Max Sharpe"         portfolio={ms}  symbols={data.symbols} color="text-violet-400" />
          <WeightsTable label="▼ Min Volatility"     portfolio={mv}  symbols={data.symbols} color="text-emerald-400" />
        </div>
      </div>

      <div className="text-gray-700 text-xs">Markowitz mean-variance · 1Y daily returns · Long-only · Cached 30 min · Not investment advice</div>
    </div>
  )
}
