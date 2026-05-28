import { useEffect, useState } from 'react'

const today = new Date().toISOString().slice(0, 10)

function ProgressBar({ current, target }) {
  if (!current || !target) return null
  const bullish = target > current
  const pct = Math.min(100, Math.max(0, bullish
    ? (current / target) * 100
    : (target / current) * 100))
  const remaining = ((target / current - 1) * 100).toFixed(1)
  const color = bullish ? 'bg-emerald-500' : 'bg-red-500'
  const textColor = bullish ? 'text-emerald-400' : 'text-red-400'

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-600">${current.toFixed(2)}</span>
        <span className={`font-semibold ${textColor}`}>{remaining >= 0 ? '+' : ''}{remaining}% to target</span>
        <span className="text-gray-500">${target.toFixed(2)}</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function DaysChip({ days }) {
  if (days == null) return null
  if (days < 0)  return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-600">Passed</span>
  if (days === 0) return <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/50 text-red-300">Today</span>
  if (days <= 7)  return <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/30 text-red-400">{days}d</span>
  if (days <= 30) return <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400">{days}d</span>
  return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{days}d</span>
}

export default function PriceTargets() {
  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(true)

  // form
  const [sym,    setSym]    = useState('')
  const [price,  setPrice]  = useState('')
  const [date,   setDate]   = useState('')
  const [note,   setNote]   = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => { fetchTargets() }, [])

  function fetchTargets() {
    setLoading(true)
    fetch('/api/price-targets')
      .then(r => r.json()).then(setTargets).finally(() => setLoading(false))
  }

  async function addTarget(e) {
    e.preventDefault()
    if (!sym || !price) return
    setAdding(true)
    await fetch('/api/price-targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: sym.toUpperCase().trim(), target_price: Number(price), target_date: date, note }),
    })
    setSym(''); setPrice(''); setDate(''); setNote('')
    setAdding(false)
    fetchTargets()
  }

  async function remove(id) {
    await fetch(`/api/price-targets/${id}`, { method: 'DELETE' })
    setTargets(t => t.filter(x => x.id !== id))
  }

  const sorted = [...targets].sort((a, b) => {
    const aPct = Math.abs(a.pct_to_target ?? 0)
    const bPct = Math.abs(b.pct_to_target ?? 0)
    return bPct - aPct
  })

  return (
    <div className="space-y-6">
      <div className="text-gray-500 text-xs uppercase tracking-widest">Price Target Tracker</div>

      {/* Add form */}
      <form onSubmit={addTarget} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        <div className="text-gray-600 text-xs uppercase tracking-wider mb-3">Set Target</div>
        <div className="flex flex-wrap gap-3 items-end">
          {[
            { label: 'Symbol',      val: sym,   set: e => setSym(e.target.value.toUpperCase()), placeholder: 'AAPL', width: 'w-20' },
            { label: 'Target ($)',  val: price, set: e => setPrice(e.target.value), placeholder: '220.00', width: 'w-24', type: 'number', step: '0.01' },
            { label: 'Deadline',    val: date,  set: e => setDate(e.target.value),  placeholder: '',        width: 'w-36', type: 'date', min: today },
            { label: 'Note',        val: note,  set: e => setNote(e.target.value),  placeholder: 'thesis…', width: 'w-52' },
          ].map(({ label, val, set, placeholder, width, type: t = 'text', min, step }) => (
            <div key={label}>
              <label className="text-gray-600 text-xs block mb-1">{label}</label>
              <input type={t} value={val} onChange={set} placeholder={placeholder} min={min} step={step}
                className={`${width} bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-sky-600`} />
            </div>
          ))}
          <button type="submit" disabled={adding || !sym || !price}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 transition-colors">
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </div>
      </form>

      {loading && <div className="py-8 text-center text-gray-500 text-sm animate-pulse">Loading targets…</div>}

      {!loading && sorted.length === 0 && (
        <div className="py-8 text-center text-gray-700 text-sm">No price targets set. Add one above.</div>
      )}

      {/* Target cards */}
      {!loading && sorted.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {sorted.map(t => {
            const bullish = (t.target_price ?? 0) > (t.current_price ?? 0)
            const reached = t.current_price && (bullish ? t.current_price >= t.target_price : t.current_price <= t.target_price)
            return (
              <div key={t.id} className={`bg-gray-900/60 border rounded-xl p-4 space-y-3 ${reached ? 'border-amber-600/50' : 'border-gray-800'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-bold text-sm">{t.symbol}</span>
                      {reached && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 font-semibold">Target Reached!</span>}
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${bullish ? 'bg-emerald-900/30 text-emerald-500' : 'bg-red-900/30 text-red-400'}`}>
                        {bullish ? '▲ Long' : '▼ Short'}
                      </span>
                    </div>
                    {t.note && <div className="text-gray-500 text-xs mt-1 max-w-xs truncate">{t.note}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.target_date && <DaysChip days={t.days_remaining} />}
                    <button onClick={() => remove(t.id)} className="text-gray-700 hover:text-red-400 text-xs transition-colors">✕</button>
                  </div>
                </div>

                <ProgressBar current={t.current_price} target={t.target_price} />

                <div className="flex flex-wrap gap-4 text-xs">
                  <div>
                    <span className="text-gray-600">Current </span>
                    <span className="text-white font-semibold tabular-nums">{t.current_price ? `$${t.current_price.toFixed(2)}` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Target </span>
                    <span className={`font-semibold tabular-nums ${bullish ? 'text-emerald-400' : 'text-red-400'}`}>${t.target_price.toFixed(2)}</span>
                  </div>
                  {t.analyst_consensus && (
                    <div>
                      <span className="text-gray-600">Analyst Consensus </span>
                      <span className="text-sky-400 font-semibold tabular-nums">${t.analyst_consensus.toFixed(2)}</span>
                    </div>
                  )}
                  {t.target_date && (
                    <div>
                      <span className="text-gray-600">Deadline </span>
                      <span className="text-gray-400">{t.target_date}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
