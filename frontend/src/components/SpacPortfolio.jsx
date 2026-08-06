import { useState, useEffect, useCallback } from 'react'
import { fmt$, fmtPct, pctColor } from './MergerDealDashboard'

const API = import.meta.env.VITE_API_URL || ''

const BLANK_POS = { spac_id: '', security_type: 'common', shares: '', entry_price: '', entry_date: '', notes: '' }

function PositionFormModal({ initial, spacs, onSave, onClose }) {
  const [form, setForm] = useState(initial || BLANK_POS)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const selectedSpac = spacs.find(s => String(s.id) === String(form.spac_id))

  const handleSave = async () => {
    if (!form.spac_id)     { setErr('Select a SPAC');            return }
    if (!form.shares)      { setErr('Shares is required');        return }
    if (!form.entry_price) { setErr('Entry price is required');  return }
    setSaving(true)
    try {
      await onSave({
        ...form,
        spac_id:     parseInt(form.spac_id),
        shares:      parseFloat(form.shares),
        entry_price: parseFloat(form.entry_price),
      })
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="text-lg font-bold">{initial?.id ? 'Edit Position' : 'Add Position'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">SPAC *</label>
            <select value={form.spac_id} onChange={e => set('spac_id', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500">
              <option value="">Select a tracked SPAC…</option>
              {spacs.map(s => (
                <option key={s.id} value={s.id}>{s.ticker} — {s.companyName} (trust {fmt$(s.trustValuePerShare)})</option>
              ))}
            </select>
            {spacs.length === 0 && <div className="text-xs text-amber-400 mt-1">No tracked SPACs — add one on the Tracker first.</div>}
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Security</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => set('security_type', 'common')}
                className={`flex-1 px-3 py-1.5 rounded text-sm ${form.security_type === 'common' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                Common
              </button>
              <button type="button" onClick={() => set('security_type', 'warrant')}
                disabled={!selectedSpac?.warrantTicker}
                className={`flex-1 px-3 py-1.5 rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed ${form.security_type === 'warrant' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                Warrant {selectedSpac && !selectedSpac.warrantTicker ? '(none tracked)' : ''}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{form.security_type === 'warrant' ? 'Warrants *' : 'Shares *'}</label>
              <input type="number" value={form.shares} onChange={e => set('shares', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Entry Price *</label>
              <input type="number" step="0.01" value={form.entry_price} onChange={e => set('entry_price', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Entry Date</label>
            <input type="date" value={form.entry_date} onChange={e => set('entry_date', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500 resize-none" />
          </div>
        </div>
        {err && <div className="px-5 pb-2 text-red-400 text-sm">{err}</div>}
        <div className="flex justify-end gap-3 p-5 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 rounded-lg text-sm text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Position'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConcentrationBars({ title, data }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-slate-300 mb-3">{title}</h3>
      <div className="space-y-2">
        {entries.map(([label, pct]) => (
          <div key={label} className="flex items-center gap-3">
            <div className="w-28 text-xs text-slate-400 shrink-0 truncate">{label}</div>
            <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
              <div className="bg-sky-500 h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <div className="w-12 text-xs text-slate-300 text-right shrink-0">{pct.toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SpacPortfolio() {
  const [positions, setPositions] = useState([])
  const [summary, setSummary]     = useState(null)
  const [spacs, setSpacs]         = useState([])
  const [loading, setLoading]     = useState(false)
  const [modal, setModal]         = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [posRes, spacsRes] = await Promise.all([
        fetch(`${API}/api/spac/positions`),
        fetch(`${API}/api/spac/deals`),
      ])
      const posData = await posRes.json()
      setPositions(posData.positions || [])
      setSummary(posData.summary)
      setSpacs(await spacsRes.json())
    } catch {
      setPositions([]); setSummary(null); setSpacs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (body) => {
    const isEdit = !!modal?.id
    const url    = isEdit ? `${API}/api/spac/positions/${modal.id}` : `${API}/api/spac/positions`
    const method = isEdit ? 'PUT' : 'POST'
    const res    = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await load()
  }

  const handleDelete = async (id) => {
    if (!confirm('Remove this position?')) return
    await fetch(`${API}/api/spac/positions/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="p-4 text-white max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">SPACs — Portfolio</h1>
          <p className="text-sm text-slate-400">Size common and warrant positions in tracked SPACs and track cost basis, unrealized P&amp;L, and trust-value protection</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg disabled:opacity-50">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button onClick={() => setModal({ ...BLANK_POS })}
            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm rounded-lg">
            + Add Position
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          {[
            { label: 'Positions',      value: summary.positionCount, cls: 'text-white' },
            { label: 'Cost Basis',     value: fmt$(summary.totalCostBasis), cls: 'text-white' },
            { label: 'Market Value',   value: fmt$(summary.totalMarketValue), cls: 'text-white' },
            { label: 'Unrealized P&L', value: `${fmt$(summary.totalUnrealizedPnl)} (${fmtPct(summary.totalUnrealizedPnlPct)})`, cls: pctColor(summary.totalUnrealizedPnl) },
            { label: 'Trust-Protected', value: summary.protectedPct != null ? `${summary.protectedPct.toFixed(0)}%` : '—', cls: 'text-emerald-400' },
          ].map(c => (
            <div key={c.label} className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">{c.label}</div>
              <div className={`text-lg font-bold ${c.cls}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <ConcentrationBars title="Common vs. Warrant Exposure" data={summary.concentrationBySecurityType} />
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Trust-Value Floor</h3>
            <div className="text-2xl font-bold text-emerald-400">{fmt$(summary.floorValue)}</div>
            <p className="text-xs text-slate-500 mt-2">Redemption value of your common positions at trust — the amount recoverable regardless of deal outcome. Warrant positions carry no floor: they can go to zero if the deal falls through or the stock never clears the strike.</p>
          </div>
        </div>
      )}

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-700">
              <th className="text-left px-3 py-2">SPAC</th>
              <th className="text-left px-3 py-2">Security</th>
              <th className="text-right px-3 py-2">Shares</th>
              <th className="text-right px-3 py-2">Entry</th>
              <th className="text-right px-3 py-2">Current</th>
              <th className="text-right px-3 py-2">Cost Basis</th>
              <th className="text-right px-3 py-2">Mkt Value</th>
              <th className="text-right px-3 py-2">Unrealized P&L</th>
              <th className="text-right px-3 py-2">Trust Floor</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="text-center py-12 text-slate-500">Loading…</td></tr>
            ) : positions.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-12">
                  <div className="text-slate-500 text-sm mb-2">No positions yet</div>
                  <div className="text-slate-600 text-xs">Click "+ Add Position" to size a position in one of your tracked SPACs</div>
                </td>
              </tr>
            ) : positions.map(p => (
              <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-750 group">
                <td className="px-3 py-3">
                  <div className="font-bold text-sky-400 text-sm">{p.ticker}</div>
                  <div className="text-xs text-slate-500 truncate max-w-[160px]">{p.companyName}</div>
                </td>
                <td className="px-3 py-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${p.securityType === 'warrant' ? 'bg-purple-900 text-purple-300' : 'bg-sky-900 text-sky-300'}`}>
                    {p.securityType === 'warrant' ? `Warrant (${p.positionTicker})` : 'Common'}
                  </span>
                </td>
                <td className="px-3 py-3 text-right text-sm text-slate-300">{p.shares}</td>
                <td className="px-3 py-3 text-right text-sm text-slate-300">{fmt$(p.entryPrice)}</td>
                <td className="px-3 py-3 text-right text-sm text-slate-300">{fmt$(p.currentPrice)}</td>
                <td className="px-3 py-3 text-right text-sm text-slate-300">{fmt$(p.costBasis)}</td>
                <td className="px-3 py-3 text-right text-sm text-white">{fmt$(p.marketValue)}</td>
                <td className="px-3 py-3 text-right">
                  <div className={`text-sm font-semibold ${pctColor(p.unrealizedPnl)}`}>{fmt$(p.unrealizedPnl)}</div>
                  <div className={`text-xs ${pctColor(p.unrealizedPnlPct)}`}>{fmtPct(p.unrealizedPnlPct)}</div>
                </td>
                <td className="px-3 py-3 text-right text-sm text-slate-300">
                  {p.floorValue != null ? fmt$(p.floorValue) : <span className="text-slate-600">N/A</span>}
                </td>
                <td className="px-3 py-3">
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setModal({ id: p.id, spac_id: String(p.spacId), security_type: p.securityType, shares: p.shares, entry_price: p.entryPrice, entry_date: p.entryDate, notes: p.notes })}
                      className="px-1.5 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(p.id)}
                      className="px-1.5 py-0.5 rounded text-xs bg-red-900/50 hover:bg-red-900 text-red-300">
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <PositionFormModal initial={modal} spacs={spacs} onSave={handleSave} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
