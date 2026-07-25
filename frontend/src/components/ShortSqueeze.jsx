import { useState, useEffect } from 'react'

const LEVEL_STYLE = {
  EXTREME: 'bg-red-500/20 text-red-300 border-red-500/40',
  HIGH:    'bg-orange-500/20 text-orange-300 border-orange-500/40',
  MEDIUM:  'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  LOW:     'bg-slate-600/40 text-slate-300 border-slate-500/40',
}

const LEVEL_BAR = {
  EXTREME: 'bg-red-500',
  HIGH:    'bg-orange-500',
  MEDIUM:  'bg-yellow-500',
  LOW:     'bg-slate-500',
}

function fmt(v, decimals = 1, suffix = '') {
  if (v == null) return '—'
  return `${Number(v).toFixed(decimals)}${suffix}`
}

function fmtCap(v) {
  if (!v) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toLocaleString()}`
}

export default function ShortSqueeze() {
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [sortKey, setSortKey] = useState('squeezeScore')
  const [sortAsc, setSortAsc] = useState(false)
  const [filter, setFilter]   = useState('ALL')
  const [extra, setExtra]     = useState('')
  const [extraInput, setExtraInput] = useState('')

  async function load(extraSyms = '') {
    setLoading(true)
    setError(null)
    try {
      const q = extraSyms ? `?extra=${encodeURIComponent(extraSyms)}` : ''
      const res = await fetch(`/api/market/short-squeeze${q}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function addExtra() {
    const syms = extraInput.trim().toUpperCase()
    if (!syms) return
    setExtra(syms)
    setExtraInput('')
    load(syms)
  }

  function sort(key) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const filtered = data.filter(r => filter === 'ALL' || r.squeezeLevel === filter)
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity
    const bv = b[sortKey] ?? -Infinity
    return sortAsc ? av - bv : bv - av
  })

  const counts = { ALL: data.length, EXTREME: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  data.forEach(r => counts[r.squeezeLevel]++)

  function ColHeader({ label, k }) {
    const active = sortKey === k
    return (
      <th
        onClick={() => sort(k)}
        className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-white select-none whitespace-nowrap"
      >
        {label}{active ? (sortAsc ? ' ▲' : ' ▼') : ''}
      </th>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Short Squeeze Scanner</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Ranks high-short-interest stocks by squeeze potential. Score weights: short % float (40%), days to cover (30%), momentum (20%), SI change (10%).
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={extraInput}
            onChange={e => setExtraInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && addExtra()}
            placeholder="Add symbols (e.g. AAPL,TSLA)"
            className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-52"
          />
          <button onClick={addExtra} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white text-sm rounded-lg">+ Add</button>
          <button onClick={() => load(extra)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">Refresh</button>
        </div>
      </div>

      {/* Level filters */}
      <div className="flex gap-2 flex-wrap">
        {['ALL','EXTREME','HIGH','MEDIUM','LOW'].map(lvl => (
          <button
            key={lvl}
            onClick={() => setFilter(lvl)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              filter === lvl
                ? lvl === 'ALL' ? 'bg-white text-slate-900 border-white' : `${LEVEL_STYLE[lvl]} border`
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
            }`}
          >
            {lvl} ({counts[lvl] ?? 0})
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500 self-center">
          Data cached 30 min · Short interest typically reported bi-monthly
        </span>
      </div>

      {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300 text-sm">{error}</div>}
      {loading && <div className="text-center py-20 text-slate-500">Scanning {data.length > 0 ? '…' : 'universe — this takes ~30 seconds on first load…'}</div>}

      {!loading && (
        <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/60">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-8">#</th>
                  <ColHeader label="Symbol / Name" k="symbol" />
                  <ColHeader label="Score" k="squeezeScore" />
                  <ColHeader label="Level" k="squeezeLevel" />
                  <ColHeader label="Price" k="price" />
                  <ColHeader label="Today %" k="changePercent" />
                  <ColHeader label="Short % Float" k="shortPctFloat" />
                  <ColHeader label="Days to Cover" k="daysToCover" />
                  <ColHeader label="SI Change (MoM)" k="siChangePct" />
                  <ColHeader label="52W Change" k="w52Change" />
                  <ColHeader label="Mkt Cap" k="marketCap" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => (
                  <tr key={row.symbol} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                    <td className="px-3 py-2 text-xs text-slate-500">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="font-bold text-white">{row.symbol}</div>
                      <div className="text-xs text-slate-400 truncate max-w-[140px]">{row.name}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-20 bg-slate-700 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${LEVEL_BAR[row.squeezeLevel]}`}
                            style={{ width: `${row.squeezeScore}%` }}
                          />
                        </div>
                        <span className="text-white font-semibold tabular-nums">{row.squeezeScore}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${LEVEL_STYLE[row.squeezeLevel]}`}>
                        {row.squeezeLevel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-white tabular-nums">{fmt(row.price, 2, '')}</td>
                    <td className={`px-3 py-2 tabular-nums font-medium ${(row.changePercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {row.changePercent != null ? `${row.changePercent >= 0 ? '+' : ''}${fmt(row.changePercent)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-orange-300 font-semibold tabular-nums">
                      {fmt(row.shortPctFloat, 1, '%')}
                    </td>
                    <td className="px-3 py-2 text-yellow-300 tabular-nums">{fmt(row.daysToCover, 1, 'd')}</td>
                    <td className={`px-3 py-2 tabular-nums ${(row.siChangePct ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {row.siChangePct != null ? `${row.siChangePct > 0 ? '+' : ''}${fmt(row.siChangePct)}%` : '—'}
                    </td>
                    <td className={`px-3 py-2 tabular-nums ${(row.w52Change ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {`${(row.w52Change ?? 0) >= 0 ? '+' : ''}${fmt(row.w52Change)}%`}
                    </td>
                    <td className="px-3 py-2 text-slate-400 tabular-nums">{fmtCap(row.marketCap)}</td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-10 text-center text-slate-500">No stocks match this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-600">
        Short interest data is reported bi-monthly by FINRA. Days to cover = shares short ÷ avg daily volume.
        This tool is for informational purposes only — short squeezes are highly unpredictable and carry extreme risk.
      </p>
    </div>
  )
}
