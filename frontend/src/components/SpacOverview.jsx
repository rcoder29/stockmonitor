import { useState, useEffect } from 'react'
import { fmt$, fmtPct, pctColor } from './MergerDealDashboard'
import { SpacFormModal, BLANK_FORM } from './SpacTracker'

const API = import.meta.env.VITE_API_URL || ''

function statusCls(status) {
  if (status === 'searching')      return 'text-slate-400'
  if (status === 'deal_announced') return 'text-sky-400'
  if (status === 'closing')        return 'text-emerald-400'
  if (status === 'liquidated')     return 'text-red-400'
  if (status === 'completed')      return 'text-slate-500'
  return 'text-yellow-400'
}

function yieldCls(v) {
  if (v == null) return 'text-slate-500'
  if (v >= 15) return 'text-emerald-400'
  if (v >= 5)  return 'text-yellow-400'
  return 'text-slate-300'
}

function categoryCls(cat) {
  if (cat === 'New SPAC IPO') return 'bg-emerald-900 text-emerald-300'
  if (cat === 'De-SPAC Announcement') return 'bg-sky-900 text-sky-300'
  return 'bg-purple-900 text-purple-300'
}

export default function SpacOverview({ onNavigate }) {
  const [spacs, setSpacs]         = useState([])
  const [discovery, setDiscovery] = useState([])
  const [loading, setLoading]     = useState(false)
  const [modal, setModal]         = useState(null)
  const [added, setAdded]         = useState(new Set())

  const load = async () => {
    setLoading(true)
    try {
      const [spacsRes, discRes] = await Promise.all([
        fetch(`${API}/api/spac/deals`),
        fetch(`${API}/api/spac/discovery`),
      ])
      setSpacs(await spacsRes.json())
      setDiscovery(await discRes.json())
    } catch {
      setSpacs([]); setDiscovery([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const sortedSpacs = [...spacs].sort((a, b) => {
    if (a.daysToDeadline == null) return 1
    if (b.daysToDeadline == null) return -1
    return a.daysToDeadline - b.daysToDeadline
  })

  const untracked = discovery.filter(r => !r.tracked && !added.has(r.ticker)).slice(0, 8)

  const avgYield = spacs.filter(s => s.annualizedYieldPct != null).map(s => s.annualizedYieldPct)
  const avgYieldVal = avgYield.length ? avgYield.reduce((a, b) => a + b, 0) / avgYield.length : null

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
    await load()
  }

  return (
    <div className="p-4 text-white max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">SPACs — Overview</h1>
          <p className="text-sm text-slate-400">Tracked SPACs and newly surfaced opportunities in one place — click through to analyze, track, or size a position</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Tracked SPACs',    value: spacs.length, cls: 'text-white' },
          { label: 'Avg Ann. Yield',   value: avgYieldVal != null ? `${avgYieldVal.toFixed(1)}%` : '—', cls: yieldCls(avgYieldVal) },
          { label: 'New Filings (60d)', value: discovery.length, cls: 'text-white' },
          { label: 'Untracked Opportunities', value: discovery.filter(r => !r.tracked).length, cls: 'text-emerald-400' },
        ].map(c => (
          <div key={c.label} className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold ${c.cls}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Tracked SPACs */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl mb-4">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-sm font-semibold text-slate-300">Tracked SPACs — Nearest Deadline First</h2>
          <button onClick={() => onNavigate('spacrisk')} className="text-xs text-sky-400 hover:text-sky-300">
            View Risk Matrix →
          </button>
        </div>
        {loading ? (
          <div className="text-center py-10 text-slate-500 text-sm">Loading…</div>
        ) : sortedSpacs.length === 0 ? (
          <div className="text-center py-10">
            <div className="text-slate-500 text-sm mb-2">No SPACs tracked yet</div>
            <button onClick={() => onNavigate('spactracker')} className="text-xs text-sky-400 hover:text-sky-300">
              Add one on the Tracker →
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-700">
                  <th className="text-left px-3 py-2">SPAC</th>
                  <th className="text-right px-3 py-2">Trust Value</th>
                  <th className="text-right px-3 py-2">Disc/Prem</th>
                  <th className="text-right px-3 py-2">Ann. Yield</th>
                  <th className="text-right px-3 py-2">Deadline</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedSpacs.map(s => (
                  <tr key={s.id}
                    onClick={() => onNavigate('spacanalyzer', s.id)}
                    className="border-b border-slate-700/50 hover:bg-slate-750 cursor-pointer group">
                    <td className="px-3 py-3">
                      <div className="font-bold text-sky-400 text-sm">{s.ticker}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[160px]">{s.companyName}</div>
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-white">{fmt$(s.trustValuePerShare)}</td>
                    <td className={`px-3 py-3 text-right text-sm font-semibold ${pctColor(s.discountPct != null ? -s.discountPct : null)}`}>
                      {fmtPct(s.discountPct)}
                    </td>
                    <td className={`px-3 py-3 text-right text-sm font-bold ${yieldCls(s.annualizedYieldPct)}`}>
                      {s.annualizedYieldPct != null ? `${s.annualizedYieldPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400 text-right">
                      {s.daysToDeadline != null ? (
                        <span className={s.daysToDeadline < 45 ? 'text-emerald-400 font-semibold' : ''}>
                          {s.daysToDeadline < 0 ? 'Overdue' : `${s.daysToDeadline}d`}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs font-medium ${statusCls(s.status)}`}>{s.statusLabel}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={e => { e.stopPropagation(); onNavigate('spactracker', s.id) }}
                          className="px-1.5 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300">
                          Tracker
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upcoming / newly filed */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-sm font-semibold text-slate-300">Upcoming — Newly Filed, Not Yet Tracked</h2>
          <button onClick={() => onNavigate('spacdiscovery')} className="text-xs text-sky-400 hover:text-sky-300">
            Open Discovery →
          </button>
        </div>
        {loading ? (
          <div className="text-center py-10 text-slate-500 text-sm">Scanning EDGAR…</div>
        ) : untracked.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-sm">No new untracked filings in the last 60 days</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-700">
                  <th className="text-left px-3 py-2">Filed</th>
                  <th className="text-left px-3 py-2">Category</th>
                  <th className="text-left px-3 py-2">Company</th>
                  <th className="text-right px-3 py-2">Price</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {untracked.map(r => (
                  <tr key={r.accession} className="border-b border-slate-700/50 hover:bg-slate-750">
                    <td className="px-3 py-3 text-xs text-slate-400">{r.fileDate}</td>
                    <td className="px-3 py-3">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${categoryCls(r.category)}`} title={r.formType}>{r.category}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-bold text-sky-400 text-sm">{r.ticker || '—'}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[220px]">{r.companyName}</div>
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-slate-300">{r.currentPrice ? fmt$(r.currentPrice) : '—'}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => handleQuickAdd(r)}
                          className="px-2 py-0.5 bg-emerald-800 hover:bg-emerald-700 text-emerald-300 rounded text-xs">
                          + Add
                        </button>
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
        )}
      </div>

      {modal !== null && (
        <SpacFormModal initial={modal} onSave={handleSave} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
