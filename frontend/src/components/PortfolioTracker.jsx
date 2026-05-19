import { useState, useEffect, useCallback } from 'react'
import { fmt } from '../utils/format'
import ChartModal from './ChartModal'

const COLORS = [
  '#10b981','#3b82f6','#8b5cf6','#f59e0b','#ef4444',
  '#06b6d4','#ec4899','#84cc16','#f97316','#6366f1',
  '#14b8a6','#a855f7','#0ea5e9','#22c55e','#fb923c',
]

function SummaryCard({ label, value, sub, positive }) {
  const isNeutral = positive === null || positive === undefined
  const color = isNeutral ? 'text-white' : positive ? 'text-emerald-400' : 'text-red-400'
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3 min-w-[140px]">
      <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className={`text-xs tabular-nums mt-0.5 ${color} opacity-80`}>{sub}</div>}
    </div>
  )
}

function pct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function money(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PortfolioTracker() {
  const [positions, setPositions]     = useState([])
  const [quotes, setQuotes]           = useState({})
  const [loading, setLoading]         = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [countdown, setCountdown]     = useState(30)
  const [chartSymbol, setChartSymbol] = useState(null)
  const [chartQuote, setChartQuote]   = useState(null)

  // Form state
  const [sym, setSym]       = useState('')
  const [shares, setShares] = useState('')
  const [cost, setCost]     = useState('')
  const [formErr, setFormErr] = useState('')

  // Load positions from API on mount; migrate localStorage on first empty load
  useEffect(() => {
    fetch('/api/portfolio')
      .then(r => r.json())
      .then(async (rows) => {
        if (rows.length === 0) {
          try {
            const saved = localStorage.getItem('stockmonitor-portfolio')
            if (saved) {
              const legacy = JSON.parse(saved)
              const migrated = await Promise.all(
                legacy.map(p =>
                  fetch('/api/portfolio', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol: p.symbol, shares: p.shares, avgCost: p.avgCost }),
                  }).then(r => r.json())
                )
              )
              localStorage.removeItem('stockmonitor-portfolio')
              setPositions(migrated)
              return
            }
          } catch { /* ignore */ }
        }
        setPositions(rows)
      })
      .catch(() => setPositions([]))
  }, [])

  const fetchQuotes = useCallback(async () => {
    const syms = [...new Set(positions.map(p => p.symbol))]
    if (syms.length === 0) return
    setLoading(true)
    try {
      const r = await fetch(`/api/quotes?symbols=${syms.join(',')}`)
      if (!r.ok) throw new Error()
      const data = await r.json()
      const map = {}
      data.forEach(q => { map[q.symbol] = q })
      setQuotes(map)
      setLastUpdated(new Date())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [positions])

  useEffect(() => {
    fetchQuotes()
    setCountdown(30)
    const iv = setInterval(() => { fetchQuotes(); setCountdown(30) }, 30000)
    return () => clearInterval(iv)
  }, [fetchQuotes])

  useEffect(() => {
    setCountdown(30)
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [lastUpdated])

  const addPosition = async (e) => {
    e.preventDefault()
    const s  = sym.trim().toUpperCase()
    const sh = parseFloat(shares)
    const co = parseFloat(cost)
    if (!s)               { setFormErr('Symbol required'); return }
    if (isNaN(sh) || sh <= 0) { setFormErr('Enter valid shares'); return }
    if (isNaN(co) || co <= 0) { setFormErr('Enter valid avg cost'); return }
    setFormErr('')
    try {
      const r = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: s, shares: sh, avgCost: co }),
      })
      if (!r.ok) throw new Error('Server error')
      const pos = await r.json()
      setPositions(prev => [...prev, pos])
      setSym(''); setShares(''); setCost('')
    } catch {
      setFormErr('Failed to add position')
    }
  }

  const removePosition = async (id) => {
    await fetch(`/api/portfolio/${id}`, { method: 'DELETE' })
    setPositions(prev => prev.filter(p => p.id !== id))
  }

  // Enrich positions with live data
  const enriched = positions.map((p, i) => {
    const q      = quotes[p.symbol]
    const price  = q?.price ?? null
    const prev   = q?.previousClose ?? null
    const curVal = price != null ? p.shares * price : null
    const basis  = p.shares * p.avgCost
    const pl     = curVal != null ? curVal - basis : null
    const plPct  = pl != null ? (pl / basis) * 100 : null
    const dayPL  = price != null && prev != null ? p.shares * (price - prev) : null
    return {
      ...p,
      name: q?.name ?? p.symbol,
      price, prev, curVal, basis, pl, plPct, dayPL,
      change: q?.change ?? null,
      changePercent: q?.changePercent ?? null,
      color: COLORS[i % COLORS.length],
    }
  })

  const totalBasis  = enriched.reduce((s, p) => s + p.basis, 0)
  const totalVal    = enriched.reduce((s, p) => s + (p.curVal ?? p.basis), 0)
  const totalPL     = totalVal - totalBasis
  const totalPLPct  = totalBasis > 0 ? (totalPL / totalBasis) * 100 : 0
  const totalDayPL  = enriched.reduce((s, p) => s + (p.dayPL ?? 0), 0)

  const withWeight = enriched.map(p => ({
    ...p,
    weight: totalVal > 0 ? ((p.curVal ?? p.basis) / totalVal) * 100 : 0,
  }))

  return (
    <div className="p-4 max-w-7xl mx-auto">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Portfolio Tracker</div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-gray-600 text-xs">
              {loading
                ? <span className="text-emerald-400 animate-pulse">● Updating…</span>
                : `Updated ${lastUpdated.toLocaleTimeString()} · next in ${countdown}s`}
            </span>
          )}
          <button onClick={fetchQuotes} disabled={loading || positions.length === 0}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-400 hover:text-white px-3 py-1 text-xs rounded transition-colors">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Add position form ── */}
      <form onSubmit={addPosition} className="flex flex-wrap items-end gap-3 mb-6 bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3">
        <div>
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Symbol</div>
          <input value={sym} onChange={e => setSym(e.target.value.toUpperCase())}
            placeholder="AAPL" maxLength={10}
            className="bg-gray-800 border border-gray-700 text-white placeholder-gray-600 px-3 py-1.5 text-sm rounded w-28 focus:outline-none focus:border-emerald-500 uppercase" />
        </div>
        <div>
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Shares</div>
          <input value={shares} onChange={e => setShares(e.target.value)} type="number" min="0" step="any"
            placeholder="100"
            className="bg-gray-800 border border-gray-700 text-white placeholder-gray-600 px-3 py-1.5 text-sm rounded w-28 focus:outline-none focus:border-emerald-500" />
        </div>
        <div>
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Avg Cost ($)</div>
          <input value={cost} onChange={e => setCost(e.target.value)} type="number" min="0" step="any"
            placeholder="150.00"
            className="bg-gray-800 border border-gray-700 text-white placeholder-gray-600 px-3 py-1.5 text-sm rounded w-32 focus:outline-none focus:border-emerald-500" />
        </div>
        <button type="submit"
          className="bg-emerald-800 hover:bg-emerald-700 text-emerald-100 px-4 py-1.5 text-sm rounded transition-colors">
          + Add Position
        </button>
        {formErr && <span className="text-red-400 text-xs self-center">{formErr}</span>}
      </form>

      {positions.length === 0 && (
        <div className="text-gray-600 text-sm text-center py-20">
          Add your first position above to start tracking your portfolio
        </div>
      )}

      {positions.length > 0 && (
        <div className="space-y-6">

          {/* ── Summary cards ── */}
          <div className="flex flex-wrap gap-3">
            <SummaryCard label="Total Invested"  value={`$${totalBasis.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}`} />
            <SummaryCard label="Market Value"    value={`$${totalVal.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}`} />
            <SummaryCard label="Total P&L"       value={money(totalPL)}   sub={pct(totalPLPct)}   positive={totalPL >= 0} />
            <SummaryCard label="Day's P&L"       value={money(totalDayPL)}                         positive={totalDayPL >= 0} />
            <SummaryCard label="Positions"       value={positions.length} />
          </div>

          {/* ── Allocation bar ── */}
          <section>
            <div className="text-gray-600 text-xs uppercase tracking-widest mb-2">Allocation</div>
            <div className="w-full h-3 rounded-full overflow-hidden flex mb-3">
              {withWeight.map(p => (
                <div key={p.id} style={{ width: `${p.weight}%`, backgroundColor: p.color }}
                  title={`${p.symbol}: ${p.weight.toFixed(1)}%`} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {withWeight.map(p => (
                <span key={p.id} className="text-xs text-gray-400 flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
                  {p.symbol} <span className="text-gray-600">{p.weight.toFixed(1)}%</span>
                </span>
              ))}
            </div>
          </section>

          {/* ── Positions table ── */}
          <section>
            <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">Positions</div>
            <div className="bg-gray-900/60 border border-gray-800 rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    {['Symbol','Name','Shares','Avg Cost','Price','Market Value','P&L','P&L %','Day P&L','Weight',''].map(h => (
                      <th key={h} className={`py-2.5 px-3 text-gray-600 font-medium tracking-wider uppercase ${h===''||h==='Name'||h==='Symbol'?'text-left':'text-right'}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {withWeight.map(p => (
                    <tr key={p.id} className="border-b border-gray-800/40 hover:bg-gray-800/40 transition-colors">
                      <td className="py-2.5 px-3">
                        <button
                          onClick={() => { setChartSymbol(p.symbol); setChartQuote({name:p.name,price:p.price,change:p.change,changePercent:p.changePercent}) }}
                          className="flex items-center gap-1.5 text-white font-bold hover:text-sky-300 transition-colors"
                        >
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
                          {p.symbol}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-gray-400 max-w-[160px] truncate">{p.name}</td>
                      <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{p.shares.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{fmt.price(p.avgCost)}</td>
                      <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{fmt.price(p.price)}</td>
                      <td className="py-2.5 px-3 text-right text-white font-medium tabular-nums">
                        {p.curVal != null ? `$${p.curVal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—'}
                      </td>
                      <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${p.pl==null?'text-gray-600':p.pl>=0?'text-emerald-400':'text-red-400'}`}>
                        {money(p.pl)}
                      </td>
                      <td className={`py-2.5 px-3 text-right tabular-nums ${p.plPct==null?'text-gray-600':p.plPct>=0?'text-emerald-400':'text-red-400'}`}>
                        {pct(p.plPct)}
                      </td>
                      <td className={`py-2.5 px-3 text-right tabular-nums ${p.dayPL==null?'text-gray-600':p.dayPL>=0?'text-emerald-400':'text-red-400'}`}>
                        {money(p.dayPL)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-gray-500 tabular-nums">{p.weight.toFixed(1)}%</td>
                      <td className="py-2.5 px-3 text-right">
                        <button onClick={() => removePosition(p.id)}
                          className="text-gray-700 hover:text-red-400 transition-colors text-base leading-none px-1">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </div>
      )}

      {chartSymbol && (
        <ChartModal
          symbol={chartSymbol}
          quote={chartQuote}
          onClose={() => { setChartSymbol(null); setChartQuote(null) }}
        />
      )}
    </div>
  )
}
