import { useState, useCallback } from 'react'

const MONTH_SHORT = ['J','F','M','A','M','J','J','A','S','O','N','D']

function returnColor(v) {
  if (v == null) return '#334155'
  if (v >= 4)   return '#166534'
  if (v >= 2)   return '#16a34a'
  if (v >= 0.5) return '#4ade80'
  if (v >= 0)   return '#86efac'
  if (v >= -1)  return '#fca5a5'
  if (v >= -2)  return '#f87171'
  if (v >= -4)  return '#ef4444'
  return '#b91c1c'
}

function winRateColor(v) {
  if (v >= 75) return 'text-emerald-400'
  if (v >= 60) return 'text-green-400'
  if (v >= 50) return 'text-yellow-400'
  if (v >= 40) return 'text-orange-400'
  return 'text-red-400'
}

function BarChart({ months }) {
  const maxAbs = Math.max(...months.filter(m => m.avgReturn != null).map(m => Math.abs(m.avgReturn)), 1)
  const BAR_H = 100
  const CELL_W = 46

  return (
    <svg width={CELL_W * 12} height={BAR_H * 2 + 28} className="overflow-visible">
      {/* Zero line */}
      <line x1={0} y1={BAR_H} x2={CELL_W * 12} y2={BAR_H} stroke="#475569" strokeWidth={1} />

      {months.map((m, i) => {
        if (m.avgReturn == null) return null
        const pct = m.avgReturn
        const barH = Math.abs(pct) / maxAbs * (BAR_H - 8)
        const isPos = pct >= 0
        const x = i * CELL_W + CELL_W * 0.1
        const bw = CELL_W * 0.8
        const y = isPos ? BAR_H - barH : BAR_H

        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={Math.max(barH, 2)} fill={returnColor(pct)} rx={2} />
            <text x={x + bw / 2} y={isPos ? y - 3 : y + barH + 11}
              textAnchor="middle" fontSize={9} fill="#94a3b8" fontFamily="monospace">
              {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
            </text>
            <text x={x + bw / 2} y={BAR_H * 2 + 14}
              textAnchor="middle" fontSize={10} fill="#cbd5e1" fontFamily="sans-serif">
              {m.name.slice(0, 3)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function BoxPlot({ returns, avgReturn }) {
  if (!returns || returns.length < 3) return null
  const sorted = [...returns].sort((a, b) => a - b)
  const n = sorted.length
  const q1  = sorted[Math.floor(n * 0.25)]
  const med = sorted[Math.floor(n * 0.5)]
  const q3  = sorted[Math.floor(n * 0.75)]
  const min = sorted[0]
  const max = sorted[n - 1]
  const range = max - min || 1

  const scale = (v) => ((v - min) / range) * 160 + 10

  return (
    <svg width={180} height={20} className="overflow-visible">
      <line x1={scale(min)} y1={10} x2={scale(max)} y2={10} stroke="#475569" strokeWidth={1.5} />
      <rect x={scale(q1)} y={4} width={scale(q3) - scale(q1)} height={12} fill="#334155" stroke="#64748b" strokeWidth={1} rx={1} />
      <line x1={scale(med)} y1={3} x2={scale(med)} y2={17} stroke="#60a5fa" strokeWidth={2} />
      {avgReturn != null && (
        <circle cx={scale(avgReturn)} cy={10} r={3} fill="#f59e0b" />
      )}
    </svg>
  )
}

export default function SeasonalPatterns() {
  const [symbol,  setSymbol]  = useState('')
  const [years,   setYears]   = useState(10)
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [view,    setView]    = useState('chart') // 'chart' | 'table'

  const run = useCallback(async (sym, yrs) => {
    const s = sym.trim().toUpperCase()
    if (!s) { setError('Enter a symbol'); return }
    setLoading(true); setError(''); setData(null)
    try {
      const res = await fetch(`/api/market/seasonal?symbol=${s}&years=${yrs}`)
      if (!res.ok) throw new Error((await res.json()).detail || 'Error')
      setData(await res.json())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  const currentMonth = new Date().getMonth() + 1

  if (!data) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Seasonal Patterns</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Month-by-month historical return tendencies averaged over up to 10 years.
          </p>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 space-y-4">
          <div className="flex gap-2">
            <input
              className="w-36 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white uppercase placeholder-slate-500 focus:outline-none focus:border-blue-500"
              placeholder="AAPL"
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && run(symbol, years)}
            />
            <select value={years} onChange={e => setYears(Number(e.target.value))}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
              {[5, 7, 10, 15, 20].map(y => <option key={y} value={y}>{y} Years</option>)}
            </select>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-2 flex-wrap">
            {['AAPL','MSFT','NVDA','SPY','QQQ','TSLA','AMZN','GLD'].map(s => (
              <button key={s} onClick={() => { setSymbol(s); run(s, years) }}
                className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg border border-slate-600">
                {s}
              </button>
            ))}
          </div>

          <button onClick={() => run(symbol, years)} disabled={loading}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
            {loading ? 'Loading…' : '▶ Analyze'}
          </button>
        </div>
      </div>
    )
  }

  const { months, bestMonth, worstMonth, name, yearsOfData } = data
  const validMonths = months.filter(m => m.avgReturn != null)
  const avgAllMonths = validMonths.reduce((s, m) => s + m.avgReturn, 0) / (validMonths.length || 1)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Seasonal Patterns — {data.symbol}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{name} · {yearsOfData} years of data</p>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={() => setView('chart')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${view === 'chart' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
            Chart
          </button>
          <button onClick={() => setView('table')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${view === 'table' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
            Table
          </button>
          <button onClick={() => { setData(null); setSymbol('') }}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 rounded-lg">
            ← Back
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-emerald-900/20 rounded-xl p-3 border border-emerald-800/30">
          <p className="text-xs text-slate-400">Best Month</p>
          <p className="text-lg font-bold text-emerald-400">{months[bestMonth - 1]?.name}</p>
          <p className="text-xs text-slate-400">avg {months[bestMonth - 1]?.avgReturn?.toFixed(1)}%</p>
        </div>
        <div className="bg-red-900/20 rounded-xl p-3 border border-red-800/30">
          <p className="text-xs text-slate-400">Worst Month</p>
          <p className="text-lg font-bold text-red-400">{months[worstMonth - 1]?.name}</p>
          <p className="text-xs text-slate-400">avg {months[worstMonth - 1]?.avgReturn?.toFixed(1)}%</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
          <p className="text-xs text-slate-400">Positive Months</p>
          <p className="text-lg font-bold text-white">{validMonths.filter(m => m.avgReturn > 0).length}/12</p>
          <p className="text-xs text-slate-400">avg positive</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
          <p className="text-xs text-slate-400">Current Month</p>
          <p className={`text-lg font-bold ${(months[currentMonth - 1]?.avgReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {months[currentMonth - 1]?.name}
          </p>
          <p className="text-xs text-slate-400">hist avg {months[currentMonth - 1]?.avgReturn?.toFixed(1) ?? '—'}%</p>
        </div>
      </div>

      {view === 'chart' && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 overflow-x-auto">
          <BarChart months={months} />
        </div>
      )}

      {view === 'table' && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/60">
                {['Month', 'Avg Return', 'Win Rate', 'Best Year', 'Worst Year', 'Distribution', 'Years'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                const isCurrent = m.month === currentMonth
                return (
                  <tr key={i}
                    className={`border-b border-slate-700/40 ${isCurrent ? 'bg-blue-900/20' : i % 2 ? 'bg-slate-900/15' : ''}`}>
                    <td className="px-3 py-2 font-bold text-slate-200">
                      {m.name}{isCurrent && <span className="ml-1 text-[10px] text-blue-400">← now</span>}
                    </td>
                    <td className={`px-3 py-2 font-bold tabular-nums ${m.avgReturn == null ? 'text-slate-600' : m.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {m.avgReturn == null ? '—' : `${m.avgReturn > 0 ? '+' : ''}${m.avgReturn.toFixed(2)}%`}
                    </td>
                    <td className={`px-3 py-2 font-bold tabular-nums ${winRateColor(m.winRate)}`}>
                      {m.winRate == null ? '—' : `${m.winRate}%`}
                    </td>
                    <td className="px-3 py-2 text-emerald-400 tabular-nums text-xs">
                      {m.best == null ? '—' : `+${m.best.toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-2 text-red-400 tabular-nums text-xs">
                      {m.worst == null ? '—' : `${m.worst.toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-2">
                      <BoxPlot returns={m.returns} avgReturn={m.avgReturn} />
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{m.years}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-slate-500">
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-blue-400" /> Median</div>
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-yellow-400" /> Average</div>
        <span>Box = 25th–75th percentile of monthly returns. Whiskers = full range.</span>
      </div>

      <p className="text-xs text-slate-600">
        Each month's return is computed as close-of-first-trading-day to close-of-last-trading-day.
        Seasonal patterns are tendencies, not guarantees — market conditions override historical norms regularly.
      </p>
    </div>
  )
}
