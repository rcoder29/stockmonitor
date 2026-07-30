import { useState, useEffect } from 'react'

function fmt(n, dec = 2) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function fmtCap(n) {
  if (n == null) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`
  return `$${n.toLocaleString()}`
}

function ChgBadge({ v, suffix = '%' }) {
  if (v == null) return <span className="text-slate-500">—</span>
  const up = v >= 0
  return (
    <span className={`font-semibold tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? '+' : ''}{fmt(v)}{suffix}
    </span>
  )
}

function FearGreedGauge({ value, label }) {
  if (value == null) return null
  const pct = value / 100
  const angle = -135 + pct * 270    // sweep from -135° to +135°
  const r = 38, cx = 56, cy = 56
  const toRad = d => d * Math.PI / 180
  const x = cx + r * Math.cos(toRad(angle))
  const y = cy + r * Math.sin(toRad(angle))

  let color = '#ef4444'
  if (value >= 75) color = '#10b981'
  else if (value >= 55) color = '#84cc16'
  else if (value >= 45) color = '#eab308'
  else if (value >= 25) color = '#f97316'

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 112 70" className="w-28">
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#334155" strokeWidth="8" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={x} y2={y} stroke={color} strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="4" fill={color} />
        <text x={cx} y={cy - 14} textAnchor="middle" fill="white" fontSize="16" fontWeight="bold">{value}</text>
      </svg>
      <p className="text-xs font-bold mt-1" style={{ color }}>{label}</p>
      <p className="text-xs text-slate-500 mt-0.5">Fear & Greed Index</p>
    </div>
  )
}

function DomBar({ label, pct, color }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-400">{label} Dominance</span>
        <span className="font-bold text-white">{pct != null ? `${fmt(pct, 1)}%` : '—'}</span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-2">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(100, pct || 0)}%` }} />
      </div>
    </div>
  )
}

function BigCoinCard({ coin }) {
  if (!coin) return null
  const up = (coin.change24h || 0) >= 0
  const ticker = coin.symbol.replace('-USD', '')
  return (
    <div className={`bg-slate-800 rounded-xl p-5 border ${up ? 'border-emerald-700/30' : 'border-red-700/30'}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-400 font-medium">{coin.name}</p>
          <p className="text-xs text-slate-500">{ticker}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${up ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}>
          {up ? '▲' : '▼'} {Math.abs(coin.change24h || 0).toFixed(2)}%
        </span>
      </div>
      <p className="text-3xl font-bold text-white mt-3">
        ${coin.price >= 1000 ? fmt(coin.price, 0) : coin.price >= 1 ? fmt(coin.price, 2) : fmt(coin.price, 4)}
      </p>
      <div className="flex gap-4 mt-3 text-xs">
        <div>
          <p className="text-slate-500">Mkt Cap</p>
          <p className="text-slate-300 font-medium">{fmtCap(coin.marketCap)}</p>
        </div>
        <div>
          <p className="text-slate-500">Vol 24h</p>
          <p className="text-slate-300 font-medium">{fmtCap(coin.volume24h)}</p>
        </div>
        <div>
          <p className="text-slate-500">7d</p>
          <ChgBadge v={coin.change7d} />
        </div>
      </div>
    </div>
  )
}

export default function CryptoDashboard() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [sortKey, setSortKey] = useState('marketCap')
  const [sortAsc, setSortAsc] = useState(false)

  function load() {
    setLoading(true)
    setError(null)
    fetch('/api/market/crypto')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  function sort(k) {
    if (sortKey === k) setSortAsc(a => !a)
    else { setSortKey(k); setSortAsc(false) }
  }

  const coins = data?.coins || []
  const sorted = [...coins].sort((a, b) => {
    const av = a[sortKey] ?? (sortAsc ? Infinity : -Infinity)
    const bv = b[sortKey] ?? (sortAsc ? Infinity : -Infinity)
    return sortAsc ? av - bv : bv - av
  })

  const btc = coins.find(c => c.symbol === 'BTC-USD')
  const eth = coins.find(c => c.symbol === 'ETH-USD')

  function Th({ label, k, right }) {
    const active = sortKey === k
    return (
      <th onClick={() => sort(k)}
        className={`px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-white select-none whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
        {label} {active ? (sortAsc ? '▲' : '▼') : <span className="text-slate-700">⇅</span>}
      </th>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Crypto Dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Live prices, market caps, and 24h / 7d performance for top 20 cryptocurrencies.
            {data?.asOf && <span className="text-slate-500 ml-2">Updated {data.asOf}</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-xl transition-colors disabled:opacity-50 shrink-0">
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {error && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>}

      {loading && !data && (
        <div className="py-20 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-slate-600 border-t-blue-500 animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Loading crypto data…</p>
        </div>
      )}

      {data && (
        <>
          {/* Top row: BTC, ETH, Market stats, Fear & Greed */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <BigCoinCard coin={btc} />
            <BigCoinCard coin={eth} />

            {/* Market stats */}
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Market Overview</h3>
              <div>
                <p className="text-xs text-slate-400">Total Market Cap</p>
                <p className="text-xl font-bold text-white mt-0.5">{fmtCap(data.totalMarketCap)}</p>
              </div>
              <DomBar label="BTC" pct={data.btcDominance} color="bg-orange-400" />
              <DomBar label="ETH" pct={data.ethDominance} color="bg-blue-400" />
            </div>

            {/* Fear & Greed */}
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 flex flex-col items-center justify-center">
              {data.fearGreed
                ? <FearGreedGauge value={data.fearGreed.value} label={data.fearGreed.label} />
                : <p className="text-xs text-slate-500 text-center">Fear & Greed data unavailable</p>
              }
              <p className="text-xs text-slate-500 mt-3 text-center">
                0 = Extreme Fear · 100 = Extreme Greed
              </p>
            </div>
          </div>

          {/* Full coin table */}
          <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-900/60">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-8">#</th>
                    <Th label="Name"      k="name" />
                    <Th label="Price"     k="price"      right />
                    <Th label="24h"       k="change24h"  right />
                    <Th label="7d"        k="change7d"   right />
                    <Th label="Mkt Cap"   k="marketCap"  right />
                    <Th label="Vol 24h"   k="volume24h"  right />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c, i) => {
                    const ticker = c.symbol.replace('-USD', '')
                    const up24 = (c.change24h || 0) >= 0
                    return (
                      <tr key={c.symbol} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                        <td className="px-3 py-2.5 text-slate-500 text-xs tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-bold text-white">{ticker}</div>
                          <div className="text-xs text-slate-400">{c.name}</div>
                        </td>
                        <td className="px-3 py-2.5 text-white font-semibold tabular-nums text-right">
                          ${c.price >= 1000 ? fmt(c.price, 0)
                            : c.price >= 1 ? fmt(c.price, 2)
                            : fmt(c.price, 4)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-right">
                          <ChgBadge v={c.change24h} />
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-right">
                          <ChgBadge v={c.change7d} />
                        </td>
                        <td className="px-3 py-2.5 text-slate-300 tabular-nums text-right text-xs">{fmtCap(c.marketCap)}</td>
                        <td className="px-3 py-2.5 text-slate-400 tabular-nums text-right text-xs">{fmtCap(c.volume24h)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-slate-600">
            Prices from yfinance (Yahoo Finance). Fear &amp; Greed Index from alternative.me. Refreshed every 5 minutes. For informational purposes only.
          </p>
        </>
      )}
    </div>
  )
}
