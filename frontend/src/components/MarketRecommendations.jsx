import { useState, useCallback, useEffect } from 'react'
import { fmt } from '../utils/format'

const ACTION_META = {
  up:   { label: 'UPGRADE',    cls: 'text-emerald-400 bg-emerald-900/40 border-emerald-800' },
  down: { label: 'DOWNGRADE',  cls: 'text-red-400    bg-red-900/40    border-red-800'     },
  init: { label: 'INITIATED',  cls: 'text-sky-400    bg-sky-900/40    border-sky-800'     },
  reit: { label: 'REITERATED', cls: 'text-gray-400   bg-gray-800/60  border-gray-700'     },
  main: { label: 'MAINTAINED', cls: 'text-gray-400   bg-gray-800/60  border-gray-700'     },
}

function SectionLabel({ children }) {
  return <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">{children}</div>
}

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

export default function MarketRecommendations() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [lastFetch, setLastFetch] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/market/summary')
      if (!r.ok) throw new Error(`Server error ${r.status}`)
      setData(await r.json())
      setLastFetch(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Market Recommendations</div>
        <div className="flex items-center gap-3">
          {lastFetch && !loading && (
            <span className="text-gray-600 text-xs">Updated {lastFetch.toLocaleTimeString()} · cached 15 min</span>
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
          Loading recommendations…
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.analystUpgrades?.length > 0 && (
            <section>
              <SectionLabel>Analyst Upgrades &amp; Initiations</SectionLabel>
              <div className="space-y-1.5">
                {data.analystUpgrades.map((a, i) => <AnalystRow key={i} action={a} />)}
              </div>
            </section>
          )}
          {data.analystDowngrades?.length > 0 && (
            <section>
              <SectionLabel>Analyst Downgrades</SectionLabel>
              <div className="space-y-1.5">
                {data.analystDowngrades.map((a, i) => <AnalystRow key={i} action={a} />)}
              </div>
            </section>
          )}
          {!loading && !data.analystUpgrades?.length && !data.analystDowngrades?.length && (
            <div className="col-span-2 text-gray-500 text-sm text-center py-12">
              No analyst actions found in the last 14 days
            </div>
          )}
        </div>
      )}
    </div>
  )
}
