import { useEffect, useState } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val, decimals = 2) {
  if (val == null) return '—'
  return val.toFixed(decimals) + '%'
}

function fmtBps(val) {
  if (val == null) return '—'
  const bps = Math.round(val * 100)
  return (bps >= 0 ? '+' : '') + bps + ' bps'
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/40 rounded-xl p-4 text-center">
      <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-bold text-2xl tabular-nums ${color}`}>{value ?? '—'}</div>
      {sub && <div className="text-gray-600 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Yield Curve SVG ──────────────────────────────────────────────────────────

const CURVE_W = 480
const CURVE_H = 120
const CURVE_PAD = { top: 12, right: 20, bottom: 28, left: 42 }
const MATURITIES = ['13W', '5Y', '10Y', '30Y']

function YieldCurveSvg({ yields, inverted }) {
  const values = [yields.t13w, yields.t5y, yields.t10y, yields.t30y]
  const validValues = values.filter(v => v != null)
  if (validValues.length < 2) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-600 text-sm">
        Insufficient data
      </div>
    )
  }

  const minY = Math.min(...validValues) - 0.1
  const maxY = Math.max(...validValues) + 0.1
  const rangeY = maxY - minY || 1

  const innerW = CURVE_W - CURVE_PAD.left - CURVE_PAD.right
  const innerH = CURVE_H - CURVE_PAD.top - CURVE_PAD.bottom

  const toX = i => CURVE_PAD.left + (i / (values.length - 1)) * innerW
  const toY = v => CURVE_PAD.top + (1 - (v - minY) / rangeY) * innerH

  // Build polyline from available points
  const points = values
    .map((v, i) => (v != null ? `${toX(i)},${toY(v)}` : null))
    .filter(Boolean)
    .join(' ')

  const lineColor = inverted ? '#ef4444' : '#10b981'

  return (
    <svg width="100%" viewBox={`0 0 ${CURVE_W} ${CURVE_H + 10}`} className="block">
      {/* Y-axis gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const yv = minY + t * rangeY
        const cy = CURVE_PAD.top + (1 - t) * innerH
        return (
          <g key={t}>
            <line
              x1={CURVE_PAD.left} x2={CURVE_W - CURVE_PAD.right}
              y1={cy} y2={cy}
              stroke="#1f2937" strokeWidth={1} strokeDasharray="4 2"
            />
            <text x={CURVE_PAD.left - 4} y={cy + 3} textAnchor="end" fill="#4b5563" fontSize={9}>
              {yv.toFixed(2)}
            </text>
          </g>
        )
      })}

      {/* Curve line */}
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Dots + x-axis labels */}
      {values.map((v, i) => (
        v != null && (
          <g key={i}>
            <circle cx={toX(i)} cy={toY(v)} r={4} fill={lineColor} />
            <text
              x={toX(i)} y={CURVE_H + 8}
              textAnchor="middle" fill="#6b7280" fontSize={10}
            >
              {MATURITIES[i]}
            </text>
            <text
              x={toX(i)} y={toY(v) - 7}
              textAnchor="middle" fill="#d1d5db" fontSize={9}
            >
              {v.toFixed(2)}%
            </text>
          </g>
        )
      ))}
    </svg>
  )
}

// ── 10Y Sparkline ─────────────────────────────────────────────────────────────

const SPARK_W = 100
const SPARK_H = 40

function Sparkline10Y({ history }) {
  if (!history?.length) return null

  const min = Math.min(...history)
  const max = Math.max(...history)
  const range = max - min || 0.01

  const toX = i => (i / (history.length - 1)) * SPARK_W
  const toY = v => SPARK_H - ((v - min) / range) * SPARK_H

  const pts = history.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')
  const last = history[history.length - 1]
  const first = history[0]
  const color = last >= first ? '#10b981' : '#ef4444'

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-gray-500 text-xs uppercase tracking-widest">10Y Yield — 60d Trend</div>
        <span className={`text-lg font-bold tabular-nums ${color}`}>
          {last != null ? last.toFixed(3) + '%' : '—'}
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" className="block h-10">
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-gray-700 mt-1">
        <span>60d low: {min.toFixed(3)}%</span>
        <span>60d high: {max.toFixed(3)}%</span>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function YieldCurve() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/market/rates')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="py-16 text-center text-gray-500 text-sm animate-pulse">
      Loading yield curve data…
    </div>
  )
  if (error) return (
    <div className="py-10 text-center text-red-400 text-sm">Failed: {error}</div>
  )
  if (!data) return null

  const { yields, dxy, spread_10y_13w, inverted, hist_10y } = data

  const spreadColor = inverted ? 'text-red-400' : spread_10y_13w > 0 ? 'text-emerald-400' : 'text-gray-300'

  return (
    <div className="space-y-5 p-4">
      <div className="text-gray-500 text-xs uppercase tracking-widest">Yield Curve &amp; Rates Dashboard</div>

      {/* Yield Curve Chart */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-gray-400 text-sm font-medium">US Treasury Yield Curve</div>
          {inverted && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800/50 font-semibold">
              INVERTED
            </span>
          )}
        </div>
        <YieldCurveSvg yields={yields} inverted={inverted} />
        <div className="text-gray-700 text-[10px] mt-1">
          X-axis positions are evenly spaced (not proportional to maturity) ·{' '}
          {inverted
            ? 'Red = inverted curve (10Y yield below 13W) — potential recession signal'
            : 'Green = normal upward-sloping curve'}
        </div>
      </div>

      {/* Rates KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="13-Week T-Bill" value={fmt(yields.t13w)} sub="Short end" />
        <KpiCard label="5-Year Treasury" value={fmt(yields.t5y)} sub="Medium term" />
        <KpiCard
          label="10-Year Treasury"
          value={fmt(yields.t10y)}
          sub="Benchmark rate"
          color="text-indigo-300"
        />
        <KpiCard label="30-Year Treasury" value={fmt(yields.t30y)} sub="Long end" />
      </div>

      {/* Spread + DXY row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Spread card */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-500 text-xs uppercase tracking-widest mb-2">10Y − 13W Spread</div>
          <div className="flex items-center gap-3">
            <span className={`text-2xl font-bold tabular-nums ${spreadColor}`}>
              {fmtBps(spread_10y_13w)}
            </span>
            {inverted && (
              <span className="text-xs px-2 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800/50 font-semibold">
                INVERTED
              </span>
            )}
          </div>
          <div className="text-gray-600 text-xs mt-1">
            {inverted
              ? 'Yield curve inversion: short-term yields exceed long-term — historically a recession leading indicator'
              : 'Positive spread: normal curve — longer maturities yield more than short-term bills'}
          </div>
        </div>

        {/* DXY card */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-500 text-xs uppercase tracking-widest mb-2">US Dollar Index (DXY)</div>
          <div className="text-2xl font-bold tabular-nums text-amber-300">
            {dxy != null ? dxy.toFixed(2) : '—'}
          </div>
          <div className="text-gray-600 text-xs mt-1">
            DX-Y.NYB · Measures USD vs a basket of 6 major currencies (EUR, JPY, GBP, CAD, SEK, CHF)
          </div>
        </div>
      </div>

      {/* 10Y Sparkline */}
      <Sparkline10Y history={hist_10y} />

      {/* Footer note */}
      <div className="text-gray-700 text-xs">
        Sources: ^IRX (13W T-Bill proxy), ^FVX (5Y), ^TNX (10Y), ^TYX (30Y), DX-Y.NYB (DXY) via yfinance ·
        Cached 30 min · Yields shown as reported (not divided by 100)
      </div>
    </div>
  )
}
