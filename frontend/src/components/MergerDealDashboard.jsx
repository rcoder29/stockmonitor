import { useState, useEffect, useMemo, useCallback } from 'react'

const API = import.meta.env.VITE_API_URL || ''

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEAL_TYPES   = ['cash', 'stock', 'mixed']
export const REG_BODIES   = ['', 'DOJ', 'FTC', 'DOJ/FTC', 'EU', 'CFIUS', 'DOJ/EU', 'Multiple', 'None']
export const STATUSES     = [
  { value: 'pending_regulatory',  label: 'Pending Regulatory' },
  { value: 'pending_shareholder', label: 'Pending Shareholder Vote' },
  { value: 'pending_financing',   label: 'Pending Financing' },
  { value: 'closing',             label: 'Closing' },
  { value: 'terminated',          label: 'Terminated' },
  { value: 'closed',              label: 'Closed' },
]

export const BLANK_FORM = {
  target_ticker: '', target_name: '', acquirer_name: '',
  deal_type: 'cash', offer_price: '', announce_date: '', expected_close: '',
  status: 'pending_regulatory', deal_value_bn: '', regulatory_body: '', notes: '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function riskCls(label) {
  if (label === 'Low')    return 'bg-emerald-900 text-emerald-300 border border-emerald-700'
  if (label === 'High')   return 'bg-red-900 text-red-300 border border-red-700'
  if (label === 'Medium') return 'bg-yellow-900 text-yellow-300 border border-yellow-700'
  return 'bg-slate-700 text-slate-400'
}

function typeCls(type) {
  if (type === 'cash')  return 'bg-sky-900 text-sky-300'
  if (type === 'stock') return 'bg-purple-900 text-purple-300'
  return 'bg-orange-900 text-orange-300'
}

function statusCls(status) {
  if (status === 'closing')    return 'text-emerald-400'
  if (status === 'terminated') return 'text-red-400'
  if (status === 'closed')     return 'text-slate-500'
  return 'text-yellow-400'
}

export function pctColor(v) {
  if (v == null) return 'text-slate-500'
  return v > 0 ? 'text-green-400' : 'text-red-400'
}

export function fmt$(v) {
  if (v == null) return '—'
  return `$${Number(v).toFixed(2)}`
}

export function fmtPct(v, digits = 2) {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

// ── Spread Sparkline ──────────────────────────────────────────────────────────

function SpreadSparkline({ data }) {
  if (!data || data.length < 2) return <span className="text-slate-600 text-xs">—</span>
  const vals = data.map(d => d.spreadPct)
  const min  = Math.min(...vals), max = Math.max(...vals)
  const range = max - min || 1
  const W = 80, H = 24
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W
    const y = H - ((v - min) / range) * H
    return `${x},${y}`
  }).join(' ')
  const last = vals[vals.length - 1]
  return (
    <div className="flex items-center gap-2">
      <svg width={W} height={H} className="overflow-visible">
        <polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      </svg>
      <span className={`text-xs ${pctColor(last)}`}>{fmtPct(last)}</span>
    </div>
  )
}

// ── Deal Form Modal ───────────────────────────────────────────────────────────

export function DealFormModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial || BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.target_ticker.trim()) { setErr('Target ticker is required'); return }
    if (!form.offer_price)          { setErr('Offer price is required');   return }
    setSaving(true)
    try {
      await onSave({
        ...form,
        target_ticker: form.target_ticker.trim().toUpperCase(),
        offer_price:   parseFloat(form.offer_price),
        deal_value_bn: form.deal_value_bn ? parseFloat(form.deal_value_bn) : null,
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
          <h2 className="text-lg font-bold">{initial?.id ? 'Edit Deal' : 'Add Deal'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4">
          {field('Target Ticker *', 'target_ticker', 'text', { placeholder: 'e.g. ATVI', className: 'w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500 uppercase' })}
          {field('Target Company Name', 'target_name', 'text', { placeholder: 'e.g. Activision Blizzard' })}
          {field('Acquirer Name', 'acquirer_name', 'text', { placeholder: 'e.g. Microsoft' })}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Deal Type</label>
            <select value={form.deal_type} onChange={e => set('deal_type', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500">
              {DEAL_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          {field('Offer Price ($) *', 'offer_price', 'number', { placeholder: '95.00', step: '0.01' })}
          {field('Deal Value ($B)', 'deal_value_bn', 'number', { placeholder: '68.7', step: '0.1' })}
          {field('Announce Date', 'announce_date', 'date')}
          {field('Expected Close', 'expected_close', 'date')}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500">
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Regulatory Body</label>
            <select value={form.regulatory_body} onChange={e => set('regulatory_body', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500">
              {REG_BODIES.map(r => <option key={r} value={r}>{r || '(none / unknown)'}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500 resize-none"
              placeholder="Regulatory timeline, key risks, deal conditions…" />
          </div>
        </div>
        {err && <div className="px-5 pb-2 text-red-400 text-sm">{err}</div>}
        <div className="flex justify-end gap-3 p-5 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 rounded-lg text-sm text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Deal'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── EDGAR Scanner Panel ───────────────────────────────────────────────────────

function EdgarScanner({ onAddFromEdgar }) {
  const [open, setOpen]     = useState(false)
  const [data, setData]     = useState([])
  const [loading, setLoading] = useState(false)

  const scan = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/merger/scan-edgar`)
      setData(await res.json())
    } catch { setData([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (open && !data.length) scan() }, [open])

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl mb-4">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 text-sm font-medium text-slate-300 hover:text-white">
        <span>📡 EDGAR Tender Offer Scanner (SC TO-T · SC 13E-3 — last 90 days)</span>
        <span className="text-slate-500">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-500">{data.length} filings found</span>
            <button onClick={scan} disabled={loading}
              className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs disabled:opacity-50">
              {loading ? 'Scanning…' : 'Refresh'}
            </button>
          </div>
          {loading ? (
            <div className="text-slate-500 text-sm py-4 text-center">Scanning EDGAR…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-700">
                    <th className="text-left px-2 py-2">Filed</th>
                    <th className="text-left px-2 py-2">Form</th>
                    <th className="text-left px-2 py-2">Filer (Acquirer)</th>
                    <th className="text-left px-2 py-2">Accession</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r, i) => (
                    <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                      <td className="px-2 py-2 text-slate-400 text-xs">{r.fileDate}</td>
                      <td className="px-2 py-2">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-sky-900 text-sky-300">{r.formType}</span>
                      </td>
                      <td className="px-2 py-2 text-slate-300 text-xs">{r.filerName}</td>
                      <td className="px-2 py-2 text-slate-500 text-xs font-mono">{r.accession}</td>
                      <td className="px-2 py-2 flex gap-2">
                        <button onClick={() => onAddFromEdgar(r)}
                          className="px-2 py-0.5 bg-emerald-800 hover:bg-emerald-700 text-emerald-300 rounded text-xs">
                          + Add
                        </button>
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
          )}
        </div>
      )}
    </div>
  )
}

// ── Deal Row ──────────────────────────────────────────────────────────────────

function DealRow({ deal, onEdit, onDelete, onSelectHistory, highlighted }) {
  return (
    <tr id={`merger-deal-row-${deal.id}`}
      className={`border-b border-slate-700/50 hover:bg-slate-750 group transition-colors ${highlighted ? 'bg-sky-900/40 ring-1 ring-inset ring-sky-500' : ''}`}>
      <td className="px-3 py-3">
        <div className="font-bold text-sky-400 text-sm">{deal.targetTicker}</div>
        <div className="text-xs text-slate-500 truncate max-w-[160px]">{deal.targetName}</div>
      </td>
      <td className="px-3 py-3 text-xs text-slate-300 truncate max-w-[140px]">{deal.acquirerName || '—'}</td>
      <td className="px-3 py-3">
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${typeCls(deal.dealType)}`}>
          {deal.dealType.toUpperCase()}
        </span>
      </td>
      <td className="px-3 py-3 text-sm text-white text-right">{fmt$(deal.offerPrice)}</td>
      <td className="px-3 py-3 text-sm text-right">
        {deal.currentPrice ? (
          <span className="text-slate-300">{fmt$(deal.currentPrice)}</span>
        ) : <span className="text-slate-600">—</span>}
      </td>
      <td className="px-3 py-3 text-right">
        {deal.spread != null ? (
          <div>
            <div className={`text-sm font-semibold ${pctColor(deal.spread)}`}>{fmt$(deal.spread)}</div>
            <div className={`text-xs ${pctColor(deal.spreadPct)}`}>{fmtPct(deal.spreadPct)}</div>
          </div>
        ) : <span className="text-slate-600">—</span>}
      </td>
      <td className={`px-3 py-3 text-sm font-bold text-right ${pctColor(deal.annualizedPct)}`}>
        {deal.annualizedPct != null ? `${deal.annualizedPct.toFixed(1)}%` : '—'}
      </td>
      <td className="px-3 py-3 text-xs text-slate-400 text-right">
        {deal.daysToClose != null ? (
          <span className={deal.daysToClose < 30 ? 'text-emerald-400 font-semibold' : ''}>
            {deal.daysToClose < 0 ? 'Overdue' : `${deal.daysToClose}d`}
          </span>
        ) : '—'}
      </td>
      <td className="px-3 py-3">
        <span className={`text-xs font-medium ${statusCls(deal.status)}`}>{deal.statusLabel}</span>
      </td>
      <td className="px-3 py-3">
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${riskCls(deal.riskLabel)}`}>
          {deal.riskLabel}
        </span>
      </td>
      <td className="px-3 py-3">
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onSelectHistory(deal)}
            className="px-1.5 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300" title="Spread history">
            📈
          </button>
          <button onClick={() => onEdit(deal)}
            className="px-1.5 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300">
            Edit
          </button>
          <button onClick={() => onDelete(deal.id)}
            className="px-1.5 py-0.5 rounded text-xs bg-red-900/50 hover:bg-red-900 text-red-300">
            ✕
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Spread History Modal ──────────────────────────────────────────────────────

function SpreadHistoryModal({ deal, onClose }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/merger/deal/${deal.id}/spread-history`)
      .then(r => r.json())
      .then(d => { setHistory(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [deal.id])

  const vals = history.map(h => h.spreadPct)
  const min  = Math.min(...vals, 0), max = Math.max(...vals, 5)
  const range = max - min || 1
  const W = 500, H = 120

  const pts = history.map((h, i) => {
    const x = (i / Math.max(history.length - 1, 1)) * W
    const y = H - ((h.spreadPct - min) / range) * H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-bold">{deal.targetTicker} — 90-Day Spread History</h2>
            <div className="text-xs text-slate-400">Offer: {fmt$(deal.offerPrice)} · Current: {fmt$(deal.currentPrice)}</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="text-slate-500 text-center py-8">Loading…</div>
          ) : history.length === 0 ? (
            <div className="text-slate-500 text-center py-8">No price history available</div>
          ) : (
            <>
              <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`} className="overflow-visible mb-3">
                {/* Zero line */}
                <line x1={0} y1={H - ((-min) / range) * H} x2={W} y2={H - ((-min) / range) * H}
                  stroke="#334155" strokeWidth="1" strokeDasharray="4,3" />
                <polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth="2" />
                {/* Last point dot */}
                {history.length > 0 && (() => {
                  const last = history[history.length - 1]
                  const lx = W, ly = H - ((last.spreadPct - min) / range) * H
                  return <circle cx={lx} cy={ly} r={4} fill="#38bdf8" />
                })()}
              </svg>
              <div className="flex justify-between text-xs text-slate-500">
                <span>{history[0]?.date}</span>
                <span className="text-sky-400 font-semibold">
                  Current spread: {fmtPct(history[history.length - 1]?.spreadPct)}
                </span>
                <span>{history[history.length - 1]?.date}</span>
              </div>
              <div className="mt-3 flex gap-4 text-xs text-slate-400">
                <span>High: <b className="text-green-400">{fmtPct(Math.max(...vals))}</b></span>
                <span>Low: <b className="text-red-400">{fmtPct(Math.min(...vals))}</b></span>
                <span>Avg: <b className="text-slate-300">{fmtPct(vals.reduce((s, v) => s + v, 0) / vals.length)}</b></span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function MergerDealDashboard({ focusDealId, onFocusConsumed } = {}) {
  const [deals, setDeals]             = useState([])
  const [loading, setLoading]         = useState(false)
  const [showClosed, setShowClosed]   = useState(false)
  const [modal, setModal]             = useState(null)  // null | 'add' | deal-object (edit)
  const [histDeal, setHistDeal]       = useState(null)
  const [sortCol, setSortCol]         = useState('annualizedPct')
  const [sortDir, setSortDir]         = useState('desc')
  const [filterRisk, setFilterRisk]   = useState('All')
  const [highlightId, setHighlightId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/merger/deals?include_closed=${showClosed}`)
      setDeals(await res.json())
    } catch { setDeals([]) }
    finally { setLoading(false) }
  }, [showClosed])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (focusDealId == null) return
    setHighlightId(focusDealId)
    onFocusConsumed?.()
  }, [focusDealId])

  useEffect(() => {
    if (highlightId == null || loading) return
    const el = document.getElementById(`merger-deal-row-${highlightId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = setTimeout(() => setHighlightId(null), 2500)
    return () => clearTimeout(t)
  }, [highlightId, loading, deals])

  const handleSave = async (body) => {
    const isEdit = !!modal?.id
    const url    = isEdit ? `${API}/api/merger/deals/${modal.id}` : `${API}/api/merger/deals`
    const method = isEdit ? 'PUT' : 'POST'
    const res    = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await load()
  }

  const handleDelete = async (id) => {
    if (!confirm('Remove this deal?')) return
    await fetch(`${API}/api/merger/deals/${id}`, { method: 'DELETE' })
    await load()
  }

  const handleAddFromEdgar = (row) => {
    setModal({
      ...BLANK_FORM,
      acquirer_name:   row.filerName,
      announce_date:   row.fileDate,
      edgar_accession: row.accession,
      source:          'edgar',
    })
  }

  const sorted = useMemo(() => {
    let rows = filterRisk === 'All' ? deals : deals.filter(d => d.riskLabel === filterRisk)
    return [...rows].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return sortDir === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1)
    })
  }, [deals, sortCol, sortDir, filterRisk])

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const SortHdr = ({ col, label, right }) => (
    <th onClick={() => toggleSort(col)}
      className={`px-3 py-2 cursor-pointer select-none hover:text-white ${right ? 'text-right' : 'text-left'}`}>
      {label}{sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : <span className="text-slate-700"> ↕</span>}
    </th>
  )

  // Summary stats
  const activeDeals     = deals.filter(d => !['terminated','closed'].includes(d.status))
  const avgSpread       = activeDeals.filter(d => d.spreadPct != null).map(d => d.spreadPct)
  const avgAnn          = activeDeals.filter(d => d.annualizedPct != null).map(d => d.annualizedPct)
  const avgSpreadVal    = avgSpread.length  ? avgSpread.reduce((s,v) => s+v,0)  / avgSpread.length  : null
  const avgAnnVal       = avgAnn.length     ? avgAnn.reduce((s,v) => s+v,0)     / avgAnn.length     : null
  const riskCounts      = { Low: 0, Medium: 0, High: 0 }
  activeDeals.forEach(d => { if (riskCounts[d.riskLabel] != null) riskCounts[d.riskLabel]++ })

  return (
    <div className="p-4 text-white max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Merger Arb — Deal Dashboard</h1>
          <p className="text-sm text-slate-400">Track active deals, spreads, and risk across your merger arb universe</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg disabled:opacity-50">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button onClick={() => setModal({ ...BLANK_FORM })}
            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm rounded-lg">
            + Add Deal
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {activeDeals.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          {[
            { label: 'Active Deals',   value: activeDeals.length,                       cls: 'text-white' },
            { label: 'Avg Spread',     value: avgSpreadVal != null ? fmtPct(avgSpreadVal) : '—', cls: pctColor(avgSpreadVal) },
            { label: 'Avg Ann. Return',value: avgAnnVal   != null ? `${avgAnnVal.toFixed(1)}%` : '—', cls: pctColor(avgAnnVal) },
            { label: 'Low Risk',       value: riskCounts.Low,   cls: 'text-emerald-400' },
            { label: 'High Risk',      value: riskCounts.High,  cls: 'text-red-400' },
          ].map(c => (
            <div key={c.label} className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">{c.label}</div>
              <div className={`text-xl font-bold ${c.cls}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* EDGAR Scanner */}
      <EdgarScanner onAddFromEdgar={handleAddFromEdgar} />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <span className="text-xs text-slate-500">Risk:</span>
        {['All', 'Low', 'Medium', 'High'].map(r => (
          <button key={r} onClick={() => setFilterRisk(r)}
            className={`px-2 py-1 rounded text-xs ${filterRisk === r ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            {r}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
          Show closed / terminated
        </label>
        <span className="text-xs text-slate-500">{sorted.length} deals</span>
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-700">
              <SortHdr col="targetTicker"  label="Target" />
              <th className="text-left px-3 py-2">Acquirer</th>
              <th className="text-left px-3 py-2">Type</th>
              <SortHdr col="offerPrice"    label="Offer"     right />
              <SortHdr col="currentPrice"  label="Price"     right />
              <SortHdr col="spread"        label="Spread"    right />
              <SortHdr col="annualizedPct" label="Ann. Ret." right />
              <SortHdr col="daysToClose"   label="Days"      right />
              <th className="text-left px-3 py-2">Status</th>
              <SortHdr col="riskScore"     label="Risk" />
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="text-center py-12 text-slate-500">Loading deals…</td></tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-12">
                  <div className="text-slate-500 text-sm mb-2">No active deals tracked yet</div>
                  <div className="text-slate-600 text-xs">Click "+ Add Deal" to add one manually, or use the EDGAR Scanner above to discover recent tender offers</div>
                </td>
              </tr>
            ) : sorted.map(d => (
              <DealRow key={d.id} deal={d}
                onEdit={deal => setModal({ ...deal, offer_price: deal.offerPrice, target_ticker: deal.targetTicker, target_name: deal.targetName, acquirer_name: deal.acquirerName, deal_type: deal.dealType, announce_date: deal.announceDate, expected_close: deal.expectedClose, deal_value_bn: deal.dealValueBn, regulatory_body: deal.regulatoryBody })}
                onDelete={handleDelete}
                onSelectHistory={setHistDeal}
                highlighted={highlightId === d.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {modal !== null && (
        <DealFormModal
          initial={modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
      {histDeal && <SpreadHistoryModal deal={histDeal} onClose={() => setHistDeal(null)} />}
    </div>
  )
}
