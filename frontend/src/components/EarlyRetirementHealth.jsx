import { useState, useMemo } from 'react'

// 2025 Federal Poverty Level for household of 2
const FPL_2 = 20440

// ACA official age-rating factors (piecewise linear between anchor points)
const AGE_TABLE = [
  [21, 1.000], [25, 1.004], [30, 1.127], [35, 1.278],
  [40, 1.444], [45, 1.647], [50, 1.893], [55, 2.211],
  [60, 2.714], [64, 3.000],
]

function ageFactor(age) {
  const a = Math.max(21, Math.min(64, age))
  for (let i = 0; i < AGE_TABLE.length - 1; i++) {
    const [a0, f0] = AGE_TABLE[i]
    const [a1, f1] = AGE_TABLE[i + 1]
    if (a >= a0 && a <= a1) return f0 + (f1 - f0) * (a - a0) / (a1 - a0)
  }
  return 3.000
}

// 2025 national-average benchmark Silver plan for age-21, per person/month
const BASE_21 = 310

function benchmarkMonthly(age) {
  return BASE_21 * ageFactor(age)
}

// ACA premium contribution rate based on MAGI vs FPL (ARP/IRA extended rules)
function acaContribRate(income) {
  const r = income / FPL_2
  if (r <= 1.5) return 0
  if (r <= 2.0) return ((r - 1.5) / 0.5) * 0.02
  if (r <= 2.5) return 0.02 + ((r - 2.0) / 0.5) * 0.02
  if (r <= 3.0) return 0.04 + ((r - 2.5) / 0.5) * 0.02
  if (r <= 4.0) return 0.06 + ((r - 3.0) / 1.0) * 0.025
  return 0.085
}

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

function PremiumChart({ rows }) {
  if (rows.length < 2) return null
  const W = 600; const H = 160
  const maxV = Math.max(...rows.map(r => r.fullMonthly)) * 1.12
  const xs = i => (i / (rows.length - 1)) * W
  const ys = v => H - (v / maxV) * (H - 14)

  const fullPath = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(r.fullMonthly).toFixed(1)}`).join(' ')
  const netPath  = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(r.netMonthly).toFixed(1)}`).join(' ')

  // Shaded region between full and net (the subsidy band)
  const subsidyFill =
    rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(r.fullMonthly).toFixed(1)}`).join(' ') +
    ' ' +
    [...rows].reverse().map((r, i) => `L ${xs(rows.length - 1 - i).toFixed(1)} ${ys(r.netMonthly).toFixed(1)}`).join(' ') +
    ' Z'

  const labelIdxs = [0, Math.floor((rows.length - 1) / 2), rows.length - 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }}>
      <defs>
        <linearGradient id="subsidyBand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={0} y1={ys(maxV * f)} x2={W} y2={ys(maxV * f)} stroke="#1f2937" strokeWidth="1" />
      ))}
      <path d={subsidyFill} fill="url(#subsidyBand)" />
      <path d={fullPath} fill="none" stroke="#6b7280" strokeWidth="1.5" strokeDasharray="5 3" />
      <path d={netPath}  fill="none" stroke="#3b82f6" strokeWidth="2" />
      {labelIdxs.map(i => (
        <text key={i} x={xs(i)} y={H - 1} textAnchor="middle" fontSize="9" fill="#6b7280">
          Age {rows[i].age1}{rows[i].age2 !== rows[i].age1 ? `/${rows[i].age2}` : ''}
        </text>
      ))}
      <text x={4} y={ys(rows[0].fullMonthly) - 4} fontSize="9" fill="#6b7280">Full price</text>
      <text x={4} y={ys(rows[0].netMonthly) + 12} fontSize="9" fill="#3b82f6">Your cost</text>
    </svg>
  )
}

export default function EarlyRetirementHealth() {
  const [age1, setAge1] = useState(55)
  const [age2, setAge2] = useState(55)
  const [income, setIncome] = useState(60000)
  const [incomeGrowth, setIncomeGrowth] = useState(2)

  const results = useMemo(() => {
    const MEDICARE = 65
    const rows = []
    let cumCost = 0
    let cumSubsidy = 0

    for (let yr = 0; yr <= 15; yr++) {
      const a1 = age1 + yr
      const a2 = age2 + yr
      if (a1 >= MEDICARE && a2 >= MEDICARE) break

      const inc = income * (1 + incomeGrowth / 100) ** yr
      const rate = acaContribRate(inc)
      const maxContrib = inc * rate

      const p1mo = a1 < MEDICARE ? benchmarkMonthly(a1) : 0
      const p2mo = a2 < MEDICARE ? benchmarkMonthly(a2) : 0
      const fullMonthly = p1mo + p2mo
      const fullAnnual  = fullMonthly * 12

      const subsidyAnnual = Math.max(0, fullAnnual - maxContrib)
      const netAnnual  = Math.min(fullAnnual, maxContrib)
      const netMonthly = netAnnual / 12

      cumCost    += netAnnual
      cumSubsidy += subsidyAnnual

      rows.push({
        year: new Date().getFullYear() + yr,
        age1: a1,
        age2: a2,
        income: inc,
        fplPct: (inc / FPL_2) * 100,
        rate,
        maxContribMonthly: maxContrib / 12,
        fullMonthly,
        subsidyMonthly: subsidyAnnual / 12,
        netMonthly,
        cumCost,
        cumSubsidy,
        p1solo: a1 < MEDICARE && a2 >= MEDICARE,
        p2solo: a2 < MEDICARE && a1 >= MEDICARE,
      })
    }

    const first = rows[0] || {}
    return {
      rows,
      first,
      fplPct: (income / FPL_2) * 100,
      rate: acaContribRate(income),
      cumCost,
      cumSubsidy,
      yearsOnACA: rows.length,
    }
  }, [age1, age2, income, incomeGrowth])

  const dollarK = v => {
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
    if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
    return `$${v.toFixed(0)}`
  }
  const fmtMo = v => `$${Math.round(v).toLocaleString()}/mo`

  const fplInfo = (() => {
    const p = results.fplPct
    if (p < 100)  return { color: 'text-red-400',    text: 'Below 100% FPL — Medicaid territory in expansion states; ACA PTCs not available.' }
    if (p < 150)  return { color: 'text-emerald-400', text: '100–150% FPL — Zero or near-zero net premium likely.' }
    if (p < 200)  return { color: 'text-emerald-400', text: '150–200% FPL — Premium capped at 0–2% of income.' }
    if (p < 250)  return { color: 'text-blue-400',    text: '200–250% FPL — Premium capped at 2–4% of income.' }
    if (p < 300)  return { color: 'text-blue-400',    text: '250–300% FPL — Premium capped at 4–6% of income.' }
    if (p < 400)  return { color: 'text-amber-400',   text: '300–400% FPL — Premium capped at 6–8.5% of income.' }
    return        { color: 'text-amber-400',           text: 'Above 400% FPL — Premium capped at 8.5% of income (ARP extended through 2025).' }
  })()

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-white">Early Retirement Health Coverage</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          ACA Marketplace premium estimates for the gap between early retirement and Medicare at 65 — family of 2
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Your Situation</h3>
          <InputRow label="Your Age at Retirement" value={age1} onChange={setAge1} min={40} max={64} note="Coverage needed until you turn 65" />
          <InputRow label="Spouse / Partner Age" value={age2} onChange={setAge2} min={40} max={64} note="They get their own age-rated premium" />
          <InputRow label="Annual Retirement Income (MAGI)" value={income} onChange={setIncome} min={10000} max={500000} step={1000} prefix="$" note="SS, dividends, cap gains, trad. IRA withdrawals" />
          <InputRow label="Income Growth Rate" value={incomeGrowth} onChange={setIncomeGrowth} min={0} max={8} step={0.5} suffix="%" note="Annual inflation adjustment to income" />

          <div className="mt-4 p-3 rounded bg-gray-800/50 border border-gray-700/50">
            <div className="text-xs text-gray-400 font-medium mb-2">2025 Federal Poverty Level — Family of 2</div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">FPL (family of 2)</span>
                <span className="text-gray-300">$20,440 / yr</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Your income</span>
                <span className="text-gray-300">${income.toLocaleString()} / yr</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">% of FPL</span>
                <span className={`font-semibold ${fplInfo.color}`}>{results.fplPct.toFixed(0)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Premium cap rate</span>
                <span className="text-gray-300">{(results.rate * 100).toFixed(1)}% of income</span>
              </div>
            </div>
            <div className={`mt-2 text-[10px] ${fplInfo.color} opacity-80 leading-relaxed`}>{fplInfo.text}</div>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-4">
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <div className="text-xs text-gray-500 mb-1">Est. Monthly Premium — Year 1</div>
            <div className="text-3xl font-bold text-blue-400">{fmtMo(results.first.netMonthly || 0)}</div>
            <div className="text-xs text-gray-600 mt-0.5">
              full price {fmtMo(results.first.fullMonthly || 0)} · subsidy saves {fmtMo(results.first.subsidyMonthly || 0)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
              <div className="text-xs text-gray-500 mb-1">Premium Cap</div>
              <div className="text-2xl font-bold text-emerald-400">{(results.rate * 100).toFixed(1)}%</div>
              <div className="text-xs text-gray-600 mt-0.5">
                ${Math.round((results.first.maxContribMonthly || 0)).toLocaleString()}/mo max
              </div>
            </div>
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
              <div className="text-xs text-gray-500 mb-1">ACA Gap Years</div>
              <div className="text-2xl font-bold text-white">{results.yearsOnACA}</div>
              <div className="text-xs text-gray-600 mt-0.5">until Medicare at 65</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
              <div className="text-xs text-gray-500 mb-1">Total Premiums Paid</div>
              <div className="text-xl font-bold text-amber-400">{dollarK(results.cumCost)}</div>
              <div className="text-xs text-gray-600 mt-0.5">through age 64</div>
            </div>
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
              <div className="text-xs text-gray-500 mb-1">Total ACA Subsidies</div>
              <div className="text-xl font-bold text-emerald-400">{dollarK(results.cumSubsidy)}</div>
              <div className="text-xs text-gray-600 mt-0.5">tax credits received</div>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="mt-6 bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
          Monthly Premium Trend — Ages {age1}–64
        </h3>
        <p className="text-[10px] text-gray-600 mb-3">
          Blue = what you pay · Dashed grey = full unsubsidized price · Green band = subsidy savings
        </p>
        <PremiumChart rows={results.rows} />
      </div>

      {/* Year-by-year table */}
      <div className="mt-4 bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Year-by-Year Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-max">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left py-2 text-gray-500 pr-4">Year</th>
                <th className="text-right py-2 text-gray-500 pr-4">Ages</th>
                <th className="text-right py-2 text-gray-500 pr-4">Income</th>
                <th className="text-right py-2 text-gray-500 pr-4">% FPL</th>
                <th className="text-right py-2 text-gray-500 pr-4">Full Premium</th>
                <th className="text-right py-2 text-gray-500 pr-4">Subsidy</th>
                <th className="text-right py-2 text-gray-500 pr-4">Your Cost</th>
                <th className="text-right py-2 text-gray-500">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {results.rows.map((row, i) => {
                const transitionNote = row.p1solo
                  ? ` · spouse on Medicare`
                  : row.p2solo
                  ? ` · you on Medicare`
                  : ''
                return (
                  <tr key={i} className={`border-b border-gray-800/40 ${i === 0 ? 'bg-blue-900/10' : ''} ${(row.p1solo || row.p2solo) ? 'bg-emerald-900/10' : ''}`}>
                    <td className="py-2 text-gray-300 pr-4">{row.year}</td>
                    <td className="py-2 text-right text-gray-300 pr-4">
                      {row.age1 < 65 ? row.age1 : <span className="text-emerald-400">{row.age1}✓</span>}
                      {' / '}
                      {row.age2 < 65 ? row.age2 : <span className="text-emerald-400">{row.age2}✓</span>}
                      {transitionNote && <span className="text-[10px] text-emerald-600 ml-1">{transitionNote}</span>}
                    </td>
                    <td className="py-2 text-right text-gray-300 pr-4">${Math.round(row.income).toLocaleString()}</td>
                    <td className={`py-2 text-right pr-4 ${row.fplPct < 200 ? 'text-emerald-400' : row.fplPct < 350 ? 'text-blue-400' : 'text-amber-400'}`}>
                      {row.fplPct.toFixed(0)}%
                    </td>
                    <td className="py-2 text-right text-gray-500 pr-4">${Math.round(row.fullMonthly).toLocaleString()}/mo</td>
                    <td className="py-2 text-right text-emerald-400 pr-4">${Math.round(row.subsidyMonthly).toLocaleString()}/mo</td>
                    <td className="py-2 text-right text-blue-400 font-medium pr-4">${Math.round(row.netMonthly).toLocaleString()}/mo</td>
                    <td className="py-2 text-right text-gray-400">{dollarK(row.cumCost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-gray-600 mt-2">Ages marked with ✓ = that person has transitioned to Medicare.</p>
      </div>

      {/* Key planning notes */}
      <div className="mt-4 bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Key Planning Notes</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            {
              title: 'Roth Withdrawals Are Invisible to ACA',
              body: 'Qualified Roth IRA distributions are not MAGI. Using Roth funds keeps your income in a lower FPL bracket and reduces or eliminates premiums — a major early-retirement advantage.',
            },
            {
              title: 'Roth Conversions Count as Income',
              body: 'Converting a Traditional IRA to Roth increases MAGI and can push you into a higher ACA bracket. Time large conversions in years when income is otherwise low.',
            },
            {
              title: 'ARP Premium Cap Extended Through 2025',
              body: 'The American Rescue Plan removed the old 400% FPL subsidy cliff, capping premiums at 8.5% of income regardless of how far above 400% FPL you are. Confirm current law for years beyond 2025.',
            },
            {
              title: 'Medicare Starts at 65 — Not Retirement',
              body: 'You enroll in Medicare 3 months before your 65th birthday regardless of when you retired. 2025 Part B base premium is $185/mo per person; higher earners pay IRMAA surcharges.',
            },
            {
              title: 'Cost-Sharing Reductions (CSR)',
              body: 'If income lands at 100–250% FPL, Silver plans offer dramatically lower deductibles and copays through CSRs — these stack on top of premium subsidies and must be claimed via a Silver plan.',
            },
            {
              title: 'Income Targeting Strategy',
              body: 'Many early retirees manage MAGI to stay at 150–200% FPL ($31K–$41K for family of 2), minimizing premiums while living off Roth or taxable accounts with no reportable income.',
            },
          ].map(({ title, body }) => (
            <div key={title} className="p-3 rounded bg-gray-800/40 border border-gray-700/40">
              <div className="text-xs font-medium text-gray-300 mb-1">{title}</div>
              <div className="text-[10px] text-gray-500 leading-relaxed">{body}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 rounded bg-amber-900/20 border border-amber-700/30">
          <div className="text-xs font-medium text-amber-400 mb-1">Estimate Accuracy</div>
          <div className="text-[10px] text-gray-500 leading-relaxed">
            Premiums are based on 2025 national-average ACA benchmark Silver plan costs, age-rated using the CMS 3:1 curve.
            Actual premiums vary by state, county, insurer, tobacco use, and specific plan chosen.
            For an exact quote, visit <span className="text-blue-400">healthcare.gov</span> or your state exchange with your actual ZIP code and income.
            Deductibles, copays, and out-of-pocket maximums are not included in these estimates — budget an additional $3,000–$9,450/person/year depending on plan metal tier.
          </div>
        </div>
      </div>
    </div>
  )
}
