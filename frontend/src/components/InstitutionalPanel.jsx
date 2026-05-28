import { useEffect, useState } from 'react'

function fmtShares(n) {
  if (n == null) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toLocaleString()
}

function fmtValue(n) {
  if (n == null) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toLocaleString()}`
}

function HolderTable({ title, rows }) {
  if (!rows?.length) return (
    <div className="text-gray-600 text-xs text-center py-4">No data available</div>
  )
  return (
    <div>
      <div className="text-gray-500 text-xs uppercase tracking-widest mb-2">{title}</div>
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              {['Holder', 'Shares', '% Held', 'Value', 'Reported'].map((h, i) => (
                <th key={h} className={`py-2 px-3 text-gray-500 font-medium uppercase tracking-wider ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                <td className="py-2 px-3 text-gray-200 font-medium max-w-[200px] truncate">{r.holder || '—'}</td>
                <td className="py-2 px-3 text-right text-gray-300 tabular-nums">{fmtShares(r.shares)}</td>
                <td className="py-2 px-3 text-right tabular-nums">
                  <span className={`font-medium ${(r.pctHeld ?? 0) >= 5 ? 'text-amber-400' : 'text-gray-300'}`}>
                    {r.pctHeld != null ? `${r.pctHeld.toFixed(2)}%` : '—'}
                  </span>
                </td>
                <td className="py-2 px-3 text-right text-gray-400 tabular-nums">{fmtValue(r.value)}</td>
                <td className="py-2 px-3 text-right text-gray-600">{r.dateReported ? r.dateReported.slice(0, 10) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function InstitutionalPanel({ symbol }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/institutional/${symbol}`)
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return <div className="py-16 text-center text-gray-500 text-sm animate-pulse">Loading ownership data…</div>
  if (error)   return <div className="py-16 text-center text-red-400 text-sm">Failed to load: {error}</div>
  if (!data)   return null

  const { major = {}, institutional = [], mutualFunds = [] } = data

  const kpis = [
    { label: 'Insider Ownership',       value: major.insiderPct != null ? `${(major.insiderPct * 100).toFixed(2)}%` : '—' },
    { label: 'Institutional Ownership', value: major.institutionPct != null ? `${(major.institutionPct * 100).toFixed(2)}%` : '—' },
    { label: 'Inst. of Float',          value: major.institutionFloatPct != null ? `${(major.institutionFloatPct * 100).toFixed(2)}%` : '—' },
  ]

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="flex flex-wrap gap-3">
        {kpis.map(({ label, value }) => (
          <div key={label} className="bg-gray-800/60 rounded-lg px-4 py-3 min-w-[140px]">
            <div className="text-gray-500 text-xs mb-0.5">{label}</div>
            <div className="text-white font-bold text-base tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <HolderTable title="Top Institutional Holders" rows={institutional} />
      <HolderTable title="Top Mutual Fund Holders"   rows={mutualFunds} />

      <div className="text-gray-700 text-xs">Data from Yahoo Finance · Reported quarterly — may lag current positions</div>
    </div>
  )
}
