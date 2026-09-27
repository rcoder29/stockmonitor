import { useState } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—'
  return (n * 100).toFixed(decimals) + '%'
}

// ── Fan chart (probability cone) ───────────────────────────────────────────────
// Same band/median SVG approach as MonteCarlo.jsx's FanChart, adapted to a
// 0-12 month price horizon instead of a multi-decade portfolio-balance horizon.

function ProjectionFanChart({ projection }) {
  if (!projection || projection.length < 2) return null
  const W = 600, H = 220
  const months = projection.length - 1

  const allVals = projection.flatMap(p => [p.p10, p.p90])
  const minVal = Math.min(...allVals) * 0.97
  const maxVal = Math.max(...allVals) * 1.03
  const span = maxVal - minVal || 1

  const xs = i => (i / months) * W
  const ys = v => H - ((v - minVal) / span) * (H - 24) - 4

  const makePath = key =>
    projection.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(p[key]).toFixed(1)}`).join(' ')

  const bandPath = (loKey, hiKey) => [
    ...projection.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(p[loKey]).toFixed(1)}`),
    ...[...projection].reverse().map((p, i) => `L ${xs(projection.length - 1 - i).toFixed(1)} ${ys(p[hiKey]).toFixed(1)}`),
    'Z',
  ].join(' ')

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map(f => minVal + span * f)
  const labelMonths = [0, 3, 6, 9, 12].filter(m => m <= months)
  const startPrice = projection[0].p50

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 240 }}>
      {gridVals.map(v => (
        <g key={v}>
          <line x1={0} y1={ys(v)} x2={W} y2={ys(v)} stroke="#1f2937" strokeWidth="1" />
          <text x={2} y={ys(v) - 2} fontSize="8" fill="#4b5563">{fmtMoney(v)}</text>
        </g>
      ))}
      <path d={bandPath('p10', 'p90')} fill="#3b82f6" opacity="0.08" />
      <path d={bandPath('p25', 'p75')} fill="#3b82f6" opacity="0.18" />
      <path d={makePath('p50')} fill="none" stroke="#60a5fa" strokeWidth="2" />
      <line x1={0} y1={ys(startPrice)} x2={W} y2={ys(startPrice)} stroke="#9ca3af" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
      {labelMonths.map(m => (
        <text key={m} x={xs(m)} y={H - 2} textAnchor="middle" fontSize="9" fill="#6b7280">
          {m === 0 ? 'Today' : `${m}mo`}
        </text>
      ))}
    </svg>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function Badge({ label, value, tone = 'gray' }) {
  const tones = {
    gray:    'bg-gray-800 text-gray-300 border-gray-700',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    amber:   'bg-amber-500/10 text-amber-400 border-amber-500/30',
    red:     'bg-red-500/10 text-red-400 border-red-500/30',
    sky:     'bg-sky-500/10 text-sky-400 border-sky-500/30',
  }
  return (
    <div className={`px-3 py-2 rounded-lg border text-xs ${tones[tone]}`}>
      <div className="uppercase tracking-wider text-[9px] opacity-70 mb-0.5">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PriceProjection() {
  const [symbolInput, setSymbolInput] = useState('')
  const [lookupSym,   setLookupSym]   = useState('')
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)

  async function handleLookup() {
    const sym = symbolInput.trim().toUpperCase()
    if (!sym) return
    setLookupSym(sym)
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const res = await fetch(`/api/price-projection/${sym}`)
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      setData(json)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const inputs = data?.inputs
  const proj12 = data?.projection?.[data.projection.length - 1]
  const proj6  = data?.projection?.find(p => p.month === 6)
  const proj3  = data?.projection?.find(p => p.month === 3)

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      {/* Title */}
      <div>
        <h2 className="text-lg font-semibold text-gray-100">Price Projection</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          A 1-year-forward price cone built from market-implied inputs — options-implied volatility,
          the risk-free rate, VIX regime, and the issuer's corporate-bond credit spread as a CDS proxy.
        </p>
      </div>

      {/* Symbol lookup */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        <div className="flex gap-2">
          <input
            value={symbolInput}
            onChange={e => setSymbolInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleLookup()}
            placeholder="e.g. AAPL, SPY"
            className="flex-1 bg-gray-800 border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded-lg
                       focus:outline-none focus:border-emerald-500 placeholder-gray-600"
          />
          <button
            onClick={handleLookup}
            disabled={loading}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500
                       text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'Loading…' : 'Project'}
          </button>
        </div>

        {error && (
          <div className="mt-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {data && !error && (
        <>
          {/* Header */}
          <div className="flex items-baseline justify-between">
            <div>
              <span className="text-xl font-bold text-gray-100">{data.symbol}</span>
              <span className="text-gray-500 text-sm ml-2">as of {data.asOf}</span>
            </div>
            <span className="text-xl font-mono text-gray-100">{fmtMoney(data.price)}</span>
          </div>

          {/* Input badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Badge label="Risk-free (1yr)" value={inputs.riskFreeRate != null ? fmtPct(inputs.riskFreeRate, 2) : '—'} />
            <Badge label="Dividend Yield" value={fmtPct(inputs.dividendYield, 2)} />
            <Badge
              label="Vol Source"
              value={inputs.volSource === 'options' ? 'Options-implied' : 'Historical (fallback)'}
              tone={inputs.volSource === 'options' ? 'sky' : 'amber'}
            />
            <Badge
              label="VIX Regime"
              value={inputs.vix ? `${inputs.vix.current} (${inputs.vix.regimeMultiplier}×)` : '—'}
              tone={inputs.vix && inputs.vix.regimeMultiplier > 1.05 ? 'amber' : 'gray'}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Badge
              label="VIX Term Structure"
              value={inputs.vix?.termStructure ?? '—'}
              tone={inputs.vix?.termStructure === 'backwardation' ? 'red' : 'gray'}
            />
            <Badge
              label="Credit Spread (CDS proxy)"
              value={inputs.creditSpread ? `${inputs.creditSpread.bps} bps` : 'Not available'}
              tone={inputs.creditSpread && inputs.creditSpread.bps > 300 ? 'red' : 'gray'}
            />
            {inputs.volCurveExtrapolated && (
              <Badge label="Note" value="Vol curve extrapolated past longest expiry" tone="amber" />
            )}
          </div>

          {/* Fan chart */}
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              12-Month Price Cone (p10 / p25 / median / p75 / p90)
            </div>
            <ProjectionFanChart projection={data.projection} />
          </div>

          {/* Headline horizons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[['3 Months', proj3], ['6 Months', proj6], ['12 Months', proj12]].map(([label, p]) => (
              <div key={label} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{label}</div>
                {p ? (
                  <>
                    <div className="text-lg font-mono text-gray-100">{fmtMoney(p.p50)} <span className="text-xs text-gray-500">median</span></div>
                    <div className="text-xs text-gray-500 mt-1">
                      {fmtMoney(p.p10)} – {fmtMoney(p.p90)} <span className="text-gray-600">(p10–p90)</span>
                    </div>
                    <div className="text-[11px] text-gray-600 mt-0.5">
                      {fmtMoney(p.p25)} – {fmtMoney(p.p75)} (p25–p75)
                    </div>
                  </>
                ) : <div className="text-gray-600 text-sm">—</div>}
              </div>
            ))}
          </div>

          {/* Full table */}
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left px-3 py-2 font-medium">Month</th>
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-right px-3 py-2 font-medium">p10</th>
                  <th className="text-right px-3 py-2 font-medium">p25</th>
                  <th className="text-right px-3 py-2 font-medium">Median</th>
                  <th className="text-right px-3 py-2 font-medium">p75</th>
                  <th className="text-right px-3 py-2 font-medium">p90</th>
                </tr>
              </thead>
              <tbody>
                {data.projection.map(p => (
                  <tr key={p.month} className="border-b border-gray-800/60 last:border-0">
                    <td className="px-3 py-1.5 text-gray-300">{p.month === 0 ? 'Today' : p.month}</td>
                    <td className="px-3 py-1.5 text-gray-500">{p.date}</td>
                    <td className="px-3 py-1.5 text-right text-red-400/80 font-mono">{fmtMoney(p.p10)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-400 font-mono">{fmtMoney(p.p25)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-100 font-mono font-semibold">{fmtMoney(p.p50)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-400 font-mono">{fmtMoney(p.p75)}</td>
                    <td className="px-3 py-1.5 text-right text-emerald-400/80 font-mono">{fmtMoney(p.p90)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Implied vol term structure */}
          {inputs.impliedVolCurve?.length > 0 && (
            <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Options-Implied Volatility Term Structure (ATM)
              </div>
              <div className="flex flex-wrap gap-2">
                {inputs.impliedVolCurve.map(pt => (
                  <div key={pt.expiry} className="px-2.5 py-1.5 bg-gray-800/60 rounded-lg text-[11px]">
                    <span className="text-gray-500">{pt.daysOut}d</span>{' '}
                    <span className="text-gray-300 font-mono">{fmtPct(pt.atmIv, 1)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Methodology note */}
          <div className="text-[11px] text-gray-600 bg-gray-900/40 border border-gray-800/60 rounded-xl px-4 py-3 leading-relaxed">
            <strong className="text-gray-500">Model:</strong> {data.methodologyNote}
          </div>
        </>
      )}

      {!data && !error && !loading && (
        <div className="text-center text-gray-600 text-sm py-12">
          Enter a ticker to project its 1-year-forward price range.
        </div>
      )}
    </div>
  )
}
