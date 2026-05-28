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

export function AlertModal({ symbol, currentPrice, alerts, onClose, onAdd, onDelete, onDismiss }) {
  const [condition,   setCondition]   = useState('above')
  const [targetPrice, setTargetPrice] = useState('')
  const [note,        setNote]        = useState('')
  const [adding,      setAdding]      = useState(false)
  const [err,         setErr]         = useState('')

  const symAlerts = alerts
    .filter(a => a.symbol === symbol && a.status !== 'dismissed')
    .sort((a, b) => (a.status === 'triggered' ? 1 : 0) - (b.status === 'triggered' ? 1 : 0))

  async function handleAdd(e) {
    e.preventDefault()
    const price = parseFloat(targetPrice)
    if (isNaN(price) || price <= 0) { setErr('Enter a valid price'); return }
    setAdding(true); setErr('')
    try {
      await onAdd(symbol, price, condition, note.trim())
      setTargetPrice(''); setNote('')
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
              <div className="text-gray-400 text-sm mt-0.5">Current price: <span className="text-white font-medium">${currentPrice.toFixed(2)}</span></div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none mt-0.5">×</button>
        </div>

        {/* Add form */}
        <form onSubmit={handleAdd} className="space-y-2.5 mb-5">
          <div className="text-gray-500 text-xs uppercase tracking-widest">New Alert</div>
          <div className="flex gap-2">
            <select
              value={condition}
              onChange={e => setCondition(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
            >
              <option value="above">↑ Above</option>
              <option value="below">↓ Below</option>
            </select>
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
            placeholder="Optional note (e.g. break above resistance)"
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
                  a.condition === 'above'
                    ? 'bg-emerald-900/60 text-emerald-400'
                    : 'bg-red-900/60 text-red-400'
                }`}>
                  {a.condition === 'above' ? '↑' : '↓'} ${a.target_price.toFixed(2)}
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
