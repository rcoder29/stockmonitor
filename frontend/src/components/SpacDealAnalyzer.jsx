import { useState, useEffect, useCallback } from 'react'
import { fmt$, fmtPct, pctColor } from './MergerDealDashboard'
import { STATUSES } from './SpacTracker'

const API = import.meta.env.VITE_API_URL || ''

const BLANK_ADHOC = {
  ticker: '', trust_value_per_share: '10.00', deadline_date: '', status: 'searching',
  target_name: '', warrant_ticker: '', warrant_strike: '11.5', warrant_ratio: '0.5',
}

function yieldCls(v) {
  if (v == null) return 'text-slate-500'
  if (v >= 15) return 'text-emerald-400'
  if (v >= 5)  return 'text-yellow-400'
  return 'text-slate-300'
}

export default function SpacDealAnalyzer({ focusDealId, onFocusConsumed } = {}) {
  const [spacs, setSpacs]         = useState([])
  const [dealId, setDealId]       = useState('')
  const [adhoc, setAdhoc]         = useState(BLANK_ADHOC)
  const [mode, setMode]           = useState('tracked')
  const [result, setResult]       = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    fetch(`${API}/api/spac/deals`).then(r => r.json()).then(setSpacs).catch(() => setSpacs([]))
  }, [])

  const runAnalysis = useCallback(async () => {
    const params = new URLSearchParams()
    if (mode === 'tracked') {
      if (!dealId) { setResult(null); return }
      params.set('deal_id', dealId)
    } else {
      if (!adhoc.ticker || !adhoc.trust_value_per_share) { setError('Ticker and trust value are required'); return }
      params.set('ticker', adhoc.ticker.toUpperCase())
      params.set('trust_value_per_share', adhoc.trust_value_per_share)
      params.set('status', adhoc.status)
      if (adhoc.deadline_date)  params.set('deadline_date', adhoc.deadline_date)
      if (adhoc.target_name)    params.set('target_name', adhoc.target_name)
      if (adhoc.warrant_ticker) {
        params.set('warrant_ticker', adhoc.warrant_ticker.toUpperCase())
        params.set('warrant_strike', adhoc.warrant_strike || '11.5')
        params.set('warrant_ratio', adhoc.warrant_ratio || '0.5')
      }
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/spac/analyze?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setResult(await res.json())
    } catch (e) {
      setError(e.message)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [mode, dealId, adhoc])

  useEffect(() => { if (mode === 'tracked' && dealId) runAnalysis() }, [dealId, mode])

  useEffect(() => {
    if (focusDealId == null) return
    setMode('tracked')
    setDealId(String(focusDealId))
    onFocusConsumed?.()
  }, [focusDealId])

  const set = (k, v) => setAdhoc(f => ({ ...f, [k]: v }))

  return (
    <div className="p-4 text-white max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold">SPACs — Deal Analyzer</h1>
        <p className="text-sm text-slate-400">Discount-to-trust capture yield, warrant economics, and a redeem-vs-hold scenario table for a single SPAC</p>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4">
        <div className="flex gap-2 mb-3">
          <button onClick={() => setMode('tracked')}
            className={`px-3 py-1.5 rounded text-sm ${mode === 'tracked' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            Tracked SPAC
          </button>
          <button onClick={() => setMode('adhoc')}
            className={`px-3 py-1.5 rounded text-sm ${mode === 'adhoc' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            Ad-hoc SPAC
          </button>
        </div>

        {mode === 'tracked' ? (
          spacs.length === 0 ? (
            <div className="text-sm text-slate-500">No tracked SPACs yet — add one on the Tracker, or switch to Ad-hoc SPAC to analyze one directly.</div>
          ) : (
            <select value={dealId} onChange={e => setDealId(e.target.value)}
              className="w-full sm:w-80 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500">
              <option value="">Select a tracked SPAC…</option>
              {spacs.map(s => (
                <option key={s.id} value={s.id}>{s.ticker} — {s.companyName} (trust {fmt$(s.trustValuePerShare)})</option>
              ))}
            </select>
          )
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Ticker *</label>
              <input value={adhoc.ticker} onChange={e => set('ticker', e.target.value.toUpperCase())}
                placeholder="e.g. BCAR"
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500 uppercase" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Trust Value / Share *</label>
              <input type="number" step="0.01" value={adhoc.trust_value_per_share} onChange={e => set('trust_value_per_share', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Redemption Deadline</label>
              <input type="date" value={adhoc.deadline_date} onChange={e => set('deadline_date', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Status</label>
              <select value={adhoc.status} onChange={e => set('status', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500">
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Target Company</label>
              <input value={adhoc.target_name} onChange={e => set('target_name', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Warrant Ticker</label>
              <input value={adhoc.warrant_ticker} onChange={e => set('warrant_ticker', e.target.value.toUpperCase())}
                placeholder="optional"
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500 uppercase" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Warrant Strike</label>
              <input type="number" step="0.01" value={adhoc.warrant_strike} onChange={e => set('warrant_strike', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Warrant Ratio</label>
              <input type="number" step="0.01" value={adhoc.warrant_ratio} onChange={e => set('warrant_ratio', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500" />
            </div>
            <div className="col-span-2 sm:col-span-4">
              <button onClick={runAnalysis} disabled={loading}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 rounded-lg text-sm text-white disabled:opacity-50">
                {loading ? 'Analyzing…' : 'Analyze'}
              </button>
            </div>
          </div>
        )}
        {error && <div className="text-red-400 text-sm mt-2">{error}</div>}
      </div>

      {loading && mode === 'tracked' && <div className="text-slate-500 text-sm py-8 text-center">Analyzing…</div>}

      {result && (
        <div className="space-y-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-sky-400">{result.ticker}</h2>
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300">{result.statusLabel}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'Current Price', value: fmt$(result.currentPrice) },
                { label: 'Trust Value/Share', value: fmt$(result.trustValuePerShare) },
                { label: 'Discount/Premium', value: result.discountPct != null ? fmtPct(result.discountPct) : '—', cls: pctColor(result.discountPct != null ? -result.discountPct : null) },
                { label: 'Capture Yield', value: result.captureYieldPct != null ? fmtPct(result.captureYieldPct) : '—', cls: pctColor(result.captureYieldPct) },
                { label: 'Days to Deadline', value: result.daysToDeadline != null ? result.daysToDeadline : '—' },
              ].map(c => (
                <div key={c.label} className="text-center">
                  <div className="text-xs text-slate-500 mb-1">{c.label}</div>
                  <div className={`text-sm font-bold ${c.cls || 'text-white'}`}>{c.value}</div>
                </div>
              ))}
            </div>
          </div>

          {result.annualizedYieldPct != null && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
              <div className="text-xs text-slate-500 mb-1">Annualized Yield-to-Deadline</div>
              <div className={`text-2xl font-bold ${yieldCls(result.annualizedYieldPct)}`}>{result.annualizedYieldPct.toFixed(1)}%</div>
              <div className="text-[11px] text-slate-500 mt-1">Return on cost basis if bought now and redeemed for trust value at the deadline — the SPAC arb's floor case</div>
            </div>
          )}

          {result.warrantTicker && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Warrant — {result.warrantTicker}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Warrant Price', value: result.warrantPrice != null ? fmt$(result.warrantPrice) : '—' },
                  { label: 'Intrinsic Value', value: result.warrantIntrinsic != null ? fmt$(result.warrantIntrinsic) : '—' },
                  { label: 'Time Value', value: result.warrantTimeValue != null ? fmt$(result.warrantTimeValue) : '—' },
                  { label: 'Breakeven Price', value: result.warrantBreakeven != null ? fmt$(result.warrantBreakeven) : '—' },
                ].map(c => (
                  <div key={c.label} className="text-center">
                    <div className="text-xs text-slate-500 mb-1">{c.label}</div>
                    <div className="text-sm font-bold text-white">{c.value}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-3">Strike {fmt$(result.warrantStrike)} · {result.warrantRatio} share{result.warrantRatio === 1 ? '' : 's'} per warrant. Breakeven is the common stock price at which exercising the warrant nets zero.</p>
            </div>
          )}

          {result.scenarios.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Redeem vs. Hold Scenarios</h3>
              <p className="text-xs text-slate-500 mb-3">Trust value is a floor — redeeming or a deal closing flat both return your capture yield. Upside if you hold through a well-received business combination is uncapped and leveraged in the warrant.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-700">
                      <th className="text-left px-3 py-2">Scenario</th>
                      <th className="text-right px-3 py-2">Price</th>
                      <th className="text-right px-3 py-2">Return</th>
                      {result.warrantTicker && <th className="text-right px-3 py-2">Warrant Return</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {result.scenarios.map(s => (
                      <tr key={s.label} className="border-b border-slate-700/50">
                        <td className="px-3 py-2 text-slate-300">{s.label}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{fmt$(s.price)}</td>
                        <td className={`px-3 py-2 text-right font-medium ${pctColor(s.returnPct)}`}>{fmtPct(s.returnPct, 1)}</td>
                        {result.warrantTicker && (
                          <td className={`px-3 py-2 text-right ${pctColor(s.warrantReturnPct)}`}>
                            {s.warrantReturnPct != null ? fmtPct(s.warrantReturnPct, 1) : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
