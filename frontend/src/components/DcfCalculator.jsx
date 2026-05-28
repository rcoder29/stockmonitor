import { useState, useEffect, useMemo } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtPct(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—'
  return (n * 100).toFixed(decimals) + '%'
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

// ── Input row ─────────────────────────────────────────────────────────────────

function InputRow({ label, hint, value, onChange, min, max, step = 0.01, prefix, suffix }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-gray-800/60 last:border-0">
      <div className="min-w-0">
        <div className="text-sm text-gray-200 leading-tight">{label}</div>
        {hint && <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {prefix && <span className="text-gray-400 text-sm">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          min={min}
          max={max}
          step={step}
          className="w-24 bg-gray-800 border border-gray-700 text-gray-100 text-sm text-right px-2 py-1 rounded-lg
                     focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30
                     [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && <span className="text-gray-400 text-sm w-4">{suffix}</span>}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DcfCalculator() {
  const [symbolInput, setSymbolInput]   = useState('')
  const [lookupSym,   setLookupSym]     = useState('')
  const [prefill,     setPrefill]       = useState(null)
  const [loading,     setLoading]       = useState(false)
  const [error,       setError]         = useState(null)

  // Form fields
  const [eps,            setEps]            = useState('')
  const [growthPct,      setGrowthPct]      = useState('')   // displayed as %
  const [terminalPct,    setTerminalPct]    = useState('2.5')
  const [discountPct,    setDiscountPct]    = useState('10')
  const [marginSafetyPct, setMarginSafetyPct] = useState('25')
  const [years,          setYears]          = useState('10')
  const [currentPrice,   setCurrentPrice]   = useState('')

  // ── Fetch pre-fill data ──────────────────────────────────────────────────────

  async function handleLookup() {
    const sym = symbolInput.trim().toUpperCase()
    if (!sym) return
    setLookupSym(sym)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dcf/prefill/${sym}`)
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setPrefill(data)

      if (data.eps_ttm != null) setEps(String(data.eps_ttm))

      if (data.growth_rate != null) {
        // API returns decimal (e.g. 0.15 = 15%); show as %
        setGrowthPct(String(+(data.growth_rate * 100).toFixed(1)))
      }

      if (data.price != null) setCurrentPrice(String(data.price))

      // WACC heuristic: 8% + beta × 5%, capped at 14%
      if (data.beta != null) {
        const wacc = clamp(8 + data.beta * 5, 6, 14)
        setDiscountPct(String(+wacc.toFixed(1)))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── DCF calculations (client-side, reactive) ─────────────────────────────────

  const results = useMemo(() => {
    const epsVal      = parseFloat(eps)
    const growthRate  = parseFloat(growthPct) / 100
    const termRate    = parseFloat(terminalPct) / 100
    const discRate    = parseFloat(discountPct) / 100
    const safetyRate  = parseFloat(marginSafetyPct) / 100
    const projYears   = Math.min(Math.max(parseInt(years) || 10, 1), 30)
    const price       = parseFloat(currentPrice)

    if (!epsVal || isNaN(growthRate) || isNaN(termRate) || isNaN(discRate) || discRate <= termRate) {
      return null
    }

    const rows = []
    let sumPV = 0
    for (let n = 1; n <= projYears; n++) {
      const epsN = epsVal * Math.pow(1 + growthRate, n)
      const pv   = epsN / Math.pow(1 + discRate, n)
      sumPV += pv
      rows.push({ year: n, eps: epsN, pv })
    }

    const epsLast = epsVal * Math.pow(1 + growthRate, projYears)
    const tv      = epsLast * (1 + termRate) / (discRate - termRate)
    const pvTV    = tv / Math.pow(1 + discRate, projYears)
    const intrinsic = sumPV + pvTV
    const buyBelow  = intrinsic * (1 - safetyRate)

    let upside = null
    let verdict = null
    if (!isNaN(price) && price > 0) {
      upside = (intrinsic / price - 1) * 100
      const margin = (intrinsic - price) / intrinsic
      if (margin > 0.15)       verdict = 'undervalued'
      else if (margin < -0.15) verdict = 'overvalued'
      else                     verdict = 'fairly-valued'
    }

    return { rows, sumPV, tv, pvTV, intrinsic, buyBelow, upside, verdict }
  }, [eps, growthPct, terminalPct, discountPct, marginSafetyPct, years, currentPrice])

  // ── Verdict styling ──────────────────────────────────────────────────────────

  const verdictConfig = {
    'undervalued':  { label: 'Undervalued',   bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
    'fairly-valued':{ label: 'Fairly Valued', bg: 'bg-amber-500/15',   text: 'text-amber-400',   border: 'border-amber-500/30'   },
    'overvalued':   { label: 'Overvalued',    bg: 'bg-red-500/15',     text: 'text-red-400',     border: 'border-red-500/30'     },
  }

  const intrinsicColor = results && !isNaN(parseFloat(currentPrice))
    ? results.intrinsic > parseFloat(currentPrice) ? 'text-emerald-400' : 'text-red-400'
    : 'text-sky-400'

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      {/* Title */}
      <div>
        <h2 className="text-lg font-semibold text-gray-100">DCF Valuation Calculator</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Discounted cash flow model using EPS projections. All inputs are editable — pre-fill from any ticker.
        </p>
      </div>

      {/* Symbol lookup */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Pre-fill from Ticker</div>
        <div className="flex gap-2">
          <input
            value={symbolInput}
            onChange={e => setSymbolInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleLookup()}
            placeholder="e.g. AAPL"
            className="flex-1 bg-gray-800 border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded-lg
                       focus:outline-none focus:border-emerald-500 placeholder-gray-600"
          />
          <button
            onClick={handleLookup}
            disabled={loading}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500
                       text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'Loading…' : 'Fetch Data'}
          </button>
        </div>

        {error && (
          <div className="mt-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {prefill && !error && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Company', value: prefill.name },
              { label: 'EPS (TTM)', value: prefill.eps_ttm != null ? `$${fmt(prefill.eps_ttm)}` : '—' },
              { label: 'Beta', value: prefill.beta != null ? fmt(prefill.beta) : '—' },
              { label: 'Price', value: prefill.price != null ? `$${fmt(prefill.price)}` : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-800/50 rounded-lg px-3 py-2">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
                <div className="text-sm text-gray-200 font-medium mt-0.5 truncate">{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Inputs */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Model Inputs</div>

          <InputRow
            label="EPS (TTM)"
            hint="Trailing 12-month earnings per share"
            value={eps}
            onChange={setEps}
            step={0.01}
            prefix="$"
          />
          <InputRow
            label="EPS Growth Rate (5yr)"
            hint="Expected annual EPS growth"
            value={growthPct}
            onChange={setGrowthPct}
            step={0.5}
            suffix="%"
          />
          <InputRow
            label="Terminal Growth Rate"
            hint="Long-run perpetual growth (2–3% typical)"
            value={terminalPct}
            onChange={setTerminalPct}
            step={0.1}
            min={0}
            max={10}
            suffix="%"
          />
          <InputRow
            label="Discount Rate (WACC)"
            hint="Required rate of return"
            value={discountPct}
            onChange={setDiscountPct}
            step={0.1}
            min={1}
            max={30}
            suffix="%"
          />
          <InputRow
            label="Margin of Safety"
            hint="Buy below intrinsic by this %"
            value={marginSafetyPct}
            onChange={setMarginSafetyPct}
            step={1}
            min={0}
            max={60}
            suffix="%"
          />
          <InputRow
            label="Projection Years"
            hint="Number of years to project EPS"
            value={years}
            onChange={setYears}
            step={1}
            min={1}
            max={30}
          />
          <InputRow
            label="Current Market Price"
            hint="Used to compute upside / verdict"
            value={currentPrice}
            onChange={setCurrentPrice}
            step={0.01}
            prefix="$"
          />

          {parseFloat(discountPct) <= parseFloat(terminalPct) && (
            <div className="mt-3 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              Discount rate must exceed terminal growth rate for the model to be valid.
            </div>
          )}
        </div>

        {/* Results */}
        <div className="space-y-4">
          {results ? (
            <>
              {/* Key metrics */}
              <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Valuation Output</div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* Intrinsic value */}
                  <div className="col-span-2 bg-gray-800/60 rounded-xl p-3 text-center">
                    <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">Intrinsic Value</div>
                    <div className={`text-3xl font-bold ${intrinsicColor}`}>
                      ${fmt(results.intrinsic)}
                    </div>
                    {results.verdict && (
                      <div className={`inline-flex items-center mt-2 px-3 py-0.5 rounded-full text-xs font-semibold border
                        ${verdictConfig[results.verdict].bg}
                        ${verdictConfig[results.verdict].text}
                        ${verdictConfig[results.verdict].border}`}>
                        {verdictConfig[results.verdict].label}
                      </div>
                    )}
                  </div>

                  <div className="bg-gray-800/40 rounded-xl p-3">
                    <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">Buy Below</div>
                    <div className="text-xl font-semibold text-sky-400">${fmt(results.buyBelow)}</div>
                    <div className="text-[10px] text-gray-600 mt-0.5">{marginSafetyPct}% margin of safety</div>
                  </div>

                  <div className="bg-gray-800/40 rounded-xl p-3">
                    <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">Upside / Downside</div>
                    {results.upside != null ? (
                      <>
                        <div className={`text-xl font-semibold ${results.upside >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {results.upside >= 0 ? '+' : ''}{fmt(results.upside, 1)}%
                        </div>
                        <div className="text-[10px] text-gray-600 mt-0.5">vs ${fmt(parseFloat(currentPrice))} market</div>
                      </>
                    ) : (
                      <div className="text-sm text-gray-600">Enter market price</div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex justify-between text-gray-500">
                    <span>PV of EPS</span>
                    <span className="text-gray-300">${fmt(results.sumPV)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>Terminal Value</span>
                    <span className="text-gray-300">${fmt(results.tv)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>PV of TV</span>
                    <span className="text-gray-300">${fmt(results.pvTV)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>TV share</span>
                    <span className="text-gray-300">{fmt(results.pvTV / results.intrinsic * 100, 0)}%</span>
                  </div>
                </div>
              </div>

              {/* Projection table */}
              <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">EPS Projection</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left pb-2 font-medium">Year</th>
                        <th className="text-right pb-2 font-medium">EPS</th>
                        <th className="text-right pb-2 font-medium">PV of EPS</th>
                        <th className="text-right pb-2 font-medium hidden sm:table-cell">Cumul. PV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.rows.map((row, i) => {
                        const cumul = results.rows.slice(0, i + 1).reduce((s, r) => s + r.pv, 0)
                        const isLast = i === results.rows.length - 1
                        return (
                          <tr
                            key={row.year}
                            className={`border-b border-gray-800/40 ${isLast ? 'text-gray-200 font-medium' : 'text-gray-400'}`}
                          >
                            <td className="py-1.5">{row.year}</td>
                            <td className="text-right">${fmt(row.eps)}</td>
                            <td className="text-right">${fmt(row.pv)}</td>
                            <td className="text-right hidden sm:table-cell text-gray-500">${fmt(cumul)}</td>
                          </tr>
                        )
                      })}
                      <tr className="text-gray-400 border-b border-gray-800/40">
                        <td className="py-1.5 text-gray-500">TV</td>
                        <td className="text-right text-gray-500">—</td>
                        <td className="text-right">${fmt(results.pvTV)}</td>
                        <td className="text-right hidden sm:table-cell text-gray-500">—</td>
                      </tr>
                      <tr className="text-emerald-400 font-semibold">
                        <td className="py-1.5">Total</td>
                        <td />
                        <td className="text-right">${fmt(results.intrinsic)}</td>
                        <td className="hidden sm:table-cell" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-8 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <div>
                <div className="text-sm text-gray-400 font-medium">Enter inputs to see valuation</div>
                <div className="text-xs text-gray-600 mt-1">
                  Fetch a ticker above or fill in EPS and growth rate manually.<br />
                  Discount rate must be higher than terminal growth rate.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Methodology note */}
      <div className="text-[11px] text-gray-600 bg-gray-900/40 border border-gray-800/60 rounded-xl px-4 py-3 leading-relaxed">
        <strong className="text-gray-500">Model:</strong> Year N EPS = EPS &times; (1 + g)^N &nbsp;&bull;&nbsp;
        Terminal value = EPS<sub>N</sub> &times; (1 + g<sub>t</sub>) / (r - g<sub>t</sub>) &nbsp;&bull;&nbsp;
        PV discounted at WACC. Intrinsic value = &sum; PV(EPS) + PV(TV). &nbsp;&bull;&nbsp;
        This is a simplified model — not personalised financial advice.
      </div>
    </div>
  )
}
