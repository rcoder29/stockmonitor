import { useState, useEffect, useCallback, useRef } from 'react'
import Header from './components/Header'
import StockTable from './components/StockTable'
import ChartModal from './components/ChartModal'
import MarketSummary from './components/MarketSummary'
import MarketRecommendations from './components/MarketRecommendations'
import PortfolioTracker from './components/PortfolioTracker'
import DayTrader from './components/DayTrader'
import AiBot from './components/AiBot'
import FinancialAdvisor from './components/FinancialAdvisor'
import Screener from './components/Screener'
import TradeJournal from './components/TradeJournal'
import MacroCalendar from './components/MacroCalendar'
import SectorDashboard from './components/SectorDashboard'
import { AlertModal, AlertToast } from './components/PriceAlerts'
import EarningsCalendar from './components/EarningsCalendar'

const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA']

const TABS = [
  { id: 'market',          label: 'Market Summary' },
  { id: 'recommendations', label: 'Market Recommendations' },
  { id: 'daytrader',       label: 'Day Trader' },
  { id: 'portfolio',       label: 'Portfolio' },
  { id: 'watchlist',       label: 'Watchlist' },
  { id: 'screener',        label: 'Screener' },
  { id: 'journal',         label: 'Journal' },
  { id: 'macro',           label: 'Macro Calendar' },
  { id: 'sectors',         label: 'Sector Rotation' },
  { id: 'aibot',           label: 'AI Advisor' },
  { id: 'advisor',         label: 'Financial Advisor' },
]

export default function App() {
  const [activeTab, setActiveTab]   = useState('market')
  const [watchlist, setWatchlist]   = useState([])
  const [quotes, setQuotes]         = useState({})
  const [refreshInterval, setRefreshInterval] = useState(30)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [countdown, setCountdown]   = useState(30)
  const [priceFlash, setPriceFlash] = useState({})
  const [chartSymbol,  setChartSymbol]  = useState(null)
  const [alerts,          setAlerts]          = useState([])
  const [alertSymbol,     setAlertSymbol]     = useState(null)
  const [toasts,          setToasts]          = useState([])
  const [portfolioSymbols,  setPortfolioSymbols]  = useState([])
  const [earnings,          setEarnings]          = useState([])
  const [earningsLoading,   setEarningsLoading]   = useState(false)
  const prevPricesRef = useRef({})
  const flashTimerRef = useRef(null)
  const alertsRef     = useRef([])

  // Load watchlist from API; migrate localStorage on first empty load
  useEffect(() => {
    fetch('/api/watchlist')
      .then(r => r.json())
      .then(async (syms) => {
        if (syms.length === 0) {
          // Migrate from localStorage or seed defaults
          let seed = DEFAULT_WATCHLIST
          try {
            const saved = localStorage.getItem('stockmonitor-watchlist')
            if (saved) seed = JSON.parse(saved)
          } catch { /* ignore */ }
          await Promise.all(seed.map(sym =>
            fetch('/api/watchlist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ symbol: sym }),
            })
          ))
          localStorage.removeItem('stockmonitor-watchlist')
          setWatchlist(seed)
        } else {
          setWatchlist(syms)
        }
      })
      .catch(() => setWatchlist(DEFAULT_WATCHLIST))
  }, [])

  // Keep alertsRef in sync so fetchQuotes can read latest alerts without stale closure
  useEffect(() => { alertsRef.current = alerts }, [alerts])

  // Load alerts from DB on mount
  useEffect(() => {
    fetch('/api/alerts')
      .then(r => r.json())
      .then(rows => setAlerts(rows.filter(a => a.status !== 'dismissed')))
      .catch(() => {})
  }, [])

  // Load portfolio symbols so earnings calendar covers portfolio positions too
  useEffect(() => {
    fetch('/api/portfolio')
      .then(r => r.json())
      .then(rows => setPortfolioSymbols(rows.map(r => r.symbol)))
      .catch(() => {})
  }, [])

  // Fetch upcoming earnings whenever watchlist or portfolio symbols change
  useEffect(() => {
    const allSyms = [...new Set([...watchlist, ...portfolioSymbols])]
    if (!allSyms.length) return
    setEarningsLoading(true)
    fetch(`/api/earnings/upcoming?symbols=${allSyms.join(',')}`)
      .then(r => r.json())
      .then(data => setEarnings(data))
      .catch(() => {})
      .finally(() => setEarningsLoading(false))
  }, [watchlist.join(','), portfolioSymbols.join(',')])

  const addAlert = useCallback((_symbol, _price, _condition, _note, _type, _tval, created) => {
    if (created) setAlerts(prev => [created, ...prev])
  }, [])

  const deleteAlert = useCallback(async (id) => {
    await fetch(`/api/alerts/${id}`, { method: 'DELETE' })
    setAlerts(prev => prev.filter(a => a.id !== id))
  }, [])

  const dismissAlert = useCallback(async (id) => {
    await fetch(`/api/alerts/${id}/dismiss`, { method: 'PATCH' })
    setAlerts(prev => prev.filter(a => a.id !== id))
  }, [])

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

      // Build quote map for alert checking before state update
      const quoteMap = {}
      data.forEach(q => { quoteMap[q.symbol] = q })

      setQuotes((prev) => {
        const next = { ...prev }
        data.forEach((q) => { next[q.symbol] = q })
        return next
      })
      setLastUpdated(new Date())

      // Check active alerts against new prices (supports smart alert types)
      const activeAlerts = alertsRef.current.filter(a => a.status === 'active')
      const nowTriggered = activeAlerts.filter(a => {
        const q = quoteMap[a.symbol]
        if (!q) return false
        const { price, changePercent, week52High, week52Low, volume, avgVolume } = q
        if (price == null) return false
        switch (a.alert_type || 'price') {
          case 'price':
            return a.condition === 'above' ? price >= a.target_price : price <= a.target_price
          case 'pct_change': {
            const pct = changePercent ?? 0
            return a.condition === 'above' ? pct >= (a.trigger_value ?? 5) : pct <= -(a.trigger_value ?? 5)
          }
          case 'week52_break':
            return a.condition === 'above'
              ? (week52High != null && price >= week52High)
              : (week52Low  != null && price <= week52Low)
          case 'volume_spike':
            return avgVolume != null && volume != null && volume >= (a.trigger_value ?? 2) * avgVolume
          default:
            return a.condition === 'above' ? price >= a.target_price : price <= a.target_price
        }
      })
      if (nowTriggered.length > 0) {
        nowTriggered.forEach(a => fetch(`/api/alerts/${a.id}/trigger`, { method: 'PATCH' }))
        setAlerts(prev => prev.map(a =>
          nowTriggered.find(t => t.id === a.id) ? { ...a, status: 'triggered' } : a
        ))
        setToasts(prev => [
          ...prev,
          ...nowTriggered.map(a => ({ ...a, _toastId: `${a.id}-${Date.now()}` })),
        ])
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [watchlist])

  useEffect(() => {
    fetchQuotes()
    setCountdown(refreshInterval)
    const interval = setInterval(() => {
      fetchQuotes()
      setCountdown(refreshInterval)
    }, refreshInterval * 1000)
    return () => clearInterval(interval)
  }, [fetchQuotes, refreshInterval])

  useEffect(() => {
    setCountdown(refreshInterval)
    const timer = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(timer)
  }, [refreshInterval, lastUpdated])

  const addTicker = async (sym) => {
    const upper = sym.toUpperCase().trim()
    if (!upper || watchlist.includes(upper)) return
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: upper }),
    })
    setWatchlist((prev) => [...prev, upper])
  }

  const removeTicker = async (sym) => {
    await fetch(`/api/watchlist/${sym}`, { method: 'DELETE' })
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
        {activeTab === 'watchlist' && (() => {
          const earningsMap = Object.fromEntries(earnings.map(e => [e.symbol, e]))
          return (
            <div className="p-4">
              <EarningsCalendar earnings={earnings} loading={earningsLoading} />
              <StockTable
                watchlist={watchlist}
                quotes={quotes}
                priceFlash={priceFlash}
                onRemove={removeTicker}
                onChartOpen={setChartSymbol}
                alerts={alerts}
                onAlertBell={setAlertSymbol}
                earningsMap={earningsMap}
              />
            </div>
          )
        })()}
        {activeTab === 'market'          && <MarketSummary />}
        {activeTab === 'recommendations' && <MarketRecommendations />}
        {activeTab === 'portfolio'       && <PortfolioTracker />}
        {activeTab === 'daytrader'       && <DayTrader />}
        {activeTab === 'screener'        && <Screener />}
        {activeTab === 'journal'         && <TradeJournal />}
        {activeTab === 'macro'           && <MacroCalendar />}
        {activeTab === 'sectors'         && <SectorDashboard />}
        {activeTab === 'aibot'           && <AiBot />}
        {activeTab === 'advisor'         && <FinancialAdvisor />}
      </main>

      {chartSymbol && (
        <ChartModal
          symbol={chartSymbol}
          quote={quotes[chartSymbol]}
          onClose={() => setChartSymbol(null)}
        />
      )}

      {alertSymbol && (
        <AlertModal
          symbol={alertSymbol}
          currentPrice={quotes[alertSymbol]?.price ?? null}
          alerts={alerts}
          onClose={() => setAlertSymbol(null)}
          onAdd={addAlert}
          onDelete={deleteAlert}
          onDismiss={dismissAlert}
        />
      )}

      {/* Toast notifications — bottom-right */}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t._toastId} className="pointer-events-auto">
            <AlertToast
              alert={t}
              onClose={() => setToasts(prev => prev.filter(x => x._toastId !== t._toastId))}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
