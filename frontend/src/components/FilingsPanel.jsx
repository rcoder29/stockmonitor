import { useEffect, useState } from 'react'

const FORM_STYLE = {
  '10-K':   { color: 'text-emerald-400', bg: 'bg-emerald-900/30', border: 'border-emerald-700/40' },
  '10-Q':   { color: 'text-sky-400',     bg: 'bg-sky-900/30',     border: 'border-sky-700/40'     },
  '8-K':    { color: 'text-amber-400',   bg: 'bg-amber-900/30',   border: 'border-amber-700/40'   },
  '10-K/A': { color: 'text-emerald-300', bg: 'bg-emerald-900/20', border: 'border-emerald-700/30' },
  '10-Q/A': { color: 'text-sky-300',     bg: 'bg-sky-900/20',     border: 'border-sky-700/30'     },
}

const DEFAULT_STYLE = { color: 'text-gray-400', bg: 'bg-gray-800/40', border: 'border-gray-700/30' }

export default function FilingsPanel({ symbol }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/filings/${symbol}`)
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return (
    <div className="py-16 text-center space-y-2">
      <div className="text-gray-500 text-sm animate-pulse">Loading SEC filings…</div>
      <div className="text-gray-700 text-xs">Fetching from EDGAR</div>
    </div>
  )
  if (error)            return <div className="py-16 text-center text-red-400 text-sm">Failed to load: {error}</div>
  if (!data?.filings?.length) return <div className="py-16 text-center text-gray-600 text-sm">No filings found for {symbol}</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-gray-500 text-xs uppercase tracking-widest">SEC Filings</span>
        {data.company_name && (
          <span className="text-gray-600 text-xs">{data.company_name}</span>
        )}
        <span className="text-gray-700 text-xs ml-auto">{data.filings.length} filings</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <th className="py-2.5 px-4 text-center text-gray-500 font-medium uppercase tracking-wider">Form</th>
              <th className="py-2.5 px-4 text-right text-gray-500 font-medium uppercase tracking-wider">Filed</th>
              <th className="py-2.5 px-4 text-left text-gray-500 font-medium uppercase tracking-wider">Description</th>
              <th className="py-2.5 px-4 text-center text-gray-500 font-medium uppercase tracking-wider">View</th>
            </tr>
          </thead>
          <tbody>
            {data.filings.map((f, i) => {
              const style = FORM_STYLE[f.form] ?? DEFAULT_STYLE
              return (
                <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                  <td className="py-2.5 px-4 text-center">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${style.color} ${style.bg} ${style.border}`}>
                      {f.form}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right text-gray-400 tabular-nums whitespace-nowrap">{f.date}</td>
                  <td className="py-2.5 px-4 text-gray-300 max-w-xs truncate">{f.description || '—'}</td>
                  <td className="py-2.5 px-4 text-center">
                    {f.url ? (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-500 hover:text-sky-300 transition-colors"
                      >
                        View ↗
                      </a>
                    ) : <span className="text-gray-700">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="text-gray-700 text-xs">Source: SEC EDGAR · Cached 12 hours · Not investment advice</div>
    </div>
  )
}
