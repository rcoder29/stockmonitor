import { useState, useEffect, useMemo } from 'react'
import { fmt$, fmtPct, pctColor } from './MergerDealDashboard'

const API = import.meta.env.VITE_API_URL || ''

const CATEGORY_FILTERS = [
  { value: 'All',                            label: 'All' },
  { value: 'Activist (13D)',                 label: '13D — Activist' },
  { value: 'Institutional/Passive (13G)',    label: '13G — Passive' },
]

function categoryCls(cat) {
  return cat === 'Activist (13D)' ? 'bg-red-900 text-red-300' : 'bg-slate-700 text-slate-300'
}

function formCls(form) {
  if (form.startsWith('SCHEDULE 13D')) return 'bg-red-900/60 text-red-300'
  return 'bg-slate-700 text-slate-300'
}

export default function ActivistTracker() {
  const [rows, setRows]           = useState([])
  const [loading, setLoading]     = useState(false)
  const [category, setCategory]   = useState('Activist (13D)')
  const [newOnly, setNewOnly]     = useState(false)
  const [search, setSearch]       = useState('')

  const scan = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/activist/tracker`)
      setRows(await res.json())
    } catch { setRows([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { scan() }, [])

  const filtered = useMemo(() => {
    let r = rows
    if (category !== 'All') r = r.filter(x => x.category === category)
    if (newOnly) r = r.filter(x => !x.isAmendment)
    if (search.trim()) {
      const q = search.trim().toUpperCase()
      r = r.filter(x =>
        (x.ticker || '').includes(q) ||
        (x.companyName || '').toUpperCase().includes(q) ||
        (x.filerName || '').toUpperCase().includes(q)
      )
    }
    return r
  }, [rows, category, newOnly, search])

  const activistCount   = rows.filter(r => r.category === 'Activist (13D)').length
  const newActivistCount = rows.filter(r => r.category === 'Activist (13D)' && !r.isAmendment).length
  const passiveCount    = rows.filter(r => r.category !== 'Activist (13D)').length

  return (
    <div className="p-4 text-white max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Activist Tracker — 13D / 13G</h1>
          <p className="text-sm text-slate-400">New 5%+ beneficial ownership stakes from EDGAR. 13D signals active/control intent — far rarer and higher-signal than routine 13G index-fund filings.</p>
        </div>
        <button onClick={scan} disabled={loading}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg disabled:opacity-50">
          {loading ? 'Scanning…' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        {[
          { label: '13D Filings (30d)',     value: activistCount, cls: 'text-red-400' },
          { label: 'New 13D (not amended)', value: newActivistCount, cls: 'text-emerald-400' },
          { label: '13G Filings (recent)',  value: passiveCount, cls: 'text-slate-300' },
        ].map(c => (
          <div key={c.label} className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold ${c.cls}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        {CATEGORY_FILTERS.map(f => (
          <button key={f.value} onClick={() => setCategory(f.value)}
            className={`px-2 py-1 rounded text-xs ${category === f.value ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            {f.label}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ticker, company, or filer…"
          className="ml-2 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-500 w-56" />
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={newOnly} onChange={e => setNewOnly(e.target.checked)} />
          New filings only (hide amendments)
        </label>
        <span className="text-xs text-slate-500">{filtered.length} filings</span>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-700">
              <th className="text-left px-3 py-2">Filed</th>
              <th className="text-left px-3 py-2">Form</th>
              <th className="text-left px-3 py-2">Company</th>
              <th className="text-left px-3 py-2">Reporting Person</th>
              <th className="text-right px-3 py-2">Price</th>
              <th className="text-right px-3 py-2">5D</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-500">Scanning EDGAR for 13D/13G filings…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-500 text-sm">No matching filings found</td></tr>
            ) : filtered.map(r => (
              <tr key={r.accession} className="border-b border-slate-700/50 hover:bg-slate-750">
                <td className="px-3 py-3 text-xs text-slate-400">{r.fileDate}</td>
                <td className="px-3 py-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${formCls(r.formType)}`}>{r.formType}</span>
                </td>
                <td className="px-3 py-3">
                  <div className="font-bold text-sky-400 text-sm">{r.ticker || '—'}</div>
                  <div className="text-xs text-slate-500 truncate max-w-[200px]">{r.companyName}</div>
                </td>
                <td className="px-3 py-3 text-xs text-slate-300 truncate max-w-[200px]">{r.filerName || '—'}</td>
                <td className="px-3 py-3 text-right text-sm text-slate-300">{r.currentPrice ? fmt$(r.currentPrice) : '—'}</td>
                <td className={`px-3 py-3 text-right text-xs ${pctColor(r.priceChange5d)}`}>{fmtPct(r.priceChange5d)}</td>
                <td className="px-3 py-3">
                  <a href={r.edgarUrl} target="_blank" rel="noopener noreferrer"
                    className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs">
                    EDGAR
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-600 mt-3">13D signals possible activist/control intent (board seats, strategic alternatives, etc.); 13G is filed by passive holders (index funds, insurers) crossing 5% with no intent to influence control — high volume, lower signal. Amendments (13D/A, 13G/A) reflect changes to an existing position, not necessarily a new stake.</p>
    </div>
  )
}
