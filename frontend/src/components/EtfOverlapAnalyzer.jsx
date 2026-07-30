import { useState, useCallback } from 'react'

const PALETTE = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b']

function fmtPct(v) {
  if (v == null) return '—'
  return `${v.toFixed(2)}%`
}

function OverlapBar({ etfSymbols, weights }) {
  return (
    <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
      {etfSymbols.map((sym, i) => {
        const w = weights[sym]
        if (!w) return null
        return (
          <div key={sym} title={`${sym}: ${fmtPct(w)}`}
            className="h-full rounded-full"
            style={{ width: `${Math.min(w * 4, 100)}px`, backgroundColor: PALETTE[i % PALETTE.length], minWidth: 4 }} />
        )
      })}
    </div>
  )
}

function EtfCard({ etf, color }) {
  const holdings = etf.holdings || []
  const totalCovered = holdings.reduce((s, h) => s + h.weight, 0)
  return (
    <div className="bg-slate-800 rounded-xl border p-4 space-y-3" style={{ borderColor: color + '50' }}>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <div>
          <p className="font-bold text-white text-base">{etf.symbol}</p>
          <p className="text-xs text-slate-400 truncate max-w-[200px]">{etf.name}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-slate-400">Top holdings</p>
          <p className="text-sm font-bold text-slate-200">{holdings.length}</p>
        </div>
      </div>
      {holdings.length === 0 ? (
        <p className="text-xs text-red-400">Holdings data unavailable for this ETF</p>
      ) : (
        <div className="space-y-1">
          {holdings.slice(0, 8).map((h, i) => (
            <div key={i} className="flex justify-between items-center text-xs">
              <span className="font-mono font-bold text-slate-200 w-14 shrink-0">{h.symbol}</span>
              <div className="flex-1 mx-2 bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <div className="h-1.5 rounded-full" style={{ width: `${Math.min(h.weight / (holdings[0]?.weight || 1) * 100, 100)}%`, backgroundColor: color }} />
              </div>
              <span className="tabular-nums text-slate-400">{fmtPct(h.weight)}</span>
            </div>
          ))}
          {holdings.length > 8 && (
            <p className="text-xs text-slate-500">+ {holdings.length - 8} more ({fmtPct(100 - totalCovered)} unshown)</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function EtfOverlapAnalyzer() {
  const [input,   setInput]   = useState('')
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const run = useCallback(async (raw) => {
    const tickers = raw.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 4)
    if (tickers.length < 2) { setError('Enter at least 2 ETF tickers'); return }
    setLoading(true); setError(''); setData(null)
    try {
      const res = await fetch(`/api/market/etf-overlap?tickers=${tickers.join(',')}`)
      if (!res.ok) throw new Error((await res.json()).detail || 'Error')
      const json = await res.json()
      if (!json.etfs?.length) throw new Error('No holdings data returned — these may not be ETFs or holdings are unavailable')
      setData(json)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  const PRESETS = [
    { label: 'Big 3 Tech ETFs',   value: 'QQQ, VGT, FTEC' },
    { label: 'Growth vs Value',   value: 'QQQ, VTV' },
    { label: 'S&P + NASDAQ',      value: 'SPY, QQQ' },
    { label: 'Clean Energy',      value: 'ICLN, QCLN, ARKK' },
  ]

  if (!data) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-white">ETF Overlap Analyzer</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Find shared holdings between ETFs to reveal hidden concentration risk when you own multiple funds.
          </p>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">ETF tickers (2–4, comma-separated)</label>
            <input
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white uppercase placeholder-slate-500 focus:outline-none focus:border-blue-500"
              placeholder="QQQ, VGT, ARKK"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run(input)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <button key={p.label} onClick={() => { setInput(p.value); run(p.value) }}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg border border-slate-600">
                {p.label}
              </button>
            ))}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button onClick={() => run(input)} disabled={loading}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
            {loading ? 'Fetching holdings…' : '▶ Analyze Overlap'}
          </button>
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 text-xs text-slate-400 space-y-1">
          <p className="font-bold text-slate-300">How it works</p>
          <p>We fetch the top holdings for each ETF via Yahoo Finance. Holdings data is typically the top 25–50 positions, so overlap between smaller positions may not appear. Cached for 24 hours.</p>
        </div>
      </div>
    )
  }

  const { etfs, overlap, overlapCount } = data
  const etfSymbols = etfs.map(e => e.symbol)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">ETF Overlap: {etfSymbols.join(' + ')}</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {overlapCount} shared holding{overlapCount !== 1 ? 's' : ''} found across top portfolio positions
          </p>
        </div>
        <button onClick={() => { setData(null); setError('') }}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 rounded-lg">
          ← Back
        </button>
      </div>

      {/* ETF cards */}
      <div className={`grid gap-3 ${etfs.length === 2 ? 'sm:grid-cols-2' : etfs.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
        {etfs.map((etf, i) => (
          <EtfCard key={etf.symbol} etf={etf} color={PALETTE[i % PALETTE.length]} />
        ))}
      </div>

      {/* Overlap summary */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">Shared Holdings</h2>
          <span className="text-xs text-slate-400">{overlap.length} shown (sorted by combined weight)</span>
        </div>
        {overlap.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-sm">
            No shared holdings found in the top positions of these ETFs.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/40">
                  <th className="px-4 py-2.5 text-xs text-slate-400 uppercase tracking-wider text-left">Holding</th>
                  {etfSymbols.map((s, i) => (
                    <th key={s} className="px-3 py-2.5 text-xs text-center uppercase tracking-wider font-bold"
                      style={{ color: PALETTE[i % PALETTE.length] }}>{s}</th>
                  ))}
                  <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider text-right">Combined</th>
                  <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider text-left">Exposure</th>
                </tr>
              </thead>
              <tbody>
                {overlap.map((h, i) => {
                  const combined = Object.values(h.weights).reduce((s, w) => s + w, 0)
                  return (
                    <tr key={h.symbol} className={`border-b border-slate-700/40 ${i % 2 ? 'bg-slate-900/15' : ''}`}>
                      <td className="px-4 py-2">
                        <p className="font-bold text-white font-mono">{h.symbol}</p>
                        <p className="text-[10px] text-slate-500 truncate max-w-[140px]">{h.name}</p>
                      </td>
                      {etfSymbols.map((s, ei) => (
                        <td key={s} className="px-3 py-2 text-center tabular-nums text-xs"
                          style={{ color: h.weights[s] ? PALETTE[ei % PALETTE.length] : undefined }}>
                          {h.weights[s] ? fmtPct(h.weights[s]) : <span className="text-slate-700">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-bold text-slate-200 tabular-nums text-xs">
                        {fmtPct(combined)}
                      </td>
                      <td className="px-3 py-2">
                        <OverlapBar etfSymbols={etfSymbols} weights={h.weights} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Key insight */}
      {overlap.length > 0 && (
        <div className="bg-slate-800/60 border border-yellow-800/30 rounded-xl p-4 text-xs">
          <p className="font-bold text-yellow-400 mb-1">⚠ Overlap Insight</p>
          <p className="text-slate-300">
            These ETFs share <strong className="text-white">{overlapCount} common holdings</strong>.
            If you own equal amounts of each ETF, your top overlapping position is{' '}
            <strong className="text-white">{overlap[0]?.symbol}</strong>{' '}
            with combined weight of approximately{' '}
            <strong className="text-yellow-300">{fmtPct(Object.values(overlap[0]?.weights ?? {}).reduce((s, w) => s + w, 0))}</strong> across your ETF exposure.
          </p>
        </div>
      )}

      <p className="text-xs text-slate-600">
        Holdings sourced from Yahoo Finance top holdings (typically top 25–50 positions). Weights may not sum to 100% — remaining positions are in assets not in the top holdings list.
        Data cached 24 hours. ETF holdings change daily; consult fund provider for official current allocations.
      </p>
    </div>
  )
}
