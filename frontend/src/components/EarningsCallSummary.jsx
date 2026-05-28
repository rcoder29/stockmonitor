import { useEffect, useState } from 'react'

const TONE_STYLES = {
  bullish:  { bg: 'bg-emerald-900/30', text: 'text-emerald-400', label: 'Bullish' },
  neutral:  { bg: 'bg-gray-800/60',    text: 'text-gray-300',    label: 'Neutral' },
  cautious: { bg: 'bg-amber-900/30',   text: 'text-amber-400',   label: 'Cautious' },
  bearish:  { bg: 'bg-red-900/30',     text: 'text-red-400',     label: 'Bearish' },
}

function Section({ title, children }) {
  return (
    <div className="space-y-1.5">
      <div className="text-gray-500 text-[10px] uppercase tracking-widest">{title}</div>
      {children}
    </div>
  )
}

export default function EarningsCallSummary({ symbol }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (!symbol) return
    setLoading(true); setError(null); setData(null)
    fetch(`/api/earnings/transcript-summary/${symbol}`)
      .then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.detail || `HTTP ${r.status}`) }); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
      <div className="text-gray-500 text-[10px] uppercase tracking-widest mb-3">Earnings Call Summary</div>
      <div className="py-6 text-center text-gray-500 text-sm animate-pulse">Fetching latest 8-K filing…</div>
    </div>
  )

  if (error) return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
      <div className="text-gray-500 text-[10px] uppercase tracking-widest mb-3">Earnings Call Summary</div>
      <div className="text-red-400 text-sm">{error}</div>
    </div>
  )

  if (!data) return null

  const s = data.summary ?? {}
  const tone = TONE_STYLES[s.tone] ?? TONE_STYLES.neutral

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-gray-500 text-[10px] uppercase tracking-widest">Earnings Call Summary</div>
          <div className="text-white font-semibold mt-0.5">{data.company}</div>
          {s.quarter && <div className="text-gray-500 text-xs mt-0.5">{s.quarter} · Filed {data.filing_date}</div>}
        </div>
        <div className={`px-3 py-1 rounded-lg text-sm font-semibold ${tone.bg} ${tone.text}`}>
          {tone.label}
        </div>
      </div>

      {/* Beat/Miss + Guidance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {s.beat_miss && (
          <div className="bg-gray-800/50 border border-gray-700/40 rounded-lg p-3">
            <Section title="EPS / Revenue">
              <div className="text-gray-200 text-sm">{s.beat_miss}</div>
            </Section>
          </div>
        )}
        {s.guidance && (
          <div className="bg-gray-800/50 border border-gray-700/40 rounded-lg p-3">
            <Section title="Guidance">
              <div className="text-gray-200 text-sm">{s.guidance}</div>
            </Section>
          </div>
        )}
      </div>

      {/* Tone reason */}
      {s.tone_reason && (
        <Section title="Management Tone">
          <div className={`text-sm ${tone.text}`}>{s.tone_reason}</div>
        </Section>
      )}

      {/* Key themes + Risks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {s.key_themes?.length > 0 && (
          <Section title="Key Themes">
            <div className="flex flex-wrap gap-1.5">
              {s.key_themes.map((t, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-sky-900/30 text-sky-400 border border-sky-800/40">{t}</span>
              ))}
            </div>
          </Section>
        )}
        {s.risks?.length > 0 && (
          <Section title="Risks Mentioned">
            <div className="flex flex-wrap gap-1.5">
              {s.risks.map((r, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-red-900/20 text-red-400 border border-red-800/30">{r}</span>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Notable quote */}
      {s.notable_quote && (
        <Section title="Notable Quote">
          <blockquote className="border-l-2 border-gray-600 pl-3 text-gray-400 text-sm italic">
            "{s.notable_quote}"
          </blockquote>
        </Section>
      )}

      <div className="text-gray-700 text-[10px]">
        Source: SEC EDGAR 8-K ·{' '}
        <a href={data.filing_url} target="_blank" rel="noreferrer" className="underline hover:text-gray-500">View filing</a>
        {' '}· AI-summarized · Cached 24hr
      </div>
    </div>
  )
}
