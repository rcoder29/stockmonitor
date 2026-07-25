import { useState, useEffect } from 'react'

function ProbGauge({ label, pct, color }) {
  if (pct == null) return null
  return (
    <div className="flex flex-col items-center gap-1 min-w-[64px]">
      <div className="relative w-14 h-14">
        <svg viewBox="0 0 56 56" className="w-14 h-14 -rotate-90">
          <circle cx="28" cy="28" r="22" fill="none" stroke="#334155" strokeWidth="5" />
          <circle cx="28" cy="28" r="22" fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={`${2 * Math.PI * 22}`}
            strokeDashoffset={`${2 * Math.PI * 22 * (1 - pct / 100)}`}
            strokeLinecap="round" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
          {pct}%
        </span>
      </div>
      <span className="text-xs text-slate-400 text-center">{label}</span>
    </div>
  )
}

function MeetingCard({ mtg, isNext }) {
  const past = mtg.status === 'past'
  const hasProbabilities = mtg.cutProb != null

  return (
    <div className={`rounded-xl border p-4 space-y-3 transition-colors ${
      isNext ? 'border-blue-500/60 bg-blue-900/15' :
      past   ? 'border-slate-700/40 bg-slate-800/30 opacity-60' :
               'border-slate-700 bg-slate-800'
    }`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-white font-bold text-sm">{mtg.date}</span>
            {isNext && <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full font-semibold">NEXT</span>}
            {past  && <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">PAST</span>}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {past ? `${Math.abs(mtg.daysTo)}d ago` : `In ${mtg.daysTo} days`}
          </div>
        </div>
        {mtg.impliedRate != null && (
          <div className="text-right">
            <div className="text-xs text-slate-400">Implied Rate</div>
            <div className="text-white font-bold">{mtg.impliedRate.toFixed(3)}%</div>
          </div>
        )}
      </div>

      {hasProbabilities ? (
        <div className="flex justify-around pt-1">
          <ProbGauge label="Cut" pct={mtg.cutProb}  color="#10b981" />
          <ProbGauge label="Hold" pct={mtg.holdProb} color="#3b82f6" />
          <ProbGauge label="Hike" pct={mtg.hikeProb} color="#ef4444" />
        </div>
      ) : (
        <p className="text-xs text-slate-500 text-center py-2">Futures data unavailable</p>
      )}
    </div>
  )
}

function RateChart({ history }) {
  if (!history.length) return null
  const rates = history.map(h => h.rate)
  const min = Math.min(...rates) - 0.2
  const max = Math.max(...rates) + 0.2
  const range = max - min || 1
  const W = 560, H = 120, PAD = 4
  const pts = history.map((h, i) => {
    const x = PAD + (i / (history.length - 1)) * (W - PAD * 2)
    const y = H - PAD - ((h.rate - min) / range) * (H - PAD * 2)
    return `${x},${y}`
  }).join(' ')

  return (
    <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
      <h3 className="text-sm font-bold text-white mb-3">13-Week T-Bill Rate (1 Year)</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth="1.5" />
        <polyline points={`${PAD},${H - PAD} ${pts} ${W - PAD},${H - PAD}`}
          fill="rgba(59,130,246,0.1)" stroke="none" />
      </svg>
      <div className="flex justify-between text-xs text-slate-500 mt-1">
        <span>{history[0]?.date}</span>
        <span>{history[history.length - 1]?.date}</span>
      </div>
    </div>
  )
}

export default function FedWatch() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    fetch('/api/market/fed-watch')
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-center text-slate-500">Loading Fed data…</div>
  if (error)   return <div className="p-8 text-center text-red-400">{error}</div>
  if (!data)   return null

  const nextMeeting = data.meetings.find(m => m.daysTo >= 0)
  const upcoming    = data.meetings.filter(m => m.daysTo >= 0)
  const past        = data.meetings.filter(m => m.daysTo < 0)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Fed Watch</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            FOMC meeting calendar with rate change probabilities derived from 30-day Fed Funds futures (ZQ contracts).
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-slate-400">Current Fed Funds Target</div>
          <div className="text-3xl font-bold text-white">{data.currentTarget}</div>
          <div className="text-xs text-slate-500 mt-0.5">As of {data.asOf}</div>
        </div>
      </div>

      {/* Next meeting highlight */}
      {nextMeeting && (
        <div className="bg-gradient-to-r from-blue-900/30 to-slate-800 rounded-xl border border-blue-600/40 p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs text-blue-300 uppercase tracking-wider font-semibold">Next FOMC Meeting</p>
              <p className="text-2xl font-bold text-white mt-0.5">{nextMeeting.date}</p>
              <p className="text-slate-400 text-sm mt-0.5">In {nextMeeting.daysTo} days</p>
            </div>
            {nextMeeting.cutProb != null && (
              <div className="flex gap-6">
                <ProbGauge label="Rate Cut" pct={nextMeeting.cutProb} color="#10b981" />
                <ProbGauge label="Hold" pct={nextMeeting.holdProb} color="#3b82f6" />
                <ProbGauge label="Rate Hike" pct={nextMeeting.hikeProb} color="#ef4444" />
              </div>
            )}
          </div>
          {nextMeeting.impliedRate != null && (
            <p className="text-xs text-slate-400 mt-3">
              30-day futures implied rate: <span className="text-white font-semibold">{nextMeeting.impliedRate.toFixed(3)}%</span>
              {' '}vs current midpoint <span className="text-white font-semibold">{data.currentMidpoint}%</span>
              {' '}— implied change: <span className={`font-semibold ${nextMeeting.impliedRate < data.currentMidpoint ? 'text-emerald-400' : nextMeeting.impliedRate > data.currentMidpoint ? 'text-red-400' : 'text-slate-300'}`}>
                {((nextMeeting.impliedRate - data.currentMidpoint) * 100).toFixed(0)} bps
              </span>
            </p>
          )}
        </div>
      )}

      {/* Meeting grid */}
      <div>
        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3">2025 FOMC Calendar</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {data.meetings.map((mtg, i) => (
            <MeetingCard key={mtg.date} mtg={mtg} isNext={mtg === nextMeeting} />
          ))}
        </div>
      </div>

      {/* Rate history chart */}
      <RateChart history={data.rateHistory} />

      {/* Reference table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700">
          <h3 className="text-sm font-bold text-white">Rate Move Reference</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/40">
                <th className="px-4 py-2 text-left text-slate-400 font-semibold">Scenario</th>
                <th className="px-4 py-2 text-left text-slate-400 font-semibold">New Target Range</th>
                <th className="px-4 py-2 text-left text-slate-400 font-semibold">Change</th>
                <th className="px-4 py-2 text-left text-slate-400 font-semibold">Typical Market Impact</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Double Cut (−50bps)', '3.75%–4.00%', '−50 bps', 'Strong equity rally, weaker USD, lower yields'],
                ['Cut (−25bps)',        '4.00%–4.25%', '−25 bps', 'Equity positive, growth/tech outperform, bonds up'],
                ['Hold',               '4.25%–4.50%', '0 bps',   'Neutral to slight positive if expected; negative if cut was expected'],
                ['Hike (+25bps)',       '4.50%–4.75%', '+25 bps', 'Equity sell-off, financials outperform, growth underperforms'],
              ].map(([s, t, c, impact], i) => (
                <tr key={s} className={`border-b border-slate-700/40 ${i % 2 ? 'bg-slate-900/20' : ''}`}>
                  <td className={`px-4 py-2.5 font-medium ${c.startsWith('-') ? 'text-emerald-400' : c === '0 bps' ? 'text-slate-300' : 'text-red-400'}`}>{s}</td>
                  <td className="px-4 py-2.5 text-slate-300 tabular-nums">{t}</td>
                  <td className={`px-4 py-2.5 font-semibold tabular-nums ${c.startsWith('-') ? 'text-emerald-400' : c === '0 bps' ? 'text-slate-400' : 'text-red-400'}`}>{c}</td>
                  <td className="px-4 py-2.5 text-slate-400">{impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-600">
        Probabilities derived from 30-day Fed Funds futures (CME ZQ contracts) via yfinance.
        Futures availability varies — some months may show no data. This is informational only.
      </p>
    </div>
  )
}
