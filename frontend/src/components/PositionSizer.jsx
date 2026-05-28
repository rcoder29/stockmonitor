import { useState } from 'react'

const METHOD_COLORS = {
  'Fixed Fractional': 'text-sky-400',
  'ATR-based (14)':   'text-violet-400',
  'Half-Kelly':       'text-amber-400',
}

export default function PositionSizer() {
  const [symbol,      setSymbol]      = useState('')
  const [accountSize, setAccountSize] = useState(100000)
  const [riskPct,     setRiskPct]     = useState(1.0)
  const [entry,       setEntry]       = useState('')
  const [stop,        setStop]        = useState('')

  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  async function calculate(e) {
    e.preventDefault()
    if (!symbol || !entry || !stop) return
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/position-sizing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol:       symbol.toUpperCase().trim(),
          account_size: Number(accountSize),
          risk_pct:     Number(riskPct),
          entry_price:  Number(entry),
          stop_price:   Number(stop),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      setResult(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const riskDir = result && Number(entry) > Number(stop) ? 'long' : result ? 'short' : null

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="text-gray-500 text-xs uppercase tracking-widest">Position Sizing Calculator</div>

      <form onSubmit={calculate} className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="text-gray-500 text-xs block mb-1">Symbol</label>
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-600"
            />
          </div>
          <div>
            <label className="text-gray-500 text-xs block mb-1">Account Size ($)</label>
            <input
              type="number"
              value={accountSize}
              onChange={e => setAccountSize(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-600"
            />
          </div>
          <div>
            <label className="text-gray-500 text-xs block mb-1">Risk Per Trade (%)</label>
            <input
              type="number"
              step="0.25"
              min="0.1"
              max="10"
              value={riskPct}
              onChange={e => setRiskPct(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-600"
            />
          </div>
          <div>
            <label className="text-gray-500 text-xs block mb-1">Entry Price ($)</label>
            <input
              type="number"
              step="0.01"
              value={entry}
              onChange={e => setEntry(e.target.value)}
              placeholder="150.00"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-600"
            />
          </div>
          <div>
            <label className="text-gray-500 text-xs block mb-1">Stop Price ($)</label>
            <input
              type="number"
              step="0.01"
              value={stop}
              onChange={e => setStop(e.target.value)}
              placeholder="145.00"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-600"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading || !symbol || !entry || !stop}
              className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 transition-colors"
            >
              {loading ? 'Calculating…' : 'Calculate'}
            </button>
          </div>
        </div>
      </form>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      {result && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-gray-600 text-xs mb-0.5">Symbol</div>
              <div className="text-white font-semibold">{result.symbol} ({riskDir})</div>
            </div>
            <div>
              <div className="text-gray-600 text-xs mb-0.5">Risk Amount</div>
              <div className="text-amber-400 font-semibold">${result.risk_amount?.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-600 text-xs mb-0.5">Risk / Share</div>
              <div className="text-white font-semibold">${result.risk_per_share?.toFixed(2)}</div>
            </div>
            {result.atr != null && (
              <div>
                <div className="text-gray-600 text-xs mb-0.5">ATR (14d)</div>
                <div className="text-violet-400 font-semibold">${result.atr?.toFixed(2)}</div>
              </div>
            )}
          </div>

          {/* Methods table */}
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/80">
                  {['Method', 'Shares', 'Dollar Amount', '% of Account', 'Note'].map((h, i) => (
                    <th key={h} className={`py-2.5 px-4 text-gray-500 font-medium text-xs uppercase tracking-wider ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.methods.map((m, i) => (
                  <tr key={i} className={`border-b border-gray-800/40 hover:bg-gray-800/20 ${i % 2 ? 'bg-gray-900/20' : ''}`}>
                    <td className={`py-3 px-4 font-semibold ${METHOD_COLORS[m.method] ?? 'text-white'}`}>{m.method}</td>
                    <td className="py-3 px-4 text-right text-white tabular-nums font-semibold">{m.shares?.toLocaleString(undefined, {maximumFractionDigits: 1})}</td>
                    <td className="py-3 px-4 text-right text-gray-300 tabular-nums">${m.dollars?.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-gray-400 tabular-nums">{m.acct_pct?.toFixed(1)}%</td>
                    <td className="py-3 px-4 text-right text-gray-600 text-xs">{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-gray-700 text-xs">
            Fixed Fractional: risk$ ÷ (entry − stop) · ATR-based: risk$ ÷ ATR14 · Half-Kelly: ½ × Kelly% of account · Not investment advice
          </div>
        </div>
      )}
    </div>
  )
}
