import { useState, useEffect } from 'react'

const STORAGE_KEY = 'wheel_positions'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function daysUntil(dateStr) {
  const diff = new Date(dateStr) - new Date(today())
  return Math.ceil(diff / 86400000)
}

function annualizedReturn(premium, strike, daysToExp) {
  if (!premium || !strike || !daysToExp || daysToExp <= 0) return null
  return ((premium / strike) / daysToExp * 365 * 100).toFixed(1)
}

function statusBadge(pos) {
  const d = daysUntil(pos.expiration)
  if (pos.status === 'assigned') return { label: 'Assigned', cls: 'bg-orange-900/50 text-orange-300 border-orange-700/50' }
  if (pos.status === 'closed')   return { label: 'Closed',   cls: 'bg-slate-700 text-slate-400 border-slate-600' }
  if (d < 0)  return { label: 'Expired', cls: 'bg-slate-700 text-slate-400 border-slate-600' }
  if (d === 0) return { label: 'Expires Today', cls: 'bg-red-900/50 text-red-300 border-red-700/50' }
  if (d <= 7)  return { label: `${d}d left`, cls: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50' }
  return { label: `${d}d left`, cls: 'bg-emerald-900/30 text-emerald-400 border-emerald-700/30' }
}

function phaseLabel(p) {
  if (p.phase === 'csp') return 'Cash-Secured Put'
  if (p.phase === 'cc')  return 'Covered Call'
  return p.phase
}

const EMPTY_FORM = {
  symbol: '', phase: 'csp', strike: '', premium: '',
  contracts: 1, expiration: '', notes: '', status: 'open',
}

function PositionForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || EMPTY_FORM)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const annRet = annualizedReturn(
    Number(form.premium) * 100 * Number(form.contracts),
    Number(form.strike) * 100 * Number(form.contracts),
    form.expiration ? daysUntil(form.expiration) : null
  )

  return (
    <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
      <h3 className="text-sm font-bold text-white">{initial ? 'Edit Position' : 'Add Position'}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Ticker</label>
          <input value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            placeholder="AAPL" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Phase</label>
          <select value={form.phase} onChange={e => set('phase', e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
            <option value="csp">Cash-Secured Put</option>
            <option value="cc">Covered Call</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Status</label>
          <select value={form.status} onChange={e => set('status', e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
            <option value="open">Open</option>
            <option value="assigned">Assigned</option>
            <option value="closed">Closed / Expired</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Strike ($)</label>
          <input type="number" value={form.strike} onChange={e => set('strike', e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            placeholder="150.00" step="0.5" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Premium / contract ($)</label>
          <input type="number" value={form.premium} onChange={e => set('premium', e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            placeholder="3.50" step="0.01" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Contracts</label>
          <input type="number" min="1" value={form.contracts} onChange={e => set('contracts', Number(e.target.value))}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Expiration</label>
          <input type="date" value={form.expiration} onChange={e => set('expiration', e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-400 mb-1">Notes (optional)</label>
          <input value={form.notes} onChange={e => set('notes', e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            placeholder="Delta ~0.25, IV rank 60%" />
        </div>
      </div>
      {annRet && (
        <p className="text-xs text-emerald-400">
          Annualized return: <span className="font-bold">{annRet}%</span>
          {' '}on ${(Number(form.strike) * 100 * Number(form.contracts)).toLocaleString()} capital
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button onClick={() => onSave(form)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors">
          {initial ? 'Update' : 'Add Position'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function WheelTracker() {
  const [positions, setPositions] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [] }
    catch { return [] }
  })
  const [adding, setAdding]       = useState(false)
  const [editing, setEditing]     = useState(null)  // index
  const [filter, setFilter]       = useState('open')

  function save(pos) {
    setPositions(p => { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); return p })
  }

  function addPos(form) {
    if (!form.symbol || !form.strike || !form.premium || !form.expiration) return
    const pos = { ...form, id: Date.now(), addedAt: today() }
    const next = [pos, ...positions]
    setPositions(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setAdding(false)
  }

  function updatePos(form) {
    const next = positions.map((p, i) => i === editing ? { ...p, ...form } : p)
    setPositions(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setEditing(null)
  }

  function deletePos(idx) {
    const next = positions.filter((_, i) => i !== idx)
    setPositions(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  const displayed = positions.filter(p => {
    if (filter === 'open')   return p.status === 'open'
    if (filter === 'assigned') return p.status === 'assigned'
    if (filter === 'closed') return p.status === 'closed'
    return true
  })

  const openPremium  = positions.filter(p => p.status === 'open').reduce((s, p) => s + Number(p.premium) * 100 * Number(p.contracts), 0)
  const totalPremium = positions.reduce((s, p) => s + Number(p.premium) * 100 * Number(p.contracts), 0)
  const totalWheels  = [...new Set(positions.map(p => p.symbol))].length
  const openCount    = positions.filter(p => p.status === 'open').length

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Wheel Strategy Tracker</h1>
          <p className="text-sm text-slate-400 mt-0.5">Track your cash-secured puts and covered calls through the options wheel cycle.</p>
        </div>
        <button onClick={() => { setAdding(true); setEditing(null) }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors shrink-0">
          + Add Position
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Open Positions', value: openCount, color: 'text-white' },
          { label: 'Tickers Wheeled', value: totalWheels, color: 'text-blue-400' },
          { label: 'Open Premium', value: `$${openPremium.toLocaleString('en-US', { minimumFractionDigits: 0 })}`, color: 'text-emerald-400' },
          { label: 'Total Collected', value: `$${totalPremium.toLocaleString('en-US', { minimumFractionDigits: 0 })}`, color: 'text-emerald-400' },
        ].map(c => (
          <div key={c.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Form */}
      {adding && <PositionForm onSave={addPos} onCancel={() => setAdding(false)} />}
      {editing !== null && (
        <PositionForm initial={positions[editing]} onSave={updatePos} onCancel={() => setEditing(null)} />
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 bg-slate-800 rounded-xl p-1 w-fit">
        {[['open','Open'],['assigned','Assigned'],['closed','Closed'],['all','All']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === v ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {l} ({positions.filter(p => v === 'all' ? true : p.status === v || (v === 'open' && p.status === 'open')).length})
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/60">
                {['Ticker','Phase','Strike','Premium','Contracts','Total','Expiration','Ann. Yield','Status',''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((pos, i) => {
                const idx = positions.indexOf(pos)
                const badge = statusBadge(pos)
                const total = Number(pos.premium) * 100 * Number(pos.contracts)
                const exp = pos.expiration ? daysUntil(pos.expiration) : null
                const annRet = annualizedReturn(
                  Number(pos.premium) * 100 * Number(pos.contracts),
                  Number(pos.strike) * 100 * Number(pos.contracts),
                  exp
                )
                return (
                  <tr key={pos.id || i} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                    <td className="px-3 py-2.5 font-bold text-white">{pos.symbol}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-300">{phaseLabel(pos)}</td>
                    <td className="px-3 py-2.5 text-slate-300 tabular-nums">${Number(pos.strike).toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-emerald-400 tabular-nums font-medium">${Number(pos.premium).toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-slate-400 tabular-nums">{pos.contracts}</td>
                    <td className="px-3 py-2.5 text-emerald-400 tabular-nums font-semibold">${total.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-300 tabular-nums text-xs">{pos.expiration}</td>
                    <td className="px-3 py-2.5 tabular-nums text-xs">
                      {annRet ? <span className="text-blue-400 font-semibold">{annRet}%</span> : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-2">
                        <button onClick={() => { setEditing(idx); setAdding(false) }}
                          className="text-xs text-slate-400 hover:text-blue-400 transition-colors">Edit</button>
                        <button onClick={() => deletePos(idx)}
                          className="text-xs text-slate-400 hover:text-red-400 transition-colors">Del</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {displayed.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-12 text-center text-slate-500">
                  {filter === 'open' ? 'No open positions. Click "+ Add Position" to start tracking.' : 'No positions in this view.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* How-to explainer */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-500 bg-slate-800/40 rounded-xl p-4 border border-slate-700/40">
        <div>
          <p className="text-slate-300 font-semibold mb-1">Step 1 — Sell a CSP</p>
          <p>Sell a cash-secured put on a stock you'd be happy to own. Collect premium. If the stock stays above your strike, you keep the premium and the wheel ends (or start again).</p>
        </div>
        <div>
          <p className="text-slate-300 font-semibold mb-1">Step 2 — Get Assigned</p>
          <p>If the stock falls below your strike at expiry, you're assigned 100 shares per contract at the strike price. Your effective cost basis is strike − premium collected.</p>
        </div>
        <div>
          <p className="text-slate-300 font-semibold mb-1">Step 3 — Sell Covered Calls</p>
          <p>Now sell covered calls against your shares, typically at or above your cost basis. Collect more premium. If called away, you profit. If not, repeat and lower your basis further.</p>
        </div>
      </div>
    </div>
  )
}
