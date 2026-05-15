import { useState, useEffect, useCallback } from 'react'
import { fmt } from '../utils/format'
import ChartModal from './ChartModal'

const PERIODS = ['1d', '5d', '1m', '3m', '6m', '1y', 'ytd']
const PERIOD_LABELS = { '1d': '1D', '5d': '5D', '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y', 'ytd': 'YTD' }

function SectionLabel({ children }) {
  return <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">{children}</div>
}

function Pct({ v }) {
  if (v == null) return <span className="text-gray-700 text-xs">—</span>
  const cls = v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400'
  return <span className={`text-xs font-medium ${cls}`}>{v > 0 ? '+' : ''}{v.toFixed(2)}%</span>
}

function PerformanceTable({ rows, onRowClick }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-800">
            <th className="text-left text-gray-600 py-2 pr-4 font-medium tracking-wider uppercase">Symbol</th>
            <th className="text-left text-gray-600 py-2 pr-6 font-medium tracking-wider uppercase">Name</th>
            <th className="text-right text-gray-600 py-2 px-3 font-medium tracking-wider uppercase">Price</th>
            {PERIODS.map(p => (
              <th key={p} className="text-right text-gray-600 py-2 px-3 font-medium tracking-wider uppercase">
                {PERIOD_LABELS[p]}
              </th>
            ))}
            {onRowClick && <th className="py-2 pl-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.symbol}
              onClick={() => onRowClick?.(row)}
              className={`border-b border-gray-800/50 transition-colors ${
                onRowClick ? 'cursor-pointer hover:bg-gray-800/50' : 'hover:bg-gray-800/30'
              }`}
            >
              <td className="py-2.5 pr-4 font-bold text-white">{row.symbol}</td>
              <td className="py-2.5 pr-6 text-gray-400 whitespace-nowrap">{row.name}</td>
              <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{fmt.price(row.price)}</td>
              {PERIODS.map(p => (
                <td key={p} className="py-2.5 px-3 text-right tabular-nums">
                  <Pct v={row[p]} />
                </td>
              ))}
              {onRowClick && (
                <td className="py-2.5 pl-2 text-gray-700 hover:text-sky-400 transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded bg-gray-800/50 border border-gray-700/30 hover:bg-gray-800 transition-colors">
      <div className="min-w-0">
        <span className="text-white text-xs font-bold mr-2">{stock.symbol}</span>
        <span className="text-gray-500 text-xs truncate">{stock.name}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-3">
        <span className="text-gray-400 text-xs">{fmt.price(stock.price)}</span>
        <span className={`text-xs font-semibold w-16 text-right ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
          {stock.changePercent != null
            ? `${positive ? '+' : ''}${stock.changePercent.toFixed(2)}%`
            : '—'}
        </span>
      </div>
    </div>
  )
}

function makeQuote(row) {
  if (!row?.price || row['1d'] == null) return { name: row?.name ?? row?.symbol }
  const pct = row['1d']
  const prev = row.price / (1 + pct / 100)
  return {
    name:          row.name,
    price:         row.price,
    change:        row.price - prev,
    changePercent: pct,
  }
}

export default function MarketSummary() {
  const [summary, setSummary]   = useState(null)
  const [perf, setPerf]         = useState(null)
  const [sumLoading, setSumLoading] = useState(true)
  const [perfLoading, setPerfLoading] = useState(true)
  const [sumError, setSumError] = useState(null)
  const [perfError, setPerfError] = useState(null)
  const [lastFetch, setLastFetch] = useState(null)
  const [chartRow, setChartRow] = useState(null)

  const fetchSummary = useCallback(async () => {
    setSumLoading(true); setSumError(null)
    try {
      const r = await fetch('/api/market/summary')
      if (!r.ok) throw new Error(`Server error ${r.status}`)
      setSummary(await r.json())
    } catch (e) { setSumError(e.message) }
    finally { setSumLoading(false) }
  }, [])

  const fetchPerf = useCallback(async () => {
    setPerfLoading(true); setPerfError(null)
    try {
      const r = await fetch('/api/market/performance')
      if (!r.ok) throw new Error(`Server error ${r.status}`)
      setPerf(await r.json())
      setLastFetch(new Date())
    } catch (e) { setPerfError(e.message) }
    finally { setPerfLoading(false) }
  }, [])

  useEffect(() => { fetchSummary(); fetchPerf() }, [fetchSummary, fetchPerf])

  const refresh = () => { fetchSummary(); fetchPerf() }
  const loading = sumLoading || perfLoading

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Daily Market Summary</div>
        <div className="flex items-center gap-3">
          {lastFetch && !loading && (
            <span className="text-gray-600 text-xs">Updated {lastFetch.toLocaleTimeString()} · cached 15 min</span>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-400 hover:text-white px-3 py-1 text-xs rounded transition-colors"
          >
            {loading ? <span className="animate-pulse">↻ Loading…</span> : '↻ Refresh'}
          </button>
        </div>
      </div>

      {(sumError || perfError) && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded px-4 py-3 mb-4">
          ⚠ {sumError || perfError}
        </div>
      )}

      {loading && !perf && !summary && (
        <div className="text-gray-500 text-sm text-center py-20 animate-pulse">
          Loading market data — first load may take a moment…
        </div>
      )}

      <div className="flex gap-6 items-start">

        {/* ── Left column: tables ── */}
        <div className="flex-1 min-w-0 space-y-8">
          {/* Major Indices & ETFs */}
          {perf?.indices?.length > 0 && (
            <section>
              <SectionLabel>Major Indices &amp; ETFs</SectionLabel>
              <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-2">
                <PerformanceTable rows={perf.indices} />
              </div>
            </section>
          )}

          {/* Sector ETFs */}
          {perf?.sectors?.length > 0 && (
            <section>
              <SectionLabel>US Sector ETFs — click any row to view chart</SectionLabel>
              <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-2">
                <PerformanceTable rows={perf.sectors} onRowClick={setChartRow} />
              </div>
            </section>
          )}

          {/* Magnificent 7 */}
          {perf?.mag7?.length > 0 && (
            <section>
              <SectionLabel>Magnificent 7</SectionLabel>
              <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-2">
                <PerformanceTable rows={perf.mag7} />
              </div>
            </section>
          )}

          {/* Gainers / Losers */}
          {(summary?.gainers?.length > 0 || summary?.losers?.length > 0) && (
            <div className="grid grid-cols-2 gap-6">
              {summary?.gainers?.length > 0 && (
                <section>
                  <SectionLabel>Top 10 Gainers</SectionLabel>
                  <div className="space-y-1.5">
                    {summary.gainers.map((s, i) => <MoverRow key={i} stock={s} positive />)}
                  </div>
                </section>
              )}
              {summary?.losers?.length > 0 && (
                <section>
                  <SectionLabel>Top 10 Losers</SectionLabel>
                  <div className="space-y-1.5">
                    {summary.losers.map((s, i) => <MoverRow key={i} stock={s} positive={false} />)}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {/* ── Right column: news ── */}
        {summary?.headlines?.length > 0 && (
          <aside className="w-80 shrink-0 space-y-2">
            <SectionLabel>Top Headlines</SectionLabel>
            {summary.headlines.map((a, i) => <NewsItem key={i} article={a} />)}
          </aside>
        )}

      </div>

      {/* Sector ETF drilldown chart */}
      {chartRow && (
        <ChartModal
          symbol={chartRow.symbol}
          quote={makeQuote(chartRow)}
          onClose={() => setChartRow(null)}
        />
      )}
    </div>
  )
}
