import { useEffect, useState } from 'react'

const W = 480, H = 90
const PAD = { top: 8, right: 12, bottom: 18, left: 36 }

function GaugeArc({ pct, color, label, sub }) {
  const r = 48, cx = 64, cy = 64
  const startAngle = Math.PI
  const sweep = pct / 100 * Math.PI
  const endAngle = startAngle + sweep
  const x1 = cx + r * Math.cos(startAngle)
  const y1 = cy + r * Math.sin(startAngle)
  const x2 = cx + r * Math.cos(endAngle)
  const y2 = cy + r * Math.sin(endAngle)
  const large = sweep > Math.PI ? 1 : 0

  return (
    <div className="flex flex-col items-center">
      <svg width={128} height={72}>
        {/* Background arc */}
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#1f2937" strokeWidth={10} strokeLinecap="round" />
        {/* Value arc */}
        {pct > 0 && (
          <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
            fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" />
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize={16} fontWeight="bold">
          {pct != null ? `${pct.toFixed(0)}%` : '—'}
        </text>
      </svg>
      <div className="text-gray-500 text-[11px] uppercase tracking-wide text-center -mt-1">{label}</div>
      {sub && <div className="text-gray-600 text-[10px] text-center">{sub}</div>}
    </div>
  )
}

function KpiCard({ label, value, sub, color = 'text-white', size = 'text-2xl' }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/40 rounded-xl p-4 text-center">
      <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-bold ${size} tabular-nums ${color}`}>{value ?? '—'}</div>
      {sub && <div className="text-gray-600 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

function AdLine({ points }) {
  if (!points?.length) return null
  const vals = points.map(p => p.value)
  const minV = Math.min(...vals), maxV = Math.max(...vals)
  const range = maxV - minV || 1

  const toX = i => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right)
  const toY = v => PAD.top + (1 - (v - minV) / range) * (H - PAD.top - PAD.bottom)

  const pts = points.map((p, i) => `${toX(i)},${toY(p.value)}`).join(' ')
  const lastVal = vals[vals.length - 1]
  const color = lastVal >= vals[0] ? '#10b981' : '#ef4444'

  // X axis labels (first, middle, last)
  const labelIdxs = [0, Math.floor(points.length / 2), points.length - 1]

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
      <div className="text-gray-500 text-xs uppercase tracking-widest mb-2">Advance/Decline Line (60d)</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H + 10}`} className="block">
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
        <line x1={PAD.left} x2={W - PAD.right} y1={toY(0)} y2={toY(0)}
          stroke="#374151" strokeWidth={1} strokeDasharray="4 2" />
        {labelIdxs.map(i => (
          <text key={i} x={toX(i)} y={H + 8} textAnchor="middle" fill="#4b5563" fontSize={9}>
            {points[i]?.date?.slice(5)}
          </text>
        ))}
        <text x={PAD.left - 4} y={toY(maxV) + 3} textAnchor="end" fill="#4b5563" fontSize={9}>{maxV > 0 ? '+' : ''}{maxV}</text>
        <text x={PAD.left - 4} y={toY(minV) + 3} textAnchor="end" fill="#4b5563" fontSize={9}>{minV > 0 ? '+' : ''}{minV}</text>
      </svg>
    </div>
  )
}

function VixSparkline({ history, current }) {
  if (!history?.length || !current) return null
  const min = Math.min(...history), max = Math.max(...history)
  const range = max - min || 1
  const toX = i => (i / (history.length - 1)) * 100
  const toY = v => 100 - ((v - min) / range) * 100
  const pts = history.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')
  const fearColor = current >= 30 ? '#ef4444' : current >= 20 ? '#f59e0b' : '#10b981'
  const fearLabel = current >= 30 ? 'Extreme Fear' : current >= 20 ? 'Elevated' : current >= 13 ? 'Normal' : 'Low Vol'

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-gray-500 text-xs uppercase tracking-widest">VIX</div>
        <div className="flex items-center gap-2">
          <span className={`text-lg font-bold tabular-nums ${fearColor}`}>{current.toFixed(1)}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${fearColor === '#ef4444' ? 'bg-red-900/40 text-red-400' : fearColor === '#f59e0b' ? 'bg-amber-900/30 text-amber-400' : 'bg-emerald-900/20 text-emerald-400'}`}>
            {fearLabel}
          </span>
        </div>
      </div>
      <svg width="100%" viewBox="0 0 100 40" preserveAspectRatio="none" className="block h-10">
        <polyline points={pts} fill="none" stroke={fearColor} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-gray-700 mt-1">
        <span>60d low: {min.toFixed(1)}</span><span>60d high: {max.toFixed(1)}</span>
      </div>
    </div>
  )
}

export default function MarketBreadth() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch('/api/market/breadth')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="py-16 text-center text-gray-500 text-sm animate-pulse">Scanning {' '}market breadth…</div>
  if (error)   return <div className="py-10 text-center text-red-400 text-sm">Failed: {error}</div>
  if (!data)   return null

  const adRatio = data.ad_ratio
  const adColor = adRatio >= 1.5 ? 'text-emerald-400' : adRatio >= 1 ? 'text-gray-300' : 'text-red-400'
  const hlColor = (data.hl_ratio ?? 0.5) >= 0.6 ? 'text-emerald-400' : (data.hl_ratio ?? 0.5) <= 0.4 ? 'text-red-400' : 'text-gray-300'
  const pcColor = (data.put_call_ratio ?? 1) >= 1.2 ? 'text-red-400' : (data.put_call_ratio ?? 1) <= 0.7 ? 'text-emerald-400' : 'text-gray-300'

  return (
    <div className="space-y-5">
      <div className="text-gray-500 text-xs uppercase tracking-widest">Market Breadth Dashboard</div>

      {/* Gauge row */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
        <div className="flex flex-wrap justify-around gap-4">
          <GaugeArc pct={data.above_50ma_pct} color="#6366f1" label="Above 50-day MA"
            sub={`${data.universe_size} stocks`} />
          <GaugeArc pct={data.above_200ma_pct} color="#10b981" label="Above 200-day MA"
            sub="Long-term trend" />
          <GaugeArc pct={data.hl_ratio != null ? data.hl_ratio * 100 : null} color="#f59e0b"
            label="H/L Ratio" sub={`${data.new_highs}H / ${data.new_lows}L`} />
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiCard label="Advances"   value={data.advances}  color="text-emerald-400" />
        <KpiCard label="Declines"   value={data.declines}  color="text-red-400" />
        <KpiCard label="A/D Ratio"  value={adRatio?.toFixed(2)} color={adColor}
          sub={adRatio >= 1 ? 'Bullish' : 'Bearish'} />
        <KpiCard label="New Highs"  value={data.new_highs}  color="text-emerald-400" />
        <KpiCard label="New Lows"   value={data.new_lows}   color="text-red-400" />
        <KpiCard label="P/C Ratio"  value={data.put_call_ratio?.toFixed(2)} color={pcColor}
          sub={(data.put_call_ratio ?? 1) >= 1.2 ? 'Fearful' : (data.put_call_ratio ?? 1) <= 0.7 ? 'Greedy' : 'Neutral'} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <AdLine points={data.ad_line} />
        <VixSparkline history={data.vix?.history} current={data.vix?.price} />
      </div>

      <div className="text-gray-700 text-xs">
        Universe: {data.universe_size} large-cap stocks · MA breadth and A/D line · VIX = CBOE Volatility Index · Cached 30 min
      </div>
    </div>
  )
}
