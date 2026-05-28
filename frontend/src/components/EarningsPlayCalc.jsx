import { useEffect, useState } from 'react'

function fmtPct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

export default function EarningsPlayCalc({ symbol, currentPrice }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/earnings/play/${symbol}`)
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return <div className="py-10 text-center text-gray-500 text-sm animate-pulse">Loading earnings play data…</div>
  if (error)   return <div className="py-10 text-center text-red-400 text-sm">Failed: {error}</div>
  if (!data)   return null
  if (data.error) return <div className="py-10 text-center text-gray-600 text-sm">{data.error}</div>

  const price = currentPrice ?? data.price
  const upTarget   = price && data.expected_move_pct ? price * (1 + data.expected_move_pct / 100) : null
  const downTarget = price && data.expected_move_pct ? price * (1 - data.expected_move_pct / 100) : null

  return (
    <div className="space-y-5 mb-6">
      <div className="text-gray-500 text-xs uppercase tracking-widest">Earnings Play Calculator</div>

      {/* Key metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-800/60 border border-gray-700/40 rounded-xl p-4">
          <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Next Earnings</div>
          <div className="text-white font-semibold text-sm">{data.next_earnings ?? '—'}</div>
        </div>
        <div className="bg-amber-900/20 border border-amber-700/30 rounded-xl p-4">
          <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Expected Move (±)</div>
          <div className="text-amber-400 font-bold text-xl tabular-nums">
            {data.expected_move_pct != null ? `±${data.expected_move_pct.toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-4">
          <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Up Target</div>
          <div className="text-emerald-400 font-bold text-xl tabular-nums">
            {upTarget != null ? `$${upTarget.toFixed(2)}` : '—'}
          </div>
        </div>
        <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-4">
          <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Down Target</div>
          <div className="text-red-400 font-bold text-xl tabular-nums">
            {downTarget != null ? `$${downTarget.toFixed(2)}` : '—'}
          </div>
        </div>
      </div>

      {/* Straddle breakdown */}
      {data.straddle_cost != null && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-500 text-xs uppercase tracking-widest mb-3">ATM Straddle — {data.expiry}</div>
          <div className="flex flex-wrap gap-6 items-center">
            <div>
              <div className="text-gray-600 text-xs">Strike</div>
              <div className="text-white font-semibold tabular-nums">${data.straddle_strike?.toFixed(2) ?? '—'}</div>
            </div>
            <div>
              <div className="text-gray-600 text-xs">Call</div>
              <div className="text-emerald-400 font-semibold tabular-nums">${data.straddle_call?.toFixed(2) ?? '—'}</div>
            </div>
            <div className="text-gray-700 text-lg">+</div>
            <div>
              <div className="text-gray-600 text-xs">Put</div>
              <div className="text-red-400 font-semibold tabular-nums">${data.straddle_put?.toFixed(2) ?? '—'}</div>
            </div>
            <div className="text-gray-700 text-lg">=</div>
            <div>
              <div className="text-gray-600 text-xs">Straddle Cost</div>
              <div className="text-amber-400 font-bold text-lg tabular-nums">${data.straddle_cost?.toFixed(2) ?? '—'}</div>
            </div>
            {price && data.straddle_cost && (
              <div className="ml-auto text-gray-500 text-xs">
                = {((data.straddle_cost / price) * 100).toFixed(1)}% of stock price · breakeven: ${(price - data.straddle_cost).toFixed(2)} — ${(price + data.straddle_cost).toFixed(2)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Historical EPS surprise */}
      {data.history?.length > 0 && (
        <div>
          <div className="text-gray-500 text-xs uppercase tracking-widest mb-3">Historical EPS Surprise</div>
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900">
                  {['Date', 'EPS Est', 'EPS Actual', 'Surprise %'].map((h, i) => (
                    <th key={h} className={`py-2.5 px-4 text-gray-500 font-medium uppercase tracking-wider ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.history.map((row, i) => {
                  const beat = (row.surprisePct ?? 0) >= 0
                  return (
                    <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                      <td className="py-2.5 px-4 text-gray-400">{row.date}</td>
                      <td className="py-2.5 px-4 text-right text-gray-500 tabular-nums">
                        {row.epsEstimate != null ? `$${row.epsEstimate.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right text-white font-semibold tabular-nums">
                        {row.epsActual != null ? `$${row.epsActual.toFixed(2)}` : '—'}
                      </td>
                      <td className={`py-2.5 px-4 text-right tabular-nums font-medium ${beat ? 'text-emerald-400' : 'text-red-400'}`}>
                        {row.surprisePct != null ? (
                          <span className={`px-1.5 py-0.5 rounded text-[11px] ${beat ? 'bg-emerald-900/40' : 'bg-red-900/40'}`}>
                            {beat ? '+' : ''}{row.surprisePct.toFixed(1)}%
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-gray-700 text-xs">Expected move derived from ATM straddle price · Cached 4 hours · Not investment advice</div>
    </div>
  )
}
