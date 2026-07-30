import { useState, useEffect, useCallback } from 'react'

// ── Storage ───────────────────────────────────────────────────────────────────

const LS_KEY = 'dividend_tracker_v1'

function loadPositions() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') }
  catch { return [] }
}
function savePositions(p) { localStorage.setItem(LS_KEY, JSON.stringify(p)) }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDollar(v, dec = 2) {
  if (v == null || isNaN(v)) return '—'
  return `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`
}

function fmtPct(v) {
  if (v == null || isNaN(v)) return '—'
  return `${v.toFixed(2)}%`
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / 86400000)
}

function ExDateBadge({ dateStr }) {
  if (!dateStr) return <span className="text-slate-600 text-xs">—</span>
  const days = daysUntil(dateStr)
  const cls = days < 0   ? 'text-slate-500'
            : days <= 7  ? 'text-orange-400 font-bold'
            : days <= 30 ? 'text-yellow-400'
            : 'text-emerald-400'
  const label = days < 0 ? `${dateStr} (past)` : days === 0 ? 'Today!' : `${dateStr} (${days}d)`
  return <span className={`text-xs tabular-nums ${cls}`}>{label}</span>
}

function FreqBadge({ freq }) {
  if (!freq) return null
  const map = {
    monthly:      'bg-blue-900/40 text-blue-300',
    quarterly:    'bg-purple-900/40 text-purple-300',
    'semi-annual':'bg-yellow-900/40 text-yellow-300',
    annual:       'bg-slate-700 text-slate-400',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${map[freq] || 'bg-slate-700 text-slate-400'}`}>
      {freq}
    </span>
  )
}

function YocBadge({ yoc }) {
  if (yoc == null) return <span className="text-slate-600">—</span>
  const cls = yoc >= 5 ? 'text-emerald-400' : yoc >= 3 ? 'text-blue-400' : yoc >= 1 ? 'text-yellow-400' : 'text-red-400'
  return <span className={`font-bold tabular-nums ${cls}`}>{fmtPct(yoc)}</span>
}

// ── DRIP projection ───────────────────────────────────────────────────────────

function DripProjection({ totalAnnualIncome, avgYield, startPortfolioValue }) {
  const [monthlyAdd, setMonthlyAdd] = useState(0)

  if (!avgYield || !startPortfolioValue) return (
    <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 text-center text-slate-500 text-sm">
      Add dividend positions to see DRIP projection.
    </div>
  )

  const yieldPct = avgYield / 100
  const years    = [1, 3, 5, 10, 20]
  const rows     = years.map(yr => {
    let portVal = startPortfolioValue
    for (let y = 0; y < yr; y++) {
      const income = portVal * yieldPct
      portVal += income + monthlyAdd * 12
    }
    const income = portVal * yieldPct
    return { yr, portVal, income, monthlyIncome: income / 12 }
  })

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700 flex flex-wrap items-center gap-4">
        <h2 className="text-sm font-bold text-white">DRIP Projection</h2>
        <p className="text-xs text-slate-400">Assumes dividends reinvested + constant yield ({fmtPct(avgYield)})</p>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400">Monthly contribution</span>
          <input type="number" min="0" step="100" value={monthlyAdd}
            onChange={e => setMonthlyAdd(Number(e.target.value))}
            className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-white text-xs text-right focus:outline-none focus:border-blue-500" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-900/40">
              {['Year', 'Portfolio Value', 'Annual Income', 'Monthly Income', 'Growth'].map(h => (
                <th key={h} className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider first:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const growth = totalAnnualIncome > 0 ? ((r.income / totalAnnualIncome - 1) * 100) : 0
              return (
                <tr key={r.yr} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="px-4 py-2.5 text-white font-bold">Yr {r.yr}</td>
                  <td className="px-4 py-2.5 text-slate-300 tabular-nums text-right">{fmtDollar(r.portVal, 0)}</td>
                  <td className="px-4 py-2.5 text-emerald-400 font-bold tabular-nums text-right">{fmtDollar(r.income, 0)}</td>
                  <td className="px-4 py-2.5 text-slate-300 tabular-nums text-right">{fmtDollar(r.monthlyIncome, 0)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-right">
                    <span className="text-emerald-400 font-semibold">+{growth.toFixed(0)}%</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-xs text-slate-600 border-t border-slate-700">
        Simplified model: constant yield, no dividend growth assumed, dividends reinvested at end of each year. Not investment advice.
      </p>
    </div>
  )
}

// ── Calendar view ─────────────────────────────────────────────────────────────

function DividendCalendar({ positions, divData }) {
  const today = new Date()
  const cutoff = new Date(today.getTime() + 90 * 86400000)

  const upcoming = positions
    .map(p => {
      const d = divData[p.symbol]
      if (!d?.exDividendDate) return null
      const dt = new Date(d.exDividendDate)
      if (dt < today || dt > cutoff) return null
      const income = d.dividendRate && d.payoutFrequency
        ? p.shares * d.lastDividendValue || p.shares * (d.dividendRate / { quarterly: 4, monthly: 12, 'semi-annual': 2, annual: 1 }[d.payoutFrequency] || 4)
        : null
      return {
        symbol: p.symbol,
        name: d.name,
        date: d.exDividendDate,
        days: daysUntil(d.exDividendDate),
        income,
        freq: d.payoutFrequency,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (upcoming.length === 0) return (
    <div className="bg-slate-800 rounded-xl p-8 border border-slate-700 text-center text-slate-500 text-sm">
      No ex-dividend dates in the next 90 days for your positions.
    </div>
  )

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-700">
        <h2 className="text-sm font-bold text-white">Upcoming Ex-Dividend Dates <span className="text-slate-500 font-normal">(next 90 days)</span></h2>
      </div>
      <div className="divide-y divide-slate-700/50">
        {upcoming.map((item, i) => (
          <div key={i} className={`flex items-center gap-4 px-5 py-3 ${item.days <= 7 ? 'bg-orange-900/5' : ''}`}>
            <div className="w-24 shrink-0">
              <p className={`text-xs font-bold tabular-nums ${item.days <= 7 ? 'text-orange-400' : item.days <= 30 ? 'text-yellow-400' : 'text-slate-300'}`}>
                {item.date}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {item.days === 0 ? 'Today' : item.days === 1 ? 'Tomorrow' : `${item.days} days`}
              </p>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white text-sm">{item.symbol}</p>
              <p className="text-xs text-slate-400 truncate">{item.name}</p>
            </div>
            <FreqBadge freq={item.freq} />
            {item.income != null && (
              <p className="text-emerald-400 font-bold text-sm tabular-nums shrink-0">
                {fmtDollar(item.income)}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DividendTracker() {
  const [positions, setPositions] = useState(loadPositions)
  const [divData, setDivData]     = useState({})
  const [loading, setLoading]     = useState(false)
  const [tab, setTab]             = useState('holdings')
  const [form, setForm]           = useState({ symbol: '', shares: '', avgCost: '' })
  const [formErr, setFormErr]     = useState('')
  const [importLoading, setImportLoading] = useState(false)

  const fetchDivData = useCallback(async (syms) => {
    if (!syms.length) return
    setLoading(true)
    try {
      const r = await fetch('/api/market/dividend-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: syms }),
      })
      const data = await r.json()
      setDivData(prev => {
        const next = { ...prev }
        data.forEach(d => { next[d.symbol] = d })
        return next
      })
    } catch (e) {
      console.error('Dividend data fetch:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const syms = [...new Set(positions.map(p => p.symbol))]
    if (syms.length) fetchDivData(syms)
  }, [])

  function addPosition(e) {
    e.preventDefault()
    const sym = form.symbol.trim().toUpperCase()
    const shares = parseFloat(form.shares)
    const avgCost = parseFloat(form.avgCost)
    if (!sym) { setFormErr('Enter a ticker symbol.'); return }
    if (!shares || shares <= 0) { setFormErr('Enter valid share count.'); return }
    if (!avgCost || avgCost <= 0) { setFormErr('Enter valid average cost.'); return }
    setFormErr('')
    const next = [...positions, { id: Date.now(), symbol: sym, shares, avgCost }]
    setPositions(next)
    savePositions(next)
    setForm({ symbol: '', shares: '', avgCost: '' })
    fetchDivData([sym])
  }

  function removePosition(id) {
    const next = positions.filter(p => p.id !== id)
    setPositions(next)
    savePositions(next)
  }

  async function importFromPortfolio() {
    setImportLoading(true)
    try {
      const r = await fetch('/api/portfolio')
      const data = await r.json()
      const portPositions = Array.isArray(data) ? data : []
      const existing = new Set(positions.map(p => p.symbol))
      const toAdd = portPositions
        .filter(p => !existing.has(p.symbol))
        .map(p => ({ id: Date.now() + Math.random(), symbol: p.symbol, shares: p.shares, avgCost: p.avgCost || 0 }))
      if (toAdd.length === 0) { alert('All portfolio positions are already in the tracker.'); return }
      const next = [...positions, ...toAdd]
      setPositions(next)
      savePositions(next)
      fetchDivData(toAdd.map(p => p.symbol))
    } catch (e) {
      console.error('Import:', e)
    } finally {
      setImportLoading(false)
    }
  }

  // ── Calculations ─────────────────────────────────────────────────────────

  const enriched = positions.map(p => {
    const d = divData[p.symbol]
    const annualIncome = d?.dividendRate ? d.dividendRate * p.shares : null
    const yieldOnCost  = d?.dividendRate && p.avgCost > 0 ? (d.dividendRate / p.avgCost) * 100 : null
    const currentValue = d?.price ? d.price * p.shares : null
    return { ...p, d, annualIncome, yieldOnCost, currentValue }
  })

  const totalAnnualIncome = enriched.reduce((s, p) => s + (p.annualIncome || 0), 0)
  const monthlyIncome     = totalAnnualIncome / 12
  const payingCount       = enriched.filter(p => p.annualIncome > 0).length
  const totalPortValue    = enriched.reduce((s, p) => s + (p.currentValue || 0), 0)

  const avgYoc = (() => {
    const valid = enriched.filter(p => p.yieldOnCost != null)
    if (!valid.length) return null
    const wSum = valid.reduce((s, p) => s + p.yieldOnCost * (p.annualIncome || 1), 0)
    const wTot = valid.reduce((s, p) => s + (p.annualIncome || 1), 0)
    return wSum / wTot
  })()

  const avgCurrentYield = totalPortValue > 0 ? (totalAnnualIncome / totalPortValue) * 100 : null

  const sorted = [...enriched].sort((a, b) => (b.annualIncome || 0) - (a.annualIncome || 0))

  const TABS = [
    { id: 'holdings', label: 'Holdings' },
    { id: 'calendar', label: 'Ex-Div Calendar' },
    { id: 'drip',     label: 'DRIP Projection' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Dividend Tracker</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Track dividend income, yield on cost, and upcoming ex-dividend dates for your income portfolio.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={importFromPortfolio} disabled={importLoading}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-xl transition-colors disabled:opacity-50">
            {importLoading ? '…' : '⬇ Import from Portfolio'}
          </button>
          <button onClick={() => fetchDivData([...new Set(positions.map(p => p.symbol))])} disabled={loading}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-xl transition-colors disabled:opacity-50">
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {positions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Annual Income',   value: fmtDollar(totalAnnualIncome, 0), color: 'text-emerald-400' },
            { label: 'Monthly Income',  value: fmtDollar(monthlyIncome, 0),     color: 'text-emerald-400' },
            { label: 'Avg Yield on Cost', value: fmtPct(avgYoc),               color: avgYoc >= 3 ? 'text-emerald-400' : avgYoc >= 1 ? 'text-yellow-400' : 'text-red-400' },
            { label: 'Current Yield',   value: fmtPct(avgCurrentYield),         color: 'text-blue-400' },
          ].map(c => (
            <div key={c.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-xs text-slate-400">{c.label}</p>
              <p className={`text-xl font-bold mt-1 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Add position form */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
        <form onSubmit={addPosition} className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Ticker</label>
            <input value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
              placeholder="AAPL"
              className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono placeholder-slate-500 focus:outline-none focus:border-blue-500 uppercase" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Shares</label>
            <input type="number" min="0" step="any" value={form.shares}
              onChange={e => setForm(f => ({ ...f, shares: e.target.value }))}
              placeholder="100"
              className="w-28 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Avg Cost / Share</label>
            <input type="number" min="0" step="any" value={form.avgCost}
              onChange={e => setForm(f => ({ ...f, avgCost: e.target.value }))}
              placeholder="150.00"
              className="w-32 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500" />
          </div>
          <button type="submit"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">
            + Add
          </button>
          {formErr && <p className="text-red-400 text-xs self-center">{formErr}</p>}
        </form>
      </div>

      {/* Tabs */}
      {positions.length > 0 && (
        <>
          <div className="flex gap-1 bg-slate-800 rounded-xl p-1 w-fit">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Holdings tab */}
          {tab === 'holdings' && (
            <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-900/60">
                      {['Ticker','Shares','Price','Ann Div/Sh','Curr Yield','Yield on Cost','Annual Income','% of Income','Ex-Div Date','Frequency',''].map(h => (
                        <th key={h} className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider text-left whitespace-nowrap last:w-8">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(p => {
                      const incomePct = totalAnnualIncome > 0 && p.annualIncome ? (p.annualIncome / totalAnnualIncome * 100) : 0
                      return (
                        <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                          <td className="px-3 py-2.5">
                            <div className="font-bold text-white">{p.symbol}</div>
                            <div className="text-xs text-slate-500 truncate max-w-[120px]">{p.d?.name || '—'}</div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-300 tabular-nums">{p.shares.toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-white tabular-nums">{p.d?.price ? fmtDollar(p.d.price) : loading ? '…' : '—'}</td>
                          <td className="px-3 py-2.5 text-slate-300 tabular-nums">
                            {p.d?.dividendRate ? fmtDollar(p.d.dividendRate) : p.d && !p.d.dividendRate ? <span className="text-slate-600 text-xs">No dividend</span> : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-slate-300 tabular-nums">{fmtPct(p.d?.dividendYield)}</td>
                          <td className="px-3 py-2.5"><YocBadge yoc={p.yieldOnCost} /></td>
                          <td className="px-3 py-2.5 text-emerald-400 font-bold tabular-nums">
                            {p.annualIncome ? fmtDollar(p.annualIncome, 0) : '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            {incomePct > 0 && (
                              <div>
                                <span className="text-slate-300 text-xs tabular-nums">{incomePct.toFixed(1)}%</span>
                                <div className="w-16 bg-slate-700 rounded-full h-1.5 mt-1">
                                  <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, incomePct)}%` }} />
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5"><ExDateBadge dateStr={p.d?.exDividendDate} /></td>
                          <td className="px-3 py-2.5"><FreqBadge freq={p.d?.payoutFrequency} /></td>
                          <td className="px-3 py-2.5">
                            <button onClick={() => removePosition(p.id)} className="text-slate-600 hover:text-red-400 transition-colors text-xs">✕</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {totalAnnualIncome > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-slate-600 bg-slate-900/40">
                        <td colSpan={6} className="px-3 py-2.5 text-xs font-bold text-slate-400 uppercase">Total</td>
                        <td className="px-3 py-2.5 text-emerald-400 font-bold tabular-nums">{fmtDollar(totalAnnualIncome, 0)}</td>
                        <td colSpan={4} className="px-3 py-2.5 text-xs text-slate-500">{fmtDollar(monthlyIncome, 0)}/mo · {payingCount} of {positions.length} positions paying</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* Calendar tab */}
          {tab === 'calendar' && <DividendCalendar positions={positions} divData={divData} />}

          {/* DRIP tab */}
          {tab === 'drip' && (
            <DripProjection
              totalAnnualIncome={totalAnnualIncome}
              avgYield={avgCurrentYield}
              startPortfolioValue={totalPortValue || totalAnnualIncome / ((avgCurrentYield || 3) / 100)}
            />
          )}
        </>
      )}

      {positions.length === 0 && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-10 text-center">
          <p className="text-slate-300 font-semibold text-lg mb-2">No positions yet</p>
          <p className="text-slate-400 text-sm max-w-sm mx-auto">
            Add dividend-paying stocks using the form above, or click <span className="text-blue-400">⬇ Import from Portfolio</span> to pull in your existing holdings.
          </p>
        </div>
      )}

      {/* Legend */}
      {positions.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4 text-xs text-slate-500 bg-slate-800/40 rounded-xl p-4 border border-slate-700/40">
          <div>
            <p className="text-slate-300 font-semibold mb-1">Yield on Cost</p>
            <p>Calculated as annual dividend per share ÷ your average cost. This is more meaningful than current yield because it shows your actual income rate on capital deployed. Green ≥5%, Blue 3–5%, Yellow 1–3%, Red &lt;1%.</p>
          </div>
          <div>
            <p className="text-slate-300 font-semibold mb-1">Ex-Dividend Date</p>
            <p>You must own shares <strong className="text-slate-300">before</strong> the ex-div date to receive that period's payment. The payment typically arrives 2–4 weeks after the ex-date. Orange = within 7 days, Yellow = within 30 days.</p>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-600">
        Dividend data from Yahoo Finance via yfinance. Cached 6 hours. Positions stored in your browser only. For informational purposes only.
      </p>
    </div>
  )
}
