import { useEffect, useState } from 'react'

const today = new Date().toISOString().slice(0, 10)

function DteBadge({ dte }) {
  if (dte == null) return null
  if (dte < 0)  return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-600">Expired</span>
  if (dte === 0) return <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 font-semibold">Expires today</span>
  if (dte <= 7)  return <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/40 text-red-400">{dte}d</span>
  if (dte <= 21) return <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400">{dte}d</span>
  return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{dte}d</span>
}

function PnlCell({ pnl, pnlPct }) {
  if (pnl == null) return <span className="text-gray-600">—</span>
  const pos = pnl >= 0
  return (
    <div className={`tabular-nums ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
      <div className="font-semibold">{pos ? '+' : ''}${Math.abs(pnl).toLocaleString()}</div>
      {pnlPct != null && <div className="text-xs opacity-70">{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%</div>}
    </div>
  )
}

export default function OptionsTracker() {
  const [positions, setPositions] = useState([])
  const [pnl,       setPnl]       = useState([])
  const [loading,   setLoading]   = useState(true)
  const [pnlLoad,   setPnlLoad]   = useState(false)

  // form
  const [sym,    setSym]    = useState('')
  const [type,   setType]   = useState('call')
  const [strike, setStrike] = useState('')
  const [expiry, setExpiry] = useState('')
  const [qty,    setQty]    = useState(1)
  const [entry,  setEntry]  = useState('')
  const [note,   setNote]   = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => { fetchPositions() }, [])

  function fetchPositions() {
    setLoading(true)
    fetch('/api/options-positions')
      .then(r => r.json()).then(setPositions).finally(() => setLoading(false))
  }

  async function fetchPnl() {
    setPnlLoad(true)
    try {
      const res = await fetch('/api/options-positions/pnl')
      setPnl(await res.json())
    } finally { setPnlLoad(false) }
  }

  async function addPosition(e) {
    e.preventDefault()
    if (!sym || !strike || !expiry || !entry) return
    setAdding(true)
    await fetch('/api/options-positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: sym.toUpperCase().trim(),
        option_type: type,
        strike: Number(strike),
        expiry,
        quantity: Number(qty),
        entry_premium: Number(entry),
        note,
      }),
    })
    setSym(''); setStrike(''); setExpiry(''); setEntry(''); setNote(''); setQty(1)
    setAdding(false)
    fetchPositions()
    setPnl([])
  }

  async function removePosition(id) {
    await fetch(`/api/options-positions/${id}`, { method: 'DELETE' })
    setPositions(p => p.filter(x => x.id !== id))
    setPnl(p => p.filter(x => x.id !== id))
  }

  const pnlMap = Object.fromEntries(pnl.map(p => [p.id, p]))
  const totalPnl = pnl.reduce((s, p) => s + (p.pnl ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-gray-500 text-xs uppercase tracking-widest">Options P&L Tracker</div>
          {pnl.length > 0 && (
            <div className={`text-sm font-semibold mt-0.5 tabular-nums ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              Total P&L: {totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString(undefined, {maximumFractionDigits: 0})}
            </div>
          )}
        </div>
        <button
          onClick={fetchPnl}
          disabled={pnlLoad || positions.length === 0}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40 transition-colors"
        >
          {pnlLoad ? 'Loading…' : '⟳ Refresh P&L'}
        </button>
      </div>

      {/* Add form */}
      <form onSubmit={addPosition} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        <div className="text-gray-600 text-xs uppercase tracking-wider mb-3">Add Position</div>
        <div className="flex flex-wrap gap-3 items-end">
          {[
            { label: 'Symbol',  val: sym,    set: e => setSym(e.target.value.toUpperCase()), placeholder: 'AAPL', width: 'w-20' },
            { label: 'Strike',  val: strike, set: e => setStrike(e.target.value), placeholder: '190',   width: 'w-20', type: 'number' },
            { label: 'Expiry',  val: expiry, set: e => setExpiry(e.target.value), placeholder: '',       width: 'w-36', type: 'date', min: today },
            { label: 'Qty',     val: qty,    set: e => setQty(e.target.value),    placeholder: '1',     width: 'w-16', type: 'number' },
            { label: 'Entry $', val: entry,  set: e => setEntry(e.target.value),  placeholder: '3.50',  width: 'w-20', type: 'number', step: '0.01' },
            { label: 'Note',    val: note,   set: e => setNote(e.target.value),   placeholder: 'optional', width: 'w-40' },
          ].map(({ label, val, set, placeholder, width, type: t = 'text', min, step }) => (
            <div key={label}>
              <label className="text-gray-600 text-xs block mb-1">{label}</label>
              <input type={t} value={val} onChange={set} placeholder={placeholder} min={min} step={step}
                className={`${width} bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-sky-600`} />
            </div>
          ))}
          <div>
            <label className="text-gray-600 text-xs block mb-1">Type</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-sky-600">
              <option value="call">Call</option>
              <option value="put">Put</option>
            </select>
          </div>
          <button type="submit" disabled={adding || !sym || !strike || !expiry || !entry}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 transition-colors">
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </div>
        <div className="text-gray-700 text-xs mt-2">Qty negative = short position · Entry = premium per share (×100 per contract)</div>
      </form>

      {/* Positions table */}
      {loading ? (
        <div className="py-8 text-center text-gray-500 text-sm animate-pulse">Loading positions…</div>
      ) : positions.length === 0 ? (
        <div className="py-8 text-center text-gray-700 text-sm">No options positions yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/80">
                {['Symbol', 'Type', 'Strike', 'Expiry', 'DTE', 'Qty', 'Entry', 'Current', 'P&L', 'Delta', 'Theta', 'IV', ''].map((h, i) => (
                  <th key={i} className={`py-2.5 px-3 text-gray-500 font-medium text-xs uppercase tracking-wider ${i === 0 ? 'text-left' : 'text-right'} last:text-center`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((pos, i) => {
                const live = pnlMap[pos.id]
                return (
                  <tr key={pos.id} className={`border-b border-gray-800/40 hover:bg-gray-800/20 ${i % 2 ? 'bg-gray-900/20' : ''} ${live?.expired ? 'opacity-40' : ''}`}>
                    <td className="py-2.5 px-3 text-white font-semibold">{pos.symbol}</td>
                    <td className={`py-2.5 px-3 text-right text-xs font-medium ${pos.option_type === 'call' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pos.option_type.toUpperCase()}
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">${pos.strike}</td>
                    <td className="py-2.5 px-3 text-right text-gray-400 text-xs">{pos.expiry}</td>
                    <td className="py-2.5 px-3 text-right"><DteBadge dte={live?.dte} /></td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${pos.quantity < 0 ? 'text-red-300' : 'text-gray-300'}`}>
                      {pos.quantity > 0 ? '+' : ''}{pos.quantity}
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">${pos.entry_premium.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">
                      {live?.current_mid != null ? `$${live.current_mid.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right"><PnlCell pnl={live?.pnl} pnlPct={live?.pnl_pct} /></td>
                    <td className="py-2.5 px-3 text-right text-gray-500 tabular-nums text-xs">{live?.delta?.toFixed(2) ?? '—'}</td>
                    <td className="py-2.5 px-3 text-right text-gray-500 tabular-nums text-xs">{live?.theta?.toFixed(2) ?? '—'}</td>
                    <td className="py-2.5 px-3 text-right text-gray-500 tabular-nums text-xs">{live?.iv_pct != null ? `${live.iv_pct}%` : '—'}</td>
                    <td className="py-2.5 px-3 text-center">
                      <button onClick={() => removePosition(pos.id)} className="text-gray-700 hover:text-red-400 text-xs transition-colors">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
