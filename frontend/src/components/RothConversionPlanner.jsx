import { useState, useMemo } from 'react'

// ── 2025 Federal Tax Brackets ─────────────────────────────────────────────────
const TAX = {
  mfj: {
    stdDed: 30000,
    brackets: [
      { rate: 0.10, cap: 23850 },
      { rate: 0.12, cap: 96950 },
      { rate: 0.22, cap: 206700 },
      { rate: 0.24, cap: 394600 },
      { rate: 0.32, cap: 501050 },
      { rate: 0.35, cap: 751600 },
      { rate: 0.37, cap: Infinity },
    ],
  },
  single: {
    stdDed: 15000,
    brackets: [
      { rate: 0.10, cap: 11925 },
      { rate: 0.12, cap: 48475 },
      { rate: 0.22, cap: 103350 },
      { rate: 0.24, cap: 197300 },
      { rate: 0.32, cap: 250525 },
      { rate: 0.35, cap: 626350 },
      { rate: 0.37, cap: Infinity },
    ],
  },
}

// IRS Uniform Lifetime Table — life expectancy factors for RMD calculation
const RMD_TABLE = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7,
  77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2,
}

function federalTax(taxableIncome, filing) {
  const { brackets } = TAX[filing]
  let tax = 0, rem = Math.max(0, taxableIncome), prev = 0
  for (const { rate, cap } of brackets) {
    const band = Math.min(rem, cap - prev)
    tax += band * rate
    rem -= band
    prev = cap
    if (rem <= 0) break
  }
  return tax
}

// Marginal tax on the conversion amount alone (given other income already in play)
function taxOnConversion(conversion, otherIncome, filing) {
  const { stdDed } = TAX[filing]
  const baseTaxable  = Math.max(0, otherIncome - stdDed)
  const totalTaxable = Math.max(0, otherIncome + conversion - stdDed)
  return federalTax(totalTaxable, filing) - federalTax(baseTaxable, filing)
}

// Gross income ceiling for a target bracket (taxable bracket cap + standard deduction)
function bracketCeiling(targetRate, filing) {
  const { stdDed, brackets } = TAX[filing]
  const br = brackets.find(b => b.rate === targetRate)
  return br ? br.cap + stdDed : 0
}

// Which bracket a given gross income falls into
function currentBracket(grossIncome, filing) {
  const { stdDed, brackets } = TAX[filing]
  const taxable = Math.max(0, grossIncome - stdDed)
  for (const { rate, cap } of brackets) {
    if (taxable <= cap) return (rate * 100).toFixed(0) + '%'
  }
  return '37%'
}

// ── Sub-components ────────────────────────────────────────────────────────────
function InputRow({ label, value, onChange, min, max, step = 1, prefix = '', suffix = '', note }) {
  return (
    <div className="py-2 border-b border-gray-800/60">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label className="text-xs text-gray-400">{label}</label>
          {note && <div className="text-[10px] text-gray-600 mt-0.5">{note}</div>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {prefix && <span className="text-gray-500 text-xs">{prefix}</span>}
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={e => onChange(Number(e.target.value))}
            className="w-28 bg-gray-800 border border-gray-700 text-white text-xs text-right px-2 py-1.5 rounded focus:outline-none focus:border-emerald-500"
          />
          {suffix && <span className="text-gray-500 text-xs">{suffix}</span>}
        </div>
      </div>
    </div>
  )
}

function BalanceChart({ chartData, currentAge }) {
  if (chartData.length < 2) return null
  const W = 600; const H = 180
  const maxBal = Math.max(...chartData.map(d => d.balNo)) * 1.1
  const minAge = chartData[0].age
  const maxAge = chartData[chartData.length - 1].age
  const xs = a => ((a - minAge) / (maxAge - minAge)) * W
  const ys = v => H - (v / maxBal) * (H - 16)

  const noPath   = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xs(d.age).toFixed(1)} ${ys(d.balNo).toFixed(1)}`).join(' ')
  const withPath = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xs(d.age).toFixed(1)} ${ys(d.balWith).toFixed(1)}`).join(' ')

  const markers = [
    { age: 65,  label: 'Medicare',  color: '#10b981' },
    { age: 73,  label: 'RMDs',      color: '#f59e0b' },
  ].filter(m => m.age > minAge && m.age <= maxAge)

  const labelAges = [minAge, Math.round((minAge + maxAge) / 2), maxAge]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 180 }}>
      <defs>
        <linearGradient id="noConvGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6b7280" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#6b7280" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={0} y1={ys(maxBal * f)} x2={W} y2={ys(maxBal * f)} stroke="#1f2937" strokeWidth="1" />
      ))}
      {markers.map(({ age, label, color }) => (
        <g key={age}>
          <line x1={xs(age)} y1={0} x2={xs(age)} y2={H - 12} stroke={color} strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
          <text x={xs(age) + 3} y={13} fontSize="8" fill={color} opacity="0.8">{label}</text>
        </g>
      ))}
      <path d={noPath}   fill="none" stroke="#4b5563" strokeWidth="1.5" strokeDasharray="6 3" />
      <path d={withPath} fill="none" stroke="#3b82f6" strokeWidth="2" />
      {labelAges.map(a => {
        const d = chartData.find(r => r.age === a)
        return d ? (
          <text key={a} x={xs(a)} y={H} textAnchor="middle" fontSize="9" fill="#6b7280">{a}</text>
        ) : null
      })}
      <text x={W - 3} y={ys(chartData[chartData.length - 1].balNo) - 5} textAnchor="end" fontSize="8" fill="#4b5563">No conversion</text>
      <text x={W - 3} y={ys(chartData[chartData.length - 1].balWith) + 11} textAnchor="end" fontSize="8" fill="#3b82f6">With conversion</text>
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
const BRACKET_OPTIONS = [
  { rate: 0.12, label: '12% bracket', desc: 'Conservative — best for ACA subsidy preservation' },
  { rate: 0.22, label: '22% bracket', desc: 'Balanced — most common recommendation' },
  { rate: 0.24, label: '24% bracket', desc: 'Aggressive — for very large Traditional balances' },
]

export default function RothConversionPlanner() {
  const [currentAge,   setCurrentAge]   = useState(55)
  const [filing,       setFiling]       = useState('mfj')
  const [tradBalance,  setTradBalance]  = useState(600000)
  const [otherIncome,  setOtherIncome]  = useState(0)
  const [targetRate,   setTargetRate]   = useState(0.22)
  const [growthRate,   setGrowthRate]   = useState(7)
  const [futureRate,   setFutureRate]   = useState(22)  // estimated future bracket at 73

  const results = useMemo(() => {
    const { stdDed } = TAX[filing]
    const ceiling  = bracketCeiling(targetRate, filing)
    const convRoom = Math.max(0, ceiling - otherIncome)
    const noRoom   = convRoom <= 0

    // ── Year-by-year conversion plan ──────────────────────────────────────────
    const rows = []
    let bal      = tradBalance
    let cumConv  = 0
    let cumTax   = 0

    for (let yr = 0; yr < 15; yr++) {
      const age = currentAge + yr
      if (age >= 65 || bal <= 0) break

      const conversion = Math.min(convRoom, bal)
      const tax        = taxOnConversion(conversion, otherIncome, filing)
      const effRate    = conversion > 0 ? tax / conversion : 0
      const endBal     = (bal - conversion) * (1 + growthRate / 100)

      cumConv += conversion
      cumTax  += tax

      rows.push({ age, year: new Date().getFullYear() + yr, beginBal: bal, conversion, tax, effRate, endBal, cumConv, cumTax })
      bal = Math.max(0, endBal)
    }

    const convEndAge = currentAge + rows.length  // age when conversions stop (65 or balance gone)
    const convEndBal = bal

    // ── Project both scenarios to age 73 ─────────────────────────────────────
    const RMD_START = 73
    const yearsTo73 = Math.max(0, RMD_START - convEndAge)
    const balAt73With = convEndBal * (1 + growthRate / 100) ** yearsTo73

    const yearsTo73NoConv = Math.max(0, RMD_START - currentAge)
    const balAt73No = tradBalance * (1 + growthRate / 100) ** yearsTo73NoConv

    // RMDs at age 73
    const rmdFactor  = RMD_TABLE[73]
    const rmdWith    = balAt73With  / rmdFactor
    const rmdWithout = balAt73No    / rmdFactor

    // Tax saved annually at 73 (using user's estimated future rate)
    const rmdDiff         = Math.max(0, rmdWithout - rmdWith)
    const annualTaxSavings = rmdDiff * (futureRate / 100)

    // Lifetime tax savings (20-year RMD window)
    const lifetimeTaxSavings = annualTaxSavings * 20

    // ── Chart data: both scenarios from currentAge to age 75 ─────────────────
    const chartData = []
    let cWith = tradBalance
    let cNo   = tradBalance
    const chartEnd = Math.max(75, currentAge + 1)

    for (let yr = 0; yr <= chartEnd - currentAge; yr++) {
      const age = currentAge + yr
      chartData.push({ age, balWith: cWith, balNo: cNo })

      const conv  = age < 65 && cWith > 0 ? Math.min(convRoom, cWith) : 0
      cWith = Math.max(0, (cWith - conv) * (1 + growthRate / 100))
      cNo   = cNo * (1 + growthRate / 100)
    }

    // Gross income with conversion at target rate
    const bracketGrossIncome = otherIncome + convRoom

    return {
      convRoom,
      noRoom,
      ceiling,
      rows,
      cumConv,
      cumTax,
      convEndAge,
      convEndBal,
      balAt73With,
      balAt73No,
      rmdWith,
      rmdWithout,
      rmdDiff,
      annualTaxSavings,
      lifetimeTaxSavings,
      effRateOverall: cumConv > 0 ? cumTax / cumConv : 0,
      chartData,
      yearsConverting: rows.length,
      bracketGrossIncome,
      bracketStr: currentBracket(bracketGrossIncome, filing),
    }
  }, [currentAge, filing, tradBalance, otherIncome, targetRate, growthRate, futureRate])

  const fmt  = v => `$${Math.round(v).toLocaleString()}`
  const fmtK = v => {
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
    if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
    return `$${v.toFixed(0)}`
  }
  const fmtMo = v => `$${Math.round(v / 12).toLocaleString()}/mo`

  return (
    <div className="p-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-white">Roth Conversion Planner</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Optimize Traditional IRA → Roth conversions in the low-income window between early retirement and Medicare / RMDs
        </p>
      </div>

      {/* Filing + bracket selector */}
      <div className="flex flex-wrap gap-4 mb-5">
        <div>
          <span className="text-xs text-gray-500 mr-2">Filing status</span>
          {[{ id: 'mfj', label: 'Married (MFJ)' }, { id: 'single', label: 'Single' }].map(f => (
            <button key={f.id} onClick={() => setFiling(f.id)}
              className={`mr-1 px-3 py-1.5 rounded text-xs transition-colors ${filing === f.id ? 'bg-emerald-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div>
          <span className="text-xs text-gray-500 mr-2">Convert up to</span>
          {BRACKET_OPTIONS.map(opt => (
            <button key={opt.rate} onClick={() => setTargetRate(opt.rate)}
              title={opt.desc}
              className={`mr-1 px-3 py-1.5 rounded text-xs transition-colors ${targetRate === opt.rate ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Your Numbers</h3>
          <InputRow label="Current Age" value={currentAge} onChange={setCurrentAge} min={45} max={64} />
          <InputRow label="Traditional IRA / 401k Balance" value={tradBalance} onChange={setTradBalance} min={0} max={5000000} step={10000} prefix="$" note="Combined pre-tax retirement account balance" />
          <InputRow label="Other Annual Income" value={otherIncome} onChange={setOtherIncome} min={0} max={500000} step={1000} prefix="$" note="Dividends, interest, SS, pension, part-time work — excluding IRA" />
          <InputRow label="Expected Annual Return" value={growthRate} onChange={setGrowthRate} min={1} max={15} step={0.5} suffix="%" />
          <InputRow label="Estimated Tax Bracket at 73+" value={futureRate} onChange={setFutureRate} min={10} max={37} suffix="%" note="Your expected rate when RMDs + SS are fully taxed" />

          {/* Bracket info box */}
          <div className="mt-4 p-3 rounded bg-gray-800/50 border border-gray-700/50 text-xs space-y-1">
            <div className="text-gray-400 font-medium mb-1.5">2025 bracket ceiling — {filing === 'mfj' ? 'Married (MFJ)' : 'Single'}</div>
            {[
              { rate: 0.12, label: '12% top' },
              { rate: 0.22, label: '22% top' },
              { rate: 0.24, label: '24% top' },
            ].map(({ rate, label }) => {
              const ceil = bracketCeiling(rate, filing)
              const room = Math.max(0, ceil - otherIncome)
              const active = rate === targetRate
              return (
                <div key={rate} className={`flex justify-between ${active ? 'text-blue-400' : 'text-gray-500'}`}>
                  <span>{label} (gross income)</span>
                  <span className="font-medium">{fmt(ceil)} → {fmt(room)} room</span>
                </div>
              )
            })}
            <div className="pt-1.5 border-t border-gray-700/50 text-gray-600 text-[10px]">
              Std deduction {filing === 'mfj' ? '$30,000' : '$15,000'} already subtracted from bracket cap
            </div>
          </div>
        </div>

        {/* Results summary */}
        <div className="space-y-3">
          {results.noRoom ? (
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-4 text-xs text-amber-400">
              Your other income of {fmt(otherIncome)} already reaches or exceeds the {(targetRate * 100).toFixed(0)}% bracket ceiling of {fmt(results.ceiling)}.
              No room for conversions at this bracket. Try the 24% bracket or reduce other income.
            </div>
          ) : (
            <>
              <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                <div className="text-xs text-gray-500 mb-1">Annual Conversion Amount</div>
                <div className="text-3xl font-bold text-blue-400">{fmtK(results.convRoom)}</div>
                <div className="text-xs text-gray-600 mt-0.5">
                  fills up to {(targetRate * 100).toFixed(0)}% bracket · {fmt(results.cumTax / Math.max(1, results.yearsConverting))}/yr in tax
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
                  <div className="text-xs text-gray-500 mb-1">Effective Rate on Conversion</div>
                  <div className="text-2xl font-bold text-emerald-400">
                    {(results.effRateOverall * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">blended marginal rate</div>
                </div>
                <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
                  <div className="text-xs text-gray-500 mb-1">Years to Convert</div>
                  <div className="text-2xl font-bold text-white">{results.yearsConverting}</div>
                  <div className="text-xs text-gray-600 mt-0.5">age {currentAge}–{results.convEndAge - 1}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
                  <div className="text-xs text-gray-500 mb-1">Total Converted</div>
                  <div className="text-xl font-bold text-blue-400">{fmtK(results.cumConv)}</div>
                  <div className="text-xs text-gray-600 mt-0.5">tax: {fmtK(results.cumTax)}</div>
                </div>
                <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
                  <div className="text-xs text-gray-500 mb-1">Est. Lifetime Tax Savings</div>
                  <div className="text-xl font-bold text-emerald-400">{fmtK(results.lifetimeTaxSavings)}</div>
                  <div className="text-xs text-gray-600 mt-0.5">{fmt(results.annualTaxSavings)}/yr × 20 yrs</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Balance chart */}
      <div className="mt-6 bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Traditional IRA Balance — Conversion vs. No Conversion</h3>
        <p className="text-[10px] text-gray-600 mb-3">
          Blue = with annual conversions · Dashed grey = no action · Balance drops as you convert; the transferred money is in Roth growing tax-free
        </p>
        <BalanceChart chartData={results.chartData} currentAge={currentAge} />
      </div>

      {/* RMD Impact */}
      <div className="mt-4 bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Projected RMD Impact at Age 73</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 rounded bg-gray-800/50 border border-gray-700/40">
            <div className="text-xs text-gray-500 mb-1">Without Conversions</div>
            <div className="text-2xl font-bold text-amber-400">{fmtMo(results.rmdWithout * 12)}</div>
            <div className="text-xs text-gray-600 mt-0.5">RMD from {fmtK(results.balAt73No)} balance</div>
            <div className="text-xs text-gray-600 mt-0.5">est. tax: ~{fmt(results.rmdWithout * 12 * (futureRate / 100))}/yr</div>
          </div>
          <div className="p-3 rounded bg-gray-800/50 border border-gray-700/40">
            <div className="text-xs text-gray-500 mb-1">With Conversions</div>
            <div className="text-2xl font-bold text-blue-400">{fmtMo(results.rmdWith * 12)}</div>
            <div className="text-xs text-gray-600 mt-0.5">RMD from {fmtK(results.balAt73With)} balance</div>
            <div className="text-xs text-gray-600 mt-0.5">est. tax: ~{fmt(results.rmdWith * 12 * (futureRate / 100))}/yr</div>
          </div>
          <div className="p-3 rounded bg-emerald-900/20 border border-emerald-700/30">
            <div className="text-xs text-gray-500 mb-1">RMD Reduction</div>
            <div className="text-2xl font-bold text-emerald-400">{fmtMo(results.rmdDiff * 12)}</div>
            <div className="text-xs text-emerald-600 mt-0.5">less forced income per month</div>
            <div className="text-xs text-emerald-600 mt-0.5">{fmt(results.annualTaxSavings)}/yr in tax savings</div>
          </div>
        </div>
        <p className="text-[10px] text-gray-600 mt-3">
          RMDs calculated using IRS Uniform Lifetime Table factor of 26.5 at age 73. Future tax rate assumed at {futureRate}% — adjust in inputs.
          RMD reduction also lowers Medicare IRMAA surcharges and reduces Social Security benefit taxation.
        </p>
      </div>

      {/* Year-by-year table */}
      {results.rows.length > 0 && (
        <div className="mt-4 bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Year-by-Year Conversion Plan</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-max">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-2 text-gray-500 pr-4">Year / Age</th>
                  <th className="text-right py-2 text-gray-500 pr-4">Trad. IRA Start</th>
                  <th className="text-right py-2 text-gray-500 pr-4">Conversion</th>
                  <th className="text-right py-2 text-gray-500 pr-4">Tax Owed</th>
                  <th className="text-right py-2 text-gray-500 pr-4">Eff. Rate</th>
                  <th className="text-right py-2 text-gray-500 pr-4">Trad. IRA End</th>
                  <th className="text-right py-2 text-gray-500">Cumulative Tax</th>
                </tr>
              </thead>
              <tbody>
                {results.rows.map((row, i) => (
                  <tr key={i} className={`border-b border-gray-800/40 ${i === 0 ? 'bg-blue-900/10' : ''}`}>
                    <td className="py-2 text-gray-300 pr-4">{row.year} · Age {row.age}</td>
                    <td className="py-2 text-right text-gray-400 pr-4">{fmtK(row.beginBal)}</td>
                    <td className="py-2 text-right text-blue-400 font-medium pr-4">{fmtK(row.conversion)}</td>
                    <td className="py-2 text-right text-amber-400 pr-4">{fmt(row.tax)}</td>
                    <td className={`py-2 text-right pr-4 ${row.effRate < 0.13 ? 'text-emerald-400' : row.effRate < 0.20 ? 'text-blue-400' : 'text-amber-400'}`}>
                      {(row.effRate * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 text-right text-gray-300 pr-4">{fmtK(row.endBal)}</td>
                    <td className="py-2 text-right text-gray-500">{fmtK(row.cumTax)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700">
                  <td className="py-2 text-gray-400 font-medium pr-4">Total</td>
                  <td className="pr-4" />
                  <td className="py-2 text-right text-blue-400 font-bold pr-4">{fmtK(results.cumConv)}</td>
                  <td className="py-2 text-right text-amber-400 font-bold pr-4">{fmtK(results.cumTax)}</td>
                  <td className="py-2 text-right text-gray-400 pr-4">{(results.effRateOverall * 100).toFixed(1)}%</td>
                  <td className="py-2 text-right text-gray-300 pr-4">{fmtK(results.convEndBal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Strategy notes */}
      <div className="mt-4 bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Conversion Strategy Notes</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            {
              title: 'Why the 55–65 Window Is the Golden Opportunity',
              color: 'text-emerald-400',
              body: 'Your income is at its lowest — no salary, Social Security likely not yet started, no RMDs. Brackets have maximum headroom. Every dollar converted now grows tax-free in Roth for 10+ years before Medicare or RMDs force income higher.',
            },
            {
              title: 'ACA Subsidy Interaction — Plan Carefully',
              color: 'text-amber-400',
              body: 'Roth conversions count as MAGI and can reduce or eliminate ACA Premium Tax Credits. Use the Early Retirement Health calculator to find your subsidy cliff, then decide whether conversion tax savings exceed subsidy loss. Often converting to the 12% bracket preserves the most subsidies.',
            },
            {
              title: 'The 5-Year Rule for Roth Conversions',
              color: 'text-blue-400',
              body: 'Each conversion starts its own 5-year clock. The converted principal (not earnings) can be withdrawn penalty-free after 5 years, even before age 59½. Converting at 55 means that principal is accessible at 60 — useful if you need cash before the Roth is fully "seasoned."',
            },
            {
              title: 'Tax Torpedo at 73 — What You\'re Preventing',
              color: 'text-red-400',
              body: 'Without conversions, RMDs at 73 stack on top of Social Security income (up to 85% taxable) and may trigger Medicare IRMAA surcharges, pushing you into the 22–24% bracket or higher — taxing dollars that could have been converted at 12% during your early retirement years.',
            },
            {
              title: '0% Long-Term Capital Gains Rate',
              color: 'text-purple-400',
              body: 'While staying in the 12% bracket, qualified dividends and long-term capital gains are taxed at 0%. If you hold appreciated assets in a taxable account, this window is also ideal for harvesting gains — rebalancing or selling winners with no federal tax.',
            },
            {
              title: 'Rule of 55 and SEPP for Early Access',
              color: 'text-cyan-400',
              body: 'If you left your employer at 55+, you can take 401k distributions penalty-free under the Rule of 55 — roll to IRA first if needed. For IRA funds before 59½, SEPP (72(t) substantially equal periodic payments) lets you draw without the 10% penalty while keeping conversion room available.',
            },
          ].map(({ title, color, body }) => (
            <div key={title} className="p-3 rounded bg-gray-800/40 border border-gray-700/40">
              <div className={`text-xs font-semibold mb-1 ${color}`}>{title}</div>
              <div className="text-[10px] text-gray-500 leading-relaxed">{body}</div>
            </div>
          ))}
        </div>

        {/* Quick reference bracket table */}
        <div className="mt-4 p-3 rounded bg-gray-800/40 border border-gray-700/40">
          <div className="text-xs font-medium text-gray-400 mb-2">
            2025 Quick Reference — {filing === 'mfj' ? 'Married Filing Jointly' : 'Single'}
          </div>
          <div className="overflow-x-auto">
            <table className="text-[10px] w-full">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700/60">
                  <th className="text-left py-1 pr-4">Bracket</th>
                  <th className="text-right py-1 pr-4">Taxable Income</th>
                  <th className="text-right py-1 pr-4">Gross Income (incl. std ded.)</th>
                  <th className="text-right py-1">0% LTCG applies?</th>
                </tr>
              </thead>
              <tbody>
                {(filing === 'mfj'
                  ? [
                      { rate: '10%', taxable: '$0 – $23,850',    gross: '$0 – $53,850',    ltcg: 'Yes' },
                      { rate: '12%', taxable: '$23,850 – $96,950', gross: '$53,850 – $126,950', ltcg: 'Yes' },
                      { rate: '22%', taxable: '$96,950 – $206,700', gross: '$126,950 – $236,700', ltcg: 'No' },
                      { rate: '24%', taxable: '$206,700 – $394,600', gross: '$236,700 – $424,600', ltcg: 'No' },
                    ]
                  : [
                      { rate: '10%', taxable: '$0 – $11,925',    gross: '$0 – $26,925',    ltcg: 'Yes' },
                      { rate: '12%', taxable: '$11,925 – $48,475', gross: '$26,925 – $63,475', ltcg: 'Yes' },
                      { rate: '22%', taxable: '$48,475 – $103,350', gross: '$63,475 – $118,350', ltcg: 'No' },
                      { rate: '24%', taxable: '$103,350 – $197,300', gross: '$118,350 – $212,300', ltcg: 'No' },
                    ]
                ).map(row => (
                  <tr key={row.rate} className="border-b border-gray-700/30 text-gray-400">
                    <td className="py-1 pr-4 font-medium">{row.rate}</td>
                    <td className="py-1 pr-4 text-right">{row.taxable}</td>
                    <td className="py-1 pr-4 text-right">{row.gross}</td>
                    <td className={`py-1 text-right ${row.ltcg === 'Yes' ? 'text-emerald-400' : 'text-gray-600'}`}>{row.ltcg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-3 text-[10px] text-gray-600 leading-relaxed">
          This planner uses 2025 federal tax brackets. State income taxes are not included — some states exempt IRA distributions or Roth conversions; check your state's rules.
          Estimates are for planning purposes only. Consult a CPA or CFP before executing a conversion strategy.
        </div>
      </div>
    </div>
  )
}
