import { useState, useEffect, useCallback, useRef } from 'react'
import { fmt } from '../utils/format'
import ChartModal from './ChartModal'

const COLORS = [
  '#10b981','#3b82f6','#8b5cf6','#f59e0b','#ef4444',
  '#06b6d4','#ec4899','#84cc16','#f97316','#6366f1',
  '#14b8a6','#a855f7','#0ea5e9','#22c55e','#fb923c',
]

// ── Treemap layout (squarified algorithm) ─────────────────────────────────────

function worstAspect(row, sideLen) {
  if (row.length === 0) return Infinity
  const s = row.reduce((acc, n) => acc + n._area, 0)
  const max = Math.max(...row.map(n => n._area))
  const min = Math.min(...row.map(n => n._area))
  return Math.max(
    (sideLen * sideLen * max) / (s * s),
    (s * s) / (sideLen * sideLen * min),
  )
}

function placeRow(row, x, y, w, h) {
  const s = row.reduce((acc, n) => acc + n._area, 0)
  const cells = []
  if (w >= h) {
    const rw = s / h
    let cy = y
    for (const n of row) {
      const ch = n._area / rw
      cells.push({ ...n, x, y: cy, w: rw, h: ch })
      cy += ch
    }
  } else {
    const rh = s / w
    let cx = x
    for (const n of row) {
      const cw = n._area / rh
      cells.push({ ...n, x: cx, y, w: cw, h: rh })
      cx += cw
    }
  }
  return cells
}

function squarify(nodes, x, y, w, h) {
  if (nodes.length === 0) return []
  const total = nodes.reduce((acc, n) => acc + n._area, 0)
  if (total <= 0) return []

  // Scale areas to fit w×h
  const scale = (w * h) / total
  const scaled = nodes.map(n => ({ ...n, _area: n._area * scale }))

  const result = []
  let remaining = [...scaled]
  let rx = x, ry = y, rw = w, rh = h

  while (remaining.length > 0) {
    const side = Math.min(rw, rh)
    let row = []
    for (let i = 0; i < remaining.length; i++) {
      const candidate = [...row, remaining[i]]
      if (row.length > 0 && worstAspect(candidate, side) > worstAspect(row, side)) break
      row = candidate
    }

    const cells = placeRow(row, rx, ry, rw, rh)
    result.push(...cells)

    const rowArea = row.reduce((acc, n) => acc + n._area, 0)
    remaining = remaining.slice(row.length)

    if (rw >= rh) {
      const used = rowArea / rh
      rx += used; rw -= used
    } else {
      const used = rowArea / rw
      ry += used; rh -= used
    }
  }

  return result
}

// ── Heat colour scale ─────────────────────────────────────────────────────────

function heatColor(pct) {
  if (pct == null)   return '#374151'   // neutral — no data
  if (pct >= 5)      return '#14532d'   // deep green
  if (pct >= 3)      return '#166534'
  if (pct >= 1.5)    return '#16a34a'
  if (pct >= 0.5)    return '#22c55e'
  if (pct >= -0.5)   return '#374151'   // flat
  if (pct >= -1.5)   return '#dc2626'
  if (pct >= -3)     return '#b91c1c'
  if (pct >= -5)     return '#991b1b'
  return '#7f1d1d'                      // deep red
}

// ── Heatmap component ─────────────────────────────────────────────────────────

const HEATMAP_H = 600

function PortfolioHeatmap({ positions, onSymbolClick }) {
  const containerRef = useRef(null)
  const [containerW, setContainerW] = useState(900)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerW(el.getBoundingClientRect().width || 900)
    const ro = new ResizeObserver(([e]) => setContainerW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const nodes = positions
    .filter(p => p.price > 0)
    .map(p => ({ ...p, _area: p.curVal ?? p.price ?? 1 }))
    .sort((a, b) => b._area - a._area)

  const cells = containerW > 0 && nodes.length > 0
    ? squarify(nodes, 0, 0, containerW, HEATMAP_H)
    : []

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
        <span className="text-gray-600 text-xs uppercase tracking-wider">Performance</span>
        {[
          { label: '< −5%',  color: '#7f1d1d' },
          { label: '−3%',    color: '#991b1b' },
          { label: '−1.5%',  color: '#dc2626' },
          { label: '0',      color: '#374151' },
          { label: '+1.5%',  color: '#22c55e' },
          { label: '+3%',    color: '#16a34a' },
          { label: '> +5%',  color: '#14532d' },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1 text-xs text-gray-400">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
        <span className="text-gray-700 text-xs ml-auto">Cell area = position market value · click to chart</span>
      </div>

      {/* Treemap */}
      <div
        ref={containerRef}
        className="relative w-full rounded-lg overflow-hidden border border-gray-800 bg-gray-950"
        style={{ height: HEATMAP_H }}
      >
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
            Waiting for price data…
          </div>
        )}
        {cells.map((cell) => {
          const bg       = heatColor(cell.changePercent)
          const showSym   = cell.w > 34 && cell.h > 20
          const showPct   = cell.w > 50 && cell.h > 36
          const showPrice = cell.w > 66 && cell.h > 50
          const fs        = Math.min(Math.max(Math.min(cell.w, cell.h) / 5, 8), 15)

          return (
            <button
              key={cell.id}
              onClick={() => onSymbolClick?.(cell)}
              style={{
                position: 'absolute',
                left:   cell.x + 0.5,
                top:    cell.y + 0.5,
                width:  Math.max(cell.w - 1, 1),
                height: Math.max(cell.h - 1, 1),
                backgroundColor: bg,
              }}
              className="flex flex-col items-center justify-center overflow-hidden transition-opacity hover:opacity-80 focus:outline-none"
              title={`${cell.symbol}  ${cell.price != null ? fmt.price(cell.price) : '—'}  ${cell.changePercent != null ? (cell.changePercent >= 0 ? '+' : '') + cell.changePercent.toFixed(2) + '%' : 'N/A'}`}
            >
              {showSym && (
                <div style={{ fontSize: fs, fontWeight: 700, color: 'rgba(255,255,255,0.95)', lineHeight: 1.15 }}>
                  {cell.symbol}
                </div>
              )}
              {showPct && cell.changePercent != null && (
                <div style={{ fontSize: fs * 0.82, color: 'rgba(255,255,255,0.80)', lineHeight: 1.15 }}>
                  {cell.changePercent >= 0 ? '+' : ''}{cell.changePercent.toFixed(2)}%
                </div>
              )}
              {showPrice && cell.price != null && (
                <div style={{ fontSize: fs * 0.70, color: 'rgba(255,255,255,0.55)', lineHeight: 1.15 }}>
                  {fmt.price(cell.price)}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, positive }) {
  const isNeutral = positive === null || positive === undefined
  const color = isNeutral ? 'text-white' : positive ? 'text-emerald-400' : 'text-red-400'
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3 min-w-[140px]">
      <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className={`text-xs tabular-nums mt-0.5 ${color} opacity-80`}>{sub}</div>}
    </div>
  )
}

function pct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function money(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Main component ────────────────────────────────────────────────────────────

function SortArrow({ active, dir }) {
  return (
    <span className={`ml-1 text-xs ${active ? 'text-emerald-400' : 'text-gray-700'}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '⇅'}
    </span>
  )
}

// ── Performance vs Benchmark ──────────────────────────────────────────────────

const PERF_PERIODS = [
  { id: '3mo', label: '3M' },
  { id: '6mo', label: '6M' },
  { id: '1y',  label: '1Y' },
  { id: '2y',  label: '2Y' },
]

const LINE_COLORS = {
  portfolio: '#10b981',
  spy:       '#3b82f6',
  qqq:       '#a855f7',
}

function PerfChart({ dates, portfolio, spy, qqq }) {
  const svgRef = useRef(null)
  const W = 800, H = 260, PL = 48, PR = 12, PT = 12, PB = 32

  const allVals = [...portfolio, ...spy, ...qqq].filter(v => v != null)
  const minV = Math.min(...allVals)
  const maxV = Math.max(...allVals)
  const vPad = (maxV - minV) * 0.08 || 1
  const lo = minV - vPad, hi = maxV + vPad
  const xW = W - PL - PR, yH = H - PT - PB
  const n = dates.length

  const toX = i => PL + (i / (n - 1)) * xW
  const toY = v => PT + yH - ((v - lo) / (hi - lo)) * yH

  function makePath(series) {
    const pts = series.map((v, i) => v != null ? `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}` : null).filter(Boolean)
    return pts.join(' ')
  }

  // Y-axis ticks
  const yTicks = []
  const step = (hi - lo) / 4
  for (let i = 0; i <= 4; i++) {
    const v = lo + step * i
    yTicks.push({ v, y: toY(v) })
  }

  // X-axis date labels (5 evenly spaced)
  const xLabels = [0, 1, 2, 3, 4].map(i => {
    const idx = Math.round(i * (n - 1) / 4)
    return { idx, label: dates[idx]?.slice(0, 7) ?? '' }
  })

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 260 }}>
      {/* Grid */}
      {yTicks.map(({ v, y }) => (
        <g key={v}>
          <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#1f2937" strokeWidth="1" />
          <text x={PL - 4} y={y} textAnchor="end" dominantBaseline="middle"
            fill="#4b5563" fontSize="10">
            {v >= 0 ? '+' : ''}{v.toFixed(1)}%
          </text>
        </g>
      ))}
      {/* Zero line */}
      {lo < 0 && hi > 0 && (
        <line x1={PL} y1={toY(0)} x2={W - PR} y2={toY(0)}
          stroke="#374151" strokeWidth="1" strokeDasharray="4,3" />
      )}
      {/* X labels */}
      {xLabels.map(({ idx, label }) => (
        <text key={idx} x={toX(idx)} y={H - 6} textAnchor="middle"
          fill="#4b5563" fontSize="9">{label}</text>
      ))}
      {/* Series */}
      <path d={makePath(spy)}       fill="none" stroke={LINE_COLORS.spy}       strokeWidth="1.5" opacity="0.7" />
      <path d={makePath(qqq)}       fill="none" stroke={LINE_COLORS.qqq}       strokeWidth="1.5" opacity="0.7" />
      <path d={makePath(portfolio)} fill="none" stroke={LINE_COLORS.portfolio} strokeWidth="2.5" />
    </svg>
  )
}

function PerformanceView({ positions, totalVal }) {
  const [period, setPeriod] = useState('1y')
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState(null)

  const fetchPerf = useCallback(async (pd) => {
    if (!positions.length) return
    setLoading(true); setError(null); setData(null)
    const symbols = positions.map(p => p.symbol)
    const weights = positions.map(p => (p.weight ?? 0) / 100)
    try {
      const r = await fetch('/api/portfolio/performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, weights, period: pd }),
      })
      if (!r.ok) throw new Error(await r.text())
      setData(await r.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [positions, totalVal])

  useEffect(() => { fetchPerf(period) }, [period, fetchPerf])

  const fmtPct = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
  const fmtAlpha = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)} pp`

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Cumulative Return vs Benchmark</div>
        <div className="flex rounded overflow-hidden border border-gray-700">
          {PERF_PERIODS.map(({ id, label }) => (
            <button key={id} onClick={() => setPeriod(id)}
              className={`px-3 py-1 text-xs transition-colors ${period === id ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPIs */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Portfolio', value: fmtPct(data.portfolio_ret), color: data.portfolio_ret >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: 'SPY',       value: fmtPct(data.spy_ret),       color: data.spy_ret >= 0 ? 'text-blue-400' : 'text-red-400' },
            { label: 'Alpha vs SPY', value: fmtAlpha(data.alpha_spy),
              color: data.alpha_spy >= 0 ? 'text-emerald-400' : 'text-red-400',
              sub: data.alpha_spy >= 0 ? 'Outperforming' : 'Underperforming' },
            { label: 'Tracking Error',
              value: data.tracking_error != null ? `${(data.tracking_error).toFixed(2)}%` : '—',
              color: 'text-amber-400',
              sub: data.tracking_error != null
                ? data.tracking_error < 5 ? 'Tight to market' : data.tracking_error < 15 ? 'Moderate deviation' : 'High deviation'
                : null },
          ].map(({ label, value, color, sub }) => (
            <div key={label} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
              <div className="text-gray-500 text-xs uppercase tracking-widest">{label}</div>
              <div className={`text-xl font-semibold tabular-nums mt-1 ${color}`}>{value}</div>
              {sub && <div className="text-gray-500 text-xs mt-0.5">{sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        {loading && (
          <div className="flex items-center justify-center h-64 text-gray-600 text-sm">Loading performance data…</div>
        )}
        {error && (
          <div className="flex items-center justify-center h-64 text-red-500 text-sm">Error: {error}</div>
        )}
        {data && !loading && (
          <>
            <PerfChart
              dates={data.dates}
              portfolio={data.portfolio}
              spy={data.spy}
              qqq={data.qqq}
            />
            {/* Legend */}
            <div className="flex items-center gap-5 justify-center mt-2">
              {[
                { label: 'Portfolio', key: 'portfolio' },
                { label: 'SPY',       key: 'spy' },
                { label: 'QQQ',       key: 'qqq' },
              ].map(({ label, key }) => (
                <span key={key} className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="w-4 h-0.5 inline-block rounded" style={{ backgroundColor: LINE_COLORS[key] }} />
                  {label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Return comparison table */}
      {data && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                {['', 'Return', 'vs SPY', 'vs QQQ'].map(h => (
                  <th key={h} className={`py-2.5 px-4 text-gray-600 font-medium tracking-wider uppercase ${h ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Portfolio', ret: data.portfolio_ret, color: LINE_COLORS.portfolio },
                { label: 'SPY',       ret: data.spy_ret,       color: LINE_COLORS.spy },
                { label: 'QQQ',       ret: data.qqq_ret,       color: LINE_COLORS.qqq },
              ].map(({ label, ret, color }) => (
                <tr key={label} className="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors">
                  <td className="py-2.5 px-4">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: color }} />
                      <span className="text-gray-300 font-medium">{label}</span>
                    </span>
                  </td>
                  <td className={`py-2.5 px-4 text-right tabular-nums font-medium ${ret >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(ret)}</td>
                  <td className={`py-2.5 px-4 text-right tabular-nums ${ret - data.spy_ret >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtAlpha(ret - data.spy_ret)}
                  </td>
                  <td className={`py-2.5 px-4 text-right tabular-nums ${ret - data.qqq_ret >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtAlpha(ret - data.qqq_ret)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Risk Metrics View ─────────────────────────────────────────────────────────

function RiskKPI({ label, value, sub, color, tooltip }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 flex flex-col gap-1" title={tooltip}>
      <div className="text-gray-500 text-xs uppercase tracking-widest">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${color || 'text-white'}`}>{value}</div>
      {sub && <div className="text-gray-500 text-xs">{sub}</div>}
    </div>
  )
}

function GaugeBar({ value, min, max, thresholds, label, format }) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  const color = thresholds.find(t => value <= t.max)?.color ?? thresholds[thresholds.length - 1].color
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className={color}>{format ? format(value) : value}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color.replace('text-', '').includes('#') ? color : undefined, background: pct > 0 ? undefined : undefined }}
          // use inline color via class mapping
        />
      </div>
    </div>
  )
}

function HHIGauge({ hhi }) {
  // HHI: 0 = perfect diversification, 1 = single position
  // <0.15 = well diversified, 0.15–0.25 = moderate, >0.25 = concentrated
  const pct = Math.min(100, hhi * 100)
  const color = hhi < 0.15 ? '#10b981' : hhi < 0.25 ? '#f59e0b' : '#ef4444'
  const label = hhi < 0.15 ? 'Well diversified' : hhi < 0.25 ? 'Moderate concentration' : 'Highly concentrated'
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-gray-400">Herfindahl Index</span>
        <span style={{ color }}>{hhi.toFixed(3)} — {label}</span>
      </div>
      <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="flex justify-between text-gray-700 text-[10px] mt-0.5">
        <span>0 — diversified</span><span>1 — concentrated</span>
      </div>
    </div>
  )
}

function RiskView({ positions, totalVal, riskData }) {
  if (!positions.length) return null

  const rf   = riskData?.risk_free_rate ?? 0.045
  const spyDailyVol   = riskData?.spy_daily_vol   ?? 0.0095
  const spyAnnualVol  = riskData?.spy_annual_vol  ?? 0.155

  // Weighted portfolio beta (exclude nulls)
  const betaPos = positions.filter(p => p.beta != null && p.weight > 0)
  const portBeta = betaPos.length
    ? betaPos.reduce((s, p) => s + (p.beta * p.weight) / 100, 0)
    : null

  // Weighted average P/E (exclude nulls and negatives)
  const pePos = positions.filter(p => p.peRatio != null && p.peRatio > 0 && p.weight > 0)
  const portPE = pePos.length
    ? pePos.reduce((s, p) => s + (p.peRatio * p.weight) / 100, 0) /
      (pePos.reduce((s, p) => s + p.weight, 0) / 100)
    : null

  // VaR 95% 1-day (parametric): 1.645 × portfolio_vol × total_value
  // portfolio_vol ≈ portBeta × SPY_daily_vol (assumes well-correlated with market)
  const portDailyVol = portBeta != null ? portBeta * spyDailyVol : spyDailyVol
  const var95 = totalVal * portDailyVol * 1.645

  // Sharpe (estimate): total unrealized return vs annualised vol
  const totalReturn = positions.reduce((s, p) => {
    const w = (p.weight ?? 0) / 100
    const r = p.plPct != null ? p.plPct / 100 : 0
    return s + w * r
  }, 0)
  const portAnnualVol = portBeta != null ? portBeta * spyAnnualVol : spyAnnualVol
  const sharpe = portAnnualVol > 0 ? (totalReturn - rf) / portAnnualVol : null

  // Concentration
  const sorted = [...positions].sort((a, b) => b.weight - a.weight)
  const top3Pct = sorted.slice(0, 3).reduce((s, p) => s + p.weight, 0)
  const hhi = positions.reduce((s, p) => s + Math.pow(p.weight / 100, 2), 0)

  // Beta color
  const betaColor = portBeta == null ? 'text-gray-500'
    : portBeta < 0.8 ? 'text-blue-400'
    : portBeta <= 1.2 ? 'text-emerald-400'
    : portBeta <= 1.6 ? 'text-amber-400'
    : 'text-red-400'

  const betaSub = portBeta == null ? 'No beta data' :
    portBeta < 0.8 ? 'Defensive — less volatile than market' :
    portBeta <= 1.2 ? 'Neutral — tracks market' :
    portBeta <= 1.6 ? 'Aggressive — more volatile than market' :
    'High risk — very market-sensitive'

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <RiskKPI
          label="Portfolio Beta"
          value={portBeta != null ? portBeta.toFixed(2) : '—'}
          sub={betaSub}
          color={betaColor}
          tooltip="Weighted average beta vs market (SPY=1.0)"
        />
        <RiskKPI
          label="Wtd Avg P/E"
          value={portPE != null ? portPE.toFixed(1) + '×' : '—'}
          sub={portPE == null ? 'No P/E data' : portPE < 15 ? 'Value-tilted' : portPE < 25 ? 'Fair value' : portPE < 35 ? 'Growth premium' : 'High growth / speculative'}
          color={portPE == null ? 'text-gray-500' : portPE < 15 ? 'text-emerald-400' : portPE < 35 ? 'text-amber-400' : 'text-red-400'}
          tooltip="Weighted average trailing P/E across positions with P/E data"
        />
        <RiskKPI
          label="VaR 95% (1-day)"
          value={`$${Math.round(var95).toLocaleString()}`}
          sub={`${(portDailyVol * 1.645 * 100).toFixed(2)}% of portfolio`}
          color="text-orange-400"
          tooltip="Parametric VaR: 1.645 × portfolio beta × SPY daily vol × portfolio value"
        />
        <RiskKPI
          label="Sharpe (Est.)"
          value={sharpe != null ? sharpe.toFixed(2) : '—'}
          sub={sharpe == null ? 'Insufficient data' : sharpe < 0 ? 'Underperforming risk-free' : sharpe < 1 ? 'Below average' : sharpe < 2 ? 'Good' : 'Excellent'}
          color={sharpe == null ? 'text-gray-500' : sharpe < 0 ? 'text-red-400' : sharpe < 1 ? 'text-amber-400' : 'text-emerald-400'}
          tooltip={`(Total return − ${(rf * 100).toFixed(1)}% risk-free) ÷ estimated portfolio volatility`}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Concentration panel */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-4">
          <div className="text-gray-500 text-xs uppercase tracking-widest">Concentration Risk</div>

          {/* Top-N breakdown */}
          <div className="space-y-2">
            {sorted.slice(0, Math.min(5, sorted.length)).map((p, i) => (
              <div key={p.symbol} className="flex items-center gap-2">
                <span className="text-gray-500 text-xs w-4">{i + 1}</span>
                <span className="text-white text-xs font-medium w-12">{p.symbol}</span>
                <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${p.weight}%`, backgroundColor: p.color }} />
                </div>
                <span className="text-gray-400 text-xs tabular-nums w-12 text-right">{p.weight.toFixed(1)}%</span>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-800 pt-3 space-y-3">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Top-3 Weight</span>
              <span className={top3Pct > 60 ? 'text-red-400' : top3Pct > 45 ? 'text-amber-400' : 'text-emerald-400'}>
                {top3Pct.toFixed(1)}%
                <span className="text-gray-600 ml-1">
                  {top3Pct > 60 ? '⚠ Concentrated' : top3Pct > 45 ? '⚡ Moderate' : '✓ Balanced'}
                </span>
              </span>
            </div>
            <HHIGauge hhi={hhi} />
          </div>
        </div>

        {/* Market sensitivity & vol panel */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-4">
          <div className="text-gray-500 text-xs uppercase tracking-widest">Market Sensitivity</div>

          {/* Beta breakdown per position */}
          <div className="space-y-2">
            {[...positions].filter(p => p.beta != null).sort((a, b) => (b.beta ?? 0) - (a.beta ?? 0)).slice(0, 6).map(p => {
              const barPct = Math.min(100, (Math.abs(p.beta) / 2.5) * 100)
              const col = p.beta < 0.8 ? '#3b82f6' : p.beta <= 1.2 ? '#10b981' : p.beta <= 1.7 ? '#f59e0b' : '#ef4444'
              return (
                <div key={p.symbol} className="flex items-center gap-2">
                  <span className="text-gray-400 text-xs w-12">{p.symbol}</span>
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: col }} />
                  </div>
                  <span className="text-xs tabular-nums w-8 text-right" style={{ color: col }}>{p.beta.toFixed(2)}</span>
                </div>
              )
            })}
            {positions.filter(p => p.beta != null).length === 0 && (
              <div className="text-gray-600 text-sm text-center py-4">Beta data unavailable</div>
            )}
          </div>

          <div className="border-t border-gray-800 pt-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">SPY Daily Vol (90d)</span>
              <span className="text-gray-300 tabular-nums">{(spyDailyVol * 100).toFixed(2)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">SPY Annual Vol (90d)</span>
              <span className="text-gray-300 tabular-nums">{(spyAnnualVol * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Est. Portfolio Daily Vol</span>
              <span className="text-orange-400 tabular-nums">{(portDailyVol * 100).toFixed(2)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Risk-Free Rate</span>
              <span className="text-gray-300 tabular-nums">{(rf * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>

      {riskData?.error && (
        <div className="text-amber-600 text-xs">⚠ Using fallback volatility estimates — live SPY data unavailable</div>
      )}
      <div className="text-gray-700 text-xs">
        VaR and Sharpe are estimates. VaR uses parametric method (portfolio beta × SPY vol × 1.645). Sharpe uses total unrealized return relative to estimated annualized portfolio volatility.
      </div>
    </div>
  )
}

// ── Sector color map ──────────────────────────────────────────────────────────
const SECTOR_COLORS = {
  'Technology':             '#3b82f6',
  'Healthcare':             '#10b981',
  'Financials':             '#f59e0b',
  'Consumer Discretionary': '#ec4899',
  'Consumer Staples':       '#84cc16',
  'Energy':                 '#f97316',
  'Industrials':            '#6366f1',
  'Materials':              '#14b8a6',
  'Real Estate':            '#a855f7',
  'Utilities':              '#06b6d4',
  'Communication Services': '#ef4444',
  'Unknown':                '#6b7280',
}

const CAP_COLORS = {
  'Mega Cap':  '#3b82f6',
  'Large Cap': '#6366f1',
  'Mid Cap':   '#8b5cf6',
  'Small Cap': '#a78bfa',
  'Micro Cap': '#c4b5fd',
  'Unknown':   '#6b7280',
}

function capTier(marketCap) {
  if (!marketCap) return 'Unknown'
  if (marketCap >= 200e9) return 'Mega Cap'
  if (marketCap >= 10e9)  return 'Large Cap'
  if (marketCap >= 2e9)   return 'Mid Cap'
  if (marketCap >= 300e6) return 'Small Cap'
  return 'Micro Cap'
}

function ExposureBar({ label, pct, color, sublabel }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-gray-300 text-xs">{label}</span>
        <div className="flex items-baseline gap-2">
          {sublabel && <span className="text-gray-600 text-xs">{sublabel}</span>}
          <span className="text-gray-400 text-xs tabular-nums font-medium">{pct.toFixed(1)}%</span>
        </div>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function ExposureView({ positions, totalVal }) {
  // ── Sector weights ────────────────────────────────────────────────────────
  const sectorMap = {}
  positions.forEach(p => {
    const val    = p.curVal ?? p.basis
    const sector = p.sector || 'Unknown'
    sectorMap[sector] = (sectorMap[sector] || 0) + val
  })
  const sectors = Object.entries(sectorMap)
    .map(([name, val]) => ({ name, val, pct: totalVal > 0 ? (val / totalVal) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct)

  // ── Market cap style ──────────────────────────────────────────────────────
  const capMap = {}
  positions.forEach(p => {
    const val  = p.curVal ?? p.basis
    const tier = capTier(p.marketCap)
    capMap[tier] = (capMap[tier] || 0) + val
  })
  const CAP_ORDER = ['Mega Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'Micro Cap', 'Unknown']
  const capTiers = CAP_ORDER
    .filter(t => capMap[t])
    .map(t => ({ name: t, val: capMap[t], pct: totalVal > 0 ? (capMap[t] / totalVal) * 100 : 0 }))

  // ── Portfolio beta (weighted average) ─────────────────────────────────────
  let betaNum = 0, betaDen = 0
  positions.forEach(p => {
    if (p.beta == null) return
    const val = p.curVal ?? p.basis
    betaNum += p.beta * val
    betaDen += val
  })
  const portfolioBeta = betaDen > 0 ? betaNum / betaDen : null

  // ── Concentration ─────────────────────────────────────────────────────────
  const sorted = [...positions].sort((a, b) => (b.curVal ?? b.basis) - (a.curVal ?? a.basis))
  const top3Pct = sorted.slice(0, 3).reduce((s, p) => s + (totalVal > 0 ? ((p.curVal ?? p.basis) / totalVal) * 100 : 0), 0)
  const concentrationWarning = top3Pct > 50

  // ── Industry breakdown (top 8) ────────────────────────────────────────────
  const industryMap = {}
  positions.forEach(p => {
    if (!p.industry) return
    const val = p.curVal ?? p.basis
    industryMap[p.industry] = (industryMap[p.industry] || 0) + val
  })
  const industries = Object.entries(industryMap)
    .map(([name, val]) => ({ name, val, pct: totalVal > 0 ? (val / totalVal) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8)

  const hasExposureData = positions.some(p => p.sector)

  if (!hasExposureData) {
    return (
      <div className="py-20 text-center text-gray-600 text-sm animate-pulse">
        Loading sector data — may take a moment on first fetch…
      </div>
    )
  }

  return (
    <div className="space-y-8">

      {/* ── Summary KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3">
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Portfolio Beta</div>
          <div className={`text-lg font-bold tabular-nums ${
            portfolioBeta == null ? 'text-gray-600'
              : portfolioBeta > 1.3 ? 'text-red-400'
              : portfolioBeta < 0.7 ? 'text-sky-400'
              : 'text-white'
          }`}>
            {portfolioBeta != null ? portfolioBeta.toFixed(2) : '—'}
          </div>
          <div className="text-gray-600 text-xs mt-0.5">
            {portfolioBeta == null ? '' : portfolioBeta > 1.2 ? 'Aggressive' : portfolioBeta < 0.8 ? 'Defensive' : 'Moderate'}
          </div>
        </div>

        <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3">
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Sectors</div>
          <div className="text-lg font-bold text-white">{sectors.filter(s => s.name !== 'Unknown').length}</div>
          <div className="text-gray-600 text-xs mt-0.5">Unique sectors</div>
        </div>

        <div className={`bg-gray-900/60 border rounded-lg px-4 py-3 ${concentrationWarning ? 'border-amber-800' : 'border-gray-800'}`}>
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Top-3 Weight</div>
          <div className={`text-lg font-bold tabular-nums ${concentrationWarning ? 'text-amber-400' : 'text-white'}`}>
            {top3Pct.toFixed(1)}%
          </div>
          <div className={`text-xs mt-0.5 ${concentrationWarning ? 'text-amber-600' : 'text-gray-600'}`}>
            {concentrationWarning ? '⚠ Concentrated' : 'Diversified'}
          </div>
        </div>

        <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3">
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Positions</div>
          <div className="text-lg font-bold text-white">{positions.length}</div>
          <div className="text-gray-600 text-xs mt-0.5">{capTiers[0]?.name ?? '—'} tilt</div>
        </div>
      </div>

      {/* ── Sector & Style side by side ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Sector breakdown */}
        <section>
          <div className="text-gray-600 text-xs uppercase tracking-widest mb-4">Sector Exposure</div>
          <div className="space-y-3">
            {sectors.map(({ name, pct }) => (
              <ExposureBar
                key={name}
                label={name}
                pct={pct}
                color={SECTOR_COLORS[name] || '#6b7280'}
              />
            ))}
          </div>
        </section>

        {/* Market cap style */}
        <section>
          <div className="text-gray-600 text-xs uppercase tracking-widest mb-4">Market Cap Style</div>
          <div className="space-y-3">
            {capTiers.map(({ name, pct }) => (
              <ExposureBar key={name} label={name} pct={pct} color={CAP_COLORS[name]} />
            ))}
          </div>

          {/* Beta context */}
          {portfolioBeta != null && (
            <div className="mt-6 border-t border-gray-800 pt-4">
              <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">Beta Context</div>
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                <span>0</span>
                <div className="flex-1 relative h-1.5 bg-gray-800 rounded-full">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-gray-600" title="Market (β=1)" />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-gray-900"
                    style={{
                      left: `${Math.min(100, Math.max(0, (portfolioBeta / 2) * 100))}%`,
                      backgroundColor: portfolioBeta > 1.2 ? '#f87171' : portfolioBeta < 0.8 ? '#38bdf8' : '#10b981',
                      transform: 'translate(-50%, -50%)',
                    }}
                  />
                </div>
                <span>2+</span>
              </div>
              <div className="text-xs text-gray-600 mt-2">
                A β of {portfolioBeta.toFixed(2)} means your portfolio moves roughly{' '}
                <span className="text-gray-400">{(portfolioBeta * 100).toFixed(0)}¢</span> for every{' '}
                <span className="text-gray-400">$1</span> the market moves.
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ── Industry breakdown ── */}
      {industries.length > 0 && (
        <section>
          <div className="text-gray-600 text-xs uppercase tracking-widest mb-4">Industry Breakdown — top 8</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {industries.map(({ name, pct }) => {
              const parentSector = positions.find(p => p.industry === name)?.sector
              return (
                <ExposureBar
                  key={name}
                  label={name}
                  pct={pct}
                  color={SECTOR_COLORS[parentSector] || '#6b7280'}
                  sublabel={parentSector}
                />
              )
            })}
          </div>
        </section>
      )}

      {/* ── Top holdings table ── */}
      <section>
        <div className="text-gray-600 text-xs uppercase tracking-widest mb-4">Holdings by Weight</div>
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                {['Symbol', 'Name', 'Sector', 'Cap Tier', 'Beta', 'Weight', 'Value'].map((h, i) => (
                  <th key={h} className={`py-2.5 px-3 text-gray-600 font-medium tracking-wider uppercase ${i > 1 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => {
                const val  = p.curVal ?? p.basis
                const pct  = totalVal > 0 ? (val / totalVal) * 100 : 0
                const tier = capTier(p.marketCap)
                return (
                  <tr key={p.id} className="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
                        <span className="text-white font-bold">{p.symbol}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-gray-400 max-w-[160px] truncate">{p.name}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: `${SECTOR_COLORS[p.sector] || '#6b7280'}22`, color: SECTOR_COLORS[p.sector] || '#9ca3af' }}>
                        {p.sector || '—'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-400">{tier}</td>
                    <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{p.beta != null ? p.beta.toFixed(2) : '—'}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: p.color }} />
                        </div>
                        <span className="text-gray-300 font-medium">{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">
                      ${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

const PORT_COLS = [
  { label: 'Symbol',       align: 'text-left',  key: 'symbol' },
  { label: 'Name',         align: 'text-left',  key: 'name' },
  { label: 'Shares',       align: 'text-right', key: 'shares' },
  { label: 'Avg Cost',     align: 'text-right', key: 'avgCost' },
  { label: 'Price',        align: 'text-right', key: 'price' },
  { label: 'Market Value', align: 'text-right', key: 'curVal' },
  { label: 'P&L',         align: 'text-right', key: 'pl' },
  { label: 'P&L %',       align: 'text-right', key: 'plPct' },
  { label: 'Day P&L',     align: 'text-right', key: 'dayPL' },
  { label: 'Weight',       align: 'text-right', key: 'weight' },
  { label: '',             align: 'text-right', key: null },
]

export default function PortfolioTracker() {
  const [positions,    setPositions]    = useState([])
  const [quotes,       setQuotes]       = useState({})
  const [loading,      setLoading]      = useState(false)
  const [lastUpdated,  setLastUpdated]  = useState(null)
  const [countdown,    setCountdown]    = useState(30)
  const [chartSymbol,  setChartSymbol]  = useState(null)
  const [chartQuote,   setChartQuote]   = useState(null)
  const [viewMode,     setViewMode]     = useState('heatmap')
  const [sortCol,      setSortCol]      = useState(null)
  const [sortDir,      setSortDir]      = useState('asc')
  const [portQuery,    setPortQuery]    = useState('')
  const [riskData,     setRiskData]     = useState(null)

  function handleSort(key) {
    if (!key) return
    if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(key); setSortDir('asc') }
  }

  useEffect(() => {
    if (viewMode === 'risk' && !riskData) {
      fetch('/api/market/risk-data')
        .then(r => r.json())
        .then(setRiskData)
        .catch(() => setRiskData({ spy_daily_vol: 0.0095, spy_annual_vol: 0.155, risk_free_rate: 0.045, error: 'fetch failed' }))
    }
  }, [viewMode, riskData])

  // Form state
  const [sym,     setSym]     = useState('')
  const [shares,  setShares]  = useState('')
  const [cost,    setCost]    = useState('')
  const [formErr, setFormErr] = useState('')

  // Load positions from API; migrate localStorage on first empty load
  useEffect(() => {
    fetch('/api/portfolio')
      .then(r => r.json())
      .then(async (rows) => {
        if (rows.length === 0) {
          try {
            const saved = localStorage.getItem('stockmonitor-portfolio')
            if (saved) {
              const legacy = JSON.parse(saved)
              const migrated = await Promise.all(
                legacy.map(p =>
                  fetch('/api/portfolio', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol: p.symbol, shares: p.shares, avgCost: p.avgCost }),
                  }).then(r => r.json())
                )
              )
              localStorage.removeItem('stockmonitor-portfolio')
              setPositions(migrated)
              return
            }
          } catch { /* ignore */ }
        }
        setPositions(rows)
      })
      .catch(() => setPositions([]))
  }, [])

  const fetchQuotes = useCallback(async () => {
    const syms = [...new Set(positions.map(p => p.symbol))]
    if (syms.length === 0) return
    setLoading(true)
    try {
      // Fetch in batches of 50 to avoid query-string limits
      const batches = []
      for (let i = 0; i < syms.length; i += 50) batches.push(syms.slice(i, i + 50))
      const results = await Promise.all(
        batches.map(b => fetch(`/api/quotes?symbols=${b.join(',')}`).then(r => r.json()))
      )
      const map = {}
      results.flat().forEach(q => { map[q.symbol] = q })
      setQuotes(map)
      setLastUpdated(new Date())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [positions])

  useEffect(() => {
    fetchQuotes()
    setCountdown(30)
    const iv = setInterval(() => { fetchQuotes(); setCountdown(30) }, 30000)
    return () => clearInterval(iv)
  }, [fetchQuotes])

  useEffect(() => {
    setCountdown(30)
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [lastUpdated])

  const addPosition = async (e) => {
    e.preventDefault()
    const s  = sym.trim().toUpperCase()
    const sh = parseFloat(shares)
    const co = parseFloat(cost)
    if (!s)                    { setFormErr('Symbol required'); return }
    if (isNaN(sh) || sh <= 0)  { setFormErr('Enter valid shares'); return }
    if (isNaN(co) || co <= 0)  { setFormErr('Enter valid avg cost'); return }
    setFormErr('')
    try {
      const r = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: s, shares: sh, avgCost: co }),
      })
      if (!r.ok) throw new Error('Server error')
      const pos = await r.json()
      setPositions(prev => [...prev, pos])
      setSym(''); setShares(''); setCost('')
    } catch { setFormErr('Failed to add position') }
  }

  const removePosition = async (id) => {
    await fetch(`/api/portfolio/${id}`, { method: 'DELETE' })
    setPositions(prev => prev.filter(p => p.id !== id))
  }

  // Enrich with live data
  const enriched = positions.map((p, i) => {
    const q      = quotes[p.symbol]
    const price  = q?.price ?? null
    const prev   = q?.previousClose ?? null
    const curVal = price != null ? p.shares * price : null
    const basis  = p.shares * p.avgCost
    const pl     = curVal != null ? curVal - basis : null
    const plPct  = pl != null ? (pl / basis) * 100 : null
    const dayPL  = price != null && prev != null ? p.shares * (price - prev) : null
    return {
      ...p,
      name:          q?.name ?? p.symbol,
      price, prev, curVal, basis, pl, plPct, dayPL,
      change:        q?.change ?? null,
      changePercent: q?.changePercent ?? null,
      sector:        q?.sector ?? null,
      industry:      q?.industry ?? null,
      beta:          q?.beta ?? null,
      marketCap:     q?.marketCap ?? null,
      peRatio:       q?.peRatio ?? null,
      color: COLORS[i % COLORS.length],
    }
  })

  const totalBasis = enriched.reduce((s, p) => s + p.basis, 0)
  const totalVal   = enriched.reduce((s, p) => s + (p.curVal ?? p.basis), 0)
  const totalPL    = totalVal - totalBasis
  const totalPLPct = totalBasis > 0 ? (totalPL / totalBasis) * 100 : 0
  const totalDayPL = enriched.reduce((s, p) => s + (p.dayPL ?? 0), 0)

  const withWeight = enriched.map(p => ({
    ...p,
    weight: totalVal > 0 ? ((p.curVal ?? p.basis) / totalVal) * 100 : 0,
  }))

  const openChart = (sym, name, price, change, changePercent) => {
    setChartSymbol(sym)
    setChartQuote({ name, price, change, changePercent })
  }

  return (
    <div className="p-4 max-w-7xl mx-auto">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Portfolio Tracker</div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex rounded overflow-hidden border border-gray-700">
            {[['heatmap', 'Heatmap'], ['table', 'Table'], ['exposure', 'Exposure'], ['risk', 'Risk'], ['performance', 'Performance']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setViewMode(id)}
                className={`px-3 py-1 text-xs transition-colors ${
                  viewMode === id
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {lastUpdated && (
            <span className="text-gray-600 text-xs">
              {loading
                ? <span className="text-emerald-400 animate-pulse">● Updating…</span>
                : `Updated ${lastUpdated.toLocaleTimeString()} · next in ${countdown}s`}
            </span>
          )}
          <button onClick={fetchQuotes} disabled={loading || positions.length === 0}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-400 hover:text-white px-3 py-1 text-xs rounded transition-colors">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Add position form ── */}
      <form onSubmit={addPosition} className="flex flex-wrap items-end gap-3 mb-6 bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3">
        <div>
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Symbol</div>
          <input value={sym} onChange={e => setSym(e.target.value.toUpperCase())}
            placeholder="AAPL" maxLength={10}
            className="bg-gray-800 border border-gray-700 text-white placeholder-gray-600 px-3 py-1.5 text-sm rounded w-28 focus:outline-none focus:border-emerald-500 uppercase" />
        </div>
        <div>
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Shares</div>
          <input value={shares} onChange={e => setShares(e.target.value)} type="number" min="0" step="any"
            placeholder="100"
            className="bg-gray-800 border border-gray-700 text-white placeholder-gray-600 px-3 py-1.5 text-sm rounded w-28 focus:outline-none focus:border-emerald-500" />
        </div>
        <div>
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Avg Cost ($)</div>
          <input value={cost} onChange={e => setCost(e.target.value)} type="number" min="0" step="any"
            placeholder="150.00"
            className="bg-gray-800 border border-gray-700 text-white placeholder-gray-600 px-3 py-1.5 text-sm rounded w-32 focus:outline-none focus:border-emerald-500" />
        </div>
        <button type="submit"
          className="bg-emerald-800 hover:bg-emerald-700 text-emerald-100 px-4 py-1.5 text-sm rounded transition-colors">
          + Add Position
        </button>
        {formErr && <span className="text-red-400 text-xs self-center">{formErr}</span>}
      </form>

      {positions.length === 0 && (
        <div className="text-gray-600 text-sm text-center py-20">
          Add your first position above to start tracking your portfolio
        </div>
      )}

      {positions.length > 0 && (
        <div className="space-y-6">

          {/* ── Summary cards ── */}
          <div className="flex flex-wrap gap-3">
            <SummaryCard label="Total Invested"  value={`$${totalBasis.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`} />
            <SummaryCard label="Market Value"    value={`$${totalVal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`} />
            <SummaryCard label="Total P&L"       value={money(totalPL)}   sub={pct(totalPLPct)}   positive={totalPL >= 0} />
            <SummaryCard label="Day's P&L"       value={money(totalDayPL)}                         positive={totalDayPL >= 0} />
            <SummaryCard label="Positions"       value={positions.length} />
          </div>

          {/* ── Allocation bar (only in table view) ── */}
          {viewMode === 'table' && (
            <section>
              <div className="text-gray-600 text-xs uppercase tracking-widest mb-2">Allocation</div>
              <div className="w-full h-3 rounded-full overflow-hidden flex mb-3">
                {withWeight.map(p => (
                  <div key={p.id} style={{ width: `${p.weight}%`, backgroundColor: p.color }}
                    title={`${p.symbol}: ${p.weight.toFixed(1)}%`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {withWeight.map(p => (
                  <span key={p.id} className="text-xs text-gray-400 flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
                    {p.symbol} <span className="text-gray-600">{p.weight.toFixed(1)}%</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* ── Heatmap view ── */}
          {viewMode === 'heatmap' && (
            <section>
              <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">Portfolio Heatmap</div>
              <PortfolioHeatmap
                positions={withWeight}
                onSymbolClick={cell => openChart(cell.symbol, cell.name, cell.price, cell.change, cell.changePercent)}
              />
            </section>
          )}

          {/* ── Exposure view ── */}
          {viewMode === 'exposure' && (
            <section>
              <ExposureView positions={withWeight} totalVal={totalVal} />
            </section>
          )}

          {/* ── Risk view ── */}
          {viewMode === 'risk' && (
            <section>
              <div className="text-gray-600 text-xs uppercase tracking-widest mb-4">Portfolio Risk Metrics</div>
              {riskData === null
                ? <div className="text-gray-600 text-sm text-center py-16">Loading risk data…</div>
                : <RiskView positions={withWeight} totalVal={totalVal} riskData={riskData} />
              }
            </section>
          )}

          {/* ── Performance view ── */}
          {viewMode === 'performance' && (
            <section>
              <PerformanceView positions={withWeight} totalVal={totalVal} />
            </section>
          )}

          {/* ── Table view ── */}
          {viewMode === 'table' && (
            <section>
              {/* Search bar */}
              <div className="relative mb-3">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
                  fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={portQuery}
                  onChange={e => setPortQuery(e.target.value)}
                  placeholder="Filter by symbol or company name…"
                  className="w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 pl-9 pr-8 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 transition-colors"
                />
                {portQuery && (
                  <button
                    onClick={() => setPortQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
              {portQuery.trim() && (() => {
                const q = portQuery.trim().toLowerCase()
                const matchCount = withWeight.filter(p =>
                  p.symbol.toLowerCase().includes(q) || (p.name ?? '').toLowerCase().includes(q)
                ).length
                return (
                  <div className="text-xs text-gray-500 mb-3">
                    {matchCount === 0
                      ? `No matches for "${portQuery}"`
                      : `${matchCount} of ${withWeight.length} positions`}
                  </div>
                )
              })()}

              <div className="bg-gray-900/60 border border-gray-800 rounded-lg overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {PORT_COLS.map(({ label, align, key }) => (
                        <th
                          key={key ?? '_action'}
                          onClick={() => handleSort(key)}
                          className={`py-2.5 px-3 text-gray-600 font-medium tracking-wider uppercase ${align}${key ? ' cursor-pointer select-none hover:text-gray-400' : ''}`}
                        >
                          {label}
                          {key && <SortArrow active={sortCol === key} dir={sortDir} />}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const q = portQuery.trim().toLowerCase()
                      const base = q
                        ? withWeight.filter(p =>
                            p.symbol.toLowerCase().includes(q) ||
                            (p.name ?? '').toLowerCase().includes(q)
                          )
                        : withWeight
                      const rows = sortCol
                        ? [...base].sort((a, b) => {
                            const av = a[sortCol] ?? null
                            const bv = b[sortCol] ?? null
                            if (av == null && bv == null) return 0
                            if (av == null) return 1
                            if (bv == null) return -1
                            if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
                            return sortDir === 'asc' ? av - bv : bv - av
                          })
                        : base
                      if (rows.length === 0 && q) {
                        return (
                          <tr>
                            <td colSpan={PORT_COLS.length} className="py-16 text-center text-gray-600 text-sm">
                              No positions match &ldquo;{portQuery}&rdquo;
                            </td>
                          </tr>
                        )
                      }
                      return rows.map(p => (
                      <tr key={p.id} className="border-b border-gray-800/40 hover:bg-gray-800/40 transition-colors">
                        <td className="py-2.5 px-3">
                          <button
                            onClick={() => openChart(p.symbol, p.name, p.price, p.change, p.changePercent)}
                            className="flex items-center gap-1.5 text-white font-bold hover:text-sky-300 transition-colors"
                          >
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
                            {p.symbol}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-gray-400 max-w-[160px] truncate">{p.name}</td>
                        <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{p.shares.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{fmt.price(p.avgCost)}</td>
                        <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{fmt.price(p.price)}</td>
                        <td className="py-2.5 px-3 text-right text-white font-medium tabular-nums">
                          {p.curVal != null ? `$${p.curVal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—'}
                        </td>
                        <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${p.pl==null?'text-gray-600':p.pl>=0?'text-emerald-400':'text-red-400'}`}>
                          {money(p.pl)}
                        </td>
                        <td className={`py-2.5 px-3 text-right tabular-nums ${p.plPct==null?'text-gray-600':p.plPct>=0?'text-emerald-400':'text-red-400'}`}>
                          {pct(p.plPct)}
                        </td>
                        <td className={`py-2.5 px-3 text-right tabular-nums ${p.dayPL==null?'text-gray-600':p.dayPL>=0?'text-emerald-400':'text-red-400'}`}>
                          {money(p.dayPL)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-gray-500 tabular-nums">{p.weight.toFixed(1)}%</td>
                        <td className="py-2.5 px-3 text-right">
                          <button onClick={() => removePosition(p.id)}
                            className="text-gray-700 hover:text-red-400 transition-colors text-base leading-none px-1">×</button>
                        </td>
                      </tr>
                    ))
                  })()}
                  </tbody>
                </table>
              </div>
            </section>
          )}

        </div>
      )}

      {chartSymbol && (
        <ChartModal
          symbol={chartSymbol}
          quote={chartQuote}
          onClose={() => { setChartSymbol(null); setChartQuote(null) }}
        />
      )}
    </div>
  )
}
