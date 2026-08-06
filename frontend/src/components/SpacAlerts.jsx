import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || ''

const ALERT_TYPES = [
  { value: 'deadline_approaching', label: 'Deadline Approaching',        paramKey: 'days', paramLabel: 'Days threshold', defaultVal: 30,   hasDirection: false },
  { value: 'discount_threshold',   label: 'Discount/Premium Threshold',  paramKey: 'pct',  paramLabel: '% threshold',    defaultVal: -3.0, hasDirection: true  },
  { value: 'deal_announced',       label: 'Deal Announced',              paramKey: null,   paramLabel: null,             defaultVal: null, hasDirection: false },
]

const TYPE_BADGES = {
  deadline_approaching: 'bg-orange-900/40 text-orange-400',
  discount_threshold:   'bg-emerald-900/40 text-emerald-400',
  deal_announced:        'bg-sky-900/40 text-sky-400',
}

function TypeBadge({ type }) {
  const meta  = ALERT_TYPES.find(a => a.value === type)
  const badge = TYPE_BADGES[type] ?? 'bg-gray-800 text-gray-400'
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${badge}`}>
      {meta?.label ?? type}
    </span>
  )
}

export default function SpacAlerts() {
  const [spacs,      setSpacs]      = useState([])
  const [rules,      setRules]      = useState([])
  const [triggered,  setTriggered]  = useState([])
  const [scanning,   setScanning]   = useState(false)
  const [loading,    setLoading]    = useState(true)

  const [spacId,    setSpacId]    = useState('')
  const [alertType, setAlertType] = useState('deadline_approaching')
  const [paramVal,  setParamVal]  = useState(30)
  const [direction, setDirection] = useState('below')
  const [adding,    setAdding]    = useState(false)

  const selectedMeta = ALERT_TYPES.find(a => a.value === alertType)

  useEffect(() => {
    fetchRules()
    fetch(`${API}/api/spac/deals`).then(r => r.json()).then(setSpacs).catch(() => setSpacs([]))
  }, [])

  function fetchRules() {
    setLoading(true)
    fetch(`${API}/api/spac/alerts`)
      .then(r => r.json())
      .then(setRules)
      .finally(() => setLoading(false))
  }

  async function addRule(e) {
    e.preventDefault()
    if (!spacId) return
    setAdding(true)
    let params = {}
    if (selectedMeta?.hasDirection) params = { direction, pct: Number(paramVal) }
    else if (selectedMeta?.paramKey) params = { [selectedMeta.paramKey]: Number(paramVal) }
    await fetch(`${API}/api/spac/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spac_id: parseInt(spacId), alert_type: alertType, params }),
    })
    setAdding(false)
    fetchRules()
  }

  async function deleteRule(id) {
    await fetch(`${API}/api/spac/alerts/${id}`, { method: 'DELETE' })
    setRules(prev => prev.filter(r => r.id !== id))
  }

  async function scan() {
    setScanning(true); setTriggered([])
    try {
      const res = await fetch(`${API}/api/spac/alerts/scan`, { method: 'POST' })
      setTriggered(await res.json())
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="p-4 text-white max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">SPACs — Alerts</h1>
          <p className="text-sm text-slate-400">Redemption deadlines, discount/premium thresholds, and deal announcements on your tracked SPACs</p>
        </div>
        <button
          onClick={scan}
          disabled={scanning || rules.length === 0}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40 transition-colors"
        >
          {scanning ? 'Scanning…' : `Scan ${rules.length} Rule${rules.length !== 1 ? 's' : ''}`}
        </button>
      </div>

      {/* Add rule form */}
      <form onSubmit={addRule} className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-slate-500 text-xs block mb-1">SPAC</label>
          <select
            value={spacId}
            onChange={e => setSpacId(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white w-48 focus:outline-none focus:border-sky-600"
          >
            <option value="">Select a tracked SPAC…</option>
            {spacs.map(s => <option key={s.id} value={s.id}>{s.ticker} — {s.companyName}</option>)}
          </select>
        </div>
        <div>
          <label className="text-slate-500 text-xs block mb-1">Alert Type</label>
          <select
            value={alertType}
            onChange={e => {
              const meta = ALERT_TYPES.find(a => a.value === e.target.value)
              setAlertType(e.target.value)
              setParamVal(meta?.defaultVal ?? 0)
              setDirection('below')
            }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-600"
          >
            {ALERT_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        {selectedMeta?.hasDirection && (
          <div>
            <label className="text-slate-500 text-xs block mb-1">Direction</label>
            <select
              value={direction}
              onChange={e => setDirection(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-600"
            >
              <option value="below">At or below</option>
              <option value="above">At or above</option>
            </select>
          </div>
        )}
        {selectedMeta?.paramKey && (
          <div>
            <label className="text-slate-500 text-xs block mb-1">{selectedMeta.paramLabel}</label>
            <input
              type="number"
              step="0.5"
              value={paramVal}
              onChange={e => setParamVal(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white w-28 focus:outline-none focus:border-sky-600"
            />
          </div>
        )}
        <button
          type="submit"
          disabled={adding || !spacId || spacs.length === 0}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 transition-colors"
        >
          {adding ? 'Adding…' : '+ Add Rule'}
        </button>
        {spacs.length === 0 && <span className="text-xs text-amber-400">No tracked SPACs — add one on the Tracker first.</span>}
      </form>

      {/* Scan results */}
      {triggered.length > 0 && (
        <div className="bg-amber-900/10 border border-amber-700/30 rounded-xl p-4">
          <div className="text-amber-400 text-xs uppercase tracking-widest font-semibold mb-3">
            {triggered.length} Alert{triggered.length !== 1 ? 's' : ''} Triggered
          </div>
          <div className="space-y-2">
            {triggered.map((t, i) => (
              <div key={i} className="flex items-center gap-3 flex-wrap">
                <span className="text-white font-semibold text-sm">{t.ticker}</span>
                <TypeBadge type={t.alertType} />
                <span className="text-slate-400 text-sm">{t.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {scanning && (
        <div className="text-center text-slate-500 text-sm animate-pulse py-4">Checking {rules.length} rules…</div>
      )}

      {/* Rules list */}
      {loading ? (
        <div className="py-6 text-center text-slate-500 text-sm animate-pulse">Loading rules…</div>
      ) : rules.length === 0 ? (
        <div className="py-8 text-center text-slate-600 text-sm">No SPAC alert rules yet. Add one above.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/80">
                <th className="py-2.5 px-4 text-left text-slate-500 font-medium text-xs uppercase tracking-wider">SPAC</th>
                <th className="py-2.5 px-4 text-left text-slate-500 font-medium text-xs uppercase tracking-wider">Type</th>
                <th className="py-2.5 px-4 text-left text-slate-500 font-medium text-xs uppercase tracking-wider">Parameters</th>
                <th className="py-2.5 px-4 text-left text-slate-500 font-medium text-xs uppercase tracking-wider">Created</th>
                <th className="py-2.5 px-4" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => {
                const paramStr = Object.entries(r.params).map(([k, v]) => `${k}: ${v}`).join(', ')
                return (
                  <tr key={r.id} className={`border-b border-slate-700/40 hover:bg-slate-800/30 ${i % 2 ? 'bg-slate-800/20' : ''}`}>
                    <td className="py-2.5 px-4">
                      <div className="text-white font-semibold">{r.ticker}</div>
                      <div className="text-slate-500 text-xs truncate max-w-[180px]">{r.companyName}</div>
                    </td>
                    <td className="py-2.5 px-4"><TypeBadge type={r.alertType} /></td>
                    <td className="py-2.5 px-4 text-slate-500 text-xs">{paramStr || '—'}</td>
                    <td className="py-2.5 px-4 text-slate-600 text-xs">{r.createdAt?.slice(0, 10)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        onClick={() => deleteRule(r.id)}
                        className="text-slate-600 hover:text-red-400 text-xs transition-colors"
                      >Remove</button>
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
