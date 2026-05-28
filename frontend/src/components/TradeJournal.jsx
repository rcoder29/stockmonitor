import { useState, useEffect, useCallback } from 'react'
import { fmt } from '../utils/format'

const STRATEGIES = [
  'Gap & Go', 'Momentum', 'VWAP', 'Opening Range',
  'Mean Reversion', 'Scalping', 'Swing', 'Long-term', 'Other',
]

function StatBox({ label, value, cls = 'text-white', sub }) {
  return (
    <div className="bg-gray-800/60 rounded-lg px-4 py-3 min-w-[110px]">
      <div className="text-gray-500 text-xs mb-0.5">{label}</div>
      <div className={`font-bold text-lg tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="text-gray-600 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

export default function TradeJournal() {
  const [entries,   setEntries]  = useState([])
  const [stats,     setStats]    = useState(null)
  const [loading,   setLoading]  = useState(true)
  const [formOpen,  setFormOpen] = useState(false)
  const [filter,    setFilter]   = useState('')
  const [stratFilter, setStratFilter] = useState('All')

  // Form fields
  const [sym,       setSym]       = useState('')
  const [side,      setSide]      = useState('buy')
  const [price,     setPrice]     = useState('')
  const [shares,    setShares]    = useState('')
  const [strategy,  setStrategy]  = useState('Other')
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes,     setNotes]     = useState('')
  const [formErr,   setFormErr]   = useState('')
  const [saving,    setSaving]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [rE, rS] = await Promise.all([
      fetch('/api/journal').then(r => r.json()).catch(() => []),
      fetch('/api/journal/stats').then(r => r.json()).catch(() => null),
    ])
    setEntries(rE)
    setStats(rS)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAdd(e) {
    e.preventDefault()
    if (!sym.trim() || !price || !shares) { setFormErr('Symbol, price and shares are required'); return }
    setSaving(true); setFormErr('')
    try {
      const r = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: sym.trim().toUpperCase(), side, price: parseFloat(price),
          shares: parseFloat(shares), strategy, trade_date: tradeDate, notes: notes || null,
        }),
      })
      if (!r.ok) throw new Error('Failed to save')
      setSym(''); setPrice(''); setShares(''); setNotes(''); setSide('buy')
      setFormOpen(false)
      await load()
    } catch (err) {
      setFormErr(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await fetch(`/api/journal/${id}`, { method: 'DELETE' })
    setEntries(prev => prev.filter(e => e.id !== id))
    // refresh stats after delete
    fetch('/api/journal/stats').then(r => r.json()).then(setStats).catch(() => {})
  }

  const allStrategies = ['All', ...STRATEGIES]
  const q = filter.trim().toLowerCase()
  const filtered = entries.filter(e => {
    if (stratFilter !== 'All' && e.strategy !== stratFilter) return false
    if (!q) return true
    return e.symbol.toLowerCase().includes(q) || (e.notes ?? '').toLowerCase().includes(q)
  })

  return (
    <div className="p-4 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Trade Journal</div>
        <button
          onClick={() => setFormOpen(o => !o)}
          className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          + Log Trade
        </button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="flex flex-wrap gap-3 mb-6">
          <StatBox
            label="Realized P&L"
            value={stats.totalPnl >= 0 ? `+$${stats.totalPnl.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : `-$${Math.abs(stats.totalPnl).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`}
            cls={stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
          />
          <StatBox
            label="Win Rate"
            value={stats.winRate != null ? `${stats.winRate}%` : '—'}
            cls={stats.winRate != null && stats.winRate >= 50 ? 'text-emerald-400' : 'text-amber-400'}
            sub={stats.closedTrades ? `${stats.wins}W / ${stats.losses}L` : null}
          />
          <StatBox label="Total Entries" value={stats.tradeCount} cls="text-white" />
          <StatBox label="Closed Trades" value={stats.closedTrades} cls="text-gray-300" />
        </div>
      )}

      {/* By-strategy breakdown */}
      {stats?.byStrategy && Object.keys(stats.byStrategy).length > 0 && (
        <div className="mb-6 bg-gray-900/60 border border-gray-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">By Strategy</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800/60">
                {['Strategy', 'Trades', 'Wins', 'Losses', 'Win Rate', 'P&L'].map((h, i) => (
                  <th key={h} className={`py-2 px-4 text-gray-500 font-medium uppercase tracking-wider ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.byStrategy)
                .sort(([, a], [, b]) => b.pnl - a.pnl)
                .map(([strat, s]) => {
                  const wr = s.trades > 0 ? Math.round(s.wins / s.trades * 100) : null
                  return (
                    <tr key={strat} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                      <td className="py-2.5 px-4 text-gray-300 font-medium">{strat}</td>
                      <td className="py-2.5 px-4 text-right text-gray-400 tabular-nums">{s.trades}</td>
                      <td className="py-2.5 px-4 text-right text-emerald-400 tabular-nums">{s.wins}</td>
                      <td className="py-2.5 px-4 text-right text-red-400 tabular-nums">{s.losses}</td>
                      <td className={`py-2.5 px-4 text-right tabular-nums ${wr != null && wr >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {wr != null ? `${wr}%` : '—'}
                      </td>
                      <td className={`py-2.5 px-4 text-right font-semibold tabular-nums ${s.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {s.pnl >= 0 ? '+' : ''}${s.pnl.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add trade form */}
      {formOpen && (
        <form onSubmit={handleAdd} className="bg-gray-900/60 border border-gray-800 rounded-lg p-4 mb-5">
          <div className="text-gray-400 text-sm font-medium mb-4">Log New Trade</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-gray-500 text-xs block mb-1">Symbol</label>
              <input value={sym} onChange={e => setSym(e.target.value.toUpperCase())}
                placeholder="AAPL"
                className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500 uppercase" />
            </div>
            <div>
              <label className="text-gray-500 text-xs block mb-1">Side</label>
              <div className="flex rounded overflow-hidden border border-gray-700">
                {['buy', 'sell'].map(s => (
                  <button type="button" key={s} onClick={() => setSide(s)}
                    className={`flex-1 py-1.5 text-sm font-semibold transition-colors ${side === s ? (s === 'buy' ? 'bg-emerald-700 text-white' : 'bg-red-700 text-white') : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}>
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-gray-500 text-xs block mb-1">Price ($)</label>
              <input type="number" value={price} onChange={e => setPrice(e.target.value)} step="0.01" min="0"
                placeholder="0.00"
                className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-gray-500 text-xs block mb-1">Shares</label>
              <input type="number" value={shares} onChange={e => setShares(e.target.value)} step="0.01" min="0"
                placeholder="0"
                className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-gray-500 text-xs block mb-1">Strategy</label>
              <select value={strategy} onChange={e => setStrategy(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500">
                {STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-gray-500 text-xs block mb-1">Date</label>
              <input type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500" />
            </div>
            <div className="md:col-span-2">
              <label className="text-gray-500 text-xs block mb-1">Notes (optional)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Setup, catalyst, mistakes…"
                className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500" />
            </div>
          </div>
          {formErr && <div className="text-red-400 text-xs mb-3">{formErr}</div>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-semibold px-5 py-1.5 rounded-lg transition-colors">
              {saving ? 'Saving…' : 'Save Trade'}
            </button>
            <button type="button" onClick={() => setFormOpen(false)}
              className="text-gray-500 hover:text-gray-300 text-sm px-3 py-1.5 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
            fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Filter by symbol or notes…"
            className="w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 pl-9 pr-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500" />
        </div>
        <select value={stratFilter} onChange={e => setStratFilter(e.target.value)}
          className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500">
          {allStrategies.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Trades table */}
      {loading ? (
        <div className="py-16 text-center text-gray-500 text-sm animate-pulse">Loading journal…</div>
      ) : entries.length === 0 ? (
        <div className="py-24 text-center text-gray-600 text-sm">
          No trades yet — click "Log Trade" to start your journal
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900">
                {['Date', 'Symbol', 'Side', 'Price', 'Shares', 'Value', 'Strategy', 'Notes', ''].map((h, i) => (
                  <th key={h || i} className={`py-2.5 px-3 text-gray-500 font-medium tracking-wider uppercase ${i <= 1 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const val = e.price * e.shares
                return (
                  <tr key={e.id} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                    <td className="py-2.5 px-3 text-gray-500 tabular-nums whitespace-nowrap">{e.trade_date}</td>
                    <td className="py-2.5 px-3 font-bold text-white">{e.symbol}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${e.side === 'buy' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-red-900/60 text-red-300'}`}>
                        {e.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{fmt.price(e.price)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{e.shares.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">
                      ${val.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-500">{e.strategy ?? '—'}</td>
                    <td className="py-2.5 px-3 text-gray-600 max-w-[160px] truncate" title={e.notes ?? ''}>{e.notes ?? ''}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button onClick={() => handleDelete(e.id)}
                        className="text-gray-700 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {q && filtered.length === 0 && (
            <div className="py-8 text-center text-gray-600 text-sm">No entries match "{filter}"</div>
          )}
        </div>
      )}
    </div>
  )
}
