import { useState, useEffect, useCallback } from 'react'

const PERIODS = [
  { value: '1mo', label: '1 Month' },
  { value: '3mo', label: '3 Months' },
  { value: '6mo', label: '6 Months' },
  { value: '1y',  label: '1 Year' },
  { value: '2y',  label: '2 Years' },
]

function corrColor(v) {
  if (v == null) return '#1e293b'
  const a = Math.abs(v)
  if (v >= 0.9)  return '#166534'
  if (v >= 0.7)  return '#15803d'
  if (v >= 0.5)  return '#16a34a'
  if (v >= 0.3)  return '#4ade80'
  if (v >= 0.0)  return '#bbf7d0'
  if (v >= -0.3) return '#fecaca'
  if (v >= -0.5) return '#f87171'
  if (v >= -0.7) return '#ef4444'
  return '#b91c1c'
}

function corrText(v) {
  if (v == null) return 'text-slate-500'
  const a = Math.abs(v)
  if (a >= 0.5) return 'text-white'
  if (a >= 0.3) return 'text-slate-800'
  return 'text-slate-600'
}

function interpLabel(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (v === 1.0)      return 'Same'
  if (a >= 0.9)       return v > 0 ? 'Very High ↑' : 'Very High ↓'
  if (a >= 0.7)       return v > 0 ? 'High ↑'      : 'High ↓'
  if (a >= 0.5)       return v > 0 ? 'Moderate ↑'  : 'Moderate ↓'
  if (a >= 0.3)       return v > 0 ? 'Low ↑'       : 'Low ↓'
  return 'Near Zero'
}

function Tooltip({ symA, symB, val }) {
  if (!symA || !symB) return null
  return (
    <div className="fixed z-50 pointer-events-none bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl"
      style={{ top: '50%', left: '50%', transform: 'translate(-50%, -120%)' }}>
      <p className="font-bold text-white">{symA} / {symB}</p>
      <p className="text-slate-300">Correlation: <span className="font-mono font-bold">{val?.toFixed(4)}</span></p>
      <p className="text-slate-400">{interpLabel(val)}</p>
    </div>
  )
}

export default function CorrelationMatrix({ watchlist = [] }) {
  const [symbols, setSymbols]     = useState('')
  const [period,  setPeriod]      = useState('3mo')
  const [data,    setData]        = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error,   setError]       = useState('')
  const [hovered, setHovered]     = useState(null) // {symA, symB, val}
  const [sortBy,  setSortBy]      = useState('avg') // 'avg' | 'alpha'

  const run = useCallback(async (symsStr, per) => {
    const cleaned = symsStr.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
    if (cleaned.length < 2) { setError('Enter at least 2 symbols'); return }
    setLoading(true); setError(''); setData(null)
    try {
      const res = await fetch(`/api/market/correlation?symbols=${cleaned.join(',')}&period=${per}`)
      if (!res.ok) throw new Error((await res.json()).detail || 'Error')
      const json = await res.json()
      setData(json)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  function importWatchlist() {
    setSymbols(watchlist.join(', '))
  }

  if (!data) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Correlation Matrix</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            See how closely your holdings move together. High correlation = hidden concentration risk.
          </p>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 space-y-4">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              placeholder="AAPL, MSFT, GOOGL, NVDA, JNJ …"
              value={symbols}
              onChange={e => setSymbols(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run(symbols, period)}
            />
            {watchlist.length > 0 && (
              <button onClick={importWatchlist}
                className="px-3 py-2 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600 whitespace-nowrap">
                ⬇ Watchlist
              </button>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${period === p.value ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                {p.label}
              </button>
            ))}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            onClick={() => run(symbols, period)}
            disabled={loading}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition-colors">
            {loading ? 'Computing…' : '▶ Run Correlation'}
          </button>
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
          <p className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Color Scale</p>
          <div className="flex gap-2 items-center flex-wrap text-xs">
            {[[-1.0,'Very Neg'],[-0.5,'Neg'],[-0.3,'Weak Neg'],[0,'Zero'],[0.3,'Weak Pos'],[0.5,'Moderate'],[0.7,'High'],[0.9,'Very High']].map(([v, lbl]) => (
              <div key={v} className="flex items-center gap-1">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: corrColor(v) }} />
                <span className="text-slate-400">{lbl}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const { symbols: syms, matrix } = data

  // Sort symbols by avg absolute correlation (most interconnected first) or alpha
  let displayOrder = syms.map((s, i) => i)
  if (sortBy === 'avg') {
    const avgCorr = syms.map((_, i) => ({
      i,
      avg: syms.reduce((sum, _, j) => sum + (i !== j ? Math.abs(matrix[i][j] ?? 0) : 0), 0) / (syms.length - 1)
    }))
    avgCorr.sort((a, b) => b.avg - a.avg)
    displayOrder = avgCorr.map(x => x.i)
  } else {
    displayOrder = syms.map((_, i) => i).sort((a, b) => syms[a].localeCompare(syms[b]))
  }

  const CELL = Math.max(44, Math.min(64, Math.floor(640 / syms.length)))

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Correlation Matrix</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {syms.length} symbols · {PERIODS.find(p => p.value === period)?.label} of daily returns
            {data.errors?.length > 0 && <span className="text-yellow-400 ml-2">({data.errors.join(', ')} skipped)</span>}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-slate-500">Sort:</span>
          <button onClick={() => setSortBy('avg')}
            className={`px-2 py-1 rounded text-xs ${sortBy === 'avg' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
            By Connectivity
          </button>
          <button onClick={() => setSortBy('alpha')}
            className={`px-2 py-1 rounded text-xs ${sortBy === 'alpha' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
            A–Z
          </button>
          <button onClick={() => { setData(null); setError('') }}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 rounded-lg">
            ← Reset
          </button>
        </div>
      </div>

      {/* Matrix */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 overflow-x-auto">
        <div className="relative">
          {hovered && <Tooltip symA={hovered.symA} symB={hovered.symB} val={hovered.val} />}
          <table className="border-separate border-spacing-0.5">
            <thead>
              <tr>
                <th className="w-14" />
                {displayOrder.map(ci => (
                  <th key={ci} className="text-center" style={{ width: CELL }}>
                    <span className="text-[10px] font-bold text-slate-300 writing-mode-vertical"
                      style={{ display: 'inline-block', maxWidth: CELL - 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {syms[ci]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayOrder.map(ri => (
                <tr key={ri}>
                  <td className="pr-2 text-right text-[10px] font-bold text-slate-300 whitespace-nowrap">{syms[ri]}</td>
                  {displayOrder.map(ci => {
                    const val = matrix[ri][ci]
                    const isDiag = ri === ci
                    return (
                      <td key={ci}
                        style={{ width: CELL, height: CELL, backgroundColor: isDiag ? '#334155' : corrColor(val), cursor: isDiag ? 'default' : 'pointer' }}
                        className="rounded text-center align-middle select-none transition-opacity hover:opacity-80"
                        onMouseEnter={() => !isDiag && setHovered({ symA: syms[ri], symB: syms[ci], val })}
                        onMouseLeave={() => setHovered(null)}>
                        <span className={`text-[10px] font-bold tabular-nums ${isDiag ? 'text-slate-400' : corrText(val)}`}>
                          {isDiag ? '—' : val?.toFixed(2) ?? '?'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Insight cards */}
      <div className="grid sm:grid-cols-3 gap-3">
        {/* Highest correlation pairs */}
        <div className="bg-slate-800 rounded-xl p-4 border border-red-900/30">
          <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">⚠ Highest Correlation</p>
          {(() => {
            const pairs = []
            for (let i = 0; i < syms.length; i++)
              for (let j = i + 1; j < syms.length; j++)
                if (matrix[i][j] != null) pairs.push({ a: syms[i], b: syms[j], v: matrix[i][j] })
            return pairs.sort((a, b) => b.v - a.v).slice(0, 3).map(p => (
              <div key={p.a + p.b} className="flex justify-between items-center py-1 border-b border-slate-700/40 last:border-0">
                <span className="text-xs text-slate-300">{p.a} / {p.b}</span>
                <span className="text-xs font-bold font-mono" style={{ color: corrColor(p.v) }}>{p.v.toFixed(2)}</span>
              </div>
            ))
          })()}
        </div>

        {/* Lowest correlation (best diversifiers) */}
        <div className="bg-slate-800 rounded-xl p-4 border border-emerald-900/30">
          <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">✓ Best Diversifiers</p>
          {(() => {
            const pairs = []
            for (let i = 0; i < syms.length; i++)
              for (let j = i + 1; j < syms.length; j++)
                if (matrix[i][j] != null) pairs.push({ a: syms[i], b: syms[j], v: matrix[i][j] })
            return pairs.sort((a, b) => a.v - b.v).slice(0, 3).map(p => (
              <div key={p.a + p.b} className="flex justify-between items-center py-1 border-b border-slate-700/40 last:border-0">
                <span className="text-xs text-slate-300">{p.a} / {p.b}</span>
                <span className="text-xs font-bold font-mono text-emerald-400">{p.v.toFixed(2)}</span>
              </div>
            ))
          })()}
        </div>

        {/* Most inter-connected symbol */}
        <div className="bg-slate-800 rounded-xl p-4 border border-orange-900/30">
          <p className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-2">★ Avg Correlation by Symbol</p>
          {syms.map((s, i) => {
            const others = syms.filter((_, j) => j !== i)
            const avg = others.reduce((sum, _, j) => {
              const ji = j >= i ? j + 1 : j
              return sum + (matrix[i][ji] ?? 0)
            }, 0) / others.length
            return { s, avg }
          }).sort((a, b) => Math.abs(b.avg) - Math.abs(a.avg)).slice(0, 4).map(({ s, avg }) => (
            <div key={s} className="flex justify-between items-center py-1 border-b border-slate-700/40 last:border-0">
              <span className="text-xs font-bold text-slate-200">{s}</span>
              <span className="text-xs font-mono text-slate-300">{avg.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-600">
        Pearson correlation of daily returns over the selected lookback. Values near 1.0 = move together; near -1.0 = move opposite; near 0 = independent.
        Correlation is not stable — it changes over time and tends to spike toward 1.0 during market crises.
      </p>
    </div>
  )
}
