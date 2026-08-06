import { useState, useEffect, useMemo, useCallback } from 'react'
import { fmt$, fmtPct, pctColor } from './MergerDealDashboard'

const API = import.meta.env.VITE_API_URL || ''

export const STATUSES = [
  { value: 'searching',         label: 'Searching for Target' },
  { value: 'deal_announced',    label: 'Deal Announced' },
  { value: 'shareholder_vote',  label: 'Pending Shareholder Vote' },
  { value: 'redemption_period', label: 'Redemption Period' },
  { value: 'closing',           label: 'Closing' },
  { value: 'completed',         label: 'Completed (De-SPAC)' },
  { value: 'liquidated',        label: 'Liquidated' },
]

export const BLANK_FORM = {
  ticker: '', company_name: '', sponsor: '', warrant_ticker: '',
  warrant_strike: '11.5', warrant_ratio: '0.5', ipo_date: '',
  trust_value_per_share: '10.00', trust_value_date: '', deadline_date: '',
  status: 'searching', target_name: '', deal_announce_date: '', pipe_amount_mn: '', notes: '',
}

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

// ── Form Modal ────────────────────────────────────────────────────────────────

export function SpacFormModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial || BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.ticker.trim()) { setErr('Ticker is required'); return }
    if (!form.trust_value_per_share) { setErr('Trust value per share is required'); return }
    setSaving(true)
    try {
      await onSave({
        ...form,
        ticker: form.ticker.trim().toUpperCase(),
        warrant_ticker: form.warrant_ticker.trim().toUpperCase(),
        warrant_strike: form.warrant_strike ? parseFloat(form.warrant_strike) : 11.5,
        warrant_ratio: form.warrant_ratio ? parseFloat(form.warrant_ratio) : 0.5,
        trust_value_per_share: parseFloat(form.trust_value_per_share),
        pipe_amount_mn: form.pipe_amount_mn ? parseFloat(form.pipe_amount_mn) : null,
      })
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const field = (label, key, type = 'text', extra = {}) => (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={e => set(key, e.target.value)}
        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500"
        {...extra}
      />
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="text-lg font-bold">{initial?.id ? 'Edit SPAC' : 'Add SPAC'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4">
          {field('Ticker *', 'ticker', 'text', { placeholder: 'e.g. BCAR', className: 'w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500 uppercase' })}
          {field('Company Name', 'company_name', 'text', { placeholder: 'e.g. D. Boral ARC Acquisition I Corp.' })}
          {field('Sponsor', 'sponsor')}
          {field('Warrant Ticker', 'warrant_ticker', 'text', { placeholder: 'e.g. BCARW', className: 'w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500 uppercase' })}
          {field('Warrant Strike ($)', 'warrant_strike', 'number', { step: '0.01' })}
          {field('Warrant Ratio (shares/warrant)', 'warrant_ratio', 'number', { step: '0.01' })}
          {field('IPO Date', 'ipo_date', 'date')}
          {field('Trust Value / Share ($) *', 'trust_value_per_share', 'number', { step: '0.01' })}
          {field('Trust Value As-Of Date', 'trust_value_date', 'date')}
          {field('Redemption Deadline', 'deadline_date', 'date')}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500">
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {field('Deal Value ($M PIPE)', 'pipe_amount_mn', 'number', { step: '1' })}
          {field('Target Company (if announced)', 'target_name')}
          {field('Deal Announce Date', 'deal_announce_date', 'date')}
          <div className="col-span-2">
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500 resize-none"
              placeholder="Sponsor track record, deal structure notes, redemption history…" />
          </div>
        </div>
        {err && <div className="px-5 pb-2 text-red-400 text-sm">{err}</div>}
        <div className="flex justify-end gap-3 p-5 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 rounded-lg text-sm text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save SPAC'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function SpacRow({ spac, onEdit, onDelete }) {
  return (
    <tr className="border-b border-slate-700/50 hover:bg-slate-750 group">
      <td className="px-3 py-3">
        <div className="font-bold text-sky-400 text-sm">{spac.ticker}</div>
        <div className="text-xs text-slate-500 truncate max-w-[160px]">{spac.companyName}</div>
      </td>
      <td className="px-3 py-3 text-sm text-white text-right">{fmt$(spac.trustValuePerShare)}</td>
      <td className="px-3 py-3 text-sm text-slate-300 text-right">{spac.currentPrice ? fmt$(spac.currentPrice) : '—'}</td>
      <td className={`px-3 py-3 text-sm font-semibold text-right ${pctColor(spac.discountPct != null ? -spac.discountPct : null)}`}>
        {fmtPct(spac.discountPct)}
      </td>
      <td className={`px-3 py-3 text-sm font-bold text-right ${yieldCls(spac.annualizedYieldPct)}`}>
        {spac.annualizedYieldPct != null ? `${spac.annualizedYieldPct.toFixed(1)}%` : '—'}
      </td>
      <td className="px-3 py-3 text-xs text-slate-400 text-right">
        {spac.daysToDeadline != null ? (
          <span className={spac.daysToDeadline < 45 ? 'text-emerald-400 font-semibold' : ''}>
            {spac.daysToDeadline < 0 ? 'Overdue' : `${spac.daysToDeadline}d`}
          </span>
        ) : '—'}
      </td>
      <td className="px-3 py-3">
        <span className={`text-xs font-medium ${statusCls(spac.status)}`}>{spac.statusLabel}</span>
      </td>
      <td className="px-3 py-3">
        {spac.warrantTicker ? (
          <div className="text-xs">
            <div className="text-slate-300">{spac.warrantTicker}</div>
            <div className="text-slate-500">{spac.warrantPrice != null ? fmt$(spac.warrantPrice) : '—'}</div>
          </div>
        ) : <span className="text-slate-600 text-xs">—</span>}
      </td>
      <td className="px-3 py-3">
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(spac)}
            className="px-1.5 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300">
            Edit
          </button>
          <button onClick={() => onDelete(spac.id)}
            className="px-1.5 py-0.5 rounded text-xs bg-red-900/50 hover:bg-red-900 text-red-300">
            ✕
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SpacTracker() {
  const [spacs, setSpacs]                 = useState([])
  const [loading, setLoading]             = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [modal, setModal]                 = useState(null)
  const [filterStatus, setFilterStatus]   = useState('All')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/spac/deals?include_completed=${showCompleted}`)
      setSpacs(await res.json())
    } catch { setSpacs([]) }
    finally { setLoading(false) }
  }, [showCompleted])

  useEffect(() => { load() }, [load])

  const handleSave = async (body) => {
    const isEdit = !!modal?.id
    const url    = isEdit ? `${API}/api/spac/deals/${modal.id}` : `${API}/api/spac/deals`
    const method = isEdit ? 'PUT' : 'POST'
    const res    = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await load()
  }

  const handleDelete = async (id) => {
    if (!confirm('Remove this SPAC?')) return
    await fetch(`${API}/api/spac/deals/${id}`, { method: 'DELETE' })
    await load()
  }

  const filtered = useMemo(() => {
    return filterStatus === 'All' ? spacs : spacs.filter(s => s.status === filterStatus)
  }, [spacs, filterStatus])

  const active     = spacs.filter(s => !['completed', 'liquidated'].includes(s.status))
  const avgDisc    = active.filter(s => s.discountPct != null).map(s => s.discountPct)
  const avgYield   = active.filter(s => s.annualizedYieldPct != null).map(s => s.annualizedYieldPct)
  const avgDiscVal  = avgDisc.length  ? avgDisc.reduce((a, b) => a + b, 0) / avgDisc.length : null
  const avgYieldVal = avgYield.length ? avgYield.reduce((a, b) => a + b, 0) / avgYield.length : null
  const dealsAnnounced = active.filter(s => s.status !== 'searching').length

  return (
    <div className="p-4 text-white max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">SPACs — Tracker</h1>
          <p className="text-sm text-slate-400">Track SPACs against trust value, redemption deadlines, and warrant pricing</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg disabled:opacity-50">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button onClick={() => setModal({ ...BLANK_FORM })}
            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm rounded-lg">
            + Add SPAC
          </button>
        </div>
      </div>

      {active.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Active SPACs',     value: active.length, cls: 'text-white' },
            { label: 'Avg Discount to Trust', value: avgDiscVal != null ? fmtPct(avgDiscVal) : '—', cls: pctColor(avgDiscVal != null ? -avgDiscVal : null) },
            { label: 'Avg Ann. Yield',   value: avgYieldVal != null ? `${avgYieldVal.toFixed(1)}%` : '—', cls: yieldCls(avgYieldVal) },
            { label: 'Deals Announced',  value: dealsAnnounced, cls: 'text-sky-400' },
          ].map(c => (
            <div key={c.label} className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">{c.label}</div>
              <div className={`text-xl font-bold ${c.cls}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <span className="text-xs text-slate-500">Status:</span>
        <button onClick={() => setFilterStatus('All')}
          className={`px-2 py-1 rounded text-xs ${filterStatus === 'All' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
          All
        </button>
        {STATUSES.filter(s => !['completed', 'liquidated'].includes(s.value)).map(s => (
          <button key={s.value} onClick={() => setFilterStatus(s.value)}
            className={`px-2 py-1 rounded text-xs ${filterStatus === s.value ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            {s.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} />
          Show completed / liquidated
        </label>
        <span className="text-xs text-slate-500">{filtered.length} SPACs</span>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-700">
              <th className="text-left px-3 py-2">SPAC</th>
              <th className="text-right px-3 py-2">Trust Value</th>
              <th className="text-right px-3 py-2">Price</th>
              <th className="text-right px-3 py-2">Disc/Prem</th>
              <th className="text-right px-3 py-2">Ann. Yield</th>
              <th className="text-right px-3 py-2">Deadline</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Warrant</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-12 text-slate-500">Loading SPACs…</td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-12">
                  <div className="text-slate-500 text-sm mb-2">No SPACs tracked yet</div>
                  <div className="text-slate-600 text-xs">Click "+ Add SPAC" to add one manually, or use SPAC Discovery to find new IPOs and de-SPAC filings</div>
                </td>
              </tr>
            ) : filtered.map(s => (
              <SpacRow key={s.id} spac={s}
                onEdit={spac => setModal({
                  id: spac.id, ticker: spac.ticker, company_name: spac.companyName, sponsor: spac.sponsor,
                  warrant_ticker: spac.warrantTicker, warrant_strike: String(spac.warrantStrike),
                  warrant_ratio: String(spac.warrantRatio), ipo_date: spac.ipoDate,
                  trust_value_per_share: String(spac.trustValuePerShare), trust_value_date: spac.trustValueDate,
                  deadline_date: spac.deadlineDate, status: spac.status, target_name: spac.targetName,
                  deal_announce_date: spac.dealAnnounceDate, pipe_amount_mn: spac.pipeAmountMn ? String(spac.pipeAmountMn) : '',
                  notes: spac.notes,
                })}
                onDelete={handleDelete}
              />
            ))}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <SpacFormModal initial={modal} onSave={handleSave} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
