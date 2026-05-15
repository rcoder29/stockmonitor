import { useState, useCallback, useEffect } from 'react'
import { fmt } from '../utils/format'
import ChartModal from './ChartModal'

// ── Analyst action badges ─────────────────────────────────────────────────────
const ACTION_META = {
  up:   { label: 'UPGRADE',    cls: 'text-emerald-400 bg-emerald-900/40 border-emerald-800' },
  down: { label: 'DOWNGRADE',  cls: 'text-red-400    bg-red-900/40    border-red-800'     },
  init: { label: 'INITIATED',  cls: 'text-sky-400    bg-sky-900/40    border-sky-800'     },
  reit: { label: 'REITERATED', cls: 'text-gray-400   bg-gray-800/60  border-gray-700'     },
  main: { label: 'MAINTAINED', cls: 'text-gray-400   bg-gray-800/60  border-gray-700'     },
}

// ── AI layer badge colours ────────────────────────────────────────────────────
const LAYER_META = {
  'Chips & Compute':  { cls: 'text-violet-300  bg-violet-900/50  border-violet-700'  },
  'Memory & Storage': { cls: 'text-blue-300    bg-blue-900/50    border-blue-700'    },
  'Semi Equipment':   { cls: 'text-indigo-300  bg-indigo-900/50  border-indigo-700'  },
  'Cloud & Infra':    { cls: 'text-sky-300     bg-sky-900/50     border-sky-700'     },
  'Networking':       { cls: 'text-teal-300    bg-teal-900/50    border-teal-700'    },
  'Power & Cooling':  { cls: 'text-amber-300   bg-amber-900/50   border-amber-700'   },
  'Data Centers':     { cls: 'text-yellow-300  bg-yellow-900/50  border-yellow-700'  },
  'Software & Apps':  { cls: 'text-emerald-300 bg-emerald-900/50 border-emerald-700' },
  'Cybersecurity':    { cls: 'text-rose-300    bg-rose-900/50    border-rose-700'    },
  'Quantum Computing':{ cls: 'text-cyan-300    bg-cyan-900/50    border-cyan-700'    },
  'Robotics':         { cls: 'text-lime-300    bg-lime-900/50    border-lime-700'    },
}

const PERIODS = ['1d', '5d', '1m', '3m', 'ytd']
const PERIOD_LABELS = { '1d': '1D', '5d': '5D', '1m': '1M', '3m': '3M', 'ytd': 'YTD' }

function SectionLabel({ children }) {
  return <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">{children}</div>
}

function Pct({ v }) {
  if (v == null) return <span className="text-gray-700 text-xs">—</span>
  const cls = v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400'
  return <span className={`text-xs font-medium ${cls}`}>{v > 0 ? '+' : ''}{v.toFixed(2)}%</span>
}

function LayerBadge({ layer }) {
  const meta = LAYER_META[layer] || { cls: 'text-gray-400 bg-gray-800 border-gray-700' }
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${meta.cls}`}>
      {layer}
    </span>
  )
}

function makeQuote(row) {
  if (!row?.price || row['1d'] == null) return { name: row?.name ?? row?.symbol }
  const pct  = row['1d']
  const prev = row.price / (1 + pct / 100)
  return { name: row.name, price: row.price, change: row.price - prev, changePercent: pct }
}

// ── AI Stocks Table ───────────────────────────────────────────────────────────
function AIStocksTable({ stocks, onRowClick }) {
  const layers = [...new Set(stocks.map(s => s.layer))]
  const [activeLayer, setActiveLayer] = useState(null)

  const visible = activeLayer ? stocks.filter(s => s.layer === activeLayer) : stocks

  return (
    <div>
      {/* Layer filter pills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setActiveLayer(null)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            !activeLayer
              ? 'bg-gray-600 border-gray-500 text-white'
              : 'border-gray-700 text-gray-500 hover:text-gray-300'
          }`}
        >
          All ({stocks.length})
        </button>
        {layers.map(l => {
          const meta = LAYER_META[l] || { cls: '' }
          const count = stocks.filter(s => s.layer === l).length
          return (
            <button
              key={l}
              onClick={() => setActiveLayer(activeLayer === l ? null : l)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-opacity ${
                meta.cls
              } ${activeLayer && activeLayer !== l ? 'opacity-30' : 'opacity-100'}`}
            >
              {l} ({count})
            </button>
          )
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left text-gray-600 py-2 pr-3 font-medium tracking-wider uppercase">Symbol</th>
              <th className="text-left text-gray-600 py-2 pr-3 font-medium tracking-wider uppercase">Company</th>
              <th className="text-left text-gray-600 py-2 pr-4 font-medium tracking-wider uppercase">Layer</th>
              <th className="text-right text-gray-600 py-2 px-3 font-medium tracking-wider uppercase">Price</th>
              {PERIODS.map(p => (
                <th key={p} className="text-right text-gray-600 py-2 px-3 font-medium tracking-wider uppercase">
                  {PERIOD_LABELS[p]}
                </th>
              ))}
              <th className="text-left text-gray-600 py-2 pl-4 font-medium tracking-wider uppercase">Thesis</th>
              <th className="py-2 pl-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr
                key={`${row.symbol}-${row.layer}`}
                onClick={() => onRowClick(row)}
                className="border-b border-gray-800/40 hover:bg-gray-800/50 cursor-pointer transition-colors"
              >
                <td className="py-2.5 pr-3 font-bold text-white">{row.symbol}</td>
                <td className="py-2.5 pr-3 text-gray-400 whitespace-nowrap">{row.name}</td>
                <td className="py-2.5 pr-4"><LayerBadge layer={row.layer} /></td>
                <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{fmt.price(row.price)}</td>
                {PERIODS.map(p => (
                  <td key={p} className="py-2.5 px-3 text-right tabular-nums"><Pct v={row[p]} /></td>
                ))}
                <td className="py-2.5 pl-4 text-gray-500 max-w-xs">{row.thesis}</td>
                <td className="py-2.5 pl-2 text-gray-700">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Analyst rows ──────────────────────────────────────────────────────────────
function AnalystRow({ action }) {
  const meta = ACTION_META[action.action] || ACTION_META.main
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded bg-gray-800/50 border border-gray-700/30 hover:bg-gray-800 transition-colors">
      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${meta.cls}`}>{meta.label}</span>
      <span className="text-white text-xs font-bold">{action.symbol}</span>
      {action.fromGrade && action.toGrade && action.fromGrade !== action.toGrade
        ? <span className="text-gray-500 text-xs">{action.fromGrade} → <span className="text-gray-300">{action.toGrade}</span></span>
        : action.toGrade && <span className="text-gray-300 text-xs">{action.toGrade}</span>
      }
      {action.priceTarget && <span className="text-gray-500 text-xs">PT {fmt.price(action.priceTarget)}</span>}
      <span className="text-gray-600 text-xs ml-auto">{action.firm}</span>
      <span className="text-gray-700 text-xs">{action.date}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MarketRecommendations() {
  const [summary, setSummary]     = useState(null)
  const [aiStocks, setAiStocks]   = useState(null)
  const [sumLoading, setSumLoading] = useState(true)
  const [aiLoading, setAiLoading]  = useState(true)
  const [error, setError]         = useState(null)
  const [lastFetch, setLastFetch] = useState(null)
  const [chartRow, setChartRow]   = useState(null)

  const fetchAll = useCallback(async () => {
    setSumLoading(true); setAiLoading(true); setError(null)
    try {
      const [rSum, rAI] = await Promise.all([
        fetch('/api/market/summary'),
        fetch('/api/ai-stocks'),
      ])
      if (!rSum.ok) throw new Error(`Summary error ${rSum.status}`)
      if (!rAI.ok)  throw new Error(`AI stocks error ${rAI.status}`)
      const [sumData, aiData] = await Promise.all([rSum.json(), rAI.json()])
      setSummary(sumData)
      setAiStocks(aiData)
      setLastFetch(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setSumLoading(false); setAiLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const loading = sumLoading || aiLoading

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Market Recommendations</div>
        <div className="flex items-center gap-3">
          {lastFetch && !loading && (
            <span className="text-gray-600 text-xs">Updated {lastFetch.toLocaleTimeString()} · cached 15 min</span>
          )}
          <button onClick={fetchAll} disabled={loading}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-400 hover:text-white px-3 py-1 text-xs rounded transition-colors">
            {loading ? <span className="animate-pulse">↻ Loading…</span> : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded px-4 py-3 mb-4">⚠ {error}</div>
      )}

      {loading && !aiStocks && !summary && (
        <div className="text-gray-500 text-sm text-center py-20 animate-pulse">Loading recommendations…</div>
      )}

      <div className="space-y-10">
        {/* ── AI Growth Watch List ── */}
        {aiStocks?.length > 0 && (
          <section>
            <SectionLabel>AI Growth Watch List — Full Stack Coverage</SectionLabel>
            <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3">
              <AIStocksTable stocks={aiStocks} onRowClick={setChartRow} />
            </div>
          </section>
        )}

        {/* ── Analyst Upgrades / Downgrades ── */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {summary.analystUpgrades?.length > 0 && (
              <section>
                <SectionLabel>Analyst Upgrades &amp; Initiations</SectionLabel>
                <div className="space-y-1.5">
                  {summary.analystUpgrades.map((a, i) => <AnalystRow key={i} action={a} />)}
                </div>
              </section>
            )}
            {summary.analystDowngrades?.length > 0 && (
              <section>
                <SectionLabel>Analyst Downgrades</SectionLabel>
                <div className="space-y-1.5">
                  {summary.analystDowngrades.map((a, i) => <AnalystRow key={i} action={a} />)}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

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
