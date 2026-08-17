import { useState, useEffect } from 'react'

const fmtMoney = v => v == null ? '—' : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPct   = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const pnlColor = v => v == null ? 'text-gray-500' : v >= 0 ? 'text-emerald-400' : 'text-red-400'

function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
      <div className="text-gray-500 text-xs uppercase tracking-widest">{label}</div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-gray-600 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

function SectionCard({ title, linkLabel, onLink, children }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span className="text-gray-500 text-xs uppercase tracking-widest">{title}</span>
        {onLink && (
          <button onClick={onLink} className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors">
            {linkLabel ?? 'View all'} →
          </button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function Empty({ children }) {
  return <div className="text-center text-gray-600 text-sm py-6">{children}</div>
}

export default function HomeDashboard({ watchlist, quotes, alerts, earnings, portfolioSymbols, navIndex, recentTabs, onNavigate }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    fetch('/api/home/summary')
      .then(r => r.json())
      .then(d => { if (!cancelled) setSummary(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const p = summary?.portfolio
  const m = summary?.market

  const watchlistQuotes = watchlist
    .map(s => quotes[s])
    .filter(q => q && q.changePercent != null)
  const gainers = [...watchlistQuotes].sort((a, b) => b.changePercent - a.changePercent).slice(0, 3)
  const losers  = [...watchlistQuotes].sort((a, b) => a.changePercent - b.changePercent).slice(0, 3)

  const earningsThisWeek = (earnings || [])
    .filter(e => e.daysUntil != null && e.daysUntil >= 0 && e.daysUntil <= 7)
    .sort((a, b) => a.daysUntil - b.daysUntil)

  const activeAlerts = (alerts || []).filter(a => a.status === 'active')

  const recentItems = (recentTabs || [])
    .map(id => navIndex[id])
    .filter(Boolean)
    .filter(i => i.id !== 'home')
    .slice(0, 8)

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-5">
      <div>
        <h2 className="text-white font-bold text-lg">Home</h2>
        <p className="text-gray-500 text-xs mt-0.5">Your account at a glance.</p>
      </div>

      {error && <div className="text-red-400 text-sm bg-red-950/30 border border-red-800/50 rounded-lg p-3">{error}</div>}

      {/* Portfolio snapshot */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Portfolio Value" value={loading ? '…' : fmtMoney(p?.totalValue)} />
        <StatCard label="Day P&L" value={loading ? '…' : `${p?.dayPnl >= 0 ? '+' : ''}${fmtMoney(p?.dayPnl)}`}
          color={pnlColor(p?.dayPnl)} sub={p?.dayPnlPct != null ? fmtPct(p.dayPnlPct) : null} />
        <StatCard label="Total P&L" value={loading ? '…' : `${p?.totalPnl >= 0 ? '+' : ''}${fmtMoney(p?.totalPnl)}`}
          color={pnlColor(p?.totalPnl)} sub={p?.totalPnlPct != null ? fmtPct(p.totalPnlPct) : null} />
        <StatCard label="Positions" value={loading ? '…' : (p?.positionCount ?? 0)}
          sub={!loading && !p?.positionCount ? 'No positions yet' : null} />
      </div>

      {/* Market pulse */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {['SPY', 'QQQ', 'DIA'].map(sym => {
          const d = m?.indices?.find(i => i.symbol === sym)
          return (
            <StatCard key={sym} label={sym} value={loading ? '…' : (d ? `$${d.price.toLocaleString()}` : '—')}
              color={pnlColor(d?.['1d'])} sub={d ? fmtPct(d['1d']) + ' today' : null} />
          )
        })}
        <StatCard label="VIX" value={loading ? '…' : (m?.vix?.price ?? '—')}
          color={m?.vix?.label === 'High' ? 'text-red-400' : m?.vix?.label === 'Elevated' ? 'text-amber-400' : 'text-emerald-400'}
          sub={m?.vix?.label ? `${m.vix.label} · ${fmtPct(m.vix['1d'])} today` : null} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Portfolio Movers" linkLabel="Portfolio" onLink={() => onNavigate('portfolio')}>
          {!p?.topDayMovers?.length ? (
            <Empty>{p?.positionCount ? 'No day-change data available.' : 'Add a position to see movers here.'}</Empty>
          ) : (
            <div className="space-y-2">
              {p.topDayMovers.map(row => (
                <div key={row.symbol} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300 font-medium">{row.symbol}</span>
                  <span className="text-gray-600 tabular-nums text-xs">{fmtMoney(row.value)}</span>
                  <span className={`tabular-nums font-medium ${pnlColor(row.dayPnl)}`}>
                    {row.dayPnl >= 0 ? '+' : ''}{fmtMoney(row.dayPnl)} ({fmtPct(row.dayPnlPct)})
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Watchlist Movers" linkLabel="Watchlist" onLink={() => onNavigate('watchlist')}>
          {!watchlistQuotes.length ? (
            <Empty>No live quotes yet.</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-1">Gainers</div>
                {gainers.map(q => (
                  <div key={q.symbol} className="flex items-center justify-between text-sm">
                    <span className="text-gray-300 font-medium">{q.symbol}</span>
                    <span className="text-emerald-400 tabular-nums">{fmtPct(q.changePercent)}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-1">Losers</div>
                {losers.map(q => (
                  <div key={q.symbol} className="flex items-center justify-between text-sm">
                    <span className="text-gray-300 font-medium">{q.symbol}</span>
                    <span className="text-red-400 tabular-nums">{fmtPct(q.changePercent)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Earnings This Week" linkLabel="Watchlist" onLink={() => onNavigate('watchlist')}>
          {!earningsThisWeek.length ? (
            <Empty>Nothing reporting in the next 7 days.</Empty>
          ) : (
            <div className="space-y-2">
              {earningsThisWeek.map(e => (
                <div key={e.symbol} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300 font-medium">{e.symbol}</span>
                  <span className="text-gray-500 text-xs">{e.date}</span>
                  <span className={`text-xs ${e.daysUntil <= 1 ? 'text-amber-400' : 'text-gray-500'}`}>
                    {e.daysUntil === 0 ? 'Today' : e.daysUntil === 1 ? 'Tomorrow' : `In ${e.daysUntil}d`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Active Alerts" linkLabel="Watchlist" onLink={() => onNavigate('watchlist')}>
          {!activeAlerts.length ? (
            <Empty>No active price alerts.</Empty>
          ) : (
            <div className="space-y-2">
              {activeAlerts.slice(0, 6).map(a => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300 font-medium">{a.symbol}</span>
                  <span className="text-gray-500 text-xs">
                    {a.condition === 'above' ? '≥' : '≤'} {a.target_price != null ? `$${a.target_price}` : a.trigger_value}
                  </span>
                </div>
              ))}
              {activeAlerts.length > 6 && (
                <div className="text-gray-600 text-xs pt-1">+{activeAlerts.length - 6} more</div>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      {recentItems.length > 0 && (
        <div>
          <div className="text-gray-500 text-xs uppercase tracking-widest mb-2">Recently Visited</div>
          <div className="flex flex-wrap gap-2">
            {recentItems.map(item => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className="bg-gray-900/60 hover:bg-gray-800 border border-gray-800 text-gray-300 text-xs px-3 py-1.5 rounded-lg transition-colors"
              >
                {item.label} <span className="text-gray-600">· {item.group}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="text-center text-gray-700 text-xs pt-2">
        Press <kbd className="border border-gray-700 rounded px-1.5 py-0.5 mx-1">⌘K</kbd> to jump to any of the app's tools.
      </div>
    </div>
  )
}
