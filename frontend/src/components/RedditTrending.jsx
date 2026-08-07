import { useState, useEffect, useMemo } from 'react'
import { fmt$, fmtPct, pctColor } from './MergerDealDashboard'

const API = import.meta.env.VITE_API_URL || ''

const SOURCES = [
  { value: 'all-stocks',     label: 'All Stocks' },
  { value: 'wallstreetbets', label: 'r/wallstreetbets' },
  { value: 'stocks',         label: 'r/stocks' },
  { value: 'options',        label: 'r/options' },
]

function momentumCls(v) {
  if (v == null) return 'text-slate-500'
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-slate-400'
}

function QuickList({ title, rows, valueKey, valueFmt }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-slate-300 mb-3">{title}</h3>
      {rows.length === 0 ? <div className="text-xs text-slate-500">—</div> : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.ticker} className="flex items-center justify-between">
              <span className="text-sm text-sky-400 font-medium">{r.ticker}</span>
              <span className={`text-sm font-bold ${momentumCls(r[valueKey])}`}>{valueFmt(r[valueKey])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RedditTrending() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(false)
  const [source, setSource]   = useState('all-stocks')
  const [search, setSearch]   = useState('')
  const [sortCol, setSortCol] = useState('rank')
  const [sortDir, setSortDir] = useState('asc')

  const load = async (src) => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/reddit/trending?source=${src}&limit=75`)
      setRows(await res.json())
    } catch { setRows([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { load(source) }, [source])

  const filtered = useMemo(() => {
    let r = rows
    if (search.trim()) {
      const q = search.trim().toUpperCase()
      r = r.filter(x => (x.ticker || '').includes(q) || (x.name || '').toUpperCase().includes(q))
    }
    return [...r].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return sortDir === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1)
    })
  }, [rows, search, sortCol, sortDir])

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir(col === 'rank' ? 'asc' : 'desc') }
  }

  const SortHdr = ({ col, label, right }) => (
    <th onClick={() => toggleSort(col)}
      className={`px-3 py-2 cursor-pointer select-none hover:text-white ${right ? 'text-right' : 'text-left'}`}>
      {label}{sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : <span className="text-slate-700"> ↕</span>}
    </th>
  )

  const rising  = [...rows].filter(r => r.rankChange != null && r.rankChange > 0).sort((a, b) => b.rankChange - a.rankChange).slice(0, 5)
  const cooling = [...rows].filter(r => r.rankChange != null && r.rankChange < 0).sort((a, b) => a.rankChange - b.rankChange).slice(0, 5)

  return (
    <div className="p-4 text-white max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Reddit Trending Stocks</h1>
          <p className="text-sm text-slate-400">Most-mentioned tickers across finance subreddits, via ApeWisdom. This tracks attention volume and momentum — not bullish/bearish sentiment.</p>
        </div>
        <button onClick={() => load(source)} disabled={loading}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {SOURCES.map(s => (
          <button key={s.value} onClick={() => setSource(s.value)}
            className={`px-2 py-1 rounded text-xs ${source === s.value ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            {s.label}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ticker or name…"
          className="ml-2 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-500 w-48" />
        <span className="ml-auto text-xs text-slate-500">{filtered.length} tickers</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <QuickList title="Rising Attention (24h)" rows={rising} valueKey="rankChange" valueFmt={v => `+${v}`} />
        <QuickList title="Cooling Attention (24h)" rows={cooling} valueKey="rankChange" valueFmt={v => `${v}`} />
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-700">
              <SortHdr col="rank" label="Rank" />
              <th className="text-left px-3 py-2">Ticker</th>
              <SortHdr col="mentions" label="Mentions" right />
              <SortHdr col="mentionsChangePct" label="Mentions Δ" right />
              <SortHdr col="rankChange" label="Rank Δ" right />
              <SortHdr col="upvotes" label="Upvotes" right />
              <SortHdr col="currentPrice" label="Price" right />
              <SortHdr col="priceChange5d" label="5D" right />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-500">Loading trending tickers…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-500 text-sm">No matching tickers</td></tr>
            ) : filtered.map(r => (
              <tr key={r.ticker} className="border-b border-slate-700/50 hover:bg-slate-750">
                <td className="px-3 py-3 text-slate-400 text-xs">#{r.rank}</td>
                <td className="px-3 py-3">
                  <div className="font-bold text-sky-400 text-sm">{r.ticker}</div>
                  <div className="text-xs text-slate-500 truncate max-w-[200px]">{r.name}</div>
                </td>
                <td className="px-3 py-3 text-right text-sm text-white">{r.mentions}</td>
                <td className={`px-3 py-3 text-right text-xs ${momentumCls(r.mentionsChangePct)}`}>
                  {r.mentionsChangePct != null ? `${r.mentionsChangePct > 0 ? '+' : ''}${r.mentionsChangePct.toFixed(0)}%` : '—'}
                </td>
                <td className={`px-3 py-3 text-right text-xs font-semibold ${momentumCls(r.rankChange)}`}>
                  {r.rankChange != null ? (r.rankChange > 0 ? `+${r.rankChange}` : r.rankChange) : '—'}
                </td>
                <td className="px-3 py-3 text-right text-xs text-slate-400">{r.upvotes ?? '—'}</td>
                <td className="px-3 py-3 text-right text-sm text-slate-300">{r.currentPrice ? fmt$(r.currentPrice) : '—'}</td>
                <td className={`px-3 py-3 text-right text-xs ${pctColor(r.priceChange5d)}`}>{fmtPct(r.priceChange5d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-600 mt-3">Data from ApeWisdom (free, unauthenticated aggregation of Reddit finance subreddits). Mentions and rank are measured over a rolling window and compared to 24 hours ago. High mention volume reflects attention, not direction — a ticker can spike for good news, bad news, or an ongoing meme, so treat "Rising Attention" as "worth checking why," not a buy signal.</p>
    </div>
  )
}
