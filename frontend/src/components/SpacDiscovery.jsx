import { useState, useEffect, useMemo } from 'react'
import { fmt$ } from './MergerDealDashboard'
import { SpacFormModal, BLANK_FORM } from './SpacTracker'

const API = import.meta.env.VITE_API_URL || ''

const CATEGORY_FILTERS = [
  { value: 'All',                       label: 'All' },
  { value: 'New SPAC IPO',              label: 'New SPAC IPOs' },
  { value: 'De-SPAC Announcement',      label: 'De-SPAC Announcements' },
  { value: 'De-SPAC Merger Proxy',      label: 'De-SPAC Merger Proxies' },
  { value: 'De-SPAC Registration',      label: 'De-SPAC Registrations' },
]

function categoryCls(cat) {
  if (cat === 'New SPAC IPO') return 'bg-emerald-900 text-emerald-300'
  if (cat === 'De-SPAC Announcement') return 'bg-sky-900 text-sky-300'
  return 'bg-purple-900 text-purple-300'
}

export default function SpacDiscovery() {
  const [rows, setRows]           = useState([])
  const [loading, setLoading]     = useState(false)
  const [category, setCategory]   = useState('All')
  const [hideTracked, setHideTracked] = useState(false)
  const [search, setSearch]       = useState('')
  const [modal, setModal]         = useState(null)
  const [added, setAdded]         = useState(new Set())

  const scan = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/spac/discovery`)
      setRows(await res.json())
    } catch { setRows([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { scan() }, [])

  const filtered = useMemo(() => {
    let r = rows
    if (category !== 'All') r = r.filter(x => x.category === category)
    if (hideTracked) r = r.filter(x => !x.tracked)
    if (search.trim()) {
      const q = search.trim().toUpperCase()
      r = r.filter(x => (x.ticker || '').includes(q) || (x.companyName || '').toUpperCase().includes(q))
    }
    return r
  }, [rows, category, hideTracked, search])

  const untrackedCount = rows.filter(r => !r.tracked).length
  const newIpoCount = rows.filter(r => r.category === 'New SPAC IPO').length
  const deSpacCount = rows.filter(r => r.category !== 'New SPAC IPO').length

  const handleQuickAdd = (row) => {
    setModal({
      ...BLANK_FORM,
      ticker:             row.ticker || '',
      company_name:       row.companyName,
      warrant_ticker:     row.warrantTicker || '',
      deal_announce_date: row.category !== 'New SPAC IPO' ? row.fileDate : '',
      ipo_date:           row.category === 'New SPAC IPO' ? row.fileDate : '',
      status:             row.category === 'New SPAC IPO' ? 'searching' : 'deal_announced',
    })
  }

  const handleSave = async (body) => {
    const res = await fetch(`${API}/api/spac/deals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    setAdded(s => new Set(s).add(body.ticker))
  }

  return (
    <div className="p-4 text-white max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">SPACs — Discovery</h1>
          <p className="text-sm text-slate-400">New SPAC IPO filings and de-SPAC merger announcements from EDGAR — add promising ones to the Tracker</p>
        </div>
        <button onClick={scan} disabled={loading}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg disabled:opacity-50">
          {loading ? 'Scanning…' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Filings (60d)',       value: rows.length, cls: 'text-white' },
          { label: 'New SPAC IPOs',       value: newIpoCount, cls: 'text-emerald-400' },
          { label: 'De-SPAC Filings',     value: deSpacCount, cls: 'text-sky-400' },
          { label: 'Untracked',           value: untrackedCount, cls: 'text-yellow-400' },
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
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ticker or company…"
          className="ml-2 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-500 w-48" />
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={hideTracked} onChange={e => setHideTracked(e.target.checked)} />
          Hide already tracked
        </label>
        <span className="text-xs text-slate-500">{filtered.length} filings</span>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-700">
              <th className="text-left px-3 py-2">Filed</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Company</th>
              <th className="text-left px-3 py-2">Warrant</th>
              <th className="text-right px-3 py-2">Price</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-500">Scanning EDGAR for SPAC filings…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-500 text-sm">No matching filings in the last 60 days</td></tr>
            ) : filtered.map(r => (
              <tr key={r.accession} className="border-b border-slate-700/50 hover:bg-slate-750 group">
                <td className="px-3 py-3 text-xs text-slate-400">{r.fileDate}</td>
                <td className="px-3 py-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${categoryCls(r.category)}`} title={r.formType}>
                    {r.category}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <div className="font-bold text-sky-400 text-sm">{r.ticker || '—'}</div>
                  <div className="text-xs text-slate-500 truncate max-w-[220px]">{r.companyName}</div>
                </td>
                <td className="px-3 py-3 text-xs text-slate-400">{r.warrantTicker || '—'}</td>
                <td className="px-3 py-3 text-right text-sm text-slate-300">{r.currentPrice ? fmt$(r.currentPrice) : '—'}</td>
                <td className="px-3 py-3">
                  <div className="flex gap-2 justify-end items-center">
                    {r.tracked || added.has(r.ticker) ? (
                      <span className="px-2 py-0.5 bg-slate-700 text-slate-400 rounded text-xs">Tracked</span>
                    ) : (
                      <button onClick={() => handleQuickAdd(r)}
                        className="px-2 py-0.5 bg-emerald-800 hover:bg-emerald-700 text-emerald-300 rounded text-xs">
                        + Add
                      </button>
                    )}
                    <a href={r.edgarUrl} target="_blank" rel="noopener noreferrer"
                      className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs">
                      EDGAR
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-600 mt-3">Filings are matched by keyword ("blank check", "trust account") and form type — not every result is guaranteed to be a SPAC. Verify via the EDGAR link before adding. Trust value defaults to $10.00; update it from the actual filing once added.</p>

      {modal !== null && (
        <SpacFormModal initial={modal} onSave={handleSave} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
