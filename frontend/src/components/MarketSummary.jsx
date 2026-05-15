import { useState, useEffect, useCallback } from 'react'
import { fmt } from '../utils/format'

const ACTION_META = {
  up:   { label: 'UPGRADE',      cls: 'text-emerald-400 bg-emerald-900/40 border-emerald-800' },
  down: { label: 'DOWNGRADE',    cls: 'text-red-400    bg-red-900/40    border-red-800'     },
  init: { label: 'INITIATED',    cls: 'text-sky-400    bg-sky-900/40    border-sky-800'     },
  reit: { label: 'REITERATED',   cls: 'text-gray-400  bg-gray-800/60  border-gray-700'     },
  main: { label: 'MAINTAINED',   cls: 'text-gray-400  bg-gray-800/60  border-gray-700'     },
}

function SectionLabel({ children }) {
  return <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">{children}</div>
}

function NewsItem({ article }) {
  const date = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null
  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-gray-800/50 border border-gray-700/40 rounded-lg px-4 py-3 hover:bg-gray-800 hover:border-gray-600 transition-colors group"
    >
      <div className="text-white text-sm font-medium leading-snug group-hover:text-sky-300 transition-colors">
        {article.title}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        {article.publisher && <span className="text-gray-500 text-xs">{article.publisher}</span>}
        {date && <><span className="text-gray-700 text-xs">·</span><span className="text-gray-600 text-xs">{date}</span></>}
        <span className="ml-auto text-gray-700 text-xs group-hover:text-sky-600 transition-colors">↗</span>
      </div>
    </a>
  )
}

function MoverRow({ stock, positive }) {
  const pct = stock.changePercent
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded bg-gray-800/50 border border-gray-700/30 hover:bg-gray-800 transition-colors">
      <div className="min-w-0">
        <span className="text-white text-xs font-bold mr-2">{stock.symbol}</span>
        <span className="text-gray-500 text-xs truncate">{stock.name}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-3">
        <span className="text-gray-400 text-xs">{fmt.price(stock.price)}</span>
        <span className={`text-xs font-semibold w-16 text-right ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
          {pct != null ? `${positive ? '+' : ''}${pct.toFixed(2)}%` : '—'}
        </span>
      </div>
    </div>
  )
}

function AnalystRow({ action }) {
  const meta = ACTION_META[action.action] || ACTION_META.main
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded bg-gray-800/50 border border-gray-700/30 hover:bg-gray-800 transition-colors">
      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${meta.cls}`}>
        {meta.label}
      </span>
      <span className="text-white text-xs font-bold">{action.symbol}</span>
      {action.fromGrade && action.toGrade && action.fromGrade !== action.toGrade && (
        <span className="text-gray-500 text-xs">
          {action.fromGrade} → <span className="text-gray-300">{action.toGrade}</span>
        </span>
      )}
      {(!action.fromGrade || action.fromGrade === action.toGrade) && action.toGrade && (
        <span className="text-gray-300 text-xs">{action.toGrade}</span>
      )}
      {action.priceTarget && (
        <span className="text-gray-500 text-xs">PT {fmt.price(action.priceTarget)}</span>
      )}
      <span className="text-gray-600 text-xs ml-auto">{action.firm}</span>
      <span className="text-gray-700 text-xs">{action.date}</span>
    </div>
  )
}

export default function MarketSummary() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [lastFetch, setLastFetch] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/market/summary')
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      setData(await res.json())
      setLastFetch(new Date())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Daily Market Summary</div>
        <div className="flex items-center gap-3">
          {lastFetch && (
            <span className="text-gray-600 text-xs">
              Updated {lastFetch.toLocaleTimeString()} · cached 15 min
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-400 hover:text-white px-3 py-1 text-xs rounded transition-colors"
          >
            {loading ? <span className="animate-pulse">↻ Loading…</span> : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded px-4 py-3 mb-4">
          ⚠ {error}
        </div>
      )}

      {loading && !data && (
        <div className="text-gray-500 text-sm text-center py-20 animate-pulse">
          Loading market data — this may take a moment on first load…
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Headlines */}
          {data.headlines?.length > 0 && (
            <section>
              <SectionLabel>Top Headlines</SectionLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {data.headlines.map((a, i) => <NewsItem key={i} article={a} />)}
              </div>
            </section>
          )}

          {/* Gainers / Losers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {data.gainers?.length > 0 && (
              <section>
                <SectionLabel>Top 10 Gainers</SectionLabel>
                <div className="space-y-1.5">
                  {data.gainers.map((s, i) => <MoverRow key={i} stock={s} positive={true} />)}
                </div>
              </section>
            )}
            {data.losers?.length > 0 && (
              <section>
                <SectionLabel>Top 10 Losers</SectionLabel>
                <div className="space-y-1.5">
                  {data.losers.map((s, i) => <MoverRow key={i} stock={s} positive={false} />)}
                </div>
              </section>
            )}
          </div>

          {/* Analyst Actions */}
          {data.analystActions?.length > 0 && (
            <section>
              <SectionLabel>Analyst Actions — Upgrades &amp; Downgrades</SectionLabel>
              <div className="space-y-1.5">
                {data.analystActions.map((a, i) => <AnalystRow key={i} action={a} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
