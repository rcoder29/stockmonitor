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
        </div>
      </div>
    </header>
  )
}
