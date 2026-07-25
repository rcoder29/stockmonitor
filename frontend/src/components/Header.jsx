import { useState } from 'react'

const INTERVALS = [
  { label: '5s', value: 5 },
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
]

export default function Header({
  loading,
  error,
  lastUpdated,
  refreshInterval,
  setRefreshInterval,
  countdown,
  onRefresh,
  onAddTicker,
  wsConnected,
  notifPermission,
  onRequestNotif,
  theme,
  onToggleTheme,
}) {
  const [input, setInput] = useState('')

  const handleAdd = (e) => {
    e.preventDefault()
    const sym = input.trim().toUpperCase()
    if (sym) {
      onAddTicker(sym)
      setInput('')
    }
  }

  return (
    <header className="bg-gray-900 border-b border-gray-700 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-emerald-400 text-lg">◆</span>
          <span className="text-white font-bold text-base tracking-widest">STOCK MONITOR</span>
        </div>

        {/* Add ticker */}
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="TICKER"
            maxLength={10}
            className="bg-gray-800 border border-gray-600 text-white placeholder-gray-600 px-3 py-1.5 text-sm rounded w-28 focus:outline-none focus:border-emerald-500 uppercase"
          />
          <button
            type="submit"
            className="bg-emerald-800 hover:bg-emerald-700 text-emerald-100 px-3 py-1.5 text-sm rounded transition-colors"
          >
            + Add
          </button>
        </form>

        {/* Refresh interval */}
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs uppercase tracking-wider">Refresh</span>
          <div className="flex gap-1">
            {INTERVALS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setRefreshInterval(value)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  refreshInterval === value
                    ? 'bg-emerald-700 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* WS + Notif */}
        <div className="flex items-center gap-2">
          <span
            title={wsConnected ? 'Live prices connected' : 'Live prices disconnected'}
            className={`w-2 h-2 rounded-full shrink-0 transition-colors ${wsConnected ? 'bg-emerald-400' : 'bg-gray-600'}`}
          />
          {notifPermission === 'default' && (
            <button
              onClick={onRequestNotif}
              title="Enable browser notifications for price alerts"
              className="text-gray-600 hover:text-amber-400 text-xs border border-gray-700 rounded px-2 py-1 transition-colors"
            >
              🔔 Enable alerts
            </button>
          )}
        </div>

        {/* Status */}
        <div className="ml-auto flex items-center gap-3">
          {error && (
            <span className="text-red-400 text-xs">⚠ {error}</span>
          )}
          <span className="text-xs text-gray-500">
            {loading ? (
              <span className="text-emerald-400 animate-pulse">● Fetching…</span>
            ) : lastUpdated ? (
              <span>
                Updated {lastUpdated.toLocaleTimeString()} ·{' '}
                <span className={countdown <= 5 ? 'text-amber-400' : 'text-gray-500'}>
                  next in {countdown}s
                </span>
              </span>
            ) : (
              <span className="text-gray-600">Not yet loaded</span>
            )}
          </span>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-400 hover:text-white px-3 py-1 text-xs rounded transition-colors"
          >
            ↻
          </button>

          {/* Theme toggle */}
          <button
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white w-7 h-7 flex items-center justify-center rounded transition-colors shrink-0"
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                <path d="M8 11a3 3 0 100-6 3 3 0 000 6zm0 1a4 4 0 110-8 4 4 0 010 8zM8 0a.5.5 0 01.5.5v1a.5.5 0 01-1 0v-1A.5.5 0 018 0zm0 13a.5.5 0 01.5.5v1a.5.5 0 01-1 0v-1A.5.5 0 018 13zm8-5a.5.5 0 01-.5.5h-1a.5.5 0 010-1h1a.5.5 0 01.5.5zM2 8a.5.5 0 01-.5.5h-1a.5.5 0 010-1h1A.5.5 0 012 8zm10.657-5.657a.5.5 0 010 .707l-.707.707a.5.5 0 11-.707-.707l.707-.707a.5.5 0 01.707 0zm-9.193 9.193a.5.5 0 010 .707l-.707.707a.5.5 0 01-.707-.707l.707-.707a.5.5 0 01.707 0zm9.193.707a.5.5 0 01-.707 0l-.707-.707a.5.5 0 01.707-.707l.707.707a.5.5 0 010 .707zM3.464 3.464a.5.5 0 01.707 0l.707.707a.5.5 0 01-.707.707l-.707-.707a.5.5 0 010-.707z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                <path d="M6 .278a.768.768 0 01.08.858 7.208 7.208 0 00-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 01.81.316.733.733 0 01-.031.893A8.349 8.349 0 018.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 016 .278z"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
