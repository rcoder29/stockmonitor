import { useEffect, useState } from 'react'

const TF_LABELS = ['1D', '1W', '1M', '3M']

function TrendBadge({ trend }) {
  if (!trend) return <span className="text-gray-700">—</span>
  const map = {
    bullish: { cls: 'text-emerald-400', icon: '▲' },
    bearish: { cls: 'text-red-400',     icon: '▼' },
    neutral: { cls: 'text-gray-400',    icon: '◆' },
  }
  const { cls, icon } = map[trend] || map.neutral
  return <span className={`font-bold ${cls}`}>{icon}</span>
}

function RsiPill({ rsi }) {
  if (rsi == null) return <span className="text-gray-700 text-xs">—</span>
  let cls = 'text-gray-300'
  if (rsi >= 70) cls = 'text-red-400'
  else if (rsi <= 30) cls = 'text-emerald-400'
  return <span className={`tabular-nums text-xs ${cls}`}>{rsi.toFixed(0)}</span>
}

function MacdDot({ macd }) {
  if (!macd || macd === 'neutral') return <span className="text-gray-700 text-xs">—</span>
  return (
    <span className={`text-xs font-medium ${macd === 'bullish' ? 'text-emerald-400' : 'text-red-400'}`}>
      {macd === 'bullish' ? '↑' : '↓'}
    </span>
  )
}

function BbPill({ bb }) {
  if (bb == null) return <span className="text-gray-700 text-xs">—</span>
  let cls = 'text-gray-400'
  if (bb >= 80) cls = 'text-red-400'
  else if (bb <= 20) cls = 'text-emerald-400'
  return <span className={`tabular-nums text-xs ${cls}`}>{bb.toFixed(0)}%</span>
}

function SignalCell({ sig }) {
  if (!sig) return <td className="py-3 px-3 text-center text-gray-700 text-xs">N/A</td>
  return (
    <td className="py-3 px-3">
      <div className="flex flex-col items-center gap-0.5">
        <TrendBadge trend={sig.trend} />
        <div className="flex gap-2 mt-0.5">
          <RsiPill rsi={sig.rsi} />
          <MacdDot macd={sig.macd} />
          <BbPill bb={sig.bb_pct} />
        </div>
      </div>
    </td>
  )
}

export default function TechnicalSignals({ symbols }) {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    const syms = [...new Set(symbols)].filter(Boolean)
    if (!syms.length) return
    setLoading(true); setError(null)
    fetch('/api/screener/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: syms }),
    })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setRows)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbols.join(',')])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Multi-timeframe Signals</div>
        <div className="flex gap-4 text-[11px] text-gray-600">
          <span><span className="text-emerald-400">▲</span> Bullish</span>
          <span><span className="text-red-400">▼</span> Bearish</span>
          <span><span className="text-gray-400">◆</span> Neutral</span>
          <span className="text-gray-700">|</span>
          <span>RSI · MACD · BB%</span>
        </div>
      </div>

      {loading && (
        <div className="py-8 text-center text-gray-500 text-sm animate-pulse">Computing signals…</div>
      )}
      {error && (
        <div className="py-8 text-center text-red-400 text-sm">Failed: {error}</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/80">
                <th className="py-2.5 px-4 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Symbol</th>
                {TF_LABELS.map(tf => (
                  <th key={tf} className="py-2.5 px-3 text-center text-gray-500 font-medium text-xs uppercase tracking-wider">{tf}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.symbol} className={`border-b border-gray-800/40 hover:bg-gray-800/20 ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}>
                  <td className="py-3 px-4 text-white font-semibold text-sm">
                    {row.symbol}
                    {row.error && <span className="ml-2 text-gray-600 text-xs font-normal">{row.error}</span>}
                  </td>
                  {TF_LABELS.map(tf => (
                    <SignalCell key={tf} sig={row[tf]} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="py-8 text-center text-gray-600 text-sm">Add symbols to your watchlist to see signals.</div>
      )}

      <div className="text-gray-700 text-xs">RSI = Relative Strength Index · MACD ↑/↓ = direction · BB% = Bollinger Band position · Cached 30 min</div>
    </div>
  )
}
