import { useState, useEffect, useMemo } from 'react'

// ── Scenario definitions ──────────────────────────────────────────────────────

const SCENARIOS = [
  {
    id: 'gfc2008',
    emoji: '🏦',
    name: '2008 Financial Crisis',
    period: 'Sep 2008 – Mar 2009',
    marketDrawdown: -38,
    nasdaqDrawdown: -54,
    durationDesc: '6 months',
    recoveryMonths: 52,
    description: 'Housing collapse, Lehman Brothers failure, global credit freeze. Worst crisis since the Great Depression.',
    sectorMods: {
      'Financial Services': -28, 'Financials': -28,
      'Real Estate': -32,
      'Energy': -18,
      'Technology': -10,
      'Consumer Discretionary': -12,
      'Industrials': -8,
      'Communication Services': -8,
      'Utilities': 12,
      'Consumer Staples': 12,
      'Healthcare': 8,
      'Basic Materials': -5,
    },
  },
  {
    id: 'covid2020',
    emoji: '🦠',
    name: '2020 COVID Crash',
    period: 'Feb 19 – Mar 23, 2020',
    marketDrawdown: -34,
    nasdaqDrawdown: -32,
    durationDesc: '5 weeks',
    recoveryMonths: 5,
    description: 'Pandemic-driven global lockdown. Fastest bear market in history — and fastest recovery.',
    sectorMods: {
      'Energy': -42,
      'Consumer Discretionary': -20,
      'Financials': -10, 'Financial Services': -10,
      'Industrials': -12,
      'Real Estate': -14,
      'Technology': 10,
      'Healthcare': 8,
      'Communication Services': 6,
      'Consumer Staples': 10,
      'Utilities': 6,
      'Basic Materials': -5,
    },
  },
  {
    id: 'rateShock2022',
    emoji: '📈',
    name: '2022 Rate Shock',
    period: 'Jan – Oct 2022',
    marketDrawdown: -25,
    nasdaqDrawdown: -35,
    durationDesc: '10 months',
    recoveryMonths: 24,
    description: 'Fed raised rates 425bps in 9 months. High-multiple growth stocks crushed; energy surged 65%.',
    sectorMods: {
      'Technology': -25,
      'Communication Services': -26,
      'Consumer Discretionary': -20,
      'Real Estate': -24,
      'Utilities': -14,
      'Financials': -5, 'Financial Services': -5,
      'Healthcare': -3,
      'Industrials': -2,
      'Energy': 24,
      'Consumer Staples': 5,
      'Basic Materials': 3,
    },
  },
  {
    id: 'dotcom2000',
    emoji: '💻',
    name: '2000 Dot-com Bust',
    period: 'Mar 2000 – Oct 2002',
    marketDrawdown: -49,
    nasdaqDrawdown: -78,
    durationDesc: '30 months',
    recoveryMonths: 84,
    description: 'Internet bubble collapse. NASDAQ fell 78%. Longest bear market since WWII. Value and staples held up.',
    sectorMods: {
      'Technology': -42,
      'Communication Services': -36,
      'Consumer Discretionary': -14,
      'Financials': -10, 'Financial Services': -10,
      'Industrials': -8,
      'Real Estate': -5,
      'Energy': 6,
      'Healthcare': 8,
      'Consumer Staples': 12,
      'Utilities': 10,
      'Basic Materials': 5,
    },
  },
  {
    id: 'custom',
    emoji: '🎛',
    name: 'Custom Scenario',
    period: 'User defined',
    marketDrawdown: -20,
    nasdaqDrawdown: null,
    durationDesc: 'Variable',
    recoveryMonths: null,
    description: 'Set your own market drawdown to run a custom stress scenario.',
    sectorMods: {},
  },
]

// ── Stress calculation ────────────────────────────────────────────────────────

function calcDrawdown(beta, sector, scenario, customPct) {
  const mktDrop   = scenario.id === 'custom' ? customPct : scenario.marketDrawdown
  const sectorMod = scenario.sectorMods?.[sector] ?? 0
  const raw       = mktDrop * Math.max(0.05, beta ?? 1.0) + sectorMod
  return Math.min(-2, Math.max(-82, raw))
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtDollar(v, dec = 0) {
  if (v == null || isNaN(v)) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`
}

function fmtPct(v) {
  if (v == null || isNaN(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

function drawdownColor(pct) {
  const a = Math.abs(pct)
  if (a >= 50) return 'text-red-300'
  if (a >= 35) return 'text-red-400'
  if (a >= 20) return 'text-orange-400'
  if (a >= 10) return 'text-yellow-400'
  return 'text-slate-300'
}

function drawdownFill(pct) {
  const a = Math.abs(pct)
  if (a >= 50) return '#7f1d1d'
  if (a >= 35) return '#991b1b'
  if (a >= 20) return '#c2410c'
  if (a >= 10) return '#b45309'
  return '#475569'
}

function severityLabel(pct) {
  const a = Math.abs(pct)
  if (a >= 50) return { label: 'CRITICAL', cls: 'bg-red-900/40 text-red-300 border-red-700/40' }
  if (a >= 35) return { label: 'HIGH',     cls: 'bg-orange-900/40 text-orange-300 border-orange-700/40' }
  if (a >= 20) return { label: 'MEDIUM',   cls: 'bg-yellow-900/30 text-yellow-300 border-yellow-700/30' }
  return              { label: 'LOW',      cls: 'bg-slate-700 text-slate-300 border-slate-600' }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScenarioCard({ scenario, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-all ${
        active
          ? 'bg-blue-900/30 border-blue-600/60 ring-1 ring-blue-600/40'
          : 'bg-slate-800 border-slate-700 hover:border-slate-500'
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-lg">{scenario.emoji}</span>
        <span className={`text-sm font-bold ${active ? 'text-white' : 'text-slate-200'}`}>{scenario.name}</span>
      </div>
      <p className="text-xs text-slate-400 mb-1">{scenario.period}</p>
      {scenario.id !== 'custom' && (
        <div className="flex gap-3 mt-2">
          <span className="text-xs font-bold text-red-400">S&P {scenario.marketDrawdown}%</span>
          {scenario.nasdaqDrawdown && (
            <span className="text-xs text-slate-500">NASDAQ {scenario.nasdaqDrawdown}%</span>
          )}
          <span className="text-xs text-slate-500">{scenario.durationDesc}</span>
        </div>
      )}
      <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">{scenario.description}</p>
    </button>
  )
}

function RecoveryBadge({ months }) {
  if (!months) return null
  const years = months / 12
  return (
    <div className="text-center">
      <p className="text-xs text-slate-400">Avg Recovery</p>
      <p className="text-lg font-bold text-slate-200">
        {months < 12 ? `${months}mo` : `${years.toFixed(1)}yr`}
      </p>
    </div>
  )
}

function VulnerabilityBars({ stressedPositions }) {
  const top10 = [...stressedPositions].sort((a, b) => a.stressLoss - b.stressLoss).slice(0, 10)
  const maxLoss = Math.abs(top10[0]?.stressLoss ?? 1)
  const W = 100

  return (
    <div className="space-y-1.5">
      {top10.map(p => {
        const pct = Math.abs(p.stressLoss) / maxLoss * 100
        return (
          <div key={p.symbol} className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-slate-300 w-14 shrink-0 text-right">{p.symbol}</span>
            <div className="flex-1 bg-slate-700 rounded-full h-4 overflow-hidden">
              <div
                className="h-4 rounded-full flex items-center pl-2 transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: drawdownFill(p.drawdownPct), minWidth: '8px' }}
              />
            </div>
            <span className={`text-xs tabular-nums w-20 text-right font-bold ${drawdownColor(p.drawdownPct)}`}>
              {fmtDollar(p.stressLoss)}
            </span>
            <span className="text-xs text-slate-500 w-14 text-right tabular-nums">{fmtPct(p.drawdownPct)}</span>
          </div>
        )
      })}
    </div>
  )
}

function SectorBreakdown({ stressedPositions }) {
  const sectors = {}
  stressedPositions.forEach(p => {
    const s = p.sector || 'Unknown'
    if (!sectors[s]) sectors[s] = { currentValue: 0, stressLoss: 0, count: 0 }
    sectors[s].currentValue += p.currentValue
    sectors[s].stressLoss   += p.stressLoss
    sectors[s].count        += 1
  })

  const rows = Object.entries(sectors)
    .map(([sector, d]) => ({ sector, ...d, drawdownPct: d.currentValue > 0 ? d.stressLoss / d.currentValue * 100 : 0 }))
    .sort((a, b) => a.stressLoss - b.stressLoss)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 bg-slate-900/40">
            {['Sector', 'Positions', 'Current Value', 'Est. Loss', 'Drawdown'].map(h => (
              <th key={h} className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider text-left">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.sector} className={`border-b border-slate-700/40 ${i % 2 ? 'bg-slate-900/15' : ''}`}>
              <td className="px-3 py-2 text-slate-200 font-medium">{r.sector}</td>
              <td className="px-3 py-2 text-slate-400 text-center">{r.count}</td>
              <td className="px-3 py-2 text-slate-300 tabular-nums">{fmtDollar(r.currentValue)}</td>
              <td className="px-3 py-2 tabular-nums font-bold text-red-400">{fmtDollar(r.stressLoss)}</td>
              <td className={`px-3 py-2 tabular-nums font-bold ${drawdownColor(r.drawdownPct)}`}>{fmtPct(r.drawdownPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PortfolioStressTest() {
  const [portfolio,   setPortfolio]   = useState([])
  const [quoteData,   setQuoteData]   = useState({})
  const [loading,     setLoading]     = useState(true)
  const [scenarioId,  setScenarioId]  = useState('gfc2008')
  const [customPct,   setCustomPct]   = useState(-20)
  const [activeTab,   setActiveTab]   = useState('positions')
  const [sortCol,     setSortCol]     = useState('stressLoss')
  const [sortAsc,     setSortAsc]     = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const port = await fetch('/api/portfolio').then(r => r.json())
        const positions = Array.isArray(port) ? port : []
        setPortfolio(positions)

        if (positions.length) {
          const syms = [...new Set(positions.map(p => p.symbol))].join(',')
          const quotes = await fetch(`/api/quotes?symbols=${syms}`).then(r => r.json())
          const map = {}
          quotes.forEach(q => { map[q.symbol] = q })
          setQuoteData(map)
        }
      } catch (e) { console.error('Stress test load:', e) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const scenario     = SCENARIOS.find(s => s.id === scenarioId)
  const mktDrawdown  = scenarioId === 'custom' ? customPct : scenario.marketDrawdown

  // Build enriched + stressed positions
  const stressedPositions = useMemo(() => {
    return portfolio
      .map(p => {
        const q           = quoteData[p.symbol] || {}
        const price       = q.price ?? p.avgCost
        const beta        = q.beta  ?? 1.0
        const sector      = q.sector ?? 'Unknown'
        const name        = q.name  ?? p.symbol
        const currentVal  = price * p.shares
        const costBasis   = p.avgCost * p.shares
        const unrealPnl   = currentVal - costBasis

        const drawdownPct  = calcDrawdown(beta, sector, scenario, customPct)
        const stressedVal  = currentVal * (1 + drawdownPct / 100)
        const stressLoss   = stressedVal - currentVal
        const stressPnl    = stressedVal - costBasis

        return {
          symbol: p.symbol, name, sector,
          beta: beta ?? null,
          shares: p.shares, avgCost: p.avgCost,
          price, currentVal, costBasis, unrealPnl,
          drawdownPct, stressedVal, stressLoss, stressPnl,
        }
      })
      .filter(p => p.currentVal > 0)
  }, [portfolio, quoteData, scenario, customPct])

  const totalCurrent   = stressedPositions.reduce((s, p) => s + p.currentVal, 0)
  const totalStressed  = stressedPositions.reduce((s, p) => s + p.stressedVal, 0)
  const totalLoss      = totalStressed - totalCurrent
  const totalLossPct   = totalCurrent > 0 ? totalLoss / totalCurrent * 100 : 0
  const totalCostBasis = stressedPositions.reduce((s, p) => s + p.costBasis, 0)
  const totalStressPnl = totalStressed - totalCostBasis

  // Sort table
  const sorted = useMemo(() => {
    return [...stressedPositions].sort((a, b) => {
      const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0
      return sortAsc ? av - bv : bv - av
    })
  }, [stressedPositions, sortCol, sortAsc])

  function handleSort(col) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  function TH({ col, label, right }) {
    const active = sortCol === col
    return (
      <th
        className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors whitespace-nowrap ${right ? 'text-right' : 'text-left'} ${active ? 'text-white' : 'text-slate-400'}`}
        onClick={() => handleSort(col)}
      >
        {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Portfolio Stress Test</h1>
        <div className="bg-slate-800/50 rounded-xl p-10 text-center text-slate-400 text-sm border border-slate-700/50">
          Loading portfolio…
        </div>
      </div>
    )
  }

  if (!portfolio.length) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Portfolio Stress Test</h1>
        <div className="bg-slate-800/50 rounded-xl p-10 text-center border border-slate-700/50">
          <p className="text-slate-300 font-semibold text-lg mb-2">No portfolio positions</p>
          <p className="text-slate-400 text-sm">Add positions in Portfolio → Portfolio first, then return here to stress test them.</p>
        </div>
      </div>
    )
  }

  const TABS = [
    { id: 'positions', label: 'By Position' },
    { id: 'sector',    label: 'By Sector' },
    { id: 'vuln',      label: 'Vulnerability Chart' },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Portfolio Stress Test</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Estimate how your {portfolio.length}-position portfolio would perform during historical market crises,
          using per-stock beta and sector-specific drawdown adjustments.
        </p>
      </div>

      {/* Scenario selector */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {SCENARIOS.map(s => (
          <ScenarioCard key={s.id} scenario={s} active={scenarioId === s.id} onClick={() => setScenarioId(s.id)} />
        ))}
      </div>

      {/* Custom drawdown slider */}
      {scenarioId === 'custom' && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center gap-4">
            <label className="text-sm text-slate-300 font-medium shrink-0">Market Drawdown:</label>
            <input type="range" min="-80" max="-5" step="1" value={customPct}
              onChange={e => setCustomPct(Number(e.target.value))}
              className="flex-1 accent-blue-500" />
            <span className="text-lg font-bold text-red-400 tabular-nums w-16 text-right">{customPct}%</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Sector-specific adjustments are not applied in custom mode — all positions use beta × market drawdown.
          </p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400">Current Value</p>
          <p className="text-xl font-bold text-white mt-1">{fmtDollar(totalCurrent)}</p>
          <p className="text-xs text-slate-500 mt-0.5">Cost basis {fmtDollar(totalCostBasis)}</p>
        </div>
        <div className="bg-red-900/20 rounded-xl p-4 border border-red-800/30">
          <p className="text-xs text-slate-400">Stressed Value</p>
          <p className="text-xl font-bold text-red-300 mt-1">{fmtDollar(totalStressed)}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            P&amp;L from cost <span className={totalStressPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmtDollar(totalStressPnl)}</span>
          </p>
        </div>
        <div className="bg-red-900/25 rounded-xl p-4 border border-red-800/40">
          <p className="text-xs text-slate-400">Estimated Loss</p>
          <p className="text-xl font-bold text-red-400 mt-1">{fmtDollar(totalLoss)}</p>
          <p className="text-xs text-slate-500 mt-0.5">from current value</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-400">Portfolio Drawdown</p>
              <p className={`text-xl font-bold mt-1 ${drawdownColor(totalLossPct)}`}>{fmtPct(totalLossPct)}</p>
            </div>
            <RecoveryBadge months={scenario.recoveryMonths} />
          </div>
        </div>
      </div>

      {/* Scenario context bar */}
      {scenarioId !== 'custom' && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl px-4 py-3 flex flex-wrap gap-4 text-xs text-slate-400">
          <span>{scenario.emoji} <strong className="text-slate-200">{scenario.name}</strong> — {scenario.description}</span>
          <span className="ml-auto flex gap-4 shrink-0">
            <span>S&P 500: <strong className="text-red-400">{scenario.marketDrawdown}%</strong></span>
            {scenario.nasdaqDrawdown && <span>NASDAQ: <strong className="text-red-400">{scenario.nasdaqDrawdown}%</strong></span>}
            <span>Duration: <strong className="text-slate-200">{scenario.durationDesc}</strong></span>
            {scenario.recoveryMonths && <span>Recovery: <strong className="text-yellow-400">{scenario.recoveryMonths < 12 ? `${scenario.recoveryMonths}mo` : `${(scenario.recoveryMonths/12).toFixed(1)}yr`}</strong></span>}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* By Position table */}
      {activeTab === 'positions' && (
        <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/60">
                  <TH col="symbol"      label="Symbol" />
                  <TH col="sector"      label="Sector" />
                  <TH col="beta"        label="Beta"         right />
                  <TH col="currentVal"  label="Current Val"  right />
                  <TH col="drawdownPct" label="Est. Drop"    right />
                  <TH col="stressLoss"  label="Est. Loss"    right />
                  <TH col="stressedVal" label="Stressed Val" right />
                  <TH col="stressPnl"   label="P&L at Low"   right />
                </tr>
              </thead>
              <tbody>
                {sorted.map((p, i) => {
                  const sev = severityLabel(p.drawdownPct)
                  return (
                    <tr key={p.symbol} className={`border-b border-slate-700/40 hover:bg-slate-700/20 transition-colors ${i % 2 ? 'bg-slate-900/10' : ''}`}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-8 rounded-sm shrink-0" style={{ backgroundColor: drawdownFill(p.drawdownPct) }} />
                          <div>
                            <p className="font-bold text-white">{p.symbol}</p>
                            <p className="text-[10px] text-slate-500 truncate max-w-[100px]">{p.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs">{p.sector}</td>
                      <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums text-xs">
                        {p.beta != null ? p.beta.toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-200 tabular-nums">{fmtDollar(p.currentVal)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className={`font-bold tabular-nums ${drawdownColor(p.drawdownPct)}`}>{fmtPct(p.drawdownPct)}</div>
                        <span className={`text-[10px] px-1 py-0.5 rounded border ${sev.cls}`}>{sev.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-red-400 tabular-nums">{fmtDollar(p.stressLoss)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums">{fmtDollar(p.stressedVal)}</td>
                      <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${p.stressPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtDollar(p.stressPnl)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-600 bg-slate-900/40">
                  <td colSpan={3} className="px-3 py-2.5 text-xs font-bold text-slate-400 uppercase">Portfolio Total</td>
                  <td className="px-3 py-2.5 text-right font-bold text-white tabular-nums">{fmtDollar(totalCurrent)}</td>
                  <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${drawdownColor(totalLossPct)}`}>{fmtPct(totalLossPct)}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-red-400 tabular-nums">{fmtDollar(totalLoss)}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-red-300 tabular-nums">{fmtDollar(totalStressed)}</td>
                  <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${totalStressPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtDollar(totalStressPnl)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* By Sector tab */}
      {activeTab === 'sector' && (
        <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
          <SectorBreakdown stressedPositions={stressedPositions} />
        </div>
      )}

      {/* Vulnerability chart tab */}
      {activeTab === 'vuln' && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <h2 className="text-sm font-bold text-white mb-4">Positions by Estimated Dollar Loss (largest first)</h2>
          <VulnerabilityBars stressedPositions={stressedPositions} />
          <p className="text-xs text-slate-600 mt-4">Shows top 10 positions by estimated dollar loss. Bar length is proportional to loss relative to the single largest loser.</p>
        </div>
      )}

      {/* Insights */}
      <div className="grid sm:grid-cols-3 gap-3">
        {/* Most vulnerable */}
        <div className="bg-slate-800 rounded-xl p-4 border border-red-900/30">
          <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">⚠ Most Vulnerable</p>
          {stressedPositions.sort((a, b) => a.drawdownPct - b.drawdownPct).slice(0, 3).map(p => (
            <div key={p.symbol} className="flex justify-between items-center py-1 border-b border-slate-700/40 last:border-0">
              <span className="font-bold text-white text-sm">{p.symbol}</span>
              <span className={`text-sm font-bold tabular-nums ${drawdownColor(p.drawdownPct)}`}>{fmtPct(p.drawdownPct)}</span>
            </div>
          ))}
        </div>

        {/* Most resilient */}
        <div className="bg-slate-800 rounded-xl p-4 border border-emerald-900/30">
          <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">✓ Most Resilient</p>
          {stressedPositions.sort((a, b) => b.drawdownPct - a.drawdownPct).slice(0, 3).map(p => (
            <div key={p.symbol} className="flex justify-between items-center py-1 border-b border-slate-700/40 last:border-0">
              <span className="font-bold text-white text-sm">{p.symbol}</span>
              <span className="text-sm font-bold tabular-nums text-slate-300">{fmtPct(p.drawdownPct)}</span>
            </div>
          ))}
        </div>

        {/* Biggest dollar risk */}
        <div className="bg-slate-800 rounded-xl p-4 border border-orange-900/30">
          <p className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-2">$ Biggest Dollar Risk</p>
          {stressedPositions.sort((a, b) => a.stressLoss - b.stressLoss).slice(0, 3).map(p => (
            <div key={p.symbol} className="flex justify-between items-center py-1 border-b border-slate-700/40 last:border-0">
              <span className="font-bold text-white text-sm">{p.symbol}</span>
              <span className="text-sm font-bold tabular-nums text-red-400">{fmtDollar(p.stressLoss)}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-600">
        Stress estimates use each stock's beta × scenario market drawdown + sector-specific adjustments derived from historical crisis data.
        Beta = 1.0 assumed when unavailable. This is a simplified model — actual crisis behavior varies significantly by individual security.
        Not investment advice.
      </p>
    </div>
  )
}
