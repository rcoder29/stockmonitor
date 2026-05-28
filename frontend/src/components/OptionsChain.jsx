import { useEffect, useState } from 'react'
import { fmt } from '../utils/format'

const OPT_COLS = [
  { label: 'Strike',  key: 'strike',          align: 'text-right' },
  { label: 'Bid',     key: 'bid',             align: 'text-right' },
  { label: 'Ask',     key: 'ask',             align: 'text-right' },
  { label: 'Last',    key: 'lastPrice',       align: 'text-right' },
  { label: 'Volume',  key: 'volume',          align: 'text-right' },
  { label: 'OI',      key: 'openInterest',    align: 'text-right' },
  { label: 'IV %',    key: 'impliedVolatility', align: 'text-right' },
]

function fmtVol(v) {
  if (v == null) return '—'
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return v.toLocaleString()
}

function OptionsTable({ rows, side }) {
  const [sort, setSort] = useState('strike')
  const [dir,  setDir]  = useState('asc')

  function handleSort(key) {
    if (sort === key) setDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSort(key); setDir('asc') }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort] ?? -Infinity
    const bv = b[sort] ?? -Infinity
    return dir === 'asc' ? av - bv : bv - av
  })

  const isCall = side === 'call'
  const headerCls = isCall ? 'text-emerald-400' : 'text-red-400'

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800 flex-1 min-w-0">
      <div className={`px-4 py-2 border-b border-gray-800 text-xs font-semibold uppercase tracking-wider ${headerCls}`}>
        {isCall ? 'Calls' : 'Puts'}
        <span className="ml-2 text-gray-600 font-normal normal-case">{rows.length} contracts</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/50">
            {OPT_COLS.map(c => (
              <th
                key={c.key}
                onClick={() => handleSort(c.key)}
                className={`py-2 px-3 text-gray-500 font-medium tracking-wider uppercase cursor-pointer select-none hover:text-gray-300 ${c.align}`}
              >
                {c.label}
                <span className={`ml-1 text-xs ${sort === c.key ? 'text-emerald-400' : 'text-gray-700'}`}>
                  {sort === c.key ? (dir === 'asc' ? '↑' : '↓') : '⇅'}
                </span>
              </th>
            ))}
            <th className="py-2 px-3 text-gray-500 font-medium tracking-wider uppercase text-center">Flag</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr
              key={i}
              className={`border-b border-gray-800/30 transition-colors
                ${r.inTheMoney
                  ? isCall ? 'bg-emerald-950/25 hover:bg-emerald-950/40' : 'bg-red-950/25 hover:bg-red-950/40'
                  : 'hover:bg-gray-800/40'}`}
            >
              <td className={`py-2 px-3 text-right font-semibold tabular-nums ${r.inTheMoney ? (isCall ? 'text-emerald-300' : 'text-red-300') : 'text-white'}`}>
                ${r.strike.toFixed(2)}
              </td>
              <td className="py-2 px-3 text-right text-gray-400 tabular-nums">{fmt.price(r.bid)}</td>
              <td className="py-2 px-3 text-right text-gray-400 tabular-nums">{fmt.price(r.ask)}</td>
              <td className="py-2 px-3 text-right text-gray-300 tabular-nums">{fmt.price(r.lastPrice)}</td>
              <td className={`py-2 px-3 text-right tabular-nums ${r.volume > 0 ? 'text-sky-400' : 'text-gray-600'}`}>
                {fmtVol(r.volume)}
              </td>
              <td className="py-2 px-3 text-right text-gray-400 tabular-nums">{fmtVol(r.openInterest)}</td>
              <td className={`py-2 px-3 text-right tabular-nums ${r.impliedVolatility != null && r.impliedVolatility > 80 ? 'text-amber-400' : 'text-gray-400'}`}>
                {r.impliedVolatility != null ? `${r.impliedVolatility}%` : '—'}
              </td>
              <td className="py-2 px-3 text-center">
                {r.unusual && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-700 text-white">🔥 UOA</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function OptionsChain({ symbol }) {
  const [expirations, setExpirations] = useState([])
  const [expiry,      setExpiry]      = useState(null)
  const [chain,       setChain]       = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/options/${symbol}/expirations`)
      .then(r => r.json())
      .then(d => {
        const exps = d.expirations || []
        setExpirations(exps)
        if (exps.length) setExpiry(exps[0])
        else setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [symbol])

  useEffect(() => {
    if (!expiry) return
    setLoading(true); setError(null)
    fetch(`/api/options/${symbol}?expiry=${expiry}`)
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json() })
      .then(d => setChain(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol, expiry])

  if (loading) return <div className="py-16 text-center text-gray-500 text-sm animate-pulse">Loading options data…</div>
  if (error)   return <div className="py-16 text-center text-red-400 text-sm">Failed to load options: {error}</div>
  if (!chain || (!chain.calls?.length && !chain.puts?.length)) {
    return <div className="py-16 text-center text-gray-600 text-sm">No options data available for {symbol}</div>
  }

  const pcRatio = chain.putCallRatio
  const unusual = [...(chain.calls || []), ...(chain.puts || [])].filter(r => r.unusual)

  return (
    <div className="space-y-4">
      {/* Controls + KPIs */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Expiry selector */}
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">Expiry</span>
          <select
            value={expiry ?? ''}
            onChange={e => setExpiry(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:border-sky-500"
          >
            {expirations.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {/* KPI badges */}
        <div className="flex gap-3 flex-wrap">
          {pcRatio != null && (
            <div className="bg-gray-800/60 rounded px-3 py-1.5">
              <span className="text-gray-500 text-xs mr-1.5">P/C Ratio</span>
              <span className={`font-bold text-sm tabular-nums ${pcRatio > 1.2 ? 'text-red-400' : pcRatio < 0.8 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {pcRatio.toFixed(2)}
              </span>
              <span className="text-gray-600 text-xs ml-1">
                {pcRatio > 1.2 ? '(bearish)' : pcRatio < 0.8 ? '(bullish)' : '(neutral)'}
              </span>
            </div>
          )}
          <div className="bg-gray-800/60 rounded px-3 py-1.5">
            <span className="text-gray-500 text-xs mr-1.5">Call OI</span>
            <span className="text-emerald-400 font-semibold text-sm tabular-nums">{fmtVol(chain.totalCallOI)}</span>
          </div>
          <div className="bg-gray-800/60 rounded px-3 py-1.5">
            <span className="text-gray-500 text-xs mr-1.5">Put OI</span>
            <span className="text-red-400 font-semibold text-sm tabular-nums">{fmtVol(chain.totalPutOI)}</span>
          </div>
          {unusual.length > 0 && (
            <div className="bg-amber-900/40 border border-amber-700/40 rounded px-3 py-1.5">
              <span className="text-amber-400 text-xs font-semibold">🔥 {unusual.length} unusual activity</span>
            </div>
          )}
        </div>
      </div>

      {/* Tables side-by-side */}
      <div className="flex gap-4 items-start">
        <OptionsTable rows={chain.calls ?? []} side="call" />
        <OptionsTable rows={chain.puts ?? []}  side="put" />
      </div>

      <div className="text-gray-700 text-xs pt-1">
        ITM = in the money · UOA = unusual options activity (vol ≥ 500 and &gt; 2× open interest) · Data delayed ~15 min
      </div>
    </div>
  )
}
