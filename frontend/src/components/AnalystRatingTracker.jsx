import { useState, useEffect, useMemo, useCallback } from 'react'

const API = 'http://localhost:8000'

// ── Helpers ──────────────────────────────────────────────────────────────────

function consensusColor(label) {
  if (!label) return 'text-slate-400'
  const l = label.toLowerCase()
  if (l.includes('strong buy'))  return 'text-emerald-400'
  if (l.includes('buy'))         return 'text-green-400'
  if (l.includes('hold'))        return 'text-yellow-400'
  if (l.includes('strong sell')) return 'text-rose-500'
  if (l.includes('sell'))        return 'text-red-400'
  return 'text-slate-400'
}

function sentimentDot(sentiment) {
  if (sentiment === 'positive') return 'bg-emerald-500'
  if (sentiment === 'negative') return 'bg-red-500'
  return 'bg-slate-500'
}

function actionBadge(action) {
  const cfg = {
    up:   { label: 'Upgrade',     cls: 'bg-emerald-900 text-emerald-300 border border-emerald-700' },
    down: { label: 'Downgrade',   cls: 'bg-red-900 text-red-300 border border-red-700' },
    init: { label: 'Initiation',  cls: 'bg-blue-900 text-blue-300 border border-blue-700' },
    reit: { label: 'Reiteration', cls: 'bg-slate-700 text-slate-300 border border-slate-600' },
    main: { label: 'Maintained',  cls: 'bg-slate-700 text-slate-300 border border-slate-600' },
  }
  const c = cfg[action] || { label: action, cls: 'bg-slate-700 text-slate-300 border border-slate-600' }
  return <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${c.cls}`}>{c.label}</span>
}

function retColor(v) {
  if (v == null) return 'text-slate-500'
  return v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-slate-400'
}

function retStr(v) {
  if (v == null) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(1) + '%'
}

// ── Price Target Bar ──────────────────────────────────────────────────────────

function PriceTargetBar({ current, low, high, mean }) {
  if (!low || !high || low >= high) return <span className="text-slate-500 text-xs">—</span>
  const pct = v => Math.max(0, Math.min(100, ((v - low) / (high - low)) * 100))
  return (
    <div className="flex flex-col gap-1 w-36">
      <div className="relative h-2 bg-slate-700 rounded-full">
        <div className="absolute inset-y-0 left-0 bg-slate-500 rounded-full"
          style={{ width: `${pct(mean || (low + high) / 2)}%` }} />
        {current && (
          <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white border border-slate-400"
            style={{ left: `calc(${pct(current)}% - 4px)` }} />
        )}
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>${low?.toFixed(0)}</span>
        <span className="text-slate-400">${mean?.toFixed(0)}</span>
        <span>${high?.toFixed(0)}</span>
      </div>
    </div>
  )
}

// ── Consensus Badge ───────────────────────────────────────────────────────────

function ConsensusBadge({ label, mean }) {
  if (!label || label === 'N/A') return <span className="text-slate-500">—</span>
  const dots = [1, 2, 3, 4, 5].map(i => {
    const filled = mean != null && (6 - mean) >= i
    return (
      <span key={i} className={`w-1.5 h-1.5 rounded-full ${filled ? 'bg-current' : 'bg-slate-600'}`} />
    )
  })
  return (
    <div className={`flex items-center gap-1 ${consensusColor(label)}`}>
      <span className="text-xs font-semibold">{label}</span>
      <div className="flex gap-0.5 ml-1">{dots}</div>
    </div>
  )
}

// ── Net Sentiment Bar ─────────────────────────────────────────────────────────

function NetBar({ upgrades, downgrades }) {
  const total = upgrades + downgrades
  if (!total) return <span className="text-slate-500 text-xs">—</span>
  const upPct = (upgrades / total) * 100
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-2 bg-red-900 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${upPct}%` }} />
      </div>
      <span className="text-xs text-slate-400">{upgrades}↑ {downgrades}↓</span>
    </div>
  )
}

// ── Feed Row ──────────────────────────────────────────────────────────────────

function FeedRow({ sym, name, change, onDeepDive }) {
  return (
    <tr className="border-b border-slate-700 hover:bg-slate-750 cursor-pointer"
        onClick={() => onDeepDive(sym)}>
      <td className="px-3 py-2 text-xs text-slate-500 w-24">{change.date}</td>
      <td className="px-3 py-2">
        <button className="font-bold text-sky-400 hover:underline text-sm">{sym}</button>
        <div className="text-xs text-slate-500 truncate max-w-[140px]">{name}</div>
      </td>
      <td className="px-3 py-2">{actionBadge(change.action)}</td>
      <td className="px-3 py-2 text-sm text-slate-300">{change.firm || '—'}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${sentimentDot(change.sentiment)}`} />
          <span className="text-xs text-slate-300">{change.toGrade || '—'}</span>
        </div>
        {change.fromGrade && (
          <div className="text-xs text-slate-500">from {change.fromGrade}</div>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {change.priceAt ? <span className="text-slate-400">${change.priceAt.toFixed(2)}</span> : <span className="text-slate-600">—</span>}
      </td>
      <td className="px-3 py-2 text-xs">
        <span className={retColor(change.ret5d)}>{retStr(change.ret5d)}</span>
      </td>
      <td className="px-3 py-2 text-xs">
        <span className={retColor(change.retSince)}>{retStr(change.retSince)}</span>
      </td>
    </tr>
  )
}

// ── By-Stock Row ──────────────────────────────────────────────────────────────

function StockRow({ stock, onDeepDive }) {
  const { symbol, name, currentPrice, consensus, summary } = stock
  return (
    <tr className="border-b border-slate-700 hover:bg-slate-750 cursor-pointer"
        onClick={() => onDeepDive(symbol)}>
      <td className="px-3 py-3">
        <div className="font-bold text-sky-400 text-sm">{symbol}</div>
        <div className="text-xs text-slate-500 truncate max-w-[140px]">{name}</div>
      </td>
      <td className="px-3 py-3">
        <ConsensusBadge label={consensus.label} mean={consensus.mean} />
        {consensus.count != null && (
          <div className="text-xs text-slate-500">{consensus.count} analysts</div>
        )}
      </td>
      <td className="px-3 py-3 text-sm text-slate-300">
        {currentPrice ? <>${currentPrice.toFixed(2)}</> : '—'}
      </td>
      <td className="px-3 py-3">
        {consensus.upsidePct != null ? (
          <span className={retColor(consensus.upsidePct)}>
            {retStr(consensus.upsidePct)}
          </span>
        ) : '—'}
        {consensus.targetMean && (
          <div className="text-xs text-slate-500">${consensus.targetMean.toFixed(2)} avg</div>
        )}
      </td>
      <td className="px-3 py-3">
        <PriceTargetBar
          current={currentPrice}
          low={consensus.targetLow}
          high={consensus.targetHigh}
          mean={consensus.targetMean}
        />
      </td>
      <td className="px-3 py-3">
        <NetBar upgrades={summary.upgrades} downgrades={summary.downgrades} />
      </td>
      <td className="px-3 py-3 text-xs text-slate-400 text-center">{summary.initiations}</td>
      <td className="px-3 py-3 text-xs text-slate-400 text-center">{summary.totalChanges}</td>
    </tr>
  )
}

// ── Deep Dive Panel ───────────────────────────────────────────────────────────

function DeepDive({ stock, onClose }) {
  if (!stock) return null
  const { symbol, name, currentPrice, consensus, recentChanges, summary } = stock
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-white">{symbol}</h2>
            <div className="text-sm text-slate-400">{name}</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Consensus cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-5 border-b border-slate-700">
          <div className="bg-slate-700 rounded-lg p-3">
            <div className="text-xs text-slate-400 mb-1">Consensus</div>
            <div className={`font-bold ${consensusColor(consensus.label)}`}>{consensus.label}</div>
            {consensus.count && <div className="text-xs text-slate-500">{consensus.count} analysts</div>}
          </div>
          <div className="bg-slate-700 rounded-lg p-3">
            <div className="text-xs text-slate-400 mb-1">Current Price</div>
            <div className="font-bold text-white">{currentPrice ? `$${currentPrice.toFixed(2)}` : '—'}</div>
          </div>
          <div className="bg-slate-700 rounded-lg p-3">
            <div className="text-xs text-slate-400 mb-1">Avg Target</div>
            <div className="font-bold text-white">{consensus.targetMean ? `$${consensus.targetMean.toFixed(2)}` : '—'}</div>
            {consensus.upsidePct != null && (
              <div className={`text-xs ${retColor(consensus.upsidePct)}`}>{retStr(consensus.upsidePct)} upside</div>
            )}
          </div>
          <div className="bg-slate-700 rounded-lg p-3">
            <div className="text-xs text-slate-400 mb-2">Target Range</div>
            <div className="text-xs text-slate-300">
              ${consensus.targetLow?.toFixed(2) || '—'} – ${consensus.targetHigh?.toFixed(2) || '—'}
            </div>
          </div>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-slate-700">
          <span className="px-2 py-1 rounded bg-emerald-900 text-emerald-300 text-xs">{summary.upgrades} Upgrades</span>
          <span className="px-2 py-1 rounded bg-red-900 text-red-300 text-xs">{summary.downgrades} Downgrades</span>
          <span className="px-2 py-1 rounded bg-blue-900 text-blue-300 text-xs">{summary.initiations} Initiations</span>
          <span className="px-2 py-1 rounded bg-slate-700 text-slate-300 text-xs">{summary.reiterations} Reiterations</span>
        </div>

        {/* Recent changes table */}
        <div className="p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Recent Analyst Actions (90 days)</h3>
          {recentChanges.length === 0 ? (
            <p className="text-slate-500 text-sm">No recent analyst activity found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-700">
                    <th className="text-left px-2 py-2">Date</th>
                    <th className="text-left px-2 py-2">Action</th>
                    <th className="text-left px-2 py-2">Firm</th>
                    <th className="text-left px-2 py-2">Rating</th>
                    <th className="text-right px-2 py-2">Price At</th>
                    <th className="text-right px-2 py-2">+5d Ret</th>
                    <th className="text-right px-2 py-2">Since</th>
                  </tr>
                </thead>
                <tbody>
                  {recentChanges.map((c, i) => (
                    <tr key={i} className="border-b border-slate-700/50">
                      <td className="px-2 py-2 text-slate-500 text-xs">{c.date}</td>
                      <td className="px-2 py-2">{actionBadge(c.action)}</td>
                      <td className="px-2 py-2 text-slate-300">{c.firm || '—'}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${sentimentDot(c.sentiment)}`} />
                          <span className="text-slate-300 text-xs">{c.toGrade || '—'}</span>
                        </div>
                        {c.fromGrade && <div className="text-xs text-slate-500">← {c.fromGrade}</div>}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-400 text-xs">
                        {c.priceAt ? `$${c.priceAt.toFixed(2)}` : '—'}
                      </td>
                      <td className={`px-2 py-2 text-right text-xs ${retColor(c.ret5d)}`}>{retStr(c.ret5d)}</td>
                      <td className={`px-2 py-2 text-right text-xs ${retColor(c.retSince)}`}>{retStr(c.retSince)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AnalystRatingTracker({ watchlist = [] }) {
  const [data, setData]           = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [view, setView]           = useState('feed')      // 'feed' | 'bystock'
  const [actionFilter, setAction] = useState('all')       // 'all' | 'up' | 'down' | 'init'
  const [sentFilter, setSent]     = useState('all')       // 'all' | 'positive' | 'negative'
  const [sort, setSort]           = useState('date')      // 'date' | 'upgrades' | 'net' | 'upside'
  const [deepDive, setDeepDive]   = useState(null)

  const symbols = watchlist.length > 0 ? watchlist : ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA']

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/market/analyst-ratings?symbols=${symbols.join(',')}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [symbols.join(',')])

  useEffect(() => { load() }, [load])

  // Flat feed: all recent changes across all stocks, newest first
  const feedRows = useMemo(() => {
    const rows = []
    data.forEach(stock => {
      stock.recentChanges.forEach(c => {
        rows.push({ sym: stock.symbol, name: stock.name, change: c })
      })
    })
    rows.sort((a, b) => b.change.date.localeCompare(a.change.date))
    return rows
  }, [data])

  const filteredFeed = useMemo(() => {
    return feedRows.filter(r => {
      if (actionFilter !== 'all' && r.change.action !== actionFilter) return false
      if (sentFilter !== 'all' && r.change.sentiment !== sentFilter) return false
      return true
    })
  }, [feedRows, actionFilter, sentFilter])

  const sortedStocks = useMemo(() => {
    const arr = [...data]
    if (sort === 'date') {
      return arr.sort((a, b) => {
        const ad = a.recentChanges[0]?.date || ''
        const bd = b.recentChanges[0]?.date || ''
        return bd.localeCompare(ad)
      })
    }
    if (sort === 'upgrades') return arr.sort((a, b) => b.summary.upgrades - a.summary.upgrades)
    if (sort === 'net') return arr.sort((a, b) => b.summary.netSentiment - a.summary.netSentiment)
    if (sort === 'upside') {
      return arr.sort((a, b) => (b.consensus.upsidePct ?? -999) - (a.consensus.upsidePct ?? -999))
    }
    return arr
  }, [data, sort])

  const openDeepDive = useCallback(sym => {
    const stock = data.find(s => s.symbol === sym)
    if (stock) setDeepDive(stock)
  }, [data])

  // Summary stats across all stocks
  const totalUpgrades   = data.reduce((s, d) => s + d.summary.upgrades, 0)
  const totalDowngrades = data.reduce((s, d) => s + d.summary.downgrades, 0)
  const totalChanges    = data.reduce((s, d) => s + d.summary.totalChanges, 0)

  return (
    <div className="p-4 text-white max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Analyst Rating Tracker</h1>
          <p className="text-sm text-slate-400">Upgrades, downgrades & initiations across your watchlist (last 90 days)</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm rounded-lg disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Summary chips */}
      {!loading && data.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="bg-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-xs text-slate-400">Total Actions</div>
            <div className="text-lg font-bold text-white">{totalChanges}</div>
          </div>
          <div className="bg-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-xs text-slate-400">Upgrades</div>
            <div className="text-lg font-bold text-emerald-400">{totalUpgrades}</div>
          </div>
          <div className="bg-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-xs text-slate-400">Downgrades</div>
            <div className="text-lg font-bold text-red-400">{totalDowngrades}</div>
          </div>
          <div className="bg-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-xs text-slate-400">Net Sentiment</div>
            <div className={`text-lg font-bold ${retColor(totalUpgrades - totalDowngrades)}`}>
              {totalUpgrades - totalDowngrades > 0 ? '+' : ''}{totalUpgrades - totalDowngrades}
            </div>
          </div>
        </div>
      )}

      {/* View toggle */}
      <div className="flex items-center gap-2 mb-4">
        {['feed', 'bystock'].map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === v ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            {v === 'feed' ? 'Activity Feed' : 'By Stock'}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-red-300 text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="text-center py-16 text-slate-400">Loading analyst data…</div>
      ) : (

        /* ── Feed View ── */
        view === 'feed' ? (
          <div className="bg-slate-800 rounded-xl border border-slate-700">
            {/* Filters */}
            <div className="flex flex-wrap gap-2 p-3 border-b border-slate-700">
              <span className="text-xs text-slate-500 self-center mr-1">Action:</span>
              {[['all','All'],['up','Upgrades'],['down','Downgrades'],['init','Initiations']].map(([val, lbl]) => (
                <button key={val} onClick={() => setAction(val)}
                  className={`px-2 py-1 rounded text-xs ${actionFilter === val ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                  {lbl}
                </button>
              ))}
              <span className="text-xs text-slate-500 self-center ml-2 mr-1">Sentiment:</span>
              {[['all','All'],['positive','Positive'],['negative','Negative']].map(([val, lbl]) => (
                <button key={val} onClick={() => setSent(val)}
                  className={`px-2 py-1 rounded text-xs ${sentFilter === val ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                  {lbl}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-700 bg-slate-800/80">
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Stock</th>
                    <th className="text-left px-3 py-2">Action</th>
                    <th className="text-left px-3 py-2">Firm</th>
                    <th className="text-left px-3 py-2">Rating</th>
                    <th className="text-left px-3 py-2">Price At</th>
                    <th className="text-left px-3 py-2">+5d Return</th>
                    <th className="text-left px-3 py-2">Since Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFeed.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-slate-500">No analyst activity found</td></tr>
                  ) : filteredFeed.map((r, i) => (
                    <FeedRow key={i} sym={r.sym} name={r.name} change={r.change} onDeepDive={openDeepDive} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        ) : (
          /* ── By Stock View ── */
          <div className="bg-slate-800 rounded-xl border border-slate-700">
            {/* Sort */}
            <div className="flex gap-2 p-3 border-b border-slate-700 items-center">
              <span className="text-xs text-slate-500 mr-1">Sort:</span>
              {[['date','Recent'],['upgrades','Upgrades'],['net','Net Sentiment'],['upside','Upside']].map(([val, lbl]) => (
                <button key={val} onClick={() => setSort(val)}
                  className={`px-2 py-1 rounded text-xs ${sort === val ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                  {lbl}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-700 bg-slate-800/80">
                    <th className="text-left px-3 py-2">Stock</th>
                    <th className="text-left px-3 py-2">Consensus</th>
                    <th className="text-left px-3 py-2">Price</th>
                    <th className="text-left px-3 py-2">Upside</th>
                    <th className="text-left px-3 py-2">Target Range</th>
                    <th className="text-left px-3 py-2">90d Activity</th>
                    <th className="text-center px-3 py-2">Inits</th>
                    <th className="text-center px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStocks.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-slate-500">No data available</td></tr>
                  ) : sortedStocks.map(s => (
                    <StockRow key={s.symbol} stock={s} onDeepDive={openDeepDive} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {deepDive && <DeepDive stock={deepDive} onClose={() => setDeepDive(null)} />}
    </div>
  )
}
