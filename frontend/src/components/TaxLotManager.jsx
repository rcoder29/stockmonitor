import { useState } from 'react'

const STORAGE_KEY = 'tax_lots'

const METHODS = ['FIFO', 'LIFO', 'HighCost', 'LowCost', 'MinTax']

function today() { return new Date().toISOString().slice(0, 10) }
function daysBetween(from, to) {
  return Math.floor((new Date(to) - new Date(from)) / 86400000)
}

const LTCG_THRESHOLDS_MFJ_2025 = [
  { rate: 0,    upTo: 94050 },
  { rate: 0.15, upTo: 583750 },
  { rate: 0.20, upTo: Infinity },
]
const FED_BRACKETS_MFJ_2025 = [
  { rate: 0.10, upTo: 23850 },
  { rate: 0.12, upTo: 96950 },
  { rate: 0.22, upTo: 206700 },
  { rate: 0.24, upTo: 394600 },
  { rate: 0.32, upTo: 501050 },
  { rate: 0.35, upTo: 751600 },
  { rate: 0.37, upTo: Infinity },
]

function marginalRate(income, brackets) {
  for (const b of brackets) {
    if (income <= b.upTo) return b.rate
  }
  return brackets[brackets.length - 1].rate
}

function ltcgRate(income) {
  for (const b of LTCG_THRESHOLDS_MFJ_2025) {
    if (income <= b.upTo) return b.rate
  }
  return 0.20
}

function taxOnGain(gain, holdDays, ordinaryIncome) {
  if (gain <= 0) return 0
  if (holdDays >= 365) return gain * ltcgRate(ordinaryIncome + gain)
  return gain * marginalRate(ordinaryIncome + gain, FED_BRACKETS_MFJ_2025)
}

const EMPTY_LOT = { symbol: '', shares: '', costBasis: '', purchaseDate: '', notes: '' }

function LotForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || EMPTY_LOT)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
      <h3 className="text-sm font-bold text-white">{initial ? 'Edit Lot' : 'Add Tax Lot'}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Ticker</label>
          <input value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            placeholder="AAPL" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Shares</label>
          <input type="number" min="0" step="0.001" value={form.shares} onChange={e => set('shares', e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            placeholder="100" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Cost Basis / share ($)</label>
          <input type="number" min="0" step="0.01" value={form.costBasis} onChange={e => set('costBasis', e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            placeholder="150.00" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Purchase Date</label>
          <input type="date" value={form.purchaseDate} onChange={e => set('purchaseDate', e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Notes (optional)</label>
          <input value={form.notes} onChange={e => set('notes', e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            placeholder="DRIP purchase, RSU vest, etc." />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => { if (form.symbol && form.shares && form.costBasis && form.purchaseDate) onSave(form) }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors">
          {initial ? 'Update Lot' : 'Add Lot'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg transition-colors">Cancel</button>
      </div>
    </div>
  )
}

export default function TaxLotManager() {
  const [lots, setLots] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [] }
    catch { return [] }
  })
  const [adding, setAdding]     = useState(false)
  const [editing, setEditing]   = useState(null)
  const [sellSym, setSellSym]   = useState('')
  const [sellShares, setSellShares] = useState('')
  const [sellPrice, setSellPrice]   = useState('')
  const [method, setMethod]     = useState('MinTax')
  const [income, setIncome]     = useState(150000)
  const [sellResult, setSellResult] = useState(null)
  const [filterSym, setFilterSym]   = useState('all')

  function saveLots(next) {
    setLots(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  function addLot(form) {
    saveLots([{ ...form, id: Date.now() }, ...lots])
    setAdding(false)
  }

  function updateLot(form) {
    saveLots(lots.map((l, i) => i === editing ? { ...l, ...form } : l))
    setEditing(null)
  }

  function deleteLot(idx) { saveLots(lots.filter((_, i) => i !== idx)) }

  // ── Lot selection for a sale ──────────────────────────────────────────────
  function simulateSale() {
    const sym    = sellSym.toUpperCase()
    const shares = Number(sellShares)
    const price  = Number(sellPrice)
    if (!sym || !shares || !price) return

    const symLots = lots
      .filter(l => l.symbol === sym)
      .map(l => ({
        ...l,
        sharesN:  Number(l.shares),
        basisN:   Number(l.costBasis),
        holdDays: daysBetween(l.purchaseDate, today()),
        gainPerShare: price - Number(l.costBasis),
        isLT: daysBetween(l.purchaseDate, today()) >= 365,
      }))

    if (!symLots.length) { setSellResult({ error: `No lots found for ${sym}` }); return }

    // sort by method
    let sorted = [...symLots]
    if (method === 'FIFO')     sorted.sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))
    if (method === 'LIFO')     sorted.sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
    if (method === 'HighCost') sorted.sort((a, b) => b.basisN - a.basisN)
    if (method === 'LowCost')  sorted.sort((a, b) => a.basisN - b.basisN)
    if (method === 'MinTax')   sorted.sort((a, b) => {
      const taxA = taxOnGain((price - a.basisN) * 1, a.holdDays, income)
      const taxB = taxOnGain((price - b.basisN) * 1, b.holdDays, income)
      return taxA - taxB
    })

    // pick lots to fill order
    let remaining = shares
    const usedLots = []
    for (const lot of sorted) {
      if (remaining <= 0) break
      const use = Math.min(remaining, lot.sharesN)
      const gain = (price - lot.basisN) * use
      usedLots.push({ ...lot, used: use, gain, tax: taxOnGain(gain, lot.holdDays, income) })
      remaining -= use
    }
    if (remaining > 0) { setSellResult({ error: `Insufficient shares. Only ${shares - remaining} available.` }); return }

    const totalGain = usedLots.reduce((s, l) => s + l.gain, 0)
    const totalTax  = usedLots.reduce((s, l) => s + l.tax, 0)
    setSellResult({ sym, shares, price, usedLots, totalGain, totalTax, method })
  }

  const symbols = [...new Set(lots.map(l => l.symbol))]
  const filtered = filterSym === 'all' ? lots : lots.filter(l => l.symbol === filterSym)

  const totalBasis  = filtered.reduce((s, l) => s + Number(l.shares) * Number(l.costBasis), 0)
  const totalShares = filtered.reduce((s, l) => s + Number(l.shares), 0)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tax Lot Manager</h1>
          <p className="text-sm text-slate-400 mt-0.5">Track cost basis by lot and simulate which shares to sell to minimize taxes.</p>
        </div>
        <button onClick={() => { setAdding(true); setEditing(null) }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl shrink-0 transition-colors">
          + Add Lot
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Tickers Tracked', value: symbols.length },
          { label: 'Total Lots', value: lots.length },
          { label: 'Total Cost Basis', value: `$${totalBasis.toLocaleString('en-US', { minimumFractionDigits: 0 })}` },
        ].map(c => (
          <div key={c.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400">{c.label}</p>
            <p className="text-2xl font-bold text-white mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {adding && <LotForm onSave={addLot} onCancel={() => setAdding(false)} />}
      {editing !== null && <LotForm initial={lots[editing]} onSave={updateLot} onCancel={() => setEditing(null)} />}

      {/* Lot table */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <label className="text-xs text-slate-400">Filter by ticker:</label>
          <select value={filterSym} onChange={e => setFilterSym(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
            <option value="all">All</option>
            {symbols.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/60">
                  {['Ticker','Shares','Cost Basis','Total Basis','Purchase Date','Hold Period','Term','Notes',''].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((lot, i) => {
                  const idx = lots.indexOf(lot)
                  const days = daysBetween(lot.purchaseDate, today())
                  const isLT = days >= 365
                  const totalBasisLot = Number(lot.shares) * Number(lot.costBasis)
                  return (
                    <tr key={lot.id || i} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                      <td className="px-3 py-2.5 font-bold text-white">{lot.symbol}</td>
                      <td className="px-3 py-2.5 text-slate-300 tabular-nums">{Number(lot.shares).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-slate-300 tabular-nums">${Number(lot.costBasis).toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-slate-300 tabular-nums font-medium">${totalBasisLot.toLocaleString('en-US', { minimumFractionDigits: 0 })}</td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs tabular-nums">{lot.purchaseDate}</td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs tabular-nums">{days >= 365 ? `${Math.floor(days/365)}yr ${days%365}d` : `${days}d`}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isLT ? 'bg-emerald-900/40 text-emerald-400' : 'bg-orange-900/40 text-orange-400'}`}>
                          {isLT ? 'Long-term' : 'Short-term'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">{lot.notes}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-2">
                          <button onClick={() => { setEditing(idx); setAdding(false) }} className="text-xs text-slate-400 hover:text-blue-400">Edit</button>
                          <button onClick={() => deleteLot(idx)} className="text-xs text-slate-400 hover:text-red-400">Del</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-12 text-center text-slate-500">No lots yet. Click "+ Add Lot" to start tracking your cost basis.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Sell simulator */}
      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider">Sell Optimizer</h2>
        <p className="text-xs text-slate-400">Simulate a sale and see which lots minimize your tax bill.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Ticker to sell</label>
            <input value={sellSym} onChange={e => setSellSym(e.target.value.toUpperCase())}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              placeholder="AAPL" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Shares to sell</label>
            <input type="number" value={sellShares} onChange={e => setSellShares(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              placeholder="50" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Current price ($)</label>
            <input type="number" value={sellPrice} onChange={e => setSellPrice(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              placeholder="200.00" step="0.01" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Lot selection method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
              <option value="MinTax">Min Tax (recommended)</option>
              <option value="FIFO">FIFO (oldest first)</option>
              <option value="LIFO">LIFO (newest first)</option>
              <option value="HighCost">Highest Cost First</option>
              <option value="LowCost">Lowest Cost First</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Your other ordinary income (MFJ, for bracket calc)</label>
            <input type="number" value={income} onChange={e => setIncome(Number(e.target.value))}
              className="w-48 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              step="10000" />
          </div>
          <button onClick={simulateSale}
            className="self-end px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors">
            Simulate Sale
          </button>
        </div>

        {sellResult && (
          sellResult.error ? (
            <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm">{sellResult.error}</div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-4 flex-wrap">
                <div className="bg-slate-900/60 rounded-lg p-3 min-w-[120px]">
                  <p className="text-xs text-slate-400">Total Gain / Loss</p>
                  <p className={`text-xl font-bold ${sellResult.totalGain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {sellResult.totalGain >= 0 ? '+' : ''}${sellResult.totalGain.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="bg-slate-900/60 rounded-lg p-3 min-w-[120px]">
                  <p className="text-xs text-slate-400">Est. Tax Owed</p>
                  <p className="text-xl font-bold text-orange-400">${sellResult.totalTax.toLocaleString('en-US', { minimumFractionDigits: 0 })}</p>
                </div>
                <div className="bg-slate-900/60 rounded-lg p-3 min-w-[120px]">
                  <p className="text-xs text-slate-400">After-Tax Proceeds</p>
                  <p className="text-xl font-bold text-white">${((sellResult.price * sellResult.shares) - sellResult.totalTax).toLocaleString('en-US', { minimumFractionDigits: 0 })}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700">
                      {['Lot Date','Shares Used','Cost Basis','Gain/Loss','Hold','Term','Est. Tax'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-slate-400 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sellResult.usedLots.map((l, i) => (
                      <tr key={i} className="border-b border-slate-700/40">
                        <td className="px-3 py-2 text-slate-300">{l.purchaseDate}</td>
                        <td className="px-3 py-2 text-slate-300 tabular-nums">{l.used}</td>
                        <td className="px-3 py-2 text-slate-300 tabular-nums">${l.basisN.toFixed(2)}</td>
                        <td className={`px-3 py-2 tabular-nums font-semibold ${l.gain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {l.gain >= 0 ? '+' : ''}${l.gain.toFixed(0)}
                        </td>
                        <td className="px-3 py-2 text-slate-400 tabular-nums">{l.holdDays}d</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${l.isLT ? 'text-emerald-400' : 'text-orange-400'}`}>
                            {l.isLT ? 'LT' : 'ST'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-orange-400 tabular-nums">${l.tax.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">Tax estimates use 2025 MFJ federal brackets and LTCG rates. State taxes not included. Consult a tax professional before trading.</p>
            </div>
          )
        )}
      </div>
    </div>
  )
}
