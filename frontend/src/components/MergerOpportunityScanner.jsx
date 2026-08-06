import { useState, useEffect, useMemo } from 'react'
import { DealFormModal, BLANK_FORM, fmt$, fmtPct, pctColor } from './MergerDealDashboard'

const API = import.meta.env.VITE_API_URL || ''

const FORM_FILTERS = [
  { value: 'All',       label: 'All' },
  { value: 'SC TO-T',   label: 'Tender Offer' },
  { value: 'SC 13E-3',  label: 'Going Private' },
  { value: 'DEFM14A',   label: 'Definitive Proxy' },
  { value: 'PREM14A',   label: 'Preliminary Proxy' },
  { value: 'S-4',       label: 'Stock Registration' },
  { value: '425',       label: 'Business Combo' },
]

function formCls(form) {
  if (form === 'SC TO-T' || form === 'SC 13E-3') return 'bg-sky-900 text-sky-300'
  if (form === 'DEFM14A' || form === 'PREM14A')  return 'bg-purple-900 text-purple-300'
  return 'bg-orange-900 text-orange-300'
}

export default function MergerOpportunityScanner() {
  const [rows, setRows]           = useState([])
  const [loading, setLoading]     = useState(false)
  const [formFilter, setFormFilter] = useState('All')
  const [hideTracked, setHideTracked] = useState(false)
  const [search, setSearch]       = useState('')
  const [modal, setModal]         = useState(null)
  const [added, setAdded]         = useState(new Set())

  const scan = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/merger/opportunities`)
      setRows(await res.json())
    } catch { setRows([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { scan() }, [])

  const filtered = useMemo(() => {
    let r = rows
    if (formFilter !== 'All') r = r.filter(x => x.formType === formFilter)
    if (hideTracked) r = r.filter(x => !x.tracked)
    if (search.trim()) {
      const q = search.trim().toUpperCase()
      r = r.filter(x => (x.ticker || '').includes(q) || (x.companyName || '').toUpperCase().includes(q))
    }
    return r
  }, [rows, formFilter, hideTracked, search])

  const untrackedCount = rows.filter(r => !r.tracked).length
  const uniqueCompanies = new Set(rows.map(r => r.ticker || r.companyName)).size

  const handleQuickAdd = (row) => {
    setModal({
      ...BLANK_FORM,
      target_ticker:   row.ticker || '',
      target_name:     row.companyName,
      announce_date:   row.fileDate,
      edgar_accession: row.accession,
      source:          'edgar',
    })
  }

  const handleSave = async (body) => {
    const res = await fetch(`${API}/api/merger/deals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    setAdded(s => new Set(s).add(body.target_ticker))
  }

  return (
    <div className="p-4 text-white max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Merger Arb — Opportunity Scanner</h1>
          <p className="text-sm text-slate-400">Discover new deals from EDGAR merger filings — tender offers, merger proxies, and stock-deal registrations — before adding them to the Deal Dashboard</p>
        </div>
        <button onClick={scan} disabled={loading}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg disabled:opacity-50">
          {loading ? 'Scanning…' : 'Refresh'}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Filings (60d)',       value: rows.length,       cls: 'text-white' },
          { label: 'Untracked Opportunities', value: untrackedCount, cls: 'text-emerald-400' },
          { label: 'Unique Companies',    value: uniqueCompanies,   cls: 'text-sky-400' },
        ].map(c => (
          <div key={c.label} className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold ${c.cls}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        {FORM_FILTERS.map(f => (
          <button key={f.value} onClick={() => setFormFilter(f.value)}
            className={`px-2 py-1 rounded text-xs ${formFilter === f.value ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
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

      {/* Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-700">
              <th className="text-left px-3 py-2">Filed</th>
              <th className="text-left px-3 py-2">Form</th>
              <th className="text-left px-3 py-2">Company</th>
              <th className="text-right px-3 py-2">Price</th>
              <th className="text-right px-3 py-2">5D</th>
              <th className="text-right px-3 py-2">1M</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-500">Scanning EDGAR for merger filings…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-500 text-sm">No matching filings in the last 60 days</td></tr>
            ) : filtered.map(r => (
              <tr key={r.accession} className="border-b border-slate-700/50 hover:bg-slate-750 group">
                <td className="px-3 py-3 text-xs text-slate-400">{r.fileDate}</td>
                <td className="px-3 py-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${formCls(r.formType)}`} title={r.formLabel}>
                    {r.formType}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <div className="font-bold text-sky-400 text-sm">{r.ticker || '—'}</div>
                  <div className="text-xs text-slate-500 truncate max-w-[220px]">{r.companyName}</div>
                </td>
                <td className="px-3 py-3 text-right text-sm text-slate-300">{r.currentPrice ? fmt$(r.currentPrice) : '—'}</td>
                <td className={`px-3 py-3 text-right text-xs ${pctColor(r.priceChange5d)}`}>{fmtPct(r.priceChange5d)}</td>
                <td className={`px-3 py-3 text-right text-xs ${pctColor(r.priceChange1mo)}`}>{fmtPct(r.priceChange1mo)}</td>
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

      {modal !== null && (
        <DealFormModal
          initial={modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
