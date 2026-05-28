import { useEffect, useState } from 'react'

const LABEL_CONFIG = {
  'Very Bullish': { color: 'text-emerald-300', bg: 'bg-emerald-900/40', border: 'border-emerald-700/50' },
  'Bullish':      { color: 'text-emerald-400', bg: 'bg-emerald-900/30', border: 'border-emerald-700/40' },
  'Neutral':      { color: 'text-gray-300',    bg: 'bg-gray-800/50',    border: 'border-gray-700/50'    },
  'Bearish':      { color: 'text-red-400',      bg: 'bg-red-900/30',     border: 'border-red-700/40'     },
  'Very Bearish': { color: 'text-red-300',      bg: 'bg-red-900/40',     border: 'border-red-700/50'     },
}

function ScoreGauge({ score }) {
  const pct = ((score + 1) / 2) * 100
  const clamp = Math.max(0, Math.min(100, pct))
  const color = score >= 0.3 ? '#10b981' : score >= -0.3 ? '#9ca3af' : '#ef4444'
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-gray-600">
        <span>Very Bearish</span>
        <span>Very Bullish</span>
      </div>
      <div className="relative h-3 bg-gray-800 rounded-full overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-red-600/40 via-gray-600/20 to-emerald-600/40 rounded-full" />
        <div
          className="absolute top-0 h-full w-1 rounded-full -translate-x-1/2 shadow-lg"
          style={{ left: `${clamp}%`, background: color }}
        />
      </div>
      <div className="text-center text-lg font-bold tabular-nums" style={{ color }}>
        {score >= 0 ? '+' : ''}{score.toFixed(2)}
      </div>
    </div>
  )
}

function headlineColor(score) {
  if (score >= 0.3)  return 'text-emerald-400'
  if (score >= -0.3) return 'text-gray-400'
  return 'text-red-400'
}

export default function SentimentPanel({ symbol }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/sentiment/${symbol}`)
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return (
    <div className="py-16 text-center space-y-2">
      <div className="text-gray-500 text-sm animate-pulse">Analyzing news with Claude…</div>
      <div className="text-gray-700 text-xs">This may take a few seconds</div>
    </div>
  )
  if (error) return <div className="py-16 text-center text-red-400 text-sm">Failed to load: {error}</div>
  if (!data)  return null

  const cfg = LABEL_CONFIG[data.label] ?? LABEL_CONFIG['Neutral']

  return (
    <div className="space-y-5">
      {/* Overall sentiment */}
      <div className={`rounded-xl border p-5 ${cfg.bg} ${cfg.border}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-gray-400 text-xs uppercase tracking-widest">Overall Sentiment</div>
          <span className={`text-sm font-bold px-3 py-1 rounded-lg border ${cfg.color} ${cfg.border} ${cfg.bg}`}>
            {data.label}
          </span>
        </div>
        <ScoreGauge score={data.score ?? 0} />
        {data.summary && (
          <p className="mt-4 text-gray-300 text-sm leading-relaxed">{data.summary}</p>
        )}
      </div>

      {/* Per-headline breakdown */}
      {data.headlines?.length > 0 && (
        <div>
          <div className="text-gray-500 text-xs uppercase tracking-widest mb-3">Headline Analysis</div>
          <div className="space-y-2">
            {data.headlines.map((h, i) => (
              <div key={i} className="bg-gray-800/40 border border-gray-700/40 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-gray-200 text-xs leading-relaxed flex-1">{h.text}</p>
                  <span className={`shrink-0 font-bold tabular-nums text-xs ${headlineColor(h.score)}`}>
                    {h.score >= 0 ? '+' : ''}{h.score?.toFixed(2)}
                  </span>
                </div>
                {h.reason && (
                  <p className="text-gray-600 text-[11px] mt-1.5 leading-relaxed">{h.reason}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-gray-700 text-xs">Sentiment scored by Claude AI · Cached 1 hour · Not investment advice</div>
    </div>
  )
}
