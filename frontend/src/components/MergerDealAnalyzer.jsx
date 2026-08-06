import { useState, useEffect, useCallback } from 'react'
import { DEAL_TYPES, REG_BODIES, fmt$, fmtPct, pctColor } from './MergerDealDashboard'

const API = import.meta.env.VITE_API_URL || ''

function riskCls(label) {
  if (label === 'Low')    return 'bg-emerald-900 text-emerald-300 border border-emerald-700'
  if (label === 'High')   return 'bg-red-900 text-red-300 border border-red-700'
  if (label === 'Medium') return 'bg-yellow-900 text-yellow-300 border border-yellow-700'
  return 'bg-slate-700 text-slate-400'
}

const BLANK_ADHOC = {
  target_ticker: '', offer_price: '', deal_type: 'cash', regulatory_body: '',
  expected_close: '', announce_date: '', deal_value_bn: '', walkaway_price: '',
}

export default function MergerDealAnalyzer() {
  const [deals, setDeals]         = useState([])
  const [dealId, setDealId]       = useState('')
  const [adhoc, setAdhoc]         = useState(BLANK_ADHOC)
  const [mode, setMode]           = useState('tracked') // 'tracked' | 'adhoc'
  const [result, setResult]       = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    fetch(`${API}/api/merger/deals`).then(r => r.json()).then(setDeals).catch(() => setDeals([]))
  }, [])

  const runAnalysis = useCallback(async () => {
    const params = new URLSearchParams()
    if (mode === 'tracked') {
      if (!dealId) { setResult(null); return }
      params.set('deal_id', dealId)
    } else {
      if (!adhoc.target_ticker || !adhoc.offer_price) { setError('Ticker and offer price are required'); return }
      params.set('target_ticker', adhoc.target_ticker.toUpperCase())
      params.set('offer_price', adhoc.offer_price)
      params.set('deal_type', adhoc.deal_type)
      if (adhoc.regulatory_body)  params.set('regulatory_body', adhoc.regulatory_body)
      if (adhoc.expected_close)   params.set('expected_close', adhoc.expected_close)
      if (adhoc.announce_date)    params.set('announce_date', adhoc.announce_date)
      if (adhoc.deal_value_bn)    params.set('deal_value_bn', adhoc.deal_value_bn)
      if (adhoc.walkaway_price)   params.set('walkaway_price', adhoc.walkaway_price)
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/merger/analyze?${params}`)
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

  const set = (k, v) => setAdhoc(f => ({ ...f, [k]: v }))

  return (
    <div className="p-4 text-white max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold">Merger Arb — Deal Analyzer</h1>
        <p className="text-sm text-slate-400">Risk/reward deep-dive on a single deal: risk factor breakdown, market-implied close probability, and expected-value scenarios</p>
      </div>

      {/* Mode toggle + inputs */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4">
        <div className="flex gap-2 mb-3">
          <button onClick={() => setMode('tracked')}
            className={`px-3 py-1.5 rounded text-sm ${mode === 'tracked' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            Tracked Deal
          </button>
          <button onClick={() => setMode('adhoc')}
            className={`px-3 py-1.5 rounded text-sm ${mode === 'adhoc' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            Ad-hoc Deal
          </button>
        </div>

        {mode === 'tracked' ? (
          deals.length === 0 ? (
            <div className="text-sm text-slate-500">No tracked deals yet — add one on the Deal Dashboard, or switch to Ad-hoc Deal to analyze one directly.</div>
          ) : (
            <select value={dealId} onChange={e => setDealId(e.target.value)}
              className="w-full sm:w-80 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500">
              <option value="">Select a tracked deal…</option>
              {deals.map(d => (
                <option key={d.id} value={d.id}>{d.targetTicker} — {d.targetName} (offer {fmt$(d.offerPrice)})</option>
              ))}
            </select>
          )
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Ticker *</label>
              <input value={adhoc.target_ticker} onChange={e => set('target_ticker', e.target.value.toUpperCase())}
                placeholder="e.g. FBRX"
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500 uppercase" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Offer Price *</label>
              <input type="number" step="0.01" value={adhoc.offer_price} onChange={e => set('offer_price', e.target.value)}
                placeholder="80.00"
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Deal Type</label>
              <select value={adhoc.deal_type} onChange={e => set('deal_type', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500">
                {DEAL_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Regulatory Body</label>
              <select value={adhoc.regulatory_body} onChange={e => set('regulatory_body', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500">
                {REG_BODIES.map(r => <option key={r} value={r}>{r || '(none / unknown)'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Expected Close</label>
              <input type="date" value={adhoc.expected_close} onChange={e => set('expected_close', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Announce Date</label>
              <input type="date" value={adhoc.announce_date} onChange={e => set('announce_date', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500" />
              <div className="text-[10px] text-slate-500 mt-0.5">Used to estimate walk-away price from pre-deal trading</div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Deal Value ($B)</label>
              <input type="number" step="0.1" value={adhoc.deal_value_bn} onChange={e => set('deal_value_bn', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Walk-away Price</label>
              <input type="number" step="0.01" value={adhoc.walkaway_price} onChange={e => set('walkaway_price', e.target.value)}
                placeholder="auto-estimated"
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
          {/* Header stats */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-sky-400">{result.targetTicker}</h2>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${riskCls(result.riskLabel)}`}>
                Risk: {result.riskLabel} ({result.riskScore}/10)
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              {[
                { label: 'Offer Price',   value: fmt$(result.offerPrice) },
                { label: 'Current Price', value: fmt$(result.currentPrice) },
                { label: 'Walk-away Price', value: result.walkawayPrice != null ? `${fmt$(result.walkawayPrice)}${result.walkawayEstimated ? ' (est.)' : ''}` : '—' },
                { label: 'Spread', value: result.spreadPct != null ? fmtPct(result.spreadPct) : '—', cls: pctColor(result.spreadPct) },
                { label: 'Ann. Return', value: result.annualizedPct != null ? `${result.annualizedPct.toFixed(1)}%` : '—', cls: pctColor(result.annualizedPct) },
                { label: 'Days to Close', value: result.daysToClose != null ? result.daysToClose : '—' },
              ].map(c => (
                <div key={c.label} className="text-center">
                  <div className="text-xs text-slate-500 mb-1">{c.label}</div>
                  <div className={`text-sm font-bold ${c.cls || 'text-white'}`}>{c.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Upside/downside + implied probability */}
          {result.upsidePct != null && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
                <div className="text-xs text-slate-500 mb-1">Upside if deal closes</div>
                <div className="text-xl font-bold text-green-400">{fmtPct(result.upsidePct)}</div>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
                <div className="text-xs text-slate-500 mb-1">Downside if deal breaks</div>
                <div className="text-xl font-bold text-red-400">{fmtPct(result.downsidePct)}</div>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
                <div className="text-xs text-slate-500 mb-1">Market-Implied P(close)</div>
                <div className="text-xl font-bold text-sky-400">{result.marketImpliedProbabilityPct != null ? `${result.marketImpliedProbabilityPct}%` : '—'}</div>
                <div className="text-[10px] text-slate-500 mt-1">Probability of close the current price already reflects</div>
              </div>
            </div>
          )}

          {/* Risk factor breakdown */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Risk Factor Breakdown</h3>
            <div className="space-y-2">
              {result.riskFactors.map(f => (
                <div key={f.factor} className="flex items-center gap-3">
                  <div className="w-48 text-xs text-slate-400 shrink-0">{f.factor}</div>
                  <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
                    <div className="bg-yellow-500 h-full rounded-full" style={{ width: `${(f.points / f.max) * 100}%` }} />
                  </div>
                  <div className="w-12 text-xs text-slate-300 text-right shrink-0">{f.points}/{f.max}</div>
                  <div className="w-64 text-[11px] text-slate-500 truncate shrink-0" title={f.detail}>{f.detail}</div>
                </div>
              ))}
            </div>
          </div>

          {/* EV scenario table */}
          {result.scenarios.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Expected-Value Scenarios</h3>
              <p className="text-xs text-slate-500 mb-3">Expected return at assumed probabilities of deal completion. Crosses zero near the market-implied probability above.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-700">
                      <th className="text-left px-3 py-2">P(close)</th>
                      <th className="text-right px-3 py-2">Expected Return</th>
                      <th className="text-right px-3 py-2">Annualized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.scenarios.map(s => (
                      <tr key={s.probability} className="border-b border-slate-700/50">
                        <td className="px-3 py-2 text-slate-300">{s.probability}%</td>
                        <td className={`px-3 py-2 text-right font-medium ${pctColor(s.evPct)}`}>{fmtPct(s.evPct)}</td>
                        <td className={`px-3 py-2 text-right ${pctColor(s.evAnnualizedPct)}`}>{s.evAnnualizedPct != null ? `${s.evAnnualizedPct > 0 ? '+' : ''}${s.evAnnualizedPct.toFixed(1)}%` : '—'}</td>
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
