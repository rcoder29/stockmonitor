import { useEffect, useState } from 'react'

const PERIODS = [
  { key: 'chg1w',  label: '1W' },
  { key: 'chg1m',  label: '1M' },
  { key: 'chg3m',  label: '3M' },
  { key: 'chg6m',  label: '6M' },
  { key: 'chgYTD', label: 'YTD' },
]

const RS_PERIODS = [
  { key: 'rs_1m',  label: 'vs SPY 1M' },
  { key: 'rs_3m',  label: 'vs SPY 3M' },
  { key: 'rs_6m',  label: 'vs SPY 6M' },
  { key: 'rs_ytd', label: 'vs SPY YTD' },
]

function PctCell({ val, rank, total }) {
  if (val == null) return <td className="py-2.5 px-3 text-right text-gray-700">—</td>
  const pos = val >= 0
  const intensity = rank != null ? Math.max(0.15, 1 - (rank - 1) / (total - 1)) : 0.5
  return (
    <td className="py-2.5 px-3 text-right tabular-nums">
      <span className={`text-sm font-medium ${pos ? 'text-emerald-400' : 'text-red-400'}`}
        style={{ opacity: 0.4 + intensity * 0.6 }}>
        {val >= 0 ? '+' : ''}{val.toFixed(2)}%
      </span>
      {rank != null && (
        <span className={`ml-1 text-[10px] ${rank <= 3 ? 'text-amber-500' : 'text-gray-700'}`}>
          #{rank}
        </span>
      )}
    </td>
  )
}

function AccelBadge({ accel }) {
  if (accel == null) return <td className="py-2.5 px-3 text-center text-gray-700">—</td>
  const label = accel > 0.5 ? '▲▲' : accel > 0 ? '▲' : accel > -0.5 ? '▼' : '▼▼'
  const color = accel > 0.5 ? 'text-emerald-400' : accel > 0 ? 'text-emerald-600' : accel > -0.5 ? 'text-red-600' : 'text-red-400'
  return <td className={`py-2.5 px-3 text-center text-sm font-bold ${color}`} title={`Accel: ${accel.toFixed(2)}%`}>{label}</td>
}

export default function SectorMomentum() {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [mode,    setMode]    = useState('abs')  // abs | rs

  useEffect(() => {
    setLoading(true); setError(null)
    fetch('/api/sectors/momentum')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setRows)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const n = rows.length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Sector Momentum Ranker</div>
        <div className="flex gap-1 bg-gray-900/60 rounded-lg p-1 border border-gray-800">
          {[['abs', 'Absolute'], ['rs', 'vs SPY']].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${mode === v ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="py-10 text-center text-gray-500 text-sm animate-pulse">Loading sector momentum…</div>}
      {error   && <div className="py-10 text-center text-red-400 text-sm">Failed: {error}</div>}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/80">
                <th className="py-2.5 px-4 text-left text-gray-500 font-medium text-xs uppercase tracking-wider w-8">#</th>
                <th className="py-2.5 px-4 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Sector</th>
                {(mode === 'abs' ? PERIODS : RS_PERIODS).map(p => (
                  <th key={p.key} className="py-2.5 px-3 text-right text-gray-500 font-medium text-xs uppercase tracking-wider">{p.label}</th>
                ))}
                <th className="py-2.5 px-3 text-center text-gray-500 font-medium text-xs uppercase tracking-wider">Accel</th>
                <th className="py-2.5 px-3 text-right text-gray-500 font-medium text-xs uppercase tracking-wider">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.symbol} className={`border-b border-gray-800/40 hover:bg-gray-800/20 ${i % 2 ? 'bg-gray-900/20' : ''}`}>
                  <td className={`py-2.5 px-4 text-xs font-bold tabular-nums ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-700' : 'text-gray-700'}`}>
                    {i + 1}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="text-white font-semibold text-sm">{row.name}</div>
                    <div className="text-gray-600 text-[10px]">{row.symbol}</div>
                  </td>
                  {(mode === 'abs' ? PERIODS : RS_PERIODS).map(p => (
                    <PctCell key={p.key} val={row[p.key]}
                      rank={row[`rank_${p.key === 'chg1m' ? 'chg1m' : p.key === 'chg3m' ? 'chg3m' : p.key === 'chg6m' ? 'chg6m' : p.key === 'chgYTD' ? 'chgYTD' : null}`]}
                      total={n} />
                  ))}
                  <AccelBadge accel={row.accel} />
                  <td className="py-2.5 px-3 text-right">
                    <span className={`text-xs font-semibold tabular-nums ${(row.composite ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(row.composite ?? 0) >= 0 ? '+' : ''}{(row.composite ?? 0).toFixed(2)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Momentum bar chart */}
      {!loading && rows.length > 0 && (
        <div>
          <div className="text-gray-600 text-xs uppercase tracking-widest mb-2">1-Month Performance</div>
          <div className="space-y-1.5">
            {[...rows].sort((a, b) => (b.chg1m ?? -999) - (a.chg1m ?? -999)).map(row => {
              const val  = row.chg1m ?? 0
              const maxAbs = Math.max(...rows.map(r => Math.abs(r.chg1m ?? 0)), 0.1)
              const barW = Math.abs(val) / maxAbs * 100
              return (
                <div key={row.symbol} className="flex items-center gap-2">
                  <span className="text-gray-500 text-xs w-24 shrink-0 truncate">{row.name}</span>
                  <div className="flex-1 flex items-center h-4">
                    {val >= 0 ? (
                      <>
                        <div className="w-1/2 flex justify-end">
                          <div className="h-3 rounded-l-sm bg-emerald-500/30" style={{ width: 0 }} />
                        </div>
                        <div className="w-1/2">
                          <div className="h-3 rounded-r-sm bg-emerald-500" style={{ width: `${barW / 2}%` }} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-1/2 flex justify-end">
                          <div className="h-3 rounded-l-sm bg-red-500" style={{ width: `${barW / 2}%` }} />
                        </div>
                        <div className="w-1/2" />
                      </>
                    )}
                  </div>
                  <span className={`text-xs tabular-nums w-14 text-right font-medium ${val >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {val >= 0 ? '+' : ''}{val.toFixed(2)}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="text-gray-700 text-xs">
        Score = 0.35×1M + 0.30×3M/3 + 0.20×6M/6 + 0.15×YTD · Accel = 1M momentum vs 3M avg · Cached 30 min
      </div>
    </div>
  )
}
