import { useState, useEffect, useCallback, useRef } from 'react'
import Header from './components/Header'
import StockTable from './components/StockTable'
import ChartModal from './components/ChartModal'
import MarketSummary from './components/MarketSummary'

const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA']

const TABS = [
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'market',    label: 'Market Summary' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('watchlist')
  const [watchlist, setWatchlist] = useState(() => {
    try {
      const saved = localStorage.getItem('stockmonitor-watchlist')
      return saved ? JSON.parse(saved) : DEFAULT_WATCHLIST
    } catch {
      return DEFAULT_WATCHLIST
    }
  })
  const [quotes, setQuotes] = useState({})
  const [refreshInterval, setRefreshInterval] = useState(30)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [countdown, setCountdown] = useState(30)
  const [priceFlash, setPriceFlash] = useState({})
  const [chartSymbol, setChartSymbol] = useState(null)
  const prevPricesRef = useRef({})
  const flashTimerRef = useRef(null)

  useEffect(() => {
    localStorage.setItem('stockmonitor-watchlist', JSON.stringify(watchlist))
  }, [watchlist])

  const fetchQuotes = useCallback(async () => {
    if (watchlist.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/quotes?symbols=${watchlist.join(',')}`)
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()

      const newFlash = {}
      data.forEach((q) => {
        if (q.price != null) {
          const prev = prevPricesRef.current[q.symbol]
          if (prev != null && prev !== q.price) {
            newFlash[q.symbol] = q.price > prev ? 'up' : 'down'
          }
          prevPricesRef.current[q.symbol] = q.price
        }
      })

      if (Object.keys(newFlash).length > 0) {
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
        setPriceFlash(newFlash)
        flashTimerRef.current = setTimeout(() => setPriceFlash({}), 1200)
      }

      setQuotes((prev) => {
        const next = { ...prev }
        data.forEach((q) => { next[q.symbol] = q })
        return next
      })
      setLastUpdated(new Date())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [watchlist])

  // Re-fetch and reset interval when watchlist or refreshInterval changes
  useEffect(() => {
    fetchQuotes()
    setCountdown(refreshInterval)
    const interval = setInterval(() => {
      fetchQuotes()
      setCountdown(refreshInterval)
    }, refreshInterval * 1000)
    return () => clearInterval(interval)
  }, [fetchQuotes, refreshInterval])

  // Countdown ticker
  useEffect(() => {
    setCountdown(refreshInterval)
    const timer = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [refreshInterval, lastUpdated])

  const addTicker = (sym) => {
    const upper = sym.toUpperCase().trim()
    if (upper && !watchlist.includes(upper)) {
      setWatchlist((prev) => [...prev, upper])
    }
  }

  const removeTicker = (sym) => {
    setWatchlist((prev) => prev.filter((s) => s !== sym))
    setQuotes((prev) => {
      const next = { ...prev }
      delete next[sym]
      return next
    })
    delete prevPricesRef.current[sym]
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Header
        loading={loading}
        error={error}
        lastUpdated={lastUpdated}
        refreshInterval={refreshInterval}
        setRefreshInterval={setRefreshInterval}
        countdown={countdown}
        onRefresh={fetchQuotes}
        onAddTicker={addTicker}
      />

      {/* Top-level tab bar */}
      <nav className="bg-gray-900 border-b border-gray-800 px-4">
        <div className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2.5 px-4 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.id
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main>
        {activeTab === 'watchlist' && (
          <div className="p-4">
            <StockTable
              watchlist={watchlist}
              quotes={quotes}
              priceFlash={priceFlash}
              onRemove={removeTicker}
              onChartOpen={setChartSymbol}
            />
          </div>
        )}
        {activeTab === 'market' && <MarketSummary />}
      </main>

      {chartSymbol && (
        <ChartModal
          symbol={chartSymbol}
          quote={quotes[chartSymbol]}
          onClose={() => setChartSymbol(null)}
        />
      )}
    </div>
  )
}
