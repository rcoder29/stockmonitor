import { useEffect, useState } from 'react'

function fmtVal(v) {
  if (v == null) return '—'
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toLocaleString()}`
}

function txColor(tx) {
  const t = (tx ?? '').toLowerCase()
  if (t.includes('sale') || t.includes('sell') || t.includes('disposed')) return 'text-red-400 bg-red-900/40'
  if (t.includes('purchase') || t.includes('buy') || t.includes('acquired')) return 'text-emerald-400 bg-emerald-900/40'
  return 'text-gray-400 bg-gray-800/60'
}

export default function InsiderPanel({ symbol }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/insider/${symbol}`)
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return <div className="py-16 text-center text-gray-500 text-sm animate-pulse">Loading insider transactions…</div>
  if (error)   return <div className="py-16 text-center text-red-400 text-sm">Failed to load: {error}</div>
  if (!data?.transactions?.length) return (
    <div className="py-16 text-center text-gray-600 text-sm">No recent insider transactions found for {symbol}</div>
  )

  const buys  = data.transactions.filter(t => (t.transaction ?? '').toLowerCase().includes('purchase') || (t.transaction ?? '').toLowerCase().includes('acqui'))
  const sells = data.transactions.filter(t => (t.transaction ?? '').toLowerCase().includes('sale') || (t.transaction ?? '').toLowerCase().includes('sell') || (t.transaction ?? '').toLowerCase().includes('dispos'))
  const buyVal  = buys.reduce((s, t) => s + (t.value ?? 0), 0)
  const sellVal = sells.reduce((s, t) => s + (t.value ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="flex flex-wrap gap-3">
        <div className="bg-gray-800/60 rounded-lg px-4 py-2.5 min-w-[110px]">
          <div className="text-gray-500 text-xs mb-0.5">Insider Buys</div>
          <div className="text-emerald-400 font-bold text-sm">{buys.length} <span className="text-gray-500 font-normal text-xs">trades</span></div>
          <div className="text-emerald-400/70 text-xs tabular-nums">{fmtVal(buyVal)}</div>
        </div>
        <div className="bg-gray-800/60 rounded-lg px-4 py-2.5 min-w-[110px]">
          <div className="text-gray-500 text-xs mb-0.5">Insider Sales</div>
          <div className="text-red-400 font-bold text-sm">{sells.length} <span className="text-gray-500 font-normal text-xs">trades</span></div>
          <div className="text-red-400/70 text-xs tabular-nums">{fmtVal(sellVal)}</div>
        </div>
        <div className="bg-gray-800/60 rounded-lg px-4 py-2.5 min-w-[110px]">
          <div className="text-gray-500 text-xs mb-0.5">Total Filings</div>
          <div className="text-white font-bold text-sm">{data.transactions.length}</div>
        </div>
      </div>

      {/* Transactions table */}
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              {['Date', 'Insider', 'Position', 'Transaction', 'Shares', 'Value'].map((h, i) => (
                <th key={h} className={`py-2.5 px-3 text-gray-500 font-medium tracking-wider uppercase ${i < 3 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.transactions.map((t, i) => (
              <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                <td className="py-2.5 px-3 text-gray-500 whitespace-nowrap tabular-nums">{t.date ?? '—'}</td>
                <td className="py-2.5 px-3 text-white font-medium max-w-[140px] truncate" title={t.insider ?? ''}>{t.insider ?? '—'}</td>
                <td className="py-2.5 px-3 text-gray-500 max-w-[120px] truncate" title={t.position ?? ''}>{t.position ?? '—'}</td>
                <td className="py-2.5 px-3 text-right">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${txColor(t.transaction)}`}>
                    {t.transaction ? t.transaction.split(' ').slice(0, 4).join(' ') : '—'}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">
                  {t.shares != null ? t.shares.toLocaleString() : '—'}
                </td>
                <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{fmtVal(t.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-gray-700 text-xs">Source: SEC Form 4 filings via Yahoo Finance · Data may be delayed</div>
    </div>
  )
}
