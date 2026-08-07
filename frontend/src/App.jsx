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
import StockComparison from './components/StockComparison'
import Backtester from './components/Backtester'
import { AlertModal, AlertToast } from './components/PriceAlerts'
import EarningsCalendar from './components/EarningsCalendar'
import TechnicalSignals from './components/TechnicalSignals'
import TradeIdeas from './components/TradeIdeas'
import SmartAlerts from './components/SmartAlerts'
import PositionSizer from './components/PositionSizer'
import RichEarningsCalendar from './components/RichEarningsCalendar'
import NewsSentiment from './components/NewsSentiment'
import OptionsTracker from './components/OptionsTracker'
import SectorMomentum from './components/SectorMomentum'
import MarketBreadth from './components/MarketBreadth'
import FundamentalComparison from './components/FundamentalComparison'
import PriceTargets from './components/PriceTargets'
import DcfCalculator from './components/DcfCalculator'
import YieldCurve from './components/YieldCurve'
import UnusualOptions from './components/UnusualOptions'
import UserGuide from './components/UserGuide'
import IndexHeatmap from './components/IndexHeatmap'
import FireCalculator from './components/FireCalculator'
import MonteCarlo from './components/MonteCarlo'
import CoastFire from './components/CoastFire'
import SocialSecurity from './components/SocialSecurity'
import EarlyRetirementHealth from './components/EarlyRetirementHealth'
import RothConversionPlanner from './components/RothConversionPlanner'
import CustomNews from './components/CustomNews'
import TaxAdvisor from './components/TaxAdvisor'
import ShortSqueeze from './components/ShortSqueeze'
import IpoCalendar from './components/IpoCalendar'
import FedWatch from './components/FedWatch'
import MorningBriefing from './components/MorningBriefing'
import WheelTracker from './components/WheelTracker'
import TaxLotManager from './components/TaxLotManager'
import MedicareEstimator from './components/MedicareEstimator'
import EstateRmdProjector from './components/EstateRmdProjector'
import InsiderFeed from './components/InsiderFeed'
import CryptoDashboard from './components/CryptoDashboard'
import PortfolioReview from './components/PortfolioReview'
import EconomicDashboard from './components/EconomicDashboard'
import StockAnalyzer from './components/StockAnalyzer'
import DividendTracker from './components/DividendTracker'
import WatchlistHeatmap from './components/WatchlistHeatmap'
import EarningsSurpriseTracker from './components/EarningsSurpriseTracker'
import PortfolioStressTest from './components/PortfolioStressTest'
import CorrelationMatrix from './components/CorrelationMatrix'
import SeasonalPatterns from './components/SeasonalPatterns'
import EtfOverlapAnalyzer from './components/EtfOverlapAnalyzer'
import RelativeStrengthRanker from './components/RelativeStrengthRanker'
import PortfolioAttribution from './components/PortfolioAttribution'
import EarningsStrategyAnalyzer from './components/EarningsStrategyAnalyzer'
import MarketSentimentDashboard from './components/MarketSentimentDashboard'
import AnalystRatingTracker from './components/AnalystRatingTracker'
import FundHoldingsExplorer from './components/FundHoldingsExplorer'
import ActivistTracker from './components/ActivistTracker'
import RedditTrending from './components/RedditTrending'
import MergerArbOverview from './components/MergerArbOverview'
import MergerDealDashboard from './components/MergerDealDashboard'
import MergerOpportunityScanner from './components/MergerOpportunityScanner'
import MergerDealAnalyzer from './components/MergerDealAnalyzer'
import MergerArbPortfolio from './components/MergerArbPortfolio'
import MergerRiskMatrix from './components/MergerRiskMatrix'
import MergerAlerts from './components/MergerAlerts'
import SpacOverview from './components/SpacOverview'
import SpacTracker from './components/SpacTracker'
import SpacDiscovery from './components/SpacDiscovery'
import SpacDealAnalyzer from './components/SpacDealAnalyzer'
import SpacPortfolio from './components/SpacPortfolio'
import SpacAlerts from './components/SpacAlerts'
import SpacRiskMatrix from './components/SpacRiskMatrix'

const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA']

// ── Sidebar icons (inline SVG, no icon library needed) ────────────────────────

const Icons = {
  market: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <rect x="1" y="9" width="3" height="6" rx="0.5"/>
      <rect x="6" y="5" width="3" height="10" rx="0.5"/>
      <rect x="11" y="1" width="3" height="14" rx="0.5"/>
    </svg>
  ),
  watchlist: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <path d="M8 2.5C4.4 2.5 1 5.3 1 8s3.4 5.5 7 5.5S15 10.7 15 8 11.6 2.5 8 2.5zm0 9a3.5 3.5 0 110-7 3.5 3.5 0 010 7zm0-5.5a2 2 0 100 4 2 2 0 000-4z"/>
    </svg>
  ),
  portfolio: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <path d="M5.5 2A1.5 1.5 0 004 3.5V4H2a1 1 0 00-1 1v8a1 1 0 001 1h12a1 1 0 001-1V5a1 1 0 00-1-1h-2v-.5A1.5 1.5 0 0010.5 2h-5zm0 1.5h5V4h-5v-.5z"/>
    </svg>
  ),
  research: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <path d="M11.2 10.1a5.5 5.5 0 10-1.1 1.1l3.1 3.1 1.1-1.1-3.1-3.1zm-4.7.9a4 4 0 110-8 4 4 0 010 8z"/>
    </svg>
  ),
  sectors: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <path d="M8 1.5A6.5 6.5 0 1014.5 8H8V1.5zm1.5-.1V6.5H15A6.52 6.52 0 009.5 1.4z"/>
    </svg>
  ),
  trading: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <path d="M8.8 1.2L5.5 8.5H9l-2 6.3 7.5-8.8H11L13.5 1.2z"/>
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z"/>
      <path d="M13 11l.75 2.25L16 14l-2.25.75L13 17l-.75-2.25L10 14l2.25-.75z" opacity="0.5"/>
    </svg>
  ),
  news: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <rect x="1" y="2" width="14" height="2" rx="0.5"/>
      <rect x="1" y="6" width="9" height="1.5" rx="0.5"/>
      <rect x="1" y="9" width="11" height="1.5" rx="0.5"/>
      <rect x="1" y="12" width="7" height="1.5" rx="0.5"/>
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 16 16" className="w-3 h-3 shrink-0" fill="currentColor">
      <path d="M4.5 6l3.5 3.5L11.5 6"/>
    </svg>
  ),
}

// ── Navigation groups ─────────────────────────────────────────────────────────

const NAV_GROUPS = [
  {
    id: 'market',
    label: 'Markets',
    icon: Icons.market,
    items: [
      { id: 'market',          label: 'Overview' },
      { id: 'sentiment',       label: 'Sentiment' },
      { id: 'reddittrending',  label: 'Reddit Trending' },
      { id: 'indexheatmap',    label: 'Index Heatmap' },
      { id: 'breadth',         label: 'Breadth' },
      { id: 'sectors',         label: 'Sector Rotation' },
      { id: 'sectormomentum',  label: 'Sector Momentum' },
      { id: 'rates',           label: 'Yield Curve' },
      { id: 'fedwatch',        label: 'Fed Watch' },
      { id: 'macro',           label: 'Macro Calendar' },
      { id: 'recommendations', label: 'Analyst Picks' },
      { id: 'shortsqueeze',    label: 'Short Squeeze' },
      { id: 'ipocalendar',     label: 'IPO & Lockups' },
      { id: 'insiderfeed',     label: 'Insider Trading' },
      { id: 'crypto',          label: 'Crypto' },
      { id: 'economic',        label: 'Economic Indicators' },
    ],
  },
  {
    id: 'research',
    label: 'Research',
    icon: Icons.research,
    items: [
      { id: 'screener',     label: 'Screener' },
      { id: 'fundamentals', label: 'Fundamentals' },
      { id: 'dcf',          label: 'DCF Valuation' },
      { id: 'compare',      label: 'Chart Compare' },
      { id: 'backtest',         label: 'Backtester' },
      { id: 'earningssurprise',    label: 'Earnings Surprise' },
      { id: 'earningstrategy',     label: 'Earnings Strategy' },
      { id: 'analystratings',      label: 'Analyst Ratings' },
      { id: 'fundholdings',        label: 'Fund Holdings' },
      { id: 'activisttracker',     label: 'Activist Tracker' },
      { id: 'relativestrengthr',   label: 'Relative Strength' },
      { id: 'seasonalpatterns',    label: 'Seasonal Patterns' },
      { id: 'etfoverlap',          label: 'ETF Overlap' },
      { id: 'signals',             label: 'Signals' },
      { id: 'uoa',                 label: 'Unusual Options' },
    ],
  },
  {
    id: 'watchlist',
    label: 'Watchlist',
    icon: Icons.watchlist,
    items: [
      { id: 'watchlist',         label: 'Watchlist' },
      { id: 'watchlistheatmap',  label: 'Heatmap' },
      { id: 'correlationmatrix', label: 'Correlation' },
      { id: 'pricetargets',     label: 'Price Targets' },
      { id: 'richearnings',  label: 'Earnings+' },
      { id: 'newssentiment', label: 'News Sentiment' },
      { id: 'smartalerts',   label: 'Smart Alerts' },
    ],
  },
  {
    id: 'news',
    label: 'News',
    icon: Icons.news,
    items: [
      { id: 'customnews', label: 'My News Feed' },
    ],
  },
  {
    id: 'trading',
    label: 'Trading',
    icon: Icons.trading,
    items: [
      { id: 'tradeideas',   label: 'Trade Ideas' },
      { id: 'positionsize', label: 'Position Sizer' },
      { id: 'wheeltracker', label: 'Wheel Tracker' },
      { id: 'daytrader',    label: 'Day Trader' },
    ],
  },
  {
    id: 'mergerarb',
    label: 'Merger Arb',
    icon: (
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
        <path d="M2 8h4M10 8h4M6 5l-3 3 3 3M10 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
    ),
    items: [
      { id: 'mergeroverview',   label: 'Overview' },
      { id: 'mergerdashboard',  label: 'Deal Dashboard' },
      { id: 'mergerscanner',    label: 'Opportunity Scanner' },
      { id: 'mergeranalyzer',   label: 'Deal Analyzer' },
      { id: 'mergerportfolio',  label: 'Arb Portfolio' },
      { id: 'mergerrisk',       label: 'Risk Matrix' },
      { id: 'mergeralerts',     label: 'Alerts' },
    ],
  },
  {
    id: 'spacs',
    label: 'SPACs',
    icon: (
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
        <path d="M8 1.5v13M4 5.5l4-4 4 4M4 10.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
    ),
    items: [
      { id: 'spacoverview',  label: 'Overview' },
      { id: 'spactracker',   label: 'Tracker' },
      { id: 'spacdiscovery', label: 'Discovery' },
      { id: 'spacanalyzer',  label: 'Deal Analyzer' },
      { id: 'spacportfolio', label: 'Portfolio' },
      { id: 'spacalerts',    label: 'Alerts' },
      { id: 'spacrisk',      label: 'Risk Matrix' },
    ],
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    icon: Icons.portfolio,
    items: [
      { id: 'portfolio',       label: 'Portfolio' },
      { id: 'optionstracker', label: 'Options P&L' },
      { id: 'taxlots',        label: 'Tax Lots' },
      { id: 'dividendtracker',label: 'Dividend Tracker' },
      { id: 'stresstest',        label: 'Stress Test' },
      { id: 'attribution',       label: 'Attribution' },
      { id: 'journal',           label: 'Trade Journal' },
    ],
  },
  {
    id: 'ai',
    label: 'AI Tools',
    icon: Icons.ai,
    items: [
      { id: 'morningbriefing',  label: 'Morning Briefing' },
      { id: 'stockanalyzer',    label: 'Stock Analyzer' },
      { id: 'portfolioreview',  label: 'Portfolio Review' },
      { id: 'advisor',          label: 'Financial Advisor' },
      { id: 'taxadvisor',       label: 'Tax Advisor' },
      { id: 'aibot',            label: 'AI Chat' },
    ],
  },
  {
    id: 'retirement',
    label: 'Retirement',
    icon: (
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
        <circle cx="8" cy="8" r="6.5" fillOpacity="0" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 4.5v3.75l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      </svg>
    ),
    items: [
      { id: 'fire',                   label: 'FIRE Calculator' },
      { id: 'coastfire',              label: 'Coast FIRE & Roth' },
      { id: 'montecarlo',             label: 'Monte Carlo' },
      { id: 'socialsecurity',         label: 'Social Security' },
      { id: 'earlyretirementhealth',  label: 'Early Retirement Health' },
      { id: 'rothconversionplanner',  label: 'Roth Conversion Planner' },
      { id: 'medicare',               label: 'Medicare Estimator' },
      { id: 'estatermd',              label: 'Estate & RMD' },
    ],
  },
]

// ── Watchlist selector bar ────────────────────────────────────────────────────

function WatchlistBar({ lists, active, onSelect, onCreate, onDelete }) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName]   = useState('')

  function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    onCreate(newName.trim())
    setNewName(''); setCreating(false)
  }

  if (lists.length <= 1 && !creating) {
    return (
      <div className="flex items-center gap-2 mb-3">
        <span className="text-gray-700 text-xs">Watchlist</span>
        <button onClick={() => setCreating(true)}
          className="text-gray-600 hover:text-emerald-400 text-xs transition-colors">+ New List</button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
      {lists.map(l => (
        <button
          key={l.name}
          onClick={() => onSelect(l.name)}
          className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
            active === l.name
              ? 'bg-emerald-700/60 text-emerald-300 border border-emerald-600/50'
              : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700'
          }`}
        >
          {l.name}
          <span className="text-[10px] opacity-60">({l.count})</span>
          {l.name !== 'default' && active === l.name && (
            <span
              onClick={e => { e.stopPropagation(); onDelete(l.name) }}
              className="ml-0.5 opacity-50 hover:opacity-100 text-red-400 hover:text-red-300"
              title="Delete list"
            >×</span>
          )}
        </button>
      ))}
      {creating ? (
        <form onSubmit={handleCreate} className="flex gap-1">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="List name"
            maxLength={30}
            className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded-lg focus:outline-none focus:border-emerald-500 w-28"
          />
          <button type="submit" className="text-emerald-400 text-xs hover:text-emerald-300">✓</button>
          <button type="button" onClick={() => setCreating(false)} className="text-gray-600 text-xs hover:text-gray-400">✕</button>
        </form>
      ) : (
        <button onClick={() => setCreating(true)}
          className="text-gray-600 hover:text-emerald-400 text-xs transition-colors px-1">+ New</button>
      )}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ activeTab, onSelect, className }) {
  const [expanded, setExpanded] = useState(() => {
    const init = {}
    NAV_GROUPS.forEach(g => { init[g.id] = false })
    // Open only the group that contains the current active tab
    const activeGroup = NAV_GROUPS.find(g => g.items.some(i => i.id === activeTab))
    if (activeGroup) init[activeGroup.id] = true
    return init
  })

  function toggle(groupId) {
    setExpanded(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  return (
    <aside className={className ?? 'w-52 shrink-0 bg-slate-900 border-r border-slate-700/60 overflow-y-auto'}>
      <div className="flex flex-col min-h-full">
        {/* Nav groups */}
        <div className="flex-1 py-1">
          {NAV_GROUPS.map(group => {
            const isGroupActive = group.items.some(i => i.id === activeTab)
            const isOpen = expanded[group.id]
            return (
              <div key={group.id} className="mb-0.5">
                <button
                  onClick={() => toggle(group.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors group rounded-none ${
                    isGroupActive
                      ? 'bg-slate-800 border-l-2 border-emerald-500'
                      : 'hover:bg-slate-800/70 border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`transition-colors ${
                      isGroupActive ? 'text-emerald-400' : 'text-slate-400 group-hover:text-slate-200'
                    }`}>
                      {group.icon}
                    </span>
                    <span className={`text-[11.5px] font-bold uppercase tracking-wider transition-colors ${
                      isGroupActive ? 'text-white' : 'text-slate-300 group-hover:text-white'
                    }`}>
                      {group.label}
                    </span>
                  </div>
                  <span className={`text-xs transition-all duration-200 ${
                    isGroupActive ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300'
                  } ${isOpen ? '' : '-rotate-90'}`}>
                    ▾
                  </span>
                </button>

                {isOpen && (
                  <div className="bg-slate-950/40 pb-1">
                    {group.items.map(item => (
                      <button
                        key={item.id}
                        onClick={() => onSelect(item.id)}
                        className={`w-full text-left text-[12.5px] pl-10 pr-3 py-2 transition-colors relative ${
                          activeTab === item.id
                            ? 'text-white font-semibold bg-emerald-900/25'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                        }`}
                      >
                        {activeTab === item.id && (
                          <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-emerald-400 rounded-r" />
                        )}
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Pinned User Guide button */}
        <div className="border-t border-slate-700/60 p-2">
          <button
            onClick={() => onSelect('guide')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'guide'
                ? 'text-white bg-emerald-900/30 border border-emerald-700/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 11a1 1 0 110-2 1 1 0 010 2zm1-3.5c0 .28-.22.5-.5.5h-1a.5.5 0 01-.5-.5v-.25C7 7.01 8.5 6.5 8.5 5.5c0-.55-.45-1-1-1s-1 .45-1 1H5c0-1.65 1.35-3 3-3s3 1.35 3 3c0 1.5-1.5 2-1.5 3.5H9z"/>
            </svg>
            User Guide
          </button>
        </div>
      </div>
    </aside>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab]   = useState('market')
  const [sidebarOpen, setSidebarOpen] = useState(false)
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
  const [mergerFocusDealId, setMergerFocusDealId] = useState(null)
  const goToMerger = (tabId, dealId = null) => { setMergerFocusDealId(dealId); setActiveTab(tabId) }
  const [spacFocusId, setSpacFocusId] = useState(null)
  const goToSpac = (tabId, spacId = null) => { setSpacFocusId(spacId); setActiveTab(tabId) }

  // ── Theme ──────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState(() => localStorage.getItem('sm-theme') || 'dark')
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark', 'light')
    root.classList.add(theme)
    localStorage.setItem('sm-theme', theme)
  }, [theme])
  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  const [earnings,          setEarnings]          = useState([])
  const [earningsLoading,   setEarningsLoading]   = useState(false)
  const [activeList,        setActiveList]        = useState('default')
  const [allLists,          setAllLists]          = useState([{ name: 'default', count: 0 }])
  const prevPricesRef = useRef({})
  const flashTimerRef = useRef(null)
  const alertsRef     = useRef([])
  const wsRef         = useRef(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  )

  useEffect(() => {
    fetch('/api/watchlists').then(r => r.json()).then(setAllLists).catch(() => {})
  }, [])

  useEffect(() => {
    fetch(`/api/watchlist?list=${activeList}`)
      .then(r => r.json())
      .then(async (syms) => {
        if (syms.length === 0 && activeList === 'default') {
          let seed = DEFAULT_WATCHLIST
          try {
            const saved = localStorage.getItem('stockmonitor-watchlist')
            if (saved) seed = JSON.parse(saved)
          } catch { /* ignore */ }
          await Promise.all(seed.map(sym =>
            fetch('/api/watchlist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ symbol: sym, list: 'default' }),
            })
          ))
          localStorage.removeItem('stockmonitor-watchlist')
          setWatchlist(seed)
        } else {
          setWatchlist(syms)
        }
      })
      .catch(() => setWatchlist(activeList === 'default' ? DEFAULT_WATCHLIST : []))
  }, [activeList])

  useEffect(() => { alertsRef.current = alerts }, [alerts])

  const requestNotifPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setNotifPermission(result)
  }, [])

  function processQuoteUpdates(data) {
    const newFlash = {}
    data.forEach(q => {
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
    setQuotes(prev => {
      const next = { ...prev }
      data.forEach(q => { next[q.symbol] = q })
      return next
    })
    setLastUpdated(new Date())

    const quoteMap = {}
    data.forEach(q => { quoteMap[q.symbol] = q })
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
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        nowTriggered.forEach(a => {
          new Notification(`Alert: ${a.symbol}`, {
            body: a.note || `${a.symbol} price alert triggered`,
          })
        })
      }
    }
  }

  const watchlistKey = watchlist.join(',')
  useEffect(() => {
    if (!watchlist.length) return
    let intentionalClose = false
    let reconnectTimeout = null

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${protocol}//${window.location.host}/ws/quotes?symbols=${watchlist.join(',')}`
      const ws = new WebSocket(url)
      wsRef.current = ws
      ws.onopen  = () => setWsConnected(true)
      ws.onclose = () => {
        setWsConnected(false)
        if (!intentionalClose) reconnectTimeout = setTimeout(connect, 5000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (e) => {
        try { processQuoteUpdates(JSON.parse(e.data)) } catch {}
      }
    }

    connect()
    return () => {
      intentionalClose = true
      clearTimeout(reconnectTimeout)
      wsRef.current?.close()
      setWsConnected(false)
    }
  }, [watchlistKey])

  useEffect(() => {
    fetch('/api/alerts')
      .then(r => r.json())
      .then(rows => setAlerts(rows.filter(a => a.status !== 'dismissed')))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/portfolio')
      .then(r => r.json())
      .then(rows => setPortfolioSymbols(rows.map(r => r.symbol)))
      .catch(() => {})
  }, [])

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
      processQuoteUpdates(await res.json())
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
      body: JSON.stringify({ symbol: upper, list: activeList }),
    })
    setWatchlist((prev) => [...prev, upper])
  }

  const removeTicker = async (sym) => {
    await fetch(`/api/watchlist/${sym}?list=${activeList}`, { method: 'DELETE' })
    setWatchlist((prev) => prev.filter((s) => s !== sym))
    setQuotes((prev) => { const next = { ...prev }; delete next[sym]; return next })
    delete prevPricesRef.current[sym]
  }

  const createList = async (name) => {
    const trimmed = name.trim()
    if (!trimmed || allLists.find(l => l.name === trimmed)) return
    await fetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    setAllLists(prev => [...prev, { name: trimmed, count: 0 }])
    setActiveList(trimmed)
  }

  const deleteList = async (name) => {
    if (name === 'default') return
    await fetch(`/api/watchlists/${name}`, { method: 'DELETE' })
    setAllLists(prev => prev.filter(l => l.name !== name))
    if (activeList === name) setActiveList('default')
  }

  const earningsMap = Object.fromEntries(earnings.map(e => [e.symbol, e]))
  const allSymbols  = [...new Set([...watchlist, ...portfolioSymbols])]

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden">
      <Header
        loading={loading}
        error={error}
        lastUpdated={lastUpdated}
        refreshInterval={refreshInterval}
        setRefreshInterval={setRefreshInterval}
        countdown={countdown}
        onRefresh={fetchQuotes}
        onAddTicker={addTicker}
        wsConnected={wsConnected}
        notifPermission={notifPermission}
        onRequestNotif={requestNotifPermission}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* Mobile hamburger bar */}
      <div className="md:hidden flex items-center px-4 py-2 border-b border-gray-800 bg-gray-900">
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className="text-gray-400 hover:text-white transition-colors text-xl leading-none p-1"
          aria-label="Toggle navigation"
        >
          ☰
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Desktop sidebar */}
        <Sidebar
          activeTab={activeTab}
          onSelect={setActiveTab}
          className="hidden md:flex md:flex-col w-48 shrink-0 bg-gray-900 border-r border-gray-800 overflow-y-auto"
        />

        {/* Mobile sidebar drawer */}
        {sidebarOpen && (
          <Sidebar
            activeTab={activeTab}
            onSelect={(id) => { setActiveTab(id); setSidebarOpen(false) }}
            className="fixed inset-y-0 left-0 z-40 w-64 bg-gray-900 border-r border-gray-800 overflow-y-auto flex flex-col"
          />
        )}

        <main className="flex-1 overflow-y-auto">
          {activeTab === 'watchlist' && (
            <div className="p-4">
              <WatchlistBar
                lists={allLists}
                active={activeList}
                onSelect={setActiveList}
                onCreate={createList}
                onDelete={deleteList}
              />
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
          )}
          {activeTab === 'market'          && <MarketSummary />}
          {activeTab === 'recommendations' && <MarketRecommendations />}
          {activeTab === 'portfolio'       && <PortfolioTracker />}
          {activeTab === 'daytrader'       && <DayTrader />}
          {activeTab === 'screener'        && <Screener />}
          {activeTab === 'journal'         && <TradeJournal />}
          {activeTab === 'macro'           && <MacroCalendar />}
          {activeTab === 'sectors'         && <SectorDashboard />}
          {activeTab === 'compare'         && <StockComparison />}
          {activeTab === 'backtest'        && <Backtester />}
          {activeTab === 'aibot'           && <AiBot />}
          {activeTab === 'advisor'         && <FinancialAdvisor />}
          {activeTab === 'signals'         && <TechnicalSignals symbols={allSymbols} />}
          {activeTab === 'tradeideas'      && <TradeIdeas watchlist={watchlist} quotes={quotes} alerts={alerts} />}
          {activeTab === 'smartalerts'     && <SmartAlerts />}
          {activeTab === 'positionsize'    && <PositionSizer />}
          {activeTab === 'richearnings'    && <RichEarningsCalendar symbols={allSymbols} />}
          {activeTab === 'newssentiment'   && <NewsSentiment symbols={watchlist} />}
          {activeTab === 'optionstracker'  && <OptionsTracker />}
          {activeTab === 'sectormomentum'  && <SectorMomentum />}
          {activeTab === 'breadth'         && <MarketBreadth />}
          {activeTab === 'indexheatmap'   && <IndexHeatmap />}
          {activeTab === 'rates'           && <YieldCurve />}
          {activeTab === 'fundamentals'    && <FundamentalComparison />}
          {activeTab === 'pricetargets'    && <PriceTargets />}
          {activeTab === 'dcf'             && <DcfCalculator />}
          {activeTab === 'uoa'             && <UnusualOptions symbols={watchlist} />}
          {activeTab === 'guide'           && <UserGuide />}
          {activeTab === 'fire'           && <FireCalculator />}
          {activeTab === 'montecarlo'     && <MonteCarlo />}
          {activeTab === 'coastfire'      && <CoastFire />}
          {activeTab === 'socialsecurity'        && <SocialSecurity />}
          {activeTab === 'earlyretirementhealth'  && <EarlyRetirementHealth />}
          {activeTab === 'rothconversionplanner' && <RothConversionPlanner />}
          {activeTab === 'customnews'            && <CustomNews />}
          {activeTab === 'morningbriefing'        && <MorningBriefing />}
          {activeTab === 'taxadvisor'            && <TaxAdvisor />}
          {activeTab === 'shortsqueeze'          && <ShortSqueeze />}
          {activeTab === 'ipocalendar'           && <IpoCalendar />}
          {activeTab === 'fedwatch'              && <FedWatch />}
          {activeTab === 'insiderfeed'           && <InsiderFeed />}
          {activeTab === 'wheeltracker'          && <WheelTracker />}
          {activeTab === 'taxlots'               && <TaxLotManager />}
          {activeTab === 'medicare'              && <MedicareEstimator />}
          {activeTab === 'estatermd'             && <EstateRmdProjector />}
          {activeTab === 'crypto'               && <CryptoDashboard />}
          {activeTab === 'portfolioreview'      && <PortfolioReview />}
          {activeTab === 'economic'             && <EconomicDashboard />}
          {activeTab === 'stockanalyzer'        && <StockAnalyzer />}
          {activeTab === 'dividendtracker'      && <DividendTracker />}
          {activeTab === 'watchlistheatmap'    && <WatchlistHeatmap watchlist={watchlist} quotes={quotes} />}
          {activeTab === 'earningssurprise'   && <EarningsSurpriseTracker watchlist={watchlist} />}
          {activeTab === 'stresstest'         && <PortfolioStressTest />}
          {activeTab === 'attribution'        && <PortfolioAttribution />}
          {activeTab === 'correlationmatrix'  && <CorrelationMatrix watchlist={watchlist} />}
          {activeTab === 'seasonalpatterns'   && <SeasonalPatterns />}
          {activeTab === 'etfoverlap'         && <EtfOverlapAnalyzer />}
          {activeTab === 'earningstrategy'    && <EarningsStrategyAnalyzer watchlist={watchlist} />}
          {activeTab === 'sentiment'          && <MarketSentimentDashboard />}
          {activeTab === 'reddittrending'     && <RedditTrending />}
          {activeTab === 'relativestrengthr'  && <RelativeStrengthRanker watchlist={watchlist} />}
          {activeTab === 'analystratings'     && <AnalystRatingTracker watchlist={watchlist} />}
          {activeTab === 'fundholdings'       && <FundHoldingsExplorer />}
          {activeTab === 'activisttracker'    && <ActivistTracker />}
          {activeTab === 'mergeroverview'      && <MergerArbOverview onNavigate={goToMerger} />}
          {activeTab === 'mergerdashboard'    && <MergerDealDashboard focusDealId={mergerFocusDealId} onFocusConsumed={() => setMergerFocusDealId(null)} />}
          {activeTab === 'mergerscanner'      && <MergerOpportunityScanner />}
          {activeTab === 'mergeranalyzer'     && <MergerDealAnalyzer focusDealId={mergerFocusDealId} onFocusConsumed={() => setMergerFocusDealId(null)} />}
          {activeTab === 'mergerportfolio'    && <MergerArbPortfolio />}
          {activeTab === 'mergerrisk'         && <MergerRiskMatrix />}
          {activeTab === 'mergeralerts'       && <MergerAlerts />}
          {activeTab === 'spacoverview'        && <SpacOverview onNavigate={goToSpac} />}
          {activeTab === 'spactracker'        && <SpacTracker focusDealId={spacFocusId} onFocusConsumed={() => setSpacFocusId(null)} />}
          {activeTab === 'spacdiscovery'      && <SpacDiscovery />}
          {activeTab === 'spacanalyzer'       && <SpacDealAnalyzer focusDealId={spacFocusId} onFocusConsumed={() => setSpacFocusId(null)} />}
          {activeTab === 'spacportfolio'      && <SpacPortfolio />}
          {activeTab === 'spacalerts'         && <SpacAlerts />}
          {activeTab === 'spacrisk'           && <SpacRiskMatrix />}
        </main>
      </div>

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
