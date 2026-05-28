import { useEffect, useState } from 'react'

const ALERT_TYPES = [
  { value: 'volume_spike',       label: 'Volume Spike',             paramKey: 'multiplier', paramLabel: 'Multiplier', defaultVal: 2.0 },
  { value: 'gap_up',             label: 'Gap Up',                   paramKey: 'pct',        paramLabel: 'Min %',       defaultVal: 2.0 },
  { value: 'gap_down',           label: 'Gap Down',                 paramKey: 'pct',        paramLabel: 'Min %',       defaultVal: 2.0 },
  { value: 'rsi_overbought',     label: 'RSI Overbought',           paramKey: 'threshold',  paramLabel: 'Threshold',   defaultVal: 70  },
  { value: 'rsi_oversold',       label: 'RSI Oversold',             paramKey: 'threshold',  paramLabel: 'Threshold',   defaultVal: 30  },
  { value: 'golden_cross',       label: 'Golden Cross (MA50/200)',  paramKey: null,         paramLabel: null,          defaultVal: null },
  { value: 'death_cross',        label: 'Death Cross (MA50/200)',   paramKey: null,         paramLabel: null,          defaultVal: null },
  { value: 'earnings_proximity', label: 'Earnings Proximity',       paramKey: 'days',       paramLabel: 'Days out',    defaultVal: 5   },
]

const TYPE_BADGES = {
  volume_spike:       'bg-purple-900/40 text-purple-300',
  gap_up:             'bg-emerald-900/40 text-emerald-400',
  gap_down:           'bg-red-900/40 text-red-400',
  rsi_overbought:     'bg-orange-900/40 text-orange-400',
  rsi_oversold:       'bg-sky-900/40 text-sky-400',
  golden_cross:       'bg-yellow-900/40 text-yellow-400',
  death_cross:        'bg-rose-900/40 text-rose-400',
  earnings_proximity: 'bg-indigo-900/40 text-indigo-400',
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

export default function SmartAlerts() {
  const [rules,       setRules]       = useState([])
  const [triggered,   setTriggered]   = useState([])
  const [scanning,    setScanning]    = useState(false)
  const [loading,     setLoading]     = useState(true)

  // form state
  const [symbol,    setSymbol]    = useState('')
  const [alertType, setAlertType] = useState('volume_spike')
  const [paramVal,  setParamVal]  = useState(2.0)
  const [adding,    setAdding]    = useState(false)

  const selectedMeta = ALERT_TYPES.find(a => a.value === alertType)

  useEffect(() => {
    fetchRules()
  }, [])

  function fetchRules() {
    setLoading(true)
    fetch('/api/alerts/smart')
      .then(r => r.json())
      .then(setRules)
      .finally(() => setLoading(false))
  }

  async function addRule(e) {
    e.preventDefault()
    if (!symbol.trim()) return
    setAdding(true)
    const params = selectedMeta?.paramKey ? { [selectedMeta.paramKey]: Number(paramVal) } : {}
    await fetch('/api/alerts/smart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: symbol.toUpperCase().trim(), alert_type: alertType, params }),
    })
    setSymbol('')
    setAdding(false)
    fetchRules()
  }

  async function deleteRule(id) {
    await fetch(`/api/alerts/smart/${id}`, { method: 'DELETE' })
    setRules(prev => prev.filter(r => r.id !== id))
  }

  async function scan() {
    setScanning(true); setTriggered([])
    try {
      const res = await fetch('/api/alerts/smart/scan', { method: 'POST' })
      setTriggered(await res.json())
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Smart Alerts 2.0</div>
        <button
          onClick={scan}
          disabled={scanning || rules.length === 0}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40 transition-colors"
        >
          {scanning ? 'Scanning…' : `Scan ${rules.length} Rule${rules.length !== 1 ? 's' : ''}`}
        </button>
      </div>

      {/* Add rule form */}
      <form onSubmit={addRule} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-gray-600 text-xs block mb-1">Symbol</label>
          <input
            value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
            placeholder="AAPL"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white w-24 focus:outline-none focus:border-sky-600"
          />
        </div>
        <div>
          <label className="text-gray-600 text-xs block mb-1">Alert Type</label>
          <select
            value={alertType}
            onChange={e => { setAlertType(e.target.value); setParamVal(ALERT_TYPES.find(a => a.value === e.target.value)?.defaultVal ?? 2) }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-600"
          >
            {ALERT_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        {selectedMeta?.paramKey && (
          <div>
            <label className="text-gray-600 text-xs block mb-1">{selectedMeta.paramLabel}</label>
            <input
              type="number"
              step="0.5"
              value={paramVal}
              onChange={e => setParamVal(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white w-24 focus:outline-none focus:border-sky-600"
            />
          </div>
        )}
        <button
          type="submit"
          disabled={adding || !symbol}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 transition-colors"
        >
          {adding ? 'Adding…' : '+ Add Rule'}
        </button>
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
                <span className="text-white font-semibold text-sm">{t.symbol}</span>
                <TypeBadge type={t.alert_type} />
                <span className="text-gray-400 text-sm">{t.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {scanning && (
        <div className="text-center text-gray-500 text-sm animate-pulse py-4">Checking {rules.length} rules…</div>
      )}

      {/* Rules list */}
      {loading ? (
        <div className="py-6 text-center text-gray-500 text-sm animate-pulse">Loading rules…</div>
      ) : rules.length === 0 ? (
        <div className="py-8 text-center text-gray-700 text-sm">No smart alert rules yet. Add one above.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/80">
                <th className="py-2.5 px-4 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Symbol</th>
                <th className="py-2.5 px-4 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Type</th>
                <th className="py-2.5 px-4 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Parameters</th>
                <th className="py-2.5 px-4 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Created</th>
                <th className="py-2.5 px-4" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => {
                const paramStr = Object.entries(r.params).map(([k, v]) => `${k}: ${v}`).join(', ')
                return (
                  <tr key={r.id} className={`border-b border-gray-800/40 hover:bg-gray-800/20 ${i % 2 ? 'bg-gray-900/20' : ''}`}>
                    <td className="py-2.5 px-4 text-white font-semibold">{r.symbol}</td>
                    <td className="py-2.5 px-4"><TypeBadge type={r.alert_type} /></td>
                    <td className="py-2.5 px-4 text-gray-500 text-xs">{paramStr || '—'}</td>
                    <td className="py-2.5 px-4 text-gray-600 text-xs">{r.created_at?.slice(0, 10)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        onClick={() => deleteRule(r.id)}
                        className="text-gray-700 hover:text-red-400 text-xs transition-colors"
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
