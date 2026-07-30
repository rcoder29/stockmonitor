import { useState, useCallback } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(v, plus = true) {
  if (v == null) return '—'
  return `${plus && v > 0 ? '+' : ''}${v.toFixed(1)}%`
}
function fmtEps(v) {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}
function quarter(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const m = d.getUTCMonth()
  const q = Math.floor(m / 3) + 1
  return `Q${q} '${String(d.getUTCFullYear()).slice(2)}`
}

// ── Beat Rate Ring ────────────────────────────────────────────────────────────

function BeatRing({ rate, count, total }) {
  if (rate == null) return <div className="w-14 h-14 rounded-full bg-slate-700 flex items-center justify-center text-slate-500 text-xs">—</div>
  const r = 22, circ = 2 * Math.PI * r
  const dash = (rate / 100) * circ
  const color = rate >= 75 ? '#34d399' : rate >= 50 ? '#fbbf24' : '#f87171'
  return (
    <div className="relative w-14 h-14 shrink-0">
      <svg viewBox="0 0 56 56" className="w-14 h-14 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="#334155" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs font-bold text-white leading-none">{rate}%</span>
        <span className="text-[9px] text-slate-500 leading-none">{count}/{total}</span>
      </div>
    </div>
  )
}

// ── Surprise sparkbar chart ───────────────────────────────────────────────────

function SurpriseBars({ quarters }) {
  const reversed = [...quarters].reverse() // oldest left → newest right
  const values   = reversed.map(q => q.surprisePct ?? 0)
  const maxAbs   = Math.max(10, ...values.map(Math.abs))
  const W = 220, H = 56, barW = 20, gap = 6
  const barCount = reversed.length
  const totalW   = barCount * (barW + gap) - gap
  const offsetX  = (W - totalW) / 2

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: W }}>
      {/* Zero line */}
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#475569" strokeWidth="0.8" strokeDasharray="3,3" />

      {reversed.map((q, i) => {
        const v    = q.surprisePct ?? 0
        const norm = v / maxAbs          // -1..+1
        const barH = Math.abs(norm) * (H / 2 - 4)
        const x    = offsetX + i * (barW + gap)
        const y    = v >= 0 ? H / 2 - barH : H / 2
        const fill = v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#475569'

        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={Math.max(2, barH)} fill={fill} rx="2" opacity="0.85" />
            <text x={x + barW / 2} y={H - 1} textAnchor="middle" fill="#64748b" fontSize="7">
              {quarter(q.date).split(' ')[0]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Drift badge ───────────────────────────────────────────────────────────────

function DriftBadge({ v, label }) {
  if (v == null) return (
    <div className="text-center">
      <p className="text-slate-500 text-xs">{label}</p>
      <p className="text-slate-600 text-sm font-bold">—</p>
    </div>
  )
  const cls = v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-slate-400'
  return (
    <div className="text-center">
      <p className="text-slate-400 text-xs">{label}</p>
      <p className={`text-sm font-bold ${cls}`}>{fmtPct(v)}</p>
    </div>
  )
}

// ── Streak badge ──────────────────────────────────────────────────────────────

function StreakBadge({ n }) {
  if (!n) return null
  const cls = n >= 4 ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40'
            : n >= 2 ? 'bg-yellow-900/30 text-yellow-300 border-yellow-700/30'
            : 'bg-slate-700 text-slate-300 border-slate-600'
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border font-semibold ${cls}`}>
      🔥 {n}Q streak
    </span>
  )
}

// ── Quarter detail table ──────────────────────────────────────────────────────

function QuarterTable({ quarters }) {
  return (
    <div className="overflow-x-auto border-t border-slate-700 mt-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-700 bg-slate-900/40">
            {['Quarter', 'EPS Est', 'EPS Act', 'Surprise', 'Beat?', '+1D', '+5D'].map(h => (
              <th key={h} className="px-3 py-2 text-left text-slate-400 uppercase tracking-wider font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {quarters.map((q, i) => {
            const beatCls = q.beat === true ? 'text-emerald-400' : q.beat === false ? 'text-red-400' : 'text-slate-500'
            const surpCls = (q.surprisePct ?? 0) > 0 ? 'text-emerald-400' : (q.surprisePct ?? 0) < 0 ? 'text-red-400' : 'text-slate-400'
            return (
              <tr key={i} className={`border-b border-slate-700/40 ${i % 2 ? 'bg-slate-900/20' : ''}`}>
                <td className="px-3 py-2 text-slate-300 font-medium whitespace-nowrap">{quarter(q.date)}</td>
                <td className="px-3 py-2 text-slate-400 tabular-nums">{fmtEps(q.epsEstimate)}</td>
                <td className="px-3 py-2 text-white tabular-nums font-semibold">{fmtEps(q.epsActual)}</td>
                <td className={`px-3 py-2 tabular-nums font-bold ${surpCls}`}>
                  {q.surprisePct != null ? `${q.surprisePct > 0 ? '+' : ''}${q.surprisePct.toFixed(1)}%` : '—'}
                </td>
                <td className={`px-3 py-2 font-bold ${beatCls}`}>
                  {q.beat === true ? '✓ Beat' : q.beat === false ? '✗ Miss' : '—'}
                </td>
                <td className={`px-3 py-2 tabular-nums ${q.drift1d > 0 ? 'text-emerald-400' : q.drift1d < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                  {fmtPct(q.drift1d)}
                </td>
                <td className={`px-3 py-2 tabular-nums ${q.drift5d > 0 ? 'text-emerald-400' : q.drift5d < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                  {fmtPct(q.drift5d)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Stock card ────────────────────────────────────────────────────────────────

function StockCard({ data, onRemove }) {
  const [expanded, setExpanded] = useState(false)
  const { symbol, name, sector, quarters, beatRate, beatCount, totalQuarters,
          avgSurprisePct, beatStreak, avgDrift1d, avgDrift5d, noData } = data

  if (noData || !quarters?.length) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex items-center gap-3">
        <div className="flex-1">
          <p className="font-bold text-white">{symbol}</p>
          <p className="text-xs text-slate-500 mt-0.5">No earnings history available (ETF or insufficient data)</p>
        </div>
        <button onClick={() => onRemove(symbol)} className="text-slate-600 hover:text-red-400 text-xs transition-colors shrink-0">✕ Remove</button>
      </div>
    )
  }

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      {/* Card header */}
      <div className="p-4">
        <div className="flex items-start gap-4">
          {/* Beat rate ring */}
          <BeatRing rate={beatRate} count={beatCount} total={totalQuarters} />

          {/* Main info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-white text-lg leading-none">{symbol}</p>
              {beatStreak >= 2 && <StreakBadge n={beatStreak} />}
              {sector && <span className="text-xs text-slate-500 bg-slate-700 px-1.5 py-0.5 rounded">{sector}</span>}
            </div>
            <p className="text-sm text-slate-400 mt-0.5 truncate">{name}</p>

            {/* Key stats row */}
            <div className="flex gap-5 mt-3 flex-wrap">
              <div>
                <p className="text-xs text-slate-500">Avg EPS Surprise</p>
                <p className={`text-base font-bold ${(avgSurprisePct ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {avgSurprisePct != null ? `${avgSurprisePct > 0 ? '+' : ''}${avgSurprisePct.toFixed(1)}%` : '—'}
                </p>
              </div>
              <div className="w-px bg-slate-700 self-stretch" />
              <DriftBadge v={avgDrift1d} label="Avg +1D Drift" />
              <DriftBadge v={avgDrift5d} label="Avg +5D Drift" />
              {quarters[0] && (
                <>
                  <div className="w-px bg-slate-700 self-stretch" />
                  <div>
                    <p className="text-xs text-slate-500">Last Quarter</p>
                    <p className={`text-base font-bold ${quarters[0].beat ? 'text-emerald-400' : 'text-red-400'}`}>
                      {quarters[0].beat ? '✓ Beat' : '✗ Miss'}
                      {quarters[0].surprisePct != null && (
                        <span className="text-sm font-normal ml-1">({fmtPct(quarters[0].surprisePct)})</span>
                      )}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right column: sparkbar + controls */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex gap-2">
              <button onClick={() => setExpanded(e => !e)}
                className="text-xs text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded-lg transition-colors">
                {expanded ? '▲ Hide' : '▼ Details'}
              </button>
              <button onClick={() => onRemove(symbol)} className="text-slate-600 hover:text-red-400 text-xs transition-colors">✕</button>
            </div>
            <div className="w-56">
              <p className="text-[9px] text-slate-600 text-right mb-0.5">EPS surprise — last {quarters.length}Q</p>
              <SurpriseBars quarters={quarters} />
            </div>
          </div>
        </div>
      </div>

      {/* Expandable detail table */}
      {expanded && <QuarterTable quarters={quarters} />}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EarningsSurpriseTracker({ watchlist }) {
  const [symbols,   setSymbols]   = useState([])
  const [input,     setInput]     = useState('')
  const [results,   setResults]   = useState([])
  const [loading,   setLoading]   = useState(false)
  const [ran,       setRan]       = useState(false)

  function addSymbol(sym) {
    const s = sym.trim().toUpperCase()
    if (!s || symbols.includes(s)) return
    setSymbols(prev => [...prev, s])
  }

  function removeSymbol(sym) {
    setSymbols(prev => prev.filter(s => s !== sym))
    setResults(prev => prev.filter(r => r.symbol !== sym))
  }

  function handleInput(e) {
    e.preventDefault()
    if (!input.trim()) return
    // Support comma-separated or space-separated bulk entry
    input.split(/[\s,]+/).forEach(s => addSymbol(s))
    setInput('')
  }

  function importWatchlist() {
    if (!watchlist?.length) return
    watchlist.forEach(s => addSymbol(s))
  }

  const runAnalysis = useCallback(async () => {
    if (!symbols.length) return
    setLoading(true)
    setRan(true)
    try {
      const r = await fetch(`/api/market/earnings-surprise?symbols=${symbols.join(',')}`)
      const data = await r.json()
      setResults(data)
    } catch (e) {
      console.error('Earnings surprise:', e)
    } finally {
      setLoading(false)
    }
  }, [symbols.join(',')])

  // Results keyed by symbol for quick lookup; preserve order of `results`
  const resultMap = Object.fromEntries(results.map(r => [r.symbol, r]))

  // Symbols with results + those still pending
  const pending = symbols.filter(s => !resultMap[s])

  const summarySyms  = results.filter(r => !r.noData && r.quarters?.length)
  const allBeaters   = summarySyms.filter(r => (r.beatRate ?? 0) >= 75)
  const avgBeatRate  = summarySyms.length
    ? Math.round(summarySyms.reduce((a, r) => a + (r.beatRate ?? 0), 0) / summarySyms.length)
    : null

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Earnings Surprise Tracker</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Last 8 quarters of EPS beat/miss history, average surprise %, and post-earnings price drift for any stock.
        </p>
      </div>

      {/* Symbol input */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 space-y-3">
        <form onSubmit={handleInput} className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            placeholder="AAPL, MSFT, NVDA … (comma or space separated)"
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
          />
          <button type="submit"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors shrink-0">
            + Add
          </button>
          <button type="button" onClick={importWatchlist} disabled={!watchlist?.length}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors disabled:opacity-40 shrink-0">
            ⬇ Watchlist
          </button>
        </form>

        {/* Symbol pills */}
        {symbols.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {symbols.map(s => (
              <span key={s} className="flex items-center gap-1 px-2.5 py-1 bg-slate-700 rounded-lg text-xs text-white font-mono">
                {s}
                <button onClick={() => removeSymbol(s)} className="text-slate-500 hover:text-red-400 transition-colors ml-0.5">×</button>
              </span>
            ))}
            <button onClick={() => { setSymbols([]); setResults([]); setRan(false) }}
              className="text-slate-600 hover:text-slate-400 text-xs px-2 py-1 transition-colors">
              Clear all
            </button>
          </div>
        )}

        <button
          onClick={runAnalysis}
          disabled={!symbols.length || loading}
          className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold text-sm rounded-xl transition-colors"
        >
          {loading ? `Fetching ${symbols.length} symbol${symbols.length > 1 ? 's' : ''}…` : `▶ Run Analysis (${symbols.length} symbol${symbols.length > 1 ? 's' : ''})`}
        </button>
        <p className="text-xs text-slate-600">
          First run per symbol fetches 2 years of price history + earnings history from Yahoo Finance. Cached 12 hours.
          Large watchlists may take 20–30 seconds.
        </p>
      </div>

      {/* Summary row (once results arrive) */}
      {summarySyms.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-800 rounded-xl p-3.5 border border-slate-700">
            <p className="text-xs text-slate-400">Symbols Analyzed</p>
            <p className="text-xl font-bold text-white mt-1">{summarySyms.length}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-3.5 border border-slate-700">
            <p className="text-xs text-slate-400">Avg Beat Rate</p>
            <p className={`text-xl font-bold mt-1 ${(avgBeatRate ?? 0) >= 75 ? 'text-emerald-400' : (avgBeatRate ?? 0) >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
              {avgBeatRate != null ? `${avgBeatRate}%` : '—'}
            </p>
          </div>
          <div className="bg-emerald-900/20 rounded-xl p-3.5 border border-emerald-800/30">
            <p className="text-xs text-slate-400">Consistent Beaters (≥75%)</p>
            <p className="text-xl font-bold text-emerald-400 mt-1">{allBeaters.length}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-3.5 border border-slate-700">
            <p className="text-xs text-slate-400">Active Beat Streaks</p>
            <p className="text-xl font-bold text-white mt-1">{summarySyms.filter(r => r.beatStreak >= 2).length}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {ran && !loading && results.length === 0 && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 text-center text-slate-400 text-sm">
          No results returned. Try different symbols.
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {/* Sort results: data-rich first */}
          {results
            .sort((a, b) => {
              if (a.noData && !b.noData) return 1
              if (!a.noData && b.noData) return -1
              return (b.beatRate ?? 0) - (a.beatRate ?? 0)
            })
            .map(r => (
              <StockCard key={r.symbol} data={r} onRemove={removeSymbol} />
            ))
          }
        </div>
      )}

      {/* Legend */}
      {results.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-700/40 rounded-xl p-4 text-xs text-slate-500 grid sm:grid-cols-2 gap-4">
          <div>
            <p className="text-slate-300 font-semibold mb-1">EPS Surprise %</p>
            <p>(Actual EPS − Estimate EPS) ÷ |Estimate EPS| × 100. Positive = beat, negative = miss. The surprise bars chart the last 8 quarters oldest-left to newest-right.</p>
          </div>
          <div>
            <p className="text-slate-300 font-semibold mb-1">Post-Earnings Drift</p>
            <p>+1D: stock return from market close on the earnings date to the next trading day close. +5D: same but 5 trading days out. Averages show how the stock historically moves after reports.</p>
          </div>
        </div>
      )}

      {!ran && (
        <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-8 text-center text-slate-500 text-sm">
          Add ticker symbols above and click <span className="text-white">▶ Run Analysis</span> to see earnings history.
        </div>
      )}
    </div>
  )
}
