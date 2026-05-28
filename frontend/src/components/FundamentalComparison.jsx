import { useState } from 'react'

const NEUTRAL = new Set(['Price', 'Market Cap', '52W High', '52W Low', 'Beta', 'Dividend Yield'])
const LOWER_BETTER = new Set(['P/E (Trailing)', 'P/E (Forward)', 'P/S', 'P/B', 'EV/EBITDA', 'Debt/Equity', 'Short % Float'])

const SYMBOL_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6', '#ec4899']

function cellBg(sym, metric, best, worst) {
  if (NEUTRAL.has(metric) || (!best && !worst)) return ''
  if (sym === best)  return 'bg-emerald-900/30'
  if (sym === worst) return 'bg-red-900/20'
  return ''
}

function cellColor(sym, metric, best, worst) {
  if (NEUTRAL.has(metric) || (!best && !worst)) return 'text-gray-300'
  if (sym === best)  return 'text-emerald-400 font-semibold'
  if (sym === worst) return 'text-red-400'
  return 'text-gray-300'
}

function formatVal(val, label) {
  if (val == null) return '—'
  try {
    if (label === 'Market Cap')      return `$${(val / 1e9).toFixed(1)}B`
    if (label === 'Price' || label === '52W High' || label === '52W Low') return `$${val.toFixed(2)}`
    if (['Rev Growth (YoY)', 'Gross Margin', 'Op Margin', 'Net Margin', 'ROE', 'ROA', 'Short % Float', 'Insider Own%', 'Dividend Yield'].includes(label))
      return `${(val * 100).toFixed(1)}%`
    return `${val.toFixed(2)}x`
  } catch {
    return String(val)
  }
}

export default function FundamentalComparison() {
  const [input,   setInput]   = useState('')
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  async function compare() {
    const syms = input.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 5)
    if (!syms.length) return
    setLoading(true); setError(null); setData(null)
    try {
      const res = await fetch(`/api/compare/fundamentals?symbols=${syms.join(',')}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const metaMap = data ? Object.fromEntries((data.metrics || []).map(m => [m.label, m])) : {}

  return (
    <div className="space-y-5">
      <div className="text-gray-500 text-xs uppercase tracking-widest">Fundamental Comparison</div>

      {/* Input */}
      <div className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <label className="text-gray-600 text-xs block mb-1">Symbols (up to 5, comma or space separated)</label>
          <input
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && compare()}
            placeholder="AAPL MSFT GOOGL AMZN NVDA"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-600 font-mono"
          />
        </div>
        <button onClick={compare} disabled={loading || !input.trim()}
          className="px-5 py-2 rounded-lg text-sm font-medium bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 transition-colors">
          {loading ? 'Loading…' : 'Compare'}
        </button>
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      {data && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/90 sticky top-0">
                <th className="py-3 px-4 text-left text-gray-500 font-medium text-xs uppercase tracking-wider w-36">Metric</th>
                {data.symbols.map((sym, i) => (
                  <th key={sym} className="py-3 px-4 text-right min-w-[110px]">
                    <div className="font-bold text-sm" style={{ color: SYMBOL_COLORS[i] }}>{sym}</div>
                    <div className="text-gray-600 text-[10px] font-normal truncate max-w-[100px] ml-auto">
                      {data.rows.find(r => r.symbol === sym)?.name ?? ''}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.metrics || []).map((m, mi) => (
                <tr key={m.label} className={`border-b border-gray-800/40 hover:bg-gray-800/20 ${mi % 2 ? 'bg-gray-900/20' : ''}`}>
                  <td className="py-2.5 px-4 text-gray-500 text-xs font-medium">{m.label}</td>
                  {data.symbols.map(sym => {
                    const row = data.rows.find(r => r.symbol === sym)
                    const val = row?.[m.label]
                    const bg  = cellBg(sym, m.label, m.best, m.worst)
                    const col = cellColor(sym, m.label, m.best, m.worst)
                    return (
                      <td key={sym} className={`py-2.5 px-4 text-right tabular-nums ${bg} ${col}`}>
                        {val != null ? formatVal(val, m.label) : <span className="text-gray-700">—</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="flex gap-4 text-[11px] text-gray-600 flex-wrap">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-900/50 inline-block" />Best in class</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-900/30 inline-block" />Worst in class</span>
          <span>·</span>
          <span>Lower is better for: P/E, P/S, P/B, EV/EBITDA, Debt/Equity, Short%</span>
        </div>
      )}

      {!data && !loading && (
        <div className="py-10 text-center text-gray-700 text-sm">Enter up to 5 symbols to compare fundamentals.</div>
      )}

      <div className="text-gray-700 text-xs">Data from Yahoo Finance · Cached 2hr per symbol</div>
    </div>
  )
}
