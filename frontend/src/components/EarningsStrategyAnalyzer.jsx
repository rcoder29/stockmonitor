import { useState, useCallback, useMemo } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(v, sign = true) {
  if (v == null || isNaN(v)) return '—'
  const s = sign && v > 0 ? '+' : ''
  return `${s}${v.toFixed(1)}%`
}

function fmtDays(d) {
  if (d == null) return '—'
  if (d < 0) return 'Past'
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  return `${d}d`
}

function pctColor(v) {
  if (v == null) return 'text-slate-400'
  if (v >= 3)  return 'text-emerald-300'
  if (v > 0)   return 'text-emerald-400'
  if (v <= -3) return 'text-red-300'
  if (v < 0)   return 'text-red-400'
  return 'text-slate-400'
}

function signalStyle(sig) {
  switch (sig) {
    case 'STRONG_BUY':       return { bg: 'bg-emerald-900/40', border: 'border-emerald-600/50', badge: 'bg-emerald-500',  text: 'text-emerald-300', label: '★ STRONG BUY' }
    case 'BUY':              return { bg: 'bg-emerald-900/20', border: 'border-emerald-700/40', badge: 'bg-emerald-600',  text: 'text-emerald-400', label: '▲ BUY' }
    case 'NEUTRAL':          return { bg: 'bg-slate-800',      border: 'border-slate-600',      badge: 'bg-slate-500',   text: 'text-slate-300',   label: '— NEUTRAL' }
    case 'WEAK':             return { bg: 'bg-yellow-900/20',  border: 'border-yellow-700/30',  badge: 'bg-yellow-600',  text: 'text-yellow-400',  label: '~ WEAK' }
    case 'AVOID':            return { bg: 'bg-red-900/20',     border: 'border-red-700/30',     badge: 'bg-red-600',     text: 'text-red-400',     label: '✕ AVOID' }
    case 'INSUFFICIENT_DATA':return { bg: 'bg-slate-800/50',   border: 'border-slate-700/40',   badge: 'bg-slate-600',   text: 'text-slate-500',   label: '? NO DATA' }
    default:                 return { bg: 'bg-slate-800',      border: 'border-slate-600',      badge: 'bg-slate-500',   text: 'text-slate-400',   label: sig }
  }
}

function daysUrgency(d) {
  if (d == null || d < 0) return 'text-slate-500'
  if (d <= 3)   return 'text-red-400 font-bold'
  if (d <= 10)  return 'text-orange-400 font-bold'
  if (d <= 21)  return 'text-yellow-400'
  return 'text-slate-400'
}

// ── Strategy Card ─────────────────────────────────────────────────────────────

function StrategyCard({ stratKey, strat, isRecommended }) {
  const ss = signalStyle(strat.signal)
  return (
    <div className={`rounded-xl border p-4 space-y-3 ${ss.bg} ${ss.border} ${isRecommended ? 'ring-2 ring-blue-500/50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-white text-sm">{strat.name}</p>
            {isRecommended && <span className="text-[10px] px-2 py-0.5 bg-blue-600 text-white rounded-full font-bold">RECOMMENDED</span>}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{strat.description}</p>
        </div>
        <span className={`text-[10px] px-2 py-1 rounded-lg font-bold whitespace-nowrap ${ss.badge} text-white shrink-0`}>
          {ss.label.replace('★ ', '').replace('▲ ', '').replace('— ', '').replace('~ ', '').replace('✕ ', '').replace('? ', '')}
        </span>
      </div>

      {strat.n >= 3 ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className={`text-xl font-bold tabular-nums ${strat.winRate >= 60 ? 'text-emerald-400' : strat.winRate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
              {strat.winRate}%
            </p>
            <p className="text-[10px] text-slate-500">Win Rate</p>
          </div>
          <div className="text-center">
            <p className={`text-xl font-bold tabular-nums ${pctColor(strat.avgReturn)}`}>
              {fmtPct(strat.avgReturn)}
            </p>
            <p className="text-[10px] text-slate-500">Avg Return</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-slate-200 tabular-nums">{strat.n}</p>
            <p className="text-[10px] text-slate-500">Trades</p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500 text-center py-2">
          {strat.n < 3 ? `Only ${strat.n} qualifying trade${strat.n === 1 ? '' : 's'} — insufficient history` : 'No data'}
        </p>
      )}

      {strat.n >= 3 && (
        <div className="flex justify-between text-[11px] text-slate-500 border-t border-slate-700/50 pt-2">
          <span>Best: <span className="text-emerald-400 font-mono">{fmtPct(strat.bestReturn)}</span></span>
          <span>Worst: <span className="text-red-400 font-mono">{fmtPct(strat.worstReturn)}</span></span>
          <span>EV: <span className={`font-mono ${pctColor(strat.expectedValue)}`}>{fmtPct(strat.expectedValue)}</span></span>
        </div>
      )}
    </div>
  )
}

// ── Drift Chart ───────────────────────────────────────────────────────────────

function DriftChart({ events }) {
  const recent = events.slice(0, 8).reverse()
  if (!recent.length) return null

  const BAR_W = 18
  const GAP = 4
  const TOTAL_W = recent.length * (BAR_W * 6 + GAP * 5 + 20) + 40
  const H = 120
  const MID_Y = H / 2
  const maxVal = Math.max(...recent.flatMap(e => [
    Math.abs(e.pre10d || 0), Math.abs(e.earningsReaction || 0), Math.abs(e.post10d || 0)
  ]), 3)

  const scale = (v) => Math.min(Math.abs(v) / maxVal * (MID_Y - 8), MID_Y - 8)

  const COLS = ['pre10d', 'pre5d', 'earningsReaction', 'post1d', 'post5d', 'post10d']
  const COL_COLORS = ['#6366f1', '#818cf8', '#f59e0b', '#22c55e', '#16a34a', '#166534']
  const COL_LABELS = ['-10D', '-5D', 'ERN', '+1D', '+5D', '+10D']

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(TOTAL_W, 400)} height={H + 50}>
        {/* Zero line */}
        <line x1={0} y1={MID_Y} x2={TOTAL_W} y2={MID_Y} stroke="#475569" strokeWidth={1} />

        {recent.map((ev, gi) => {
          const groupX = gi * (BAR_W * 6 + GAP * 5 + 20) + 30
          return (
            <g key={ev.date}>
              {/* Earnings date label */}
              <text x={groupX + (BAR_W * 6 + GAP * 5) / 2} y={H + 14}
                textAnchor="middle" fontSize={9} fill="#64748b">{ev.date?.slice(2, 7)}</text>
              {ev.beat != null && (
                <text x={groupX + (BAR_W * 6 + GAP * 5) / 2} y={H + 25}
                  textAnchor="middle" fontSize={8} fill={ev.beat ? '#4ade80' : '#f87171'}>
                  {ev.beat ? 'BEAT' : 'MISS'}
                </text>
              )}

              {COLS.map((col, ci) => {
                const val = ev[col]
                if (val == null) return null
                const barH = scale(val)
                const isPos = val >= 0
                const x = groupX + ci * (BAR_W + GAP)
                const y = isPos ? MID_Y - barH : MID_Y
                return (
                  <g key={col}>
                    <rect x={x} y={y} width={BAR_W - 2} height={Math.max(barH, 2)}
                      fill={col === 'earningsReaction' ? (isPos ? '#f59e0b' : '#ef4444') : (isPos ? COL_COLORS[ci] : '#ef4444')}
                      rx={2} opacity={0.85} />
                    <text x={x + (BAR_W - 2) / 2} y={isPos ? y - 2 : y + barH + 9}
                      textAnchor="middle" fontSize={7} fill="#94a3b8">
                      {val.toFixed(1)}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* Legend */}
        {COLS.map((col, ci) => (
          <g key={col}>
            <rect x={10 + ci * 55} y={H + 32} width={8} height={8}
              fill={COL_COLORS[ci]} rx={1} />
            <text x={22 + ci * 55} y={H + 40} fontSize={8} fill="#94a3b8">{COL_LABELS[ci]}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ── Deep Dive ─────────────────────────────────────────────────────────────────

function DeepDive({ data, onBack }) {
  const [tab, setTab] = useState('overview')
  const { symbol, name, sector, currentPrice, nextEarningsDate, daysToEarnings,
          events, strategies, bestStrategy, beatRate, avgAbsMove, avgPre10d } = data

  const ss = signalStyle(strategies[bestStrategy]?.signal)
  const bestStrat = strategies[bestStrategy]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold text-white">{symbol}</h2>
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${ss.badge} text-white`}>{ss.label}</span>
            {daysToEarnings != null && daysToEarnings >= 0 && (
              <span className={`text-sm ${daysUrgency(daysToEarnings)}`}>
                📅 Earnings in {fmtDays(daysToEarnings)} {nextEarningsDate && `(${nextEarningsDate})`}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-0.5">{name} · {sector} · ${currentPrice?.toFixed(2)}</p>
        </div>
        <button onClick={onBack}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 rounded-lg">
          ← Back to Scanner
        </button>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
          <p className="text-xs text-slate-400">Beat Rate</p>
          <p className={`text-xl font-bold mt-0.5 ${beatRate >= 75 ? 'text-emerald-400' : beatRate >= 55 ? 'text-yellow-400' : 'text-red-400'}`}>
            {beatRate != null ? `${beatRate}%` : '—'}
          </p>
          <p className="text-[10px] text-slate-500">{data.totalEvents} quarters</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
          <p className="text-xs text-slate-400">Avg Earnings Move</p>
          <p className="text-xl font-bold mt-0.5 text-yellow-400">±{avgAbsMove?.toFixed(1) ?? '—'}%</p>
          <p className="text-[10px] text-slate-500">absolute day-of move</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
          <p className="text-xs text-slate-400">Avg Pre-Run (10D)</p>
          <p className={`text-xl font-bold mt-0.5 ${pctColor(avgPre10d)}`}>{fmtPct(avgPre10d)}</p>
          <p className="text-[10px] text-slate-500">10 days before earnings</p>
        </div>
        <div className={`rounded-xl p-3 border ${ss.bg} ${ss.border}`}>
          <p className="text-xs text-slate-400">Best Strategy</p>
          <p className={`text-sm font-bold mt-0.5 ${ss.text}`}>{bestStrat?.name}</p>
          <p className="text-[10px] text-slate-500">Win rate: {bestStrat?.winRate ?? '—'}%</p>
        </div>
      </div>

      {/* Recommended action banner */}
      {bestStrat?.signal !== 'INSUFFICIENT_DATA' && bestStrat?.n >= 3 && (
        <div className={`rounded-xl border px-4 py-3 ${ss.bg} ${ss.border}`}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-lg font-black ${ss.text}`}>{ss.label}</span>
            <span className="text-sm text-slate-300">
              <strong className="text-white">{bestStrat.name}</strong> —
              historically {bestStrat.winRate}% win rate, avg {fmtPct(bestStrat.avgReturn)} over {bestStrat.n} setups.
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">{bestStrat.description}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800 rounded-xl p-1 w-fit">
        {[['overview','Strategies'],['chart','Drift Chart'],['history','Trade History']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium ${tab === v ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Strategy cards */}
      {tab === 'overview' && (
        <div className="grid sm:grid-cols-2 gap-3">
          {Object.entries(strategies).map(([k, strat]) => (
            <StrategyCard key={k} stratKey={k} strat={strat} isRecommended={k === bestStrategy} />
          ))}
        </div>
      )}

      {/* Drift chart */}
      {tab === 'chart' && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <h3 className="text-sm font-bold text-white mb-1">Earnings Drift — Last {Math.min(events.length, 8)} Quarters</h3>
          <p className="text-xs text-slate-500 mb-4">Each group shows price drift from -10D to +10D around earnings. Amber bars = earnings reaction day.</p>
          <DriftChart events={events} />
        </div>
      )}

      {/* History table */}
      {tab === 'history' && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/60">
                  {['Date','Beat','Surprise%','EPS Est','EPS Act','Pre-20D','Pre-10D','Pre-5D','Earn. Rxn','Post+1D','Post+5D','Post+10D'].map(h => (
                    <th key={h} className="px-2.5 py-2 text-slate-400 uppercase tracking-wider font-semibold text-right first:text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={e.date} className={`border-b border-slate-700/40 ${i % 2 ? 'bg-slate-900/10' : ''}`}>
                    <td className="px-2.5 py-2 text-slate-300 font-mono whitespace-nowrap">{e.date}</td>
                    <td className="px-2.5 py-2 text-center">
                      {e.beat == null ? <span className="text-slate-600">—</span>
                        : e.beat ? <span className="text-emerald-400 font-bold">✓</span>
                        : <span className="text-red-400 font-bold">✗</span>}
                    </td>
                    <td className={`px-2.5 py-2 text-right font-mono font-bold ${pctColor(e.surprisePct)}`}>{fmtPct(e.surprisePct)}</td>
                    <td className="px-2.5 py-2 text-right text-slate-400 font-mono">{e.epsEstimate?.toFixed(2) ?? '—'}</td>
                    <td className="px-2.5 py-2 text-right text-slate-200 font-mono">{e.epsActual?.toFixed(2) ?? '—'}</td>
                    {['pre20d','pre10d','pre5d','earningsReaction','post1d','post5d','post10d'].map(col => (
                      <td key={col} className={`px-2.5 py-2 text-right font-mono font-bold ${col === 'earningsReaction' ? (e[col] >= 0 ? 'text-yellow-400' : 'text-orange-500') : pctColor(e[col])}`}>
                        {fmtPct(e[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Scanner ───────────────────────────────────────────────────────────────────

function Scanner({ watchlist, onDeepDive }) {
  const [symbols,  setSymbols]  = useState('')
  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [filter,   setFilter]   = useState('all')   // 'all' | 'upcoming' | 'buySignal'
  const [sortCol,  setSortCol]  = useState('daysToEarnings')
  const [sortAsc,  setSortAsc]  = useState(true)

  const scan = useCallback(async (symsStr) => {
    const cleaned = symsStr.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
    if (!cleaned.length) { setError('Enter at least one symbol'); return }
    setLoading(true); setError(''); setData(null)
    try {
      const res = await fetch(`/api/market/earnings-strategy-scan?symbols=${cleaned.join(',')}`)
      if (!res.ok) throw new Error((await res.json()).detail || 'Error')
      setData(await res.json())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  function importWatchlist() {
    const s = watchlist.join(', ')
    setSymbols(s)
    scan(s)
  }

  const filtered = useMemo(() => {
    if (!data) return []
    let rows = [...data]
    if (filter === 'upcoming') rows = rows.filter(r => (r.daysToEarnings ?? 999) <= 30 && (r.daysToEarnings ?? -1) >= 0)
    if (filter === 'buySignal') rows = rows.filter(r => ['STRONG_BUY', 'BUY'].includes(r.bestSignal))
    rows.sort((a, b) => {
      const av = a[sortCol] ?? (sortAsc ? 9999 : -9999)
      const bv = b[sortCol] ?? (sortAsc ? 9999 : -9999)
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortAsc ? av - bv : bv - av
    })
    return rows
  }, [data, filter, sortCol, sortAsc])

  function handleSort(col) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  function TH({ col, label }) {
    const active = sortCol === col
    return (
      <th className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none hover:text-white whitespace-nowrap ${active ? 'text-white' : 'text-slate-400'}`}
        onClick={() => handleSort(col)}>
        {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 space-y-4">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              placeholder="AAPL, MSFT, GOOGL, NVDA …"
              value={symbols}
              onChange={e => setSymbols(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && scan(symbols)}
            />
            {watchlist.length > 0 && (
              <button onClick={importWatchlist}
                className="px-3 py-2 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg border border-emerald-600 whitespace-nowrap font-bold">
                ⬇ Scan Watchlist
              </button>
            )}
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button onClick={() => scan(symbols)} disabled={loading}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
            {loading ? 'Scanning… (takes ~30s for large lists)' : '▶ Scan for Earnings Strategy'}
          </button>
          <p className="text-xs text-slate-500">
            Analyzes 3 years of earnings history per symbol to compute historical strategy win rates. Takes 5–30 seconds depending on list size.
          </p>
        </div>
      </div>
    )
  }

  const buySignals = filtered.filter(r => ['STRONG_BUY','BUY'].includes(r.bestSignal)).length
  const upcoming   = filtered.filter(r => (r.daysToEarnings ?? 999) <= 14 && (r.daysToEarnings ?? -1) >= 0).length

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 text-center">
          <p className="text-xl font-bold text-white">{data.length}</p>
          <p className="text-xs text-slate-400">Analyzed</p>
        </div>
        <div className="bg-emerald-900/20 rounded-xl p-3 border border-emerald-800/30 text-center">
          <p className="text-xl font-bold text-emerald-400">{buySignals}</p>
          <p className="text-xs text-slate-400">Buy Signals</p>
        </div>
        <div className="bg-orange-900/20 rounded-xl p-3 border border-orange-800/30 text-center">
          <p className="text-xl font-bold text-orange-400">{upcoming}</p>
          <p className="text-xs text-slate-400">Earnings ≤14d</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 text-center">
          <button onClick={() => { setData(null); setSymbols('') }}
            className="text-xs text-blue-400 hover:text-blue-300 font-medium">
            ← Rescan
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[['all','All'],['upcoming','Earnings ≤30d'],['buySignal','Buy Signals Only']].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === v ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/60">
                <TH col="symbol"        label="Symbol" />
                <TH col="sector"        label="Sector" />
                <TH col="daysToEarnings" label="Earnings" />
                <TH col="beatRate"      label="Beat Rate" />
                <TH col="avgAbsMove"    label="Avg Move" />
                <TH col="avgPre10d"     label="Pre-Run 10D" />
                <TH col="bestWinRate"   label="Best Win %" />
                <TH col="bestAvgReturn" label="Best Avg Ret" />
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider">Strategy</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider">Signal</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const ss = signalStyle(r.bestSignal)
                const stratNames = { preRun: 'Pre-Run', buyTheBeat: 'Buy Beat', buyTheDip: 'Buy Dip', holdThrough: 'Hold Thru' }
                return (
                  <tr key={r.symbol} className={`border-b border-slate-700/40 hover:bg-slate-700/20 cursor-pointer ${i % 2 ? 'bg-slate-900/10' : ''}`}
                    onClick={() => onDeepDive(r.symbol)}>
                    <td className="px-3 py-2.5">
                      <p className="font-bold text-white">{r.symbol}</p>
                      <p className="text-[10px] text-slate-500 truncate max-w-[90px]">{r.name}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{r.sector ?? '—'}</td>
                    <td className={`px-3 py-2.5 text-sm ${daysUrgency(r.daysToEarnings)}`}>
                      {r.nextEarningsDate ? (
                        <div>
                          <div>{fmtDays(r.daysToEarnings)}</div>
                          <div className="text-[10px] text-slate-500">{r.nextEarningsDate}</div>
                        </div>
                      ) : <span className="text-slate-600">Unknown</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${r.beatRate >= 70 ? 'text-emerald-400' : r.beatRate >= 55 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {r.beatRate != null ? `${r.beatRate}%` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-yellow-400 font-bold tabular-nums">
                      {r.avgAbsMove != null ? `±${r.avgAbsMove.toFixed(1)}%` : '—'}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${pctColor(r.avgPre10d)}`}>
                      {fmtPct(r.avgPre10d)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${r.bestWinRate >= 60 ? 'text-emerald-400' : r.bestWinRate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {r.bestWinRate != null ? `${r.bestWinRate}%` : '—'}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${pctColor(r.bestAvgReturn)}`}>
                      {fmtPct(r.bestAvgReturn)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-300">
                      {stratNames[r.bestStrategy] ?? r.bestStrategy}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${ss.badge} text-white whitespace-nowrap`}>
                        {r.bestSignal?.replace('STRONG_BUY','STRONG BUY').replace('INSUFFICIENT_DATA','NO DATA') ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={e => { e.stopPropagation(); onDeepDive(r.symbol) }}
                        className="text-xs text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap">
                        Deep Dive →
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-500">No stocks match the current filter</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-600">
        Win rates and avg returns are computed from 3 years of historical earnings data. Past patterns do not guarantee future results.
        Earnings dates sourced from Yahoo Finance and may be estimates. Always verify before trading.
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EarningsStrategyAnalyzer({ watchlist = [] }) {
  const [deepDiveSymbol, setDeepDiveSymbol] = useState(null)
  const [deepDiveData,   setDeepDiveData]   = useState(null)
  const [ddLoading,      setDdLoading]      = useState(false)
  const [ddError,        setDdError]        = useState('')

  const loadDeepDive = useCallback(async (sym) => {
    setDdLoading(true); setDdError(''); setDeepDiveData(null); setDeepDiveSymbol(sym)
    try {
      const res = await fetch(`/api/market/earnings-strategy?symbol=${sym}`)
      if (!res.ok) throw new Error((await res.json()).detail || 'Error')
      setDeepDiveData(await res.json())
    } catch (e) { setDdError(e.message) }
    finally { setDdLoading(false) }
  }, [])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Earnings Strategy Analyzer</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Find the best strategy to trade around earnings — pre-run, buy the beat, buy the dip, or hold through — based on each stock's 3-year earnings history.
        </p>
      </div>

      {/* Deep dive input bar (always visible) */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl px-4 py-3 flex gap-2 items-center flex-wrap">
        <span className="text-xs text-slate-400 shrink-0">Quick Deep Dive:</span>
        <input
          className="w-28 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white uppercase placeholder-slate-500 focus:outline-none focus:border-blue-500"
          placeholder="AAPL"
          onKeyDown={e => e.key === 'Enter' && e.target.value.trim() && loadDeepDive(e.target.value.trim().toUpperCase())}
        />
        <span className="text-xs text-slate-500">Press Enter to analyze any stock</span>
        {ddLoading && <span className="text-xs text-blue-400 animate-pulse">Loading {deepDiveSymbol}…</span>}
        {ddError && <span className="text-xs text-red-400">{ddError}</span>}
      </div>

      {deepDiveData ? (
        <DeepDive data={deepDiveData} onBack={() => { setDeepDiveData(null); setDeepDiveSymbol(null) }} />
      ) : (
        <Scanner watchlist={watchlist} onDeepDive={loadDeepDive} />
      )}
    </div>
  )
}
