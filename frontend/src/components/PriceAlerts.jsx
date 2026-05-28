import { useState, useEffect } from 'react'

// ── Bell icon with active-alert badge ────────────────────────────────────────

export function AlertBellButton({ symbol, alerts, onClick }) {
  const active = alerts.filter(a => a.symbol === symbol && a.status === 'active').length
  const triggered = alerts.filter(a => a.symbol === symbol && a.status === 'triggered').length
  const count = active + triggered

  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(symbol) }}
      title={count ? `${count} alert${count > 1 ? 's' : ''} for ${symbol}` : `Set price alert for ${symbol}`}
      className="relative text-gray-600 hover:text-amber-400 transition-colors p-0.5"
    >
      {count > 0 ? (
        // Filled bell
        <svg className={`w-3.5 h-3.5 ${triggered > 0 ? 'text-amber-400' : 'text-sky-400'}`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-2.83-2h5.66A3 3 0 0110 18z" />
        </svg>
      ) : (
        // Outline bell
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      )}
      {count > 0 && (
        <span className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[9px] font-bold flex items-center justify-center text-white ${triggered > 0 ? 'bg-amber-500' : 'bg-sky-500'}`}>
          {count}
        </span>
      )}
    </button>
  )
}

// ── Per-symbol alert modal ─────────────────────────────────────────────────

const ALERT_TYPES = [
  { id: 'price',        label: 'Price',        desc: 'Fixed $ price level' },
  { id: 'pct_change',   label: '% Move',       desc: 'Daily % change threshold' },
  { id: 'week52_break', label: '52-Wk Break',  desc: 'New 52-week high/low' },
  { id: 'volume_spike', label: 'Volume Spike', desc: 'Volume × avg multiplier' },
]

function alertLabel(a) {
  switch (a.alert_type) {
    case 'pct_change':
      return `${a.condition === 'above' ? '↑' : '↓'} ${a.trigger_value ?? 5}% daily move`
    case 'week52_break':
      return a.condition === 'above' ? '↑ 52-wk high break' : '↓ 52-wk low break'
    case 'volume_spike':
      return `Vol ≥ ${a.trigger_value ?? 2}× avg`
    default:
      return `${a.condition === 'above' ? '↑' : '↓'} $${a.target_price.toFixed(2)}`
  }
}

export function AlertModal({ symbol, currentPrice, alerts, onClose, onAdd, onDelete, onDismiss }) {
  const [alertType,   setAlertType]   = useState('price')
  const [condition,   setCondition]   = useState('above')
  const [targetPrice, setTargetPrice] = useState('')
  const [triggerVal,  setTriggerVal]  = useState('')
  const [note,        setNote]        = useState('')
  const [adding,      setAdding]      = useState(false)
  const [err,         setErr]         = useState('')

  const needsPrice   = alertType === 'price'
  const needsTrigger = alertType === 'pct_change' || alertType === 'volume_spike'
  const needsCondition = alertType !== 'volume_spike'

  const symAlerts = alerts
    .filter(a => a.symbol === symbol && a.status !== 'dismissed')
    .sort((a, b) => (a.status === 'triggered' ? 1 : 0) - (b.status === 'triggered' ? 1 : 0))

  async function handleAdd(e) {
    e.preventDefault()
    let price = parseFloat(targetPrice)
    const tval = parseFloat(triggerVal) || null

    if (needsPrice && (isNaN(price) || price <= 0)) { setErr('Enter a valid price'); return }
    if (!needsPrice) price = 0

    setAdding(true); setErr('')
    try {
      const r = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          target_price:  price,
          condition:     needsCondition ? condition : 'above',
          note:          note.trim(),
          alert_type:    alertType,
          trigger_value: needsTrigger ? tval : null,
        }),
      })
      if (!r.ok) throw new Error('Failed to save')
      const created = await r.json()
      onAdd(symbol, price, needsCondition ? condition : 'above', note.trim(), alertType, tval, created)
      setTargetPrice(''); setTriggerVal(''); setNote('')
    } catch { setErr('Failed to save alert') }
    finally { setAdding(false) }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="text-white font-bold text-lg">{symbol} — Price Alerts</div>
            {currentPrice != null && (
              <div className="text-gray-400 text-sm mt-0.5">Current: <span className="text-white font-medium">${currentPrice.toFixed(2)}</span></div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none mt-0.5">×</button>
        </div>

        {/* Add form */}
        <form onSubmit={handleAdd} className="space-y-2.5 mb-5">
          <div className="text-gray-500 text-xs uppercase tracking-widest">New Alert</div>

          {/* Alert type selector */}
          <div className="grid grid-cols-2 gap-1.5">
            {ALERT_TYPES.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setAlertType(t.id)}
                className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                  alertType === t.id
                    ? 'border-emerald-600 bg-emerald-900/30 text-emerald-300'
                    : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
                }`}
              >
                <div className="font-medium">{t.label}</div>
                <div className="text-gray-600 text-[10px] mt-0.5">{t.desc}</div>
              </button>
            ))}
          </div>

          {/* Condition + value row */}
          <div className="flex gap-2">
            {needsCondition && (
              <select
                value={condition}
                onChange={e => setCondition(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
              >
                <option value="above">↑ Above</option>
                <option value="below">↓ Below</option>
              </select>
            )}

            {needsPrice && (
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input
                  type="number"
                  value={targetPrice}
                  onChange={e => setTargetPrice(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0.01"
                  required
                  className="w-full bg-gray-800 border border-gray-700 text-white pl-7 pr-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            )}

            {needsTrigger && (
              <div className="relative flex-1">
                <input
                  type="number"
                  value={triggerVal}
                  onChange={e => setTriggerVal(e.target.value)}
                  placeholder={alertType === 'pct_change' ? '5 (%)' : '2 (×avg)'}
                  step="0.1"
                  min="0.1"
                  className="w-full bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">
                  {alertType === 'pct_change' ? '%' : '×'}
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={adding}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
            >
              {adding ? '…' : 'Add'}
            </button>
          </div>

          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional note"
            maxLength={120}
            className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 transition-colors"
          />
          {err && <div className="text-red-400 text-xs">{err}</div>}
        </form>

        {/* Existing alerts */}
        {symAlerts.length === 0 ? (
          <div className="text-gray-600 text-sm text-center py-6 border border-dashed border-gray-800 rounded-xl">
            No active alerts for {symbol}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-gray-500 text-xs uppercase tracking-widest mb-1">Active Alerts</div>
            {symAlerts.map(a => (
              <div
                key={a.id}
                className={`flex items-center gap-2 p-2.5 rounded-lg border ${
                  a.status === 'triggered'
                    ? 'border-amber-700/50 bg-amber-950/40'
                    : 'border-gray-800 bg-gray-800/50'
                }`}
              >
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium ${
                  (a.condition === 'above' || a.alert_type === 'volume_spike')
                    ? 'bg-emerald-900/60 text-emerald-400'
                    : 'bg-red-900/60 text-red-400'
                }`}>
                  {alertLabel(a)}
                </span>

                <span className="text-gray-500 text-xs flex-1 truncate min-w-0">{a.note}</span>

                {a.status === 'triggered' ? (
                  <>
                    <span className="text-amber-400 text-xs shrink-0">⚡ Triggered</span>
                    <button
                      onClick={() => onDismiss(a.id)}
                      className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded px-1.5 py-0.5 transition-colors shrink-0"
                    >
                      Dismiss
                    </button>
                  </>
                ) : (
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-pulse" />
                    <span className="text-gray-600 text-xs">Active</span>
                  </span>
                )}

                <button
                  onClick={() => onDelete(a.id)}
                  className="text-gray-700 hover:text-red-400 transition-colors text-lg leading-none shrink-0"
                  title="Delete alert"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Toast notification for triggered alert ────────────────────────────────────

export function AlertToast({ alert, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 7000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className="flex items-center gap-3 bg-gray-900 border border-amber-700/70 rounded-xl p-3.5 shadow-2xl w-72 animate-slide-in">
      <div className="w-9 h-9 rounded-full bg-amber-900/50 flex items-center justify-center shrink-0 text-lg">🔔</div>
      <div className="flex-1 min-w-0">
        <div className="text-white text-sm font-semibold">{alert.symbol} Alert</div>
        <div className="text-amber-300 text-xs mt-0.5">
          Price {alert.condition === 'above' ? 'crossed above' : 'fell below'} ${alert.target_price.toFixed(2)}
        </div>
        {alert.note && <div className="text-gray-500 text-xs truncate mt-0.5">{alert.note}</div>}
      </div>
      <button onClick={onClose} className="text-gray-600 hover:text-white text-xl leading-none shrink-0">×</button>
    </div>
  )
}
