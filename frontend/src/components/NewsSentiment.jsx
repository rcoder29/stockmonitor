import { useState } from 'react'

function ScoreBar({ score }) {
  // score is -1 to 1; display as 0-100% bar split at center
  const pct = Math.round((score + 1) / 2 * 100)
  const color = score >= 0.2 ? 'bg-emerald-500' : score <= -0.2 ? 'bg-red-500' : 'bg-gray-500'
  return (
    <div className="flex items-center gap-2 w-full">
      <span className="text-red-500 text-[10px] shrink-0">−</span>
      <div className="flex-1 bg-gray-800 rounded-full h-1.5 overflow-hidden relative">
        <div className="absolute left-1/2 w-px h-full bg-gray-600" />
        {score >= 0 ? (
          <div className={`absolute h-full ${color}`} style={{ left: '50%', width: `${(score) * 50}%` }} />
        ) : (
          <div className={`absolute h-full ${color}`} style={{ right: '50%', width: `${Math.abs(score) * 50}%` }} />
        )}
      </div>
      <span className="text-emerald-500 text-[10px] shrink-0">+</span>
    </div>
  )
}

function SentimentBadge({ label }) {
  const map = {
    bullish: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
    bearish: 'bg-red-900/40 text-red-400 border-red-700/40',
    neutral: 'bg-gray-800 text-gray-400 border-gray-700',
  }
  const cls = map[label] || map.neutral
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border capitalize ${cls}`}>
      {label ?? 'neutral'}
    </span>
  )
}

function SentimentCard({ sym, data }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-sm">{sym}</span>
          <SentimentBadge label={data.label} />
        </div>
        <span className="text-gray-500 text-xs tabular-nums">
          score: <span className={`font-semibold ${data.score >= 0.2 ? 'text-emerald-400' : data.score <= -0.2 ? 'text-red-400' : 'text-gray-400'}`}>
            {data.score >= 0 ? '+' : ''}{data.score?.toFixed(2)}
          </span>
        </span>
      </div>
      <ScoreBar score={data.score ?? 0} />
      {data.summary && (
        <p className="text-gray-400 text-xs leading-relaxed">{data.summary}</p>
      )}
      {data.top_story && (
        <div className="bg-gray-800/60 rounded-lg px-3 py-2">
          <div className="text-gray-600 text-[10px] uppercase tracking-wide mb-0.5">Top Story</div>
          <div className="text-gray-300 text-xs leading-snug">{data.top_story}</div>
        </div>
      )}
    </div>
  )
}

export default function NewsSentiment({ symbols }) {
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  async function analyze() {
    const syms = [...new Set(symbols)].filter(Boolean)
    if (!syms.length) return
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/news/sentiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: syms }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      setResult(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Sort by most extreme sentiment (abs score desc)
  const entries = result
    ? Object.entries(result).sort((a, b) => Math.abs(b[1].score ?? 0) - Math.abs(a[1].score ?? 0))
    : []

  const bullCount = entries.filter(([, d]) => d.label === 'bullish').length
  const bearCount = entries.filter(([, d]) => d.label === 'bearish').length
  const neutCount = entries.filter(([, d]) => d.label === 'neutral').length

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-gray-500 text-xs uppercase tracking-widest">News Sentiment</div>
          {result && entries.length > 0 && (
            <div className="flex gap-3 mt-1 text-xs">
              {bullCount > 0 && <span className="text-emerald-400">{bullCount} bullish</span>}
              {neutCount > 0 && <span className="text-gray-500">{neutCount} neutral</span>}
              {bearCount > 0 && <span className="text-red-400">{bearCount} bearish</span>}
            </div>
          )}
        </div>
        <button
          onClick={analyze}
          disabled={loading || !symbols.length}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 transition-colors"
        >
          {loading ? 'Analyzing…' : '⚡ Analyze Sentiment'}
        </button>
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      {loading && (
        <div className="py-10 text-center text-gray-500 text-sm animate-pulse">
          Fetching news and scoring sentiment with Claude…
        </div>
      )}

      {entries.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {entries.map(([sym, data]) => (
            <SentimentCard key={sym} sym={sym} data={data} />
          ))}
        </div>
      )}

      {!loading && !error && !result && (
        <div className="py-10 text-center text-gray-700 text-sm">
          Click "Analyze Sentiment" to score today's news for your watchlist.
        </div>
      )}

      <div className="text-gray-700 text-xs">Scored by Claude Haiku · Headlines from Yahoo Finance · Cached 2hr</div>
    </div>
  )
}
