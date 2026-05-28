import { useEffect, useState } from 'react'

const PERIODS = [
  { id: 'chg1d', label: '1D' },
  { id: 'chg1w', label: '1W' },
  { id: 'chg1m', label: '1M' },
  { id: 'chg3m', label: '3M' },
]

function colorForPct(v) {
  if (v == null) return 'text-gray-500'
  if (v >= 5)   return 'text-emerald-300'
  if (v >= 2)   return 'text-emerald-400'
  if (v >= 0.5) return 'text-emerald-500'
  if (v >= 0)   return 'text-gray-400'
  if (v >= -0.5) return 'text-gray-500'
  if (v >= -2)  return 'text-red-500'
  if (v >= -5)  return 'text-red-400'
  return 'text-red-300'
}

function bgForPct(v) {
  if (v == null) return '#1f2937'
  const abs = Math.min(Math.abs(v) / 5, 1)
  if (v > 0) return `rgba(16,185,129,${0.08 + abs * 0.35})`
  return `rgba(239,68,68,${0.08 + abs * 0.35})`
}

function fmtPct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

export default function SectorDashboard() {
  const [sectors,  setSectors]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [period,   setPeriod]   = useState('chg1d')
  const [view,     setView]     = useState('table')  // 'table' | 'heatmap'

  useEffect(() => {
    setLoading(true)
    fetch('/api/market/sectors')
      .then(r => r.json())
      .then(setSectors)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const sorted = [...sectors].sort((a, b) => (b[period] ?? -999) - (a[period] ?? -999))

  const maxAbs = sectors.reduce((m, s) => Math.max(m, Math.abs(s[period] ?? 0)), 0.01)

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-bold text-lg">Sector Rotation</h2>
          <p className="text-gray-500 text-xs mt-0.5">SPDR Sector ETF performance</p>
        </div>
        <div className="flex gap-2">
          {/* Period selector */}
          <div className="flex rounded overflow-hidden border border-gray-700">
            {PERIODS.map(({ id, label }) => (
              <button key={id} onClick={() => setPeriod(id)}
                className={`px-3 py-1.5 text-xs transition-colors ${period === id ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* View selector */}
          <div className="flex rounded overflow-hidden border border-gray-700">
            {[['table', 'Table'], ['heatmap', 'Heatmap']].map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                className={`px-3 py-1.5 text-xs transition-colors ${view === id ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-64 text-gray-600 text-sm animate-pulse">
          Loading sector data…
        </div>
      )}

      {!loading && view === 'table' && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900">
                <th className="py-3 px-4 text-left text-gray-500 font-medium uppercase tracking-wider text-xs">Sector</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium uppercase tracking-wider text-xs">ETF</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium uppercase tracking-wider text-xs">Price</th>
                {PERIODS.map(({ id, label }) => (
                  <th key={id} onClick={() => setPeriod(id)}
                    className={`py-3 px-4 text-right font-medium uppercase tracking-wider text-xs cursor-pointer transition-colors ${period === id ? 'text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}>
                    {label}
                  </th>
                ))}
                {/* Sparkbar column */}
                <th className="py-3 px-4 text-right text-gray-500 font-medium uppercase tracking-wider text-xs w-32">Relative</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => {
                const v = s[period]
                const barW = v != null ? Math.abs(v) / maxAbs * 100 : 0
                return (
                  <tr key={s.symbol} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                    <td className="py-3 px-4">
                      <span className="text-white font-medium">{s.name}</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-gray-400 text-xs font-mono bg-gray-800/60 px-1.5 py-0.5 rounded">{s.symbol}</span>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-300 tabular-nums font-medium">
                      {s.price != null ? `$${s.price.toFixed(2)}` : '—'}
                    </td>
                    {PERIODS.map(({ id }) => (
                      <td key={id} className={`py-3 px-4 text-right tabular-nums font-medium ${period === id ? colorForPct(s[id]) : colorForPct(s[id])}`}>
                        {fmtPct(s[id])}
                      </td>
                    ))}
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-24 h-3 bg-gray-800 rounded overflow-hidden flex items-center">
                          <div
                            className={`h-full rounded transition-all ${(v ?? 0) >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                            style={{ width: `${barW}%`, marginLeft: (v ?? 0) >= 0 ? 0 : 'auto' }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && view === 'heatmap' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {sorted.map(s => {
            const v = s[period]
            return (
              <div
                key={s.symbol}
                className="rounded-xl p-4 border border-gray-700/40 transition-colors"
                style={{ background: bgForPct(v) }}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="text-gray-300 text-xs font-mono">{s.symbol}</span>
                  <span className={`text-xs font-bold tabular-nums ${colorForPct(v)}`}>{fmtPct(v)}</span>
                </div>
                <div className="text-white font-semibold text-sm leading-tight">{s.name}</div>
                {s.price != null && (
                  <div className="text-gray-500 text-xs mt-1 tabular-nums">${s.price.toFixed(2)}</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* All-period summary */}
      {!loading && sectors.length > 0 && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-500 text-xs uppercase tracking-widest mb-3">Performance Summary</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {PERIODS.map(({ id, label }) => {
              const best  = [...sectors].sort((a, b) => (b[id] ?? -999) - (a[id] ?? -999))[0]
              const worst = [...sectors].sort((a, b) => (a[id] ?? 999) - (b[id] ?? 999))[0]
              return (
                <div key={id} className="space-y-1">
                  <div className="text-gray-600 text-xs uppercase tracking-wider">{label}</div>
                  <div className="text-xs">
                    <span className="text-emerald-400 font-medium">{best?.name?.split(' ')[0]} </span>
                    <span className="text-emerald-500 tabular-nums">{fmtPct(best?.[id])}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-red-400 font-medium">{worst?.name?.split(' ')[0]} </span>
                    <span className="text-red-500 tabular-nums">{fmtPct(worst?.[id])}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
