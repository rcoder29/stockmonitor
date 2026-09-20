import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import Header from './components/Header'
import StockTable from './components/StockTable'
import ChartModal from './components/ChartModal'
import HomeDashboard from './components/HomeDashboard'
import CommandPalette from './components/CommandPalette'
import { AlertModal, AlertToast } from './components/PriceAlerts'
import EarningsCalendar from './components/EarningsCalendar'

// Lazy-loaded: only one tab renders at a time, so there's no benefit to
// bundling all ~85 of these into the initial JS payload (this used to be a
// single 1.55MB chunk). The imports above stay static/eager because they're
// either always mounted (Header, ChartModal, CommandPalette) or part of the
// most-visited tabs (Home, Watchlist), where a lazy-load flash would just be
// annoying for no real payload savings.
const MarketSummary = lazy(() => import('./components/MarketSummary'))
const MarketRecommendations = lazy(() => import('./components/MarketRecommendations'))
const PortfolioTracker = lazy(() => import('./components/PortfolioTracker'))
const CppiAllocator = lazy(() => import('./components/CppiAllocator'))
const NetExposure = lazy(() => import('./components/NetExposure'))
const DayTrader = lazy(() => import('./components/DayTrader'))
const AiBot = lazy(() => import('./components/AiBot'))
const FinancialAdvisor = lazy(() => import('./components/FinancialAdvisor'))
const Screener = lazy(() => import('./components/Screener'))
const TradeJournal = lazy(() => import('./components/TradeJournal'))
const MacroCalendar = lazy(() => import('./components/MacroCalendar'))
const SectorDashboard = lazy(() => import('./components/SectorDashboard'))
const StockComparison = lazy(() => import('./components/StockComparison'))
const Backtester = lazy(() => import('./components/Backtester'))
const TechnicalSignals = lazy(() => import('./components/TechnicalSignals'))
const TradeIdeas = lazy(() => import('./components/TradeIdeas'))
const SmartAlerts = lazy(() => import('./components/SmartAlerts'))
const PositionSizer = lazy(() => import('./components/PositionSizer'))
const RichEarningsCalendar = lazy(() => import('./components/RichEarningsCalendar'))
const NewsSentiment = lazy(() => import('./components/NewsSentiment'))
const OptionsTracker = lazy(() => import('./components/OptionsTracker'))
const SectorMomentum = lazy(() => import('./components/SectorMomentum'))
const MarketBreadth = lazy(() => import('./components/MarketBreadth'))
const FundamentalComparison = lazy(() => import('./components/FundamentalComparison'))
const PriceTargets = lazy(() => import('./components/PriceTargets'))
const DcfCalculator = lazy(() => import('./components/DcfCalculator'))
const YieldCurve = lazy(() => import('./components/YieldCurve'))
const UnusualOptions = lazy(() => import('./components/UnusualOptions'))
const UserGuide = lazy(() => import('./components/UserGuide'))
const InvestorEducation = lazy(() => import('./components/InvestorEducation'))
const IndexHeatmap = lazy(() => import('./components/IndexHeatmap'))
const FireCalculator = lazy(() => import('./components/FireCalculator'))
const MonteCarlo = lazy(() => import('./components/MonteCarlo'))
const CoastFire = lazy(() => import('./components/CoastFire'))
const SocialSecurity = lazy(() => import('./components/SocialSecurity'))
const EarlyRetirementHealth = lazy(() => import('./components/EarlyRetirementHealth'))
const RothConversionPlanner = lazy(() => import('./components/RothConversionPlanner'))
const CustomNews = lazy(() => import('./components/CustomNews'))
const TaxAdvisor = lazy(() => import('./components/TaxAdvisor'))
const ShortSqueeze = lazy(() => import('./components/ShortSqueeze'))
const IpoCalendar = lazy(() => import('./components/IpoCalendar'))
const FedWatch = lazy(() => import('./components/FedWatch'))
const MorningBriefing = lazy(() => import('./components/MorningBriefing'))
const DigestCenter = lazy(() => import('./components/DigestCenter'))
const WheelTracker = lazy(() => import('./components/WheelTracker'))
const TaxLotManager = lazy(() => import('./components/TaxLotManager'))
const MedicareEstimator = lazy(() => import('./components/MedicareEstimator'))
const EstateRmdProjector = lazy(() => import('./components/EstateRmdProjector'))
const InsiderFeed = lazy(() => import('./components/InsiderFeed'))
const CryptoDashboard = lazy(() => import('./components/CryptoDashboard'))
const PortfolioReview = lazy(() => import('./components/PortfolioReview'))
const EconomicDashboard = lazy(() => import('./components/EconomicDashboard'))
const StockAnalyzer = lazy(() => import('./components/StockAnalyzer'))
const DividendTracker = lazy(() => import('./components/DividendTracker'))
const WatchlistHeatmap = lazy(() => import('./components/WatchlistHeatmap'))
const EarningsSurpriseTracker = lazy(() => import('./components/EarningsSurpriseTracker'))
const PortfolioStressTest = lazy(() => import('./components/PortfolioStressTest'))
const CorrelationMatrix = lazy(() => import('./components/CorrelationMatrix'))
const SeasonalPatterns = lazy(() => import('./components/SeasonalPatterns'))
const EtfOverlapAnalyzer = lazy(() => import('./components/EtfOverlapAnalyzer'))
const RelativeStrengthRanker = lazy(() => import('./components/RelativeStrengthRanker'))
const PortfolioAttribution = lazy(() => import('./components/PortfolioAttribution'))
const EarningsStrategyAnalyzer = lazy(() => import('./components/EarningsStrategyAnalyzer'))
const MarketSentimentDashboard = lazy(() => import('./components/MarketSentimentDashboard'))
const AnalystRatingTracker = lazy(() => import('./components/AnalystRatingTracker'))
const FundHoldingsExplorer = lazy(() => import('./components/FundHoldingsExplorer'))
const ActivistTracker = lazy(() => import('./components/ActivistTracker'))
const CorporateBonds = lazy(() => import('./components/CorporateBonds'))
const ConvertibleBonds = lazy(() => import('./components/ConvertibleBonds'))
const TreasuryBonds = lazy(() => import('./components/TreasuryBonds'))
const RedditTrending = lazy(() => import('./components/RedditTrending'))
const MergerArbOverview = lazy(() => import('./components/MergerArbOverview'))
const MergerDealDashboard = lazy(() => import('./components/MergerDealDashboard'))
const MergerOpportunityScanner = lazy(() => import('./components/MergerOpportunityScanner'))
const MergerDealAnalyzer = lazy(() => import('./components/MergerDealAnalyzer'))
const MergerArbPortfolio = lazy(() => import('./components/MergerArbPortfolio'))
const MergerRiskMatrix = lazy(() => import('./components/MergerRiskMatrix'))
const MergerAlerts = lazy(() => import('./components/MergerAlerts'))
const SpacOverview = lazy(() => import('./components/SpacOverview'))
const SpacTracker = lazy(() => import('./components/SpacTracker'))
const SpacDiscovery = lazy(() => import('./components/SpacDiscovery'))
const SpacDealAnalyzer = lazy(() => import('./components/SpacDealAnalyzer'))
const SpacPortfolio = lazy(() => import('./components/SpacPortfolio'))
const SpacAlerts = lazy(() => import('./components/SpacAlerts'))
const SpacRiskMatrix = lazy(() => import('./components/SpacRiskMatrix'))

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
  home: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <path d="M8 1.5L1 7.5h2V14a1 1 0 001 1h3v-4.5h2V15h3a1 1 0 001-1V7.5h2L8 1.5z"/>
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
      { id: 'corporatebonds',      label: 'Corporate Bonds' },
      { id: 'convertiblebonds',    label: 'Convertible Bonds' },
      { id: 'treasurybonds',       label: 'Treasury Bonds' },
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
      { id: 'cppi',               label: 'CPPI Allocator' },
      { id: 'netexposure',        label: 'Net Exposure' },
    ],
  },
  {
    id: 'ai',
    label: 'AI Tools',
    icon: Icons.ai,
    items: [
      { id: 'morningbriefing',  label: 'Morning Briefing' },
      { id: 'digest',           label: 'Digests' },
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

// Flat, searchable index of every tab — powers the command palette and the
// Home dashboard's "recently visited" chips.
const FLAT_NAV_ITEMS = [
  { id: 'home', label: 'Home', group: 'Home' },
  ...NAV_GROUPS.flatMap(g => g.items.map(i => ({ id: i.id, label: i.label, group: g.label }))),
  { id: 'guide', label: 'User Guide', group: 'Help' },
  { id: 'learn', label: 'Investor Education', group: 'Help' },
]
const NAV_INDEX = Object.fromEntries(FLAT_NAV_ITEMS.map(i => [i.id, i]))

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
        {/* Pinned Home button */}
        <div className="px-2 pt-2 pb-1">
          <button
            onClick={() => onSelect('home')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[11.5px] font-bold uppercase tracking-wider transition-colors ${
              activeTab === 'home'
                ? 'text-white bg-emerald-900/30 border border-emerald-700/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800 border border-transparent'
            }`}
          >
            <span className={activeTab === 'home' ? 'text-emerald-400' : 'text-slate-400'}>{Icons.home}</span>
            Home
          </button>
        </div>

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

        {/* Pinned User Guide / Investor Education buttons */}
        <div className="border-t border-slate-700/60 p-2 space-y-1">
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
          <button
            onClick={() => onSelect('learn')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'learn'
                ? 'text-white bg-emerald-900/30 border border-emerald-700/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
              <path d="M8 2.5C6.5 1.5 4 1 2 1.5v10c2-.5 4.5 0 6 1 1.5-1 4-1.5 6-1v-10c-2-.5-4.5 0-6 1z" fillOpacity="0" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M8 2.5v10.5" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            Investor Education
          </button>
        </div>
      </div>
    </aside>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab]   = useState('home')
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

  // ── Navigation (command palette + recently-visited tracking) ─────────────
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [recentTabs, setRecentTabs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sm-recent-tabs') || '[]') } catch { return [] }
  })
  const navigate = useCallback((id) => {
    setActiveTab(id)
    if (id !== 'home' && id !== 'guide') {
      setRecentTabs(prev => {
        const next = [id, ...prev.filter(x => x !== id)].slice(0, 8)
        localStorage.setItem('sm-recent-tabs', JSON.stringify(next))
        return next
      })
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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

  const activeNavLabel = NAV_INDEX[activeTab]?.label || activeTab
  const handleExportPdf = () => {
    const prevTitle = document.title
    document.title = `StockMonitor - ${activeNavLabel} - ${new Date().toISOString().slice(0, 10)}`
    const restore = () => { document.title = prevTitle; window.removeEventListener('afterprint', restore) }
    window.addEventListener('afterprint', restore)
    window.print()
  }

  return (
    <div className="app-shell flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden">
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
        onOpenSearch={() => setCommandPaletteOpen(true)}
        onExportPdf={handleExportPdf}
      />

      {/* Mobile hamburger bar */}
      <div className="no-print md:hidden flex items-center px-4 py-2 border-b border-gray-800 bg-gray-900">
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className="text-gray-400 hover:text-white transition-colors text-xl leading-none p-1"
          aria-label="Toggle navigation"
        >
          ☰
        </button>
      </div>

      <div className="app-body flex flex-1 overflow-hidden">
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="no-print fixed inset-0 bg-black/50 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Desktop sidebar */}
        <Sidebar
          activeTab={activeTab}
          onSelect={navigate}
          className="no-print hidden md:flex md:flex-col w-48 shrink-0 bg-gray-900 border-r border-gray-800 overflow-y-auto"
        />

        {/* Mobile sidebar drawer */}
        {sidebarOpen && (
          <Sidebar
            activeTab={activeTab}
            onSelect={(id) => { navigate(id); setSidebarOpen(false) }}
            className="no-print fixed inset-y-0 left-0 z-40 w-64 bg-gray-900 border-r border-gray-800 overflow-y-auto flex flex-col"
          />
        )}

        <main className="app-main flex-1 overflow-y-auto">
         <Suspense fallback={
           <div className="p-12 text-center text-gray-500 text-sm animate-pulse">Loading…</div>
         }>
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
          {activeTab === 'home'            && (
            <HomeDashboard
              watchlist={watchlist}
              quotes={quotes}
              alerts={alerts}
              earnings={earnings}
              portfolioSymbols={portfolioSymbols}
              navIndex={NAV_INDEX}
              recentTabs={recentTabs}
              onNavigate={navigate}
            />
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
          {activeTab === 'learn'           && <InvestorEducation onNavigate={navigate} />}
          {activeTab === 'fire'           && <FireCalculator />}
          {activeTab === 'montecarlo'     && <MonteCarlo />}
          {activeTab === 'coastfire'      && <CoastFire />}
          {activeTab === 'socialsecurity'        && <SocialSecurity />}
          {activeTab === 'earlyretirementhealth'  && <EarlyRetirementHealth />}
          {activeTab === 'rothconversionplanner' && <RothConversionPlanner />}
          {activeTab === 'customnews'            && <CustomNews />}
          {activeTab === 'morningbriefing'        && <MorningBriefing />}
          {activeTab === 'digest'                 && <DigestCenter />}
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
          {activeTab === 'cppi'               && <CppiAllocator />}
          {activeTab === 'netexposure'        && <NetExposure />}
          {activeTab === 'correlationmatrix'  && <CorrelationMatrix watchlist={watchlist} />}
          {activeTab === 'seasonalpatterns'   && <SeasonalPatterns />}
          {activeTab === 'etfoverlap'         && <EtfOverlapAnalyzer />}
          {activeTab === 'earningstrategy'    && <EarningsStrategyAnalyzer watchlist={watchlist} />}
          {activeTab === 'sentiment'          && <MarketSentimentDashboard />}
          {activeTab === 'reddittrending'     && <RedditTrending />}
          {activeTab === 'relativestrengthr'  && <RelativeStrengthRanker watchlist={watchlist} />}
          {activeTab === 'analystratings'     && <AnalystRatingTracker watchlist={watchlist} />}
          {activeTab === 'fundholdings'       && <FundHoldingsExplorer />}
          {activeTab === 'corporatebonds'     && <CorporateBonds />}
          {activeTab === 'convertiblebonds'   && <ConvertibleBonds />}
          {activeTab === 'treasurybonds'      && <TreasuryBonds />}
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
         </Suspense>
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

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        items={FLAT_NAV_ITEMS}
        recents={recentTabs}
        onNavigate={(id) => { navigate(id); setCommandPaletteOpen(false) }}
      />
    </div>
  )
}
