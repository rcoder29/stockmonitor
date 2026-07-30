import { useState, useEffect, useCallback } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────

const SENTIMENT_ZONES = [
  { max: 25,  label: 'Extreme Fear', bg: 'bg-red-900/40',    border: 'border-red-700/50',    text: 'text-red-300',    badge: 'bg-red-700',     hex: '#7f1d1d' },
  { max: 45,  label: 'Fear',         bg: 'bg-orange-900/30', border: 'border-orange-700/40', text: 'text-orange-300', badge: 'bg-orange-700',  hex: '#7c2d12' },
  { max: 55,  label: 'Neutral',      bg: 'bg-slate-800',     border: 'border-slate-600',     text: 'text-slate-200',  badge: 'bg-slate-600',   hex: '#334155' },
  { max: 75,  label: 'Greed',        bg: 'bg-green-900/20',  border: 'border-green-700/30',  text: 'text-green-300',  badge: 'bg-green-700',   hex: '#14532d' },
  { max: 101, label: 'Extreme Greed',bg: 'bg-emerald-900/30',border: 'border-emerald-700/40',text: 'text-emerald-300',badge: 'bg-emerald-600', hex: '#064e3b' },
]

function getZone(score) {
  return SENTIMENT_ZONES.find(z => score < z.max) ?? SENTIMENT_ZONES[4]
}

// ── Semicircle Gauge ──────────────────────────────────────────────────────────

function SentimentGauge({ score }) {
  const cx = 150, cy = 145, R = 110, strokeW = 22

  // Arc helper: returns SVG path for an arc segment
  function arcPath(startDeg, endDeg, r) {
    const toRad = d => (d * Math.PI) / 180
    const x1 = cx + r * Math.cos(toRad(180 - startDeg))
    const y1 = cy - r * Math.sin(toRad(180 - startDeg))
    const x2 = cx + r * Math.cos(toRad(180 - endDeg))
    const y2 = cy - r * Math.sin(toRad(180 - endDeg))
    const large = endDeg - startDeg > 180 ? 1 : 0
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
  }

  // Color zones across the 180° arc
  const zones = [
    { start: 0,   end: 45,  color: '#ef4444' },   // Extreme Fear
    { start: 45,  end: 81,  color: '#f97316' },   // Fear
    { start: 81,  end: 99,  color: '#eab308' },   // Neutral
    { start: 99,  end: 135, color: '#22c55e' },   // Greed
    { start: 135, end: 180, color: '#16a34a' },   // Extreme Greed
  ]

  // Needle
  const needleDeg = (score / 100) * 180
  const needleRad = ((180 - needleDeg) * Math.PI) / 180
  const nx = cx + (R - 5) * Math.cos(needleRad)
  const ny = cy - (R - 5) * Math.sin(needleRad)

  const zone = getZone(score)

  return (
    <svg viewBox="0 0 300 160" className="w-full max-w-xs mx-auto">
      {/* Background arc */}
      <path d={arcPath(0, 180, R)} fill="none" stroke="#1e293b" strokeWidth={strokeW} strokeLinecap="butt" />

      {/* Colored zones */}
      {zones.map((z, i) => (
        <path key={i} d={arcPath(z.start, z.end, R)} fill="none"
          stroke={z.color} strokeWidth={strokeW} strokeLinecap="butt" opacity={0.85} />
      ))}

      {/* Score fill arc */}
      <path d={arcPath(0, needleDeg, R)} fill="none"
        stroke="white" strokeWidth={4} strokeLinecap="round" opacity={0.15} />

      {/* Zone labels */}
      {[
        { deg: 10,  label: 'Ext.\nFear' },
        { deg: 63,  label: 'Fear' },
        { deg: 90,  label: 'Neutral' },
        { deg: 117, label: 'Greed' },
        { deg: 168, label: 'Ext.\nGreed' },
      ].map(({ deg, label }) => {
        const labelR = R + 20
        const rad = ((180 - deg) * Math.PI) / 180
        return (
          <text key={deg} x={cx + labelR * Math.cos(rad)} y={cy - labelR * Math.sin(rad)}
            textAnchor="middle" fontSize={7.5} fill="#64748b" dominantBaseline="middle">
            {label.split('\n').map((line, i) => (
              <tspan key={i} x={cx + labelR * Math.cos(rad)} dy={i === 0 ? 0 : 9}>{line}</tspan>
            ))}
          </text>
        )
      })}

      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="white" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={6} fill="white" />
      <circle cx={cx} cy={cy} r={3} fill="#0f172a" />

      {/* Score */}
      <text x={cx} y={cy - 25} textAnchor="middle" fontSize={36} fontWeight="bold" fill="white" fontFamily="monospace">
        {score}
      </text>
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize={12} fontWeight="bold" fill={zone.text.replace('text-','').includes('-') ? '#94a3b8' : 'white'} fontFamily="sans-serif">
        {zone.label}
      </text>
    </svg>
  )
}

// ── VIX Sparkline ─────────────────────────────────────────────────────────────

function VixSparkline({ history, current }) {
  if (!history || history.length < 10) return null
  const vals = history.map(h => h.value)
  const min  = Math.min(...vals) * 0.97
  const max  = Math.max(...vals) * 1.03
  const W = 280, H = 60
  const points = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W
    const y = H - ((v - min) / (max - min)) * H
    return `${x},${y}`
  }).join(' ')

  const curY = H - ((current - min) / (max - min)) * H

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14">
      <polyline points={points} fill="none" stroke="#60a5fa" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={(vals.length - 1) / (vals.length - 1) * W} cy={curY} r={3} fill="#60a5fa" />
      <text x={2} y={10} fontSize={8} fill="#475569">{max.toFixed(0)}</text>
      <text x={2} y={H - 2} fontSize={8} fill="#475569">{min.toFixed(0)}</text>
    </svg>
  )
}

// ── Indicator Card ────────────────────────────────────────────────────────────

function IndicatorCard({ ind, vixHistory }) {
  const zone = getZone(ind.score)
  const isVix = ind.id === 'vix'

  return (
    <div className={`rounded-xl border p-4 space-y-2 ${zone.bg} ${zone.border}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold text-slate-300 uppercase tracking-wider">{ind.name}</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold text-white whitespace-nowrap shrink-0 ${zone.badge}`}>
          {zone.label}
        </span>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold tabular-nums ${zone.text}`}>{ind.reading}</span>
        {ind.readingUnit && <span className="text-xs text-slate-500">{ind.readingUnit}</span>}
      </div>

      {isVix && vixHistory?.length > 0 && (
        <VixSparkline history={vixHistory} current={parseFloat(ind.reading)} />
      )}

      <p className="text-[11px] text-slate-400 leading-snug">{ind.context}</p>

      {/* Score bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-1.5 rounded-full transition-all" style={{ width: `${ind.score}%`, backgroundColor: zone.hex }} />
        </div>
        <span className="text-[10px] text-slate-500 tabular-nums w-8 text-right">{ind.score}/100</span>
      </div>

      {/* Extra data pills for some indicators */}
      {ind.id === 'vix' && ind.extra && (
        <div className="flex gap-2 flex-wrap pt-0.5">
          {ind.extra.vix3m && (
            <span className="text-[10px] px-2 py-0.5 bg-slate-700 rounded-full text-slate-300">
              VIX3M: {ind.extra.vix3m}
            </span>
          )}
          {ind.extra.termStructure && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${ind.extra.termStructure === 'contango' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
              {ind.extra.termStructure}
            </span>
          )}
        </div>
      )}
      {ind.id === 'putCall' && ind.extra && (
        <div className="flex gap-2 flex-wrap pt-0.5">
          <span className="text-[10px] px-2 py-0.5 bg-emerald-900/30 rounded-full text-emerald-400">
            Calls: {ind.extra.callVol?.toLocaleString()}
          </span>
          <span className="text-[10px] px-2 py-0.5 bg-red-900/30 rounded-full text-red-400">
            Puts: {ind.extra.putVol?.toLocaleString()}
          </span>
        </div>
      )}
      {ind.id === 'momentum' && ind.extra && (
        <div className="flex gap-2 flex-wrap pt-0.5">
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${ind.extra.ret1m >= 0 ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
            1M: {ind.extra.ret1m >= 0 ? '+' : ''}{ind.extra.ret1m}%
          </span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${ind.extra.ret3m >= 0 ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
            3M: {ind.extra.ret3m >= 0 ? '+' : ''}{ind.extra.ret3m}%
          </span>
        </div>
      )}
      {ind.id === 'safeHaven' && ind.extra && ind.extra.gldRet1m != null && (
        <div className="flex gap-2 pt-0.5">
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${ind.extra.gldRet1m >= 0 ? 'bg-yellow-900/30 text-yellow-400' : 'bg-slate-700 text-slate-400'}`}>
            Gold 1M: {ind.extra.gldRet1m >= 0 ? '+' : ''}{ind.extra.gldRet1m}%
          </span>
        </div>
      )}
    </div>
  )
}

// ── Score History Mini Chart ──────────────────────────────────────────────────

const SCORE_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#16a34a']

function ScoreZoneBar({ score }) {
  const zone = getZone(score)
  return (
    <div className="flex h-2 rounded-full overflow-hidden gap-0.5 relative">
      {[12.5, 35, 50, 65, 87.5].map((mid, i) => (
        <div key={i} className="flex-1 rounded-sm" style={{ backgroundColor: SCORE_COLORS[i], opacity: 0.25 + (Math.abs(mid - score) < 15 ? 0.6 : 0) }} />
      ))}
      <div className="absolute inset-y-0 w-1 bg-white rounded-full shadow-lg transition-all"
        style={{ left: `calc(${score}% - 2px)` }} />
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function MarketSentimentDashboard() {
  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [lastFetch, setLastFetch] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/market/sentiment')
      if (!res.ok) throw new Error((await res.json()).detail || 'Error')
      const json = await res.json()
      setData(json)
      setLastFetch(new Date())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [load])

  if (loading && !data) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Market Sentiment Dashboard</h1>
        <div className="bg-slate-800/50 rounded-xl p-10 border border-slate-700/50 text-center">
          <div className="animate-pulse space-y-3">
            <div className="text-slate-400 text-sm">Fetching sentiment signals…</div>
            <div className="text-slate-600 text-xs">VIX · Put/Call · Momentum · Breadth · Credit · Safe Haven</div>
          </div>
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Market Sentiment Dashboard</h1>
        <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-6 text-center">
          <p className="text-red-400">{error}</p>
          <button onClick={load} className="mt-3 px-4 py-2 bg-slate-700 text-slate-200 text-sm rounded-lg">Retry</button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { overallScore, overallLabel, indicators, vixHistory, timestamp, errors } = data
  const zone = getZone(overallScore)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Market Sentiment Dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Composite of {indicators.length} market signals · Updated {lastFetch ? lastFetch.toLocaleTimeString() : timestamp}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-xs text-blue-400 animate-pulse">Refreshing…</span>}
          <button onClick={load} disabled={loading}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 rounded-lg disabled:opacity-50">
            ↻ Refresh
          </button>
          <span className="text-xs text-slate-600">Auto-refreshes every 5 min</span>
        </div>
      </div>

      {/* Central gauge + overall */}
      <div className={`rounded-2xl border p-6 ${zone.bg} ${zone.border}`}>
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="w-full max-w-xs">
            <SentimentGauge score={overallScore} />
          </div>

          <div className="flex-1 space-y-4">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Overall Market Sentiment</p>
              <div className="flex items-baseline gap-3">
                <span className={`text-5xl font-black tabular-nums ${zone.text}`}>{overallScore}</span>
                <span className={`text-2xl font-bold ${zone.text}`}>{overallLabel}</span>
              </div>
            </div>

            <ScoreZoneBar score={overallScore} />

            <div className="flex gap-4 flex-wrap text-xs text-slate-400">
              {[['0–25','Extreme Fear','text-red-400'],['26–45','Fear','text-orange-400'],
                ['46–55','Neutral','text-slate-300'],['56–75','Greed','text-green-400'],
                ['76–100','Extreme Greed','text-emerald-400']].map(([range, label, cls]) => (
                <div key={range} className="flex items-center gap-1">
                  <span className={`font-bold ${cls}`}>{range}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 pt-1">
              {indicators.map(ind => (
                <div key={ind.id} className="bg-slate-900/40 rounded-lg p-2 text-center">
                  <p className={`text-sm font-bold tabular-nums ${getZone(ind.score).text}`}>{ind.score}</p>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">{ind.name.split(' ').slice(-1)[0] === 'VIX)' ? 'VIX' : ind.name.split(' (')[0].split(' ').slice(-1)[0]}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Indicator cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {indicators.map(ind => (
          <IndicatorCard key={ind.id} ind={ind} vixHistory={ind.id === 'vix' ? vixHistory : null} />
        ))}
      </div>

      {/* Interpretation guide */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold text-slate-300 uppercase tracking-wider">How to Read This</p>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-slate-400">
          <div><span className="text-red-400 font-bold">VIX:</span> Fear index — spikes above 30 = market panic. Below 15 = complacency.</div>
          <div><span className="text-orange-400 font-bold">Put/Call:</span> Ratio &gt; 1.0 = more bearish bets than bullish. Contrarian: extreme put buying often marks bottoms.</div>
          <div><span className="text-yellow-400 font-bold">Momentum:</span> SPY above 200-day MA with positive rate of change = sustained bull trend.</div>
          <div><span className="text-green-400 font-bold">Breadth:</span> % of S&P 500 stocks above their 50-day MA. Below 40% = broad weakness even if index holds.</div>
          <div><span className="text-emerald-400 font-bold">Junk Bonds:</span> HYG outperforming LQD = investors willing to take credit risk = risk-on.</div>
          <div><span className="text-blue-400 font-bold">Safe Haven:</span> Money rotating out of bonds/gold into stocks = confident, risk-seeking market.</div>
        </div>
        <p className="text-[11px] text-slate-600">Overall score = simple average of all available indicator scores (0–100 each). Refreshes every 30 minutes server-side. VIX history covers the last 90 trading days.</p>
      </div>

      {errors?.length > 0 && (
        <p className="text-xs text-yellow-600">Note: Some indicators unavailable — {errors.join(' · ')}</p>
      )}
    </div>
  )
}
