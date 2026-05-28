import { useEffect, useState } from 'react'

function KpiCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/40 rounded-xl p-4">
      <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-bold text-xl tabular-nums ${color}`}>{value ?? '—'}</div>
      {sub && <div className="text-gray-600 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

function CorrHeatmap({ corr, symbols }) {
  if (!symbols.length) return null
  const n = symbols.length

  function bg(v) {
    if (v === null || v === undefined) return '#1f2937'
    if (v >= 0.8)  return '#166534'
    if (v >= 0.5)  return '#14532d'
    if (v >= 0.2)  return '#1e3a2f'
    if (v >= -0.2) return '#1f2937'
    if (v >= -0.5) return '#3b1a1a'
    return '#7f1d1d'
  }

  function textColor(v) {
    if (v === null || v === undefined) return 'text-gray-700'
    if (Math.abs(v) > 0.5) return 'text-white'
    return 'text-gray-400'
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] border-collapse">
        <thead>
          <tr>
            <th className="w-12" />
            {symbols.map(s => (
              <th key={s} className="px-1 py-0.5 text-gray-500 font-medium text-center w-14">{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map(row => (
            <tr key={row}>
              <td className="pr-2 text-gray-500 font-medium text-right">{row}</td>
              {symbols.map(col => {
                const v = corr[row]?.[col]
                return (
                  <td key={col}
                    className={`text-center tabular-nums w-14 h-8 rounded-sm ${textColor(v)}`}
                    style={{ backgroundColor: bg(v) }}>
                    {v != null ? v.toFixed(2) : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PortfolioRisk() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch('/api/portfolio/risk')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (d.error) throw new Error(d.error); setData(d) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="py-16 text-center text-gray-500 text-sm animate-pulse">Computing risk metrics…</div>
  if (error)   return <div className="py-16 text-center text-red-400 text-sm">Failed: {error}</div>
  if (!data)   return null

  const ddColor  = data.max_drawdown_pct < -20 ? 'text-red-400' : data.max_drawdown_pct < -10 ? 'text-amber-400' : 'text-emerald-400'
  const betaColor = Math.abs(data.portfolio_beta ?? 1) > 1.3 ? 'text-amber-400' : 'text-white'

  const corrSymbols = Object.keys(data.correlation || {})

  return (
    <div className="space-y-6">
      <div className="text-gray-500 text-xs uppercase tracking-widest">Portfolio Risk Metrics</div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard label="Portfolio Beta"     value={data.portfolio_beta ?? '—'}  color={betaColor} />
        <KpiCard label="Sharpe Ratio"       value={data.sharpe ?? '—'}           color={data.sharpe > 1 ? 'text-emerald-400' : 'text-amber-400'} sub="annualised, rf=0" />
        <KpiCard label="Sortino Ratio"      value={data.sortino ?? '—'}          color={data.sortino > 1 ? 'text-emerald-400' : 'text-amber-400'} sub="downside vol" />
        <KpiCard label="Max Drawdown"       value={`${data.max_drawdown_pct}%`}  color={ddColor} />
        <KpiCard label="VaR 95% (1d)"       value={`$${data.var95?.toLocaleString()}`} color="text-amber-400" sub="historical" />
        <KpiCard label="VaR 99% (1d)"       value={`$${data.var99?.toLocaleString()}`} color="text-red-400"   sub="historical" />
        <KpiCard label="Portfolio Value"    value={`$${data.total_value?.toLocaleString()}`} />
      </div>

      {/* Holdings beta table */}
      <div>
        <div className="text-gray-500 text-xs uppercase tracking-widest mb-3">Beta-Adjusted Exposure</div>
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/80">
                {['Symbol', 'Shares', 'Price', 'Market Value', 'Weight', 'Beta', 'Beta-Adj Exp'].map((h, i) => (
                  <th key={h} className={`py-2.5 px-4 text-gray-500 font-medium text-xs uppercase tracking-wider ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h, i) => (
                <tr key={h.symbol} className={`border-b border-gray-800/40 hover:bg-gray-800/20 ${i % 2 ? 'bg-gray-900/20' : ''}`}>
                  <td className="py-2.5 px-4 text-white font-semibold">{h.symbol}</td>
                  <td className="py-2.5 px-4 text-right text-gray-400 tabular-nums">{h.shares}</td>
                  <td className="py-2.5 px-4 text-right text-gray-300 tabular-nums">${h.price?.toFixed(2)}</td>
                  <td className="py-2.5 px-4 text-right text-gray-300 tabular-nums">${h.mkt_val?.toLocaleString()}</td>
                  <td className="py-2.5 px-4 text-right text-gray-400 tabular-nums">{h.weight}%</td>
                  <td className={`py-2.5 px-4 text-right tabular-nums font-medium ${h.beta > 1.5 ? 'text-red-400' : h.beta > 1.1 ? 'text-amber-400' : 'text-gray-300'}`}>
                    {h.beta ?? '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right text-gray-400 tabular-nums">{h.beta_adj_exp ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Correlation heatmap */}
      {corrSymbols.length > 1 && (
        <div>
          <div className="text-gray-500 text-xs uppercase tracking-widest mb-3">1Y Return Correlation</div>
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 inline-block">
            <CorrHeatmap corr={data.correlation} symbols={corrSymbols} />
            <div className="flex gap-4 mt-3 text-[10px] text-gray-600">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{background:'#166534'}} /> High positive</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{background:'#1f2937'}} /> Low</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{background:'#7f1d1d'}} /> Negative</span>
            </div>
          </div>
        </div>
      )}

      <div className="text-gray-700 text-xs">Beta vs SPY · VaR historical simulation · Cached 30 min · Not investment advice</div>
    </div>
  )
}
