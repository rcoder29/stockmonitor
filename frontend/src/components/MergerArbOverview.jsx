import { useState, useEffect } from 'react'
import { DealFormModal, BLANK_FORM, fmt$, fmtPct, pctColor } from './MergerDealDashboard'

const API = import.meta.env.VITE_API_URL || ''

function riskCls(label) {
  if (label === 'Low')    return 'bg-emerald-900 text-emerald-300 border border-emerald-700'
  if (label === 'High')   return 'bg-red-900 text-red-300 border border-red-700'
  if (label === 'Medium') return 'bg-yellow-900 text-yellow-300 border border-yellow-700'
  return 'bg-slate-700 text-slate-400'
}

function statusCls(status) {
  if (status === 'closing')    return 'text-emerald-400'
  if (status === 'terminated') return 'text-red-400'
  if (status === 'closed')     return 'text-slate-500'
  return 'text-yellow-400'
}

function formCls(form) {
  if (form === 'SC TO-T' || form === 'SC 13E-3') return 'bg-sky-900 text-sky-300'
  if (form === 'DEFM14A' || form === 'PREM14A')  return 'bg-purple-900 text-purple-300'
  return 'bg-orange-900 text-orange-300'
}

export default function MergerArbOverview({ onNavigate }) {
  const [deals, setDeals]         = useState([])
  const [opportunities, setOpps]  = useState([])
  const [loading, setLoading]     = useState(false)
  const [modal, setModal]         = useState(null)
  const [added, setAdded]         = useState(new Set())

  const load = async () => {
    setLoading(true)
    try {
      const [dealsRes, oppsRes] = await Promise.all([
        fetch(`${API}/api/merger/deals`),
        fetch(`${API}/api/merger/opportunities`),
      ])
      setDeals(await dealsRes.json())
      setOpps(await oppsRes.json())
    } catch {
      setDeals([]); setOpps([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const activeSorted = [...deals].sort((a, b) => {
    if (a.daysToClose == null) return 1
    if (b.daysToClose == null) return -1
    return a.daysToClose - b.daysToClose
  })

  const untracked = opportunities.filter(o => !o.tracked && !added.has(o.ticker)).slice(0, 8)

  const avgAnn = deals.filter(d => d.annualizedPct != null).map(d => d.annualizedPct)
  const avgAnnVal = avgAnn.length ? avgAnn.reduce((s, v) => s + v, 0) / avgAnn.length : null

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
    await load()
  }

  return (
    <div className="p-4 text-white max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Merger Arb — Overview</h1>
          <p className="text-sm text-slate-400">Active deals and newly surfaced opportunities in one place — click through to analyze, track, or size a position</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Active Deals',      value: deals.length, cls: 'text-white' },
          { label: 'Avg Ann. Return',   value: avgAnnVal != null ? `${avgAnnVal.toFixed(1)}%` : '—', cls: pctColor(avgAnnVal) },
          { label: 'New Filings (60d)', value: opportunities.length, cls: 'text-white' },
          { label: 'Untracked Opportunities', value: opportunities.filter(o => !o.tracked).length, cls: 'text-emerald-400' },
        ].map(c => (
          <div key={c.label} className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold ${c.cls}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Active deals */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl mb-4">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-sm font-semibold text-slate-300">Active Deals In Progress</h2>
          <button onClick={() => onNavigate('mergerrisk')} className="text-xs text-sky-400 hover:text-sky-300">
            View Risk Matrix →
          </button>
        </div>
        {loading ? (
          <div className="text-center py-10 text-slate-500 text-sm">Loading…</div>
        ) : activeSorted.length === 0 ? (
          <div className="text-center py-10">
            <div className="text-slate-500 text-sm mb-2">No active deals tracked yet</div>
            <button onClick={() => onNavigate('mergerdashboard')} className="text-xs text-sky-400 hover:text-sky-300">
              Add one on the Deal Dashboard →
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-700">
                  <th className="text-left px-3 py-2">Target</th>
                  <th className="text-left px-3 py-2">Acquirer</th>
                  <th className="text-right px-3 py-2">Spread</th>
                  <th className="text-right px-3 py-2">Ann. Ret.</th>
                  <th className="text-right px-3 py-2">Days</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Risk</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {activeSorted.map(d => (
                  <tr key={d.id}
                    onClick={() => onNavigate('mergeranalyzer', d.id)}
                    className="border-b border-slate-700/50 hover:bg-slate-750 cursor-pointer group">
                    <td className="px-3 py-3">
                      <div className="font-bold text-sky-400 text-sm">{d.targetTicker}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[160px]">{d.targetName}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-300 truncate max-w-[140px]">{d.acquirerName || '—'}</td>
                    <td className="px-3 py-3 text-right">
                      {d.spread != null ? (
                        <div>
                          <div className={`text-sm font-semibold ${pctColor(d.spread)}`}>{fmt$(d.spread)}</div>
                          <div className={`text-xs ${pctColor(d.spreadPct)}`}>{fmtPct(d.spreadPct)}</div>
                        </div>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className={`px-3 py-3 text-sm font-bold text-right ${pctColor(d.annualizedPct)}`}>
                      {d.annualizedPct != null ? `${d.annualizedPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400 text-right">
                      {d.daysToClose != null ? (
                        <span className={d.daysToClose < 30 ? 'text-emerald-400 font-semibold' : ''}>
                          {d.daysToClose < 0 ? 'Overdue' : `${d.daysToClose}d`}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs font-medium ${statusCls(d.status)}`}>{d.statusLabel}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${riskCls(d.riskLabel)}`}>{d.riskLabel}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={e => { e.stopPropagation(); onNavigate('mergerdashboard', d.id) }}
                          className="px-1.5 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300">
                          Dashboard
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
          <button onClick={() => onNavigate('mergerscanner')} className="text-xs text-sky-400 hover:text-sky-300">
            Open Scanner →
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
                  <th className="text-left px-3 py-2">Form</th>
                  <th className="text-left px-3 py-2">Company</th>
                  <th className="text-right px-3 py-2">Price</th>
                  <th className="text-right px-3 py-2">5D</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {untracked.map(r => (
                  <tr key={r.accession} className="border-b border-slate-700/50 hover:bg-slate-750">
                    <td className="px-3 py-3 text-xs text-slate-400">{r.fileDate}</td>
                    <td className="px-3 py-3">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${formCls(r.formType)}`} title={r.formLabel}>{r.formType}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-bold text-sky-400 text-sm">{r.ticker || '—'}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[220px]">{r.companyName}</div>
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-slate-300">{r.currentPrice ? fmt$(r.currentPrice) : '—'}</td>
                    <td className={`px-3 py-3 text-right text-xs ${pctColor(r.priceChange5d)}`}>{fmtPct(r.priceChange5d)}</td>
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
        <DealFormModal initial={modal} onSave={handleSave} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
