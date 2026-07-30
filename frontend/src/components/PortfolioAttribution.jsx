import { useState, useEffect, useMemo } from 'react'

function fmtDollar(v) {
  if (v == null || isNaN(v)) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : v > 0 ? '+' : ''
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(v, sign = true) {
  if (v == null || isNaN(v)) return '—'
  const s = sign && v > 0 ? '+' : ''
  return `${s}${v.toFixed(2)}%`
}

function pnlColor(v) {
  if (v > 0) return 'text-emerald-400'
  if (v < 0) return 'text-red-400'
  return 'text-slate-400'
}

function ContribBar({ contrib, maxAbs }) {
  const w = Math.abs(contrib) / (maxAbs || 1) * 100
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-32 h-3 bg-slate-700 rounded-full overflow-hidden relative">
        <div className="absolute inset-y-0 left-1/2 w-px bg-slate-500" />
        <div className={`absolute inset-y-0 rounded-full ${contrib >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
          style={contrib >= 0
            ? { left: '50%', width: `${w / 2}%` }
            : { right: '50%', width: `${w / 2}%` }} />
      </div>
      <span className={`text-xs tabular-nums font-bold ${pnlColor(contrib)}`}>
        {fmtPct(contrib)}
      </span>
    </div>
  )
}

function WaterfallBar({ positions, totalPnlPct }) {
  const sorted = [...positions].sort((a, b) => b.contribPct - a.contribPct)
  const barH = 28
  const gap = 4
  const H = sorted.length * (barH + gap)
  const maxAbs = Math.max(...positions.map(p => Math.abs(p.contribPct)), 0.5)
  const midX = 180

  return (
    <svg width="100%" height={H + 10} viewBox={`0 0 400 ${H + 10}`} className="overflow-visible">
      <line x1={midX} y1={0} x2={midX} y2={H} stroke="#475569" strokeWidth={1} />
      {sorted.map((p, i) => {
        const y = i * (barH + gap)
        const w = Math.abs(p.contribPct) / maxAbs * 160
        const isPos = p.contribPct >= 0
        return (
          <g key={p.symbol}>
            <text x={midX - 6} y={y + barH / 2 + 4} textAnchor="end" fontSize={11} fill="#e2e8f0" fontFamily="monospace" fontWeight="bold">
              {p.symbol}
            </text>
            <rect
              x={isPos ? midX + 2 : midX - w - 2}
              y={y + 2}
              width={w}
              height={barH - 4}
              fill={isPos ? '#22c55e' : '#ef4444'}
              rx={3}
            />
            <text
              x={isPos ? midX + w + 6 : midX - w - 6}
              y={y + barH / 2 + 4}
              textAnchor={isPos ? 'start' : 'end'}
              fontSize={10}
              fill={isPos ? '#4ade80' : '#f87171'}
              fontFamily="monospace"
            >
              {fmtDollar(p.pnl)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export default function PortfolioAttribution() {
  const [portfolio, setPortfolio] = useState([])
  const [quoteData, setQuoteData] = useState({})
  const [loading,   setLoading]   = useState(true)
  const [view,      setView]      = useState('table')   // 'table' | 'waterfall' | 'sector'
  const [sortCol,   setSortCol]   = useState('contribPct')
  const [sortAsc,   setSortAsc]   = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const port = await fetch('/api/portfolio').then(r => r.json())
        const positions = Array.isArray(port) ? port : []
        setPortfolio(positions)
        if (positions.length) {
          const syms = [...new Set(positions.map(p => p.symbol))].join(',')
          const quotes = await fetch(`/api/quotes?symbols=${syms}`).then(r => r.json())
          const map = {}
          quotes.forEach(q => { map[q.symbol] = q })
          setQuoteData(map)
        }
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const positions = useMemo(() => {
    const totalCost = portfolio.reduce((s, p) => s + p.shares * p.avgCost, 0)
    return portfolio
      .map(p => {
        const q        = quoteData[p.symbol] || {}
        const price    = q.price ?? p.avgCost
        const sector   = q.sector ?? 'Unknown'
        const name     = q.name   ?? p.symbol
        const costBasis = p.shares * p.avgCost
        const currValue = p.shares * price
        const pnl       = currValue - costBasis
        const pnlPct    = costBasis > 0 ? pnl / costBasis * 100 : 0
        const contribPct = totalCost > 0 ? pnl / totalCost * 100 : 0
        const weight     = totalCost > 0 ? costBasis / totalCost * 100 : 0
        return { symbol: p.symbol, name, sector, shares: p.shares, avgCost: p.avgCost,
                 price, costBasis, currValue, pnl, pnlPct, contribPct, weight }
      })
      .filter(p => p.costBasis > 0)
  }, [portfolio, quoteData])

  const totalCost    = positions.reduce((s, p) => s + p.costBasis, 0)
  const totalCurr    = positions.reduce((s, p) => s + p.currValue, 0)
  const totalPnl     = totalCurr - totalCost
  const totalPnlPct  = totalCost > 0 ? totalPnl / totalCost * 100 : 0

  const sorted = useMemo(() => {
    return [...positions].sort((a, b) => {
      const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0
      return sortAsc ? av - bv : bv - av
    })
  }, [positions, sortCol, sortAsc])

  // Sector breakdown
  const sectors = useMemo(() => {
    const map = {}
    positions.forEach(p => {
      if (!map[p.sector]) map[p.sector] = { sector: p.sector, costBasis: 0, currValue: 0, pnl: 0, count: 0 }
      map[p.sector].costBasis  += p.costBasis
      map[p.sector].currValue  += p.currValue
      map[p.sector].pnl        += p.pnl
      map[p.sector].count      += 1
    })
    return Object.values(map)
      .map(s => ({
        ...s,
        pnlPct:     s.costBasis > 0 ? s.pnl / s.costBasis * 100 : 0,
        contribPct: totalCost > 0   ? s.pnl / totalCost * 100   : 0,
        weight:     totalCost > 0   ? s.costBasis / totalCost * 100 : 0,
      }))
      .sort((a, b) => b.contribPct - a.contribPct)
  }, [positions, totalCost])

  const maxAbs = Math.max(...positions.map(p => Math.abs(p.contribPct)), 0.5)

  function handleSort(col) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  function TH({ col, label, right = true }) {
    const active = sortCol === col
    return (
      <th className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none hover:text-white whitespace-nowrap ${right ? 'text-right' : 'text-left'} ${active ? 'text-white' : 'text-slate-400'}`}
        onClick={() => handleSort(col)}>
        {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-4">Portfolio Attribution</h1>
        <div className="bg-slate-800/50 rounded-xl p-10 text-center text-slate-400 border border-slate-700/50">Loading portfolio…</div>
      </div>
    )
  }

  if (!positions.length) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-4">Portfolio Attribution</h1>
        <div className="bg-slate-800/50 rounded-xl p-10 text-center border border-slate-700/50">
          <p className="text-slate-300 font-semibold text-lg mb-1">No positions found</p>
          <p className="text-slate-400 text-sm">Add positions in Portfolio → Portfolio first.</p>
        </div>
      </div>
    )
  }

  const winners  = positions.filter(p => p.pnl > 0).length
  const losers   = positions.filter(p => p.pnl < 0).length
  const bestPos  = positions.reduce((b, p) => p.contribPct > b.contribPct ? p : b, positions[0])
  const worstPos = positions.reduce((w, p) => p.contribPct < w.contribPct ? p : w, positions[0])

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Portfolio Attribution</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          How much each position has contributed to your total return since purchase.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400">Total Cost Basis</p>
          <p className="text-xl font-bold text-white mt-0.5">
            ${totalCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{positions.length} positions</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400">Current Value</p>
          <p className="text-xl font-bold text-white mt-0.5">
            ${totalCurr.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
          <p className={`text-xs mt-0.5 ${pnlColor(totalPnlPct)}`}>{fmtPct(totalPnlPct)} total return</p>
        </div>
        <div className={`rounded-xl p-4 border ${totalPnl >= 0 ? 'bg-emerald-900/20 border-emerald-800/30' : 'bg-red-900/20 border-red-800/30'}`}>
          <p className="text-xs text-slate-400">Total P&amp;L</p>
          <p className={`text-xl font-bold mt-0.5 ${pnlColor(totalPnl)}`}>{fmtDollar(totalPnl)}</p>
          <p className="text-xs text-slate-500 mt-0.5">{winners}W / {losers}L</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400">Top Contributor</p>
          <p className="text-base font-bold text-emerald-400 mt-0.5">{bestPos.symbol}</p>
          <p className="text-xs text-slate-400">{fmtPct(bestPos.contribPct)} of total</p>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex gap-1 bg-slate-800 rounded-xl p-1 w-fit">
        {[['table','By Position'],['waterfall','Waterfall'],['sector','By Sector']].map(([v, l]) => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${view === v ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* By Position table */}
      {view === 'table' && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/60">
                  <TH col="symbol"     label="Symbol"          right={false} />
                  <TH col="sector"     label="Sector"          right={false} />
                  <TH col="weight"     label="Weight %" />
                  <TH col="costBasis"  label="Cost Basis" />
                  <TH col="currValue"  label="Current Val" />
                  <TH col="pnl"        label="P&L $" />
                  <TH col="pnlPct"     label="P&L %" />
                  <TH col="contribPct" label="Contribution %" />
                  <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider text-left">Bar</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p, i) => (
                  <tr key={p.symbol} className={`border-b border-slate-700/40 hover:bg-slate-700/20 ${i % 2 ? 'bg-slate-900/10' : ''}`}>
                    <td className="px-3 py-2.5">
                      <p className="font-bold text-white">{p.symbol}</p>
                      <p className="text-[10px] text-slate-500 max-w-[100px] truncate">{p.name}</p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs">{p.sector}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300 text-xs tabular-nums">{fmtPct(p.weight, false)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums text-xs">
                      ${p.costBasis.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-200 tabular-nums text-xs">
                      ${p.currValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${pnlColor(p.pnl)}`}>
                      {fmtDollar(p.pnl)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${pnlColor(p.pnlPct)}`}>
                      {fmtPct(p.pnlPct)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${pnlColor(p.contribPct)}`}>
                      {fmtPct(p.contribPct)}
                    </td>
                    <td className="px-3 py-2.5">
                      <ContribBar contrib={p.contribPct} maxAbs={maxAbs} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-600 bg-slate-900/40">
                  <td colSpan={2} className="px-3 py-2.5 text-xs font-bold text-slate-400 uppercase">Total</td>
                  <td className="px-3 py-2.5 text-right text-slate-400 text-xs">100%</td>
                  <td className="px-3 py-2.5 text-right font-bold text-white tabular-nums text-xs">
                    ${totalCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2.5 text-right font-bold text-white tabular-nums text-xs">
                    ${totalCurr.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${pnlColor(totalPnl)}`}>{fmtDollar(totalPnl)}</td>
                  <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${pnlColor(totalPnlPct)}`}>{fmtPct(totalPnlPct)}</td>
                  <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${pnlColor(totalPnlPct)}`}>{fmtPct(totalPnlPct)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Waterfall view */}
      {view === 'waterfall' && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <h2 className="text-sm font-bold text-white mb-4">P&amp;L Waterfall — Each Position's Dollar Contribution</h2>
          <div className="overflow-x-auto">
            <WaterfallBar positions={positions} totalPnlPct={totalPnlPct} />
          </div>
          <div className="flex gap-4 mt-4 text-xs text-slate-400">
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-emerald-500" /><span>Positive contributor</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-500" /><span>Negative contributor</span></div>
          </div>
        </div>
      )}

      {/* By Sector view */}
      {view === 'sector' && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/60">
                {['Sector','Positions','Weight %','Cost Basis','Current Val','P&L $','P&L %','Contribution %'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sectors.map((s, i) => (
                <tr key={s.sector} className={`border-b border-slate-700/40 ${i % 2 ? 'bg-slate-900/15' : ''}`}>
                  <td className="px-3 py-2.5 font-bold text-slate-200">{s.sector}</td>
                  <td className="px-3 py-2.5 text-center text-slate-400">{s.count}</td>
                  <td className="px-3 py-2.5 text-slate-300 tabular-nums text-xs">{fmtPct(s.weight, false)}</td>
                  <td className="px-3 py-2.5 text-slate-300 tabular-nums text-xs">
                    ${s.costBasis.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2.5 text-slate-200 tabular-nums text-xs">
                    ${s.currValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className={`px-3 py-2.5 font-bold tabular-nums ${pnlColor(s.pnl)}`}>{fmtDollar(s.pnl)}</td>
                  <td className={`px-3 py-2.5 font-bold tabular-nums ${pnlColor(s.pnlPct)}`}>{fmtPct(s.pnlPct)}</td>
                  <td className={`px-3 py-2.5 font-bold tabular-nums ${pnlColor(s.contribPct)}`}>{fmtPct(s.contribPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Winner/Loser insight */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-slate-800 rounded-xl p-4 border border-emerald-900/30">
          <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">Top 3 Contributors</p>
          {positions.sort((a, b) => b.contribPct - a.contribPct).slice(0, 3).map(p => (
            <div key={p.symbol} className="flex justify-between items-center py-1.5 border-b border-slate-700/40 last:border-0">
              <div>
                <span className="font-bold text-white text-sm">{p.symbol}</span>
                <span className="text-slate-500 text-xs ml-2">{p.sector}</span>
              </div>
              <div className="text-right">
                <p className="text-emerald-400 font-bold text-sm">{fmtPct(p.contribPct)}</p>
                <p className="text-emerald-300 text-xs">{fmtDollar(p.pnl)}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-red-900/30">
          <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">Top 3 Detractors</p>
          {positions.sort((a, b) => a.contribPct - b.contribPct).slice(0, 3).map(p => (
            <div key={p.symbol} className="flex justify-between items-center py-1.5 border-b border-slate-700/40 last:border-0">
              <div>
                <span className="font-bold text-white text-sm">{p.symbol}</span>
                <span className="text-slate-500 text-xs ml-2">{p.sector}</span>
              </div>
              <div className="text-right">
                <p className={`font-bold text-sm ${pnlColor(p.contribPct)}`}>{fmtPct(p.contribPct)}</p>
                <p className={`text-xs ${pnlColor(p.pnl)}`}>{fmtDollar(p.pnl)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-600">
        Contribution % = position P&L ÷ total portfolio cost basis. This measures each holding's impact on your overall invested capital.
        P&L is unrealised — based on current market price vs your average cost. All calculations are frontend-only using live quote data.
      </p>
    </div>
  )
}
