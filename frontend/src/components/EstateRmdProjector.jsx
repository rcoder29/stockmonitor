import { useState, useMemo } from 'react'

// IRS Uniform Lifetime Table (ULT) — key ages for RMD divisors
const ULT = {
  72:14.6, 73:14.1, 74:13.5, 75:12.9, 76:12.4, 77:11.8, 78:11.3,
  79:10.8, 80:10.2, 81:9.7,  82:9.1,  83:8.6,  84:8.1,  85:7.6,
  86:7.1,  87:6.7,  88:6.3,  89:5.9,  90:5.5,  91:5.2,  92:4.9,
  93:4.6,  94:4.3,  95:4.1,  96:3.8,  97:3.6,  98:3.4,  99:3.1,
 100:2.9, 101:2.7, 102:2.5, 103:2.3, 104:2.1, 105:1.9, 106:1.7,
 107:1.6, 108:1.4, 109:1.3, 110:1.2, 111:1.1, 112:1.0, 120:1.0,
}
function getUlt(age) {
  if (age < 72) return null
  const a = Math.min(age, 120)
  for (let x = a; x >= 72; x--) {
    if (ULT[x] !== undefined) return ULT[x]
  }
  return 1.0
}

// 2025 MFJ federal brackets
const FED_MFJ = [
  { rate: 0.10, upTo: 23850 },
  { rate: 0.12, upTo: 96950 },
  { rate: 0.22, upTo: 206700 },
  { rate: 0.24, upTo: 394600 },
  { rate: 0.32, upTo: 501050 },
  { rate: 0.35, upTo: 751600 },
  { rate: 0.37, upTo: Infinity },
]
function marginalRate(income) {
  for (const b of FED_MFJ) { if (income <= b.upTo) return b.rate }
  return 0.37
}
function fedTax(income) {
  let tax = 0, prev = 0
  for (const b of FED_MFJ) {
    if (income <= prev) break
    tax += (Math.min(income, b.upTo) - prev) * b.rate
    prev = b.upTo
  }
  return tax
}

function fmt(n, dec = 0) {
  if (n === undefined || n === null || isNaN(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function SvgLineChart({ data, keys, colors, yLabel }) {
  if (!data.length) return null
  const W = 560, H = 160, PX = 45, PY = 10, PB = 30
  const allVals = data.flatMap(d => keys.map(k => d[k] || 0)).filter(v => v > 0)
  const minV = 0
  const maxV = Math.max(...allVals) * 1.05 || 1

  function xPos(i) { return PX + (i / (data.length - 1)) * (W - PX - PY) }
  function yPos(v) { return PY + (1 - (v - minV) / (maxV - minV)) * (H - PY - PB) }

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Y axis label */}
        <text x="8" y={H / 2} fill="#64748b" fontSize="9" textAnchor="middle" transform={`rotate(-90, 8, ${H/2})`}>{yLabel}</text>
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = PY + t * (H - PY - PB)
          const val = maxV * (1 - t)
          return (
            <g key={t}>
              <line x1={PX} x2={W - PY} y1={y} y2={y} stroke="#334155" strokeWidth="0.5" strokeDasharray="3,3" />
              <text x={PX - 3} y={y + 3} fill="#64748b" fontSize="8" textAnchor="end">${fmt(val / 1000)}k</text>
            </g>
          )
        })}
        {/* Lines */}
        {keys.map((k, ki) => {
          const pts = data.map((d, i) => `${xPos(i)},${yPos(d[k] || 0)}`).join(' ')
          return <polyline key={k} points={pts} fill="none" stroke={colors[ki]} strokeWidth="1.5" />
        })}
        {/* X axis labels */}
        {data.filter((_, i) => i % Math.ceil(data.length / 8) === 0 || i === data.length - 1).map((d, _, arr) => {
          const i = data.indexOf(d)
          return (
            <text key={d.age} x={xPos(i)} y={H - 5} fill="#64748b" fontSize="8" textAnchor="middle">{d.age}</text>
          )
        })}
      </svg>
      <div className="flex gap-4 mt-2 justify-center">
        {keys.map((k, i) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className="w-6 h-0.5 rounded" style={{ backgroundColor: colors[i] }} />
            <span className="text-xs text-slate-400">{k}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function EstateRmdProjector() {
  const [age, setAge]           = useState(65)
  const [tradIra, setTradIra]   = useState(500000)
  const [rothIra, setRothIra]   = useState(200000)
  const [taxable, setTaxable]   = useState(300000)
  const [ssIncome, setSsIncome] = useState(36000)
  const [pension, setPension]   = useState(0)
  const [returnRate, setReturn] = useState(7)
  const [inflation, setInflation] = useState(2.5)
  const [spendRate, setSpend]   = useState(4)
  const [rmdStart, setRmdStart] = useState(73)  // SECURE 2.0: age 73 for those born 1951–1959
  const [deathAge, setDeathAge] = useState(90)
  const [estateTax, setEstateTax] = useState(false)  // federal estate tax

  const rows = useMemo(() => {
    let trad = tradIra, roth = rothIra, tax = taxable
    const growthR = returnRate / 100
    const inflR   = inflation / 100
    const results = []

    for (let yr = 0; yr <= deathAge - age; yr++) {
      const curAge = age + yr
      const factor = Math.pow(1 + growthR, yr)
      // Grow accounts
      trad = trad * (1 + growthR)
      roth = roth * (1 + growthR)
      tax  = tax  * (1 + growthR)

      // RMD
      const ult = curAge >= rmdStart ? getUlt(curAge) : null
      const rmd = ult ? trad / ult : 0
      if (rmd > 0) {
        trad -= rmd
        trad = Math.max(0, trad)
      }

      // Income
      const ordinaryIncome = (ssIncome * Math.pow(1 + inflR, yr)) + (pension * Math.pow(1 + inflR, yr)) + rmd
      const taxDue = fedTax(ordinaryIncome) - fedTax(ordinaryIncome - rmd)

      // Spend from taxable first, then trad, then roth
      const annualSpend = (tradIra + rothIra + taxable) * (spendRate / 100) * Math.pow(1 + inflR, yr)
      let spend = annualSpend
      const fromTax = Math.min(spend, tax); spend -= fromTax; tax -= fromTax
      const fromTrad = Math.min(spend, trad); spend -= fromTrad; trad -= fromTrad
      const fromRoth = Math.min(spend, roth); spend -= fromRoth; roth -= fromRoth
      trad = Math.max(0, trad); roth = Math.max(0, roth); tax = Math.max(0, tax)

      const totalEstate = trad + roth + tax
      results.push({
        age: curAge, yr,
        trad: Math.round(trad), roth: Math.round(roth), tax: Math.round(tax),
        total: Math.round(totalEstate),
        rmd: Math.round(rmd), taxOnRmd: Math.round(taxDue),
        ordinaryIncome: Math.round(ordinaryIncome),
        margRate: marginalRate(ordinaryIncome),
        annualSpend: Math.round(annualSpend),
      })
    }
    return results
  }, [age, tradIra, rothIra, taxable, ssIncome, pension, returnRate, inflation, spendRate, rmdStart, deathAge])

  const EXEMPTION_2025 = 13610000
  const finalEstate = rows[rows.length - 1]?.total || 0
  const estateOverExemption = Math.max(0, finalEstate - EXEMPTION_2025)
  const estateGrossUp = estateTax && estateOverExemption > 0 ? estateOverExemption * 0.40 : 0
  const heritableEstate = finalEstate - estateGrossUp

  const peakRmd = rows.reduce((m, r) => r.rmd > m.rmd ? r : m, { rmd: 0 })
  const totalRmdTax = rows.reduce((s, r) => s + r.taxOnRmd, 0)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Estate & RMD Projector</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Model Required Minimum Distributions and legacy estate value through age {deathAge}.
        </p>
      </div>

      {/* Inputs */}
      <div className="grid sm:grid-cols-2 gap-5">
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider pb-1 border-b border-slate-700">Account Balances (Today)</h3>
          {[
            ['Current Age', age, setAge, 'years', 1, false],
            ['Traditional IRA / 401(k)', tradIra, setTradIra, '', 10000, true],
            ['Roth IRA / 401(k)', rothIra, setRothIra, '', 10000, true],
            ['Taxable Accounts', taxable, setTaxable, '', 10000, true],
          ].map(([label, val, setter, unit, step, isDollar]) => (
            <div key={label}>
              <label className="block text-xs text-slate-400 mb-1">{label}</label>
              <div className="relative">
                {isDollar && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>}
                <input type="number" value={val} onChange={e => setter(Number(e.target.value))}
                  step={step} min="0"
                  className={`w-full ${isDollar ? 'pl-7' : 'pl-3'} pr-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500`} />
                {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">{unit}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider pb-1 border-b border-slate-700">Assumptions</h3>
          {[
            ['Annual SS Income', ssIncome, setSsIncome, 10000, true],
            ['Annual Pension', pension, setPension, 5000, true],
            ['Portfolio Return (%/yr)', returnRate, setReturn, 0.5, false],
            ['Inflation (%/yr)', inflation, setInflation, 0.25, false],
            ['Annual Spend Rate (% of portfolio)', spendRate, setSpend, 0.25, false],
            ['RMD Start Age (73 for born 1951–1959)', rmdStart, setRmdStart, 1, false],
            ['Project to Age', deathAge, setDeathAge, 1, false],
          ].map(([label, val, setter, step, isDollar]) => (
            <div key={label}>
              <label className="block text-xs text-slate-400 mb-1">{label}</label>
              <div className="relative">
                {isDollar && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>}
                <input type="number" value={val} onChange={e => setter(Number(e.target.value))}
                  step={step} min="0"
                  className={`w-full ${isDollar ? 'pl-7' : 'pl-3'} pr-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500`} />
              </div>
            </div>
          ))}
          <label className="flex items-center gap-2 cursor-pointer mt-1">
            <input type="checkbox" checked={estateTax} onChange={e => setEstateTax(e.target.checked)} className="accent-blue-500 w-4 h-4" />
            <span className="text-xs text-slate-300">Apply 40% federal estate tax above $13.61M exemption</span>
          </label>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Estate Today', value: `$${fmt(tradIra + rothIra + taxable)}`, color: 'text-white' },
          { label: `Peak RMD (Age ${peakRmd.age})`, value: `$${fmt(peakRmd.rmd)}/yr`, color: 'text-orange-400' },
          { label: 'Lifetime RMD Tax', value: `$${fmt(totalRmdTax)}`, color: 'text-red-400' },
          { label: `Heritable Estate (Age ${deathAge})`, value: `$${fmt(heritableEstate)}`, color: 'text-emerald-400' },
        ].map(c => (
          <div key={c.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400">{c.label}</p>
            <p className={`text-xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
        <h3 className="text-sm font-bold text-white mb-4">Account Balances by Age</h3>
        <SvgLineChart
          data={rows}
          keys={['trad', 'roth', 'tax', 'total']}
          colors={['#f97316', '#10b981', '#3b82f6', '#94a3b8']}
          yLabel="Balance"
        />
      </div>

      {/* RMD table */}
      <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
        <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Year-by-Year RMD & Estate Projection</h3>
          <span className="text-xs text-slate-500">2025 MFJ federal tax — state taxes not included</span>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="border-b border-slate-700 bg-slate-900">
                {['Age','Trad IRA','Roth IRA','Taxable','Total','RMD','Tax on RMD','Marg. Rate','Spend'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-slate-400 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.age} className={`border-b border-slate-700/40 ${i % 2 ? 'bg-slate-900/20' : ''} ${r.age === rmdStart ? 'bg-orange-900/10' : ''}`}>
                  <td className={`px-3 py-2 font-bold ${r.age === rmdStart ? 'text-orange-400' : 'text-slate-300'}`}>
                    {r.age}{r.age === rmdStart ? ' ★' : ''}
                  </td>
                  <td className="px-3 py-2 text-orange-400 tabular-nums">${fmt(r.trad)}</td>
                  <td className="px-3 py-2 text-emerald-400 tabular-nums">${fmt(r.roth)}</td>
                  <td className="px-3 py-2 text-blue-400 tabular-nums">${fmt(r.tax)}</td>
                  <td className="px-3 py-2 text-white font-semibold tabular-nums">${fmt(r.total)}</td>
                  <td className="px-3 py-2 text-orange-300 tabular-nums">{r.rmd > 0 ? `$${fmt(r.rmd)}` : '—'}</td>
                  <td className="px-3 py-2 text-red-400 tabular-nums">{r.taxOnRmd > 0 ? `$${fmt(r.taxOnRmd)}` : '—'}</td>
                  <td className="px-3 py-2 text-slate-400 tabular-nums">{r.rmd > 0 ? `${(r.margRate * 100).toFixed(0)}%` : '—'}</td>
                  <td className="px-3 py-2 text-slate-400 tabular-nums">${fmt(r.annualSpend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {estateTax && estateOverExemption > 0 && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-4 text-sm">
          <p className="text-red-400 font-bold mb-1">Federal Estate Tax Applies</p>
          <p className="text-red-300 text-xs">
            Estate of <span className="font-semibold">${fmt(finalEstate)}</span> exceeds the 2025 exemption of <span className="font-semibold">$13,610,000</span> by <span className="font-semibold">${fmt(estateOverExemption)}</span>.
            Estimated estate tax at 40%: <span className="font-semibold">${fmt(estateGrossUp)}</span>.
            Heirs receive: <span className="font-semibold">${fmt(heritableEstate)}</span>.
          </p>
          <p className="text-red-400 text-xs mt-1">The TCJA exemption is currently set to sunset after 2025 — consult an estate attorney for current law.</p>
        </div>
      )}

      <p className="text-xs text-slate-600">
        RMDs calculated using IRS Uniform Lifetime Table. Federal tax uses 2025 MFJ brackets. This is educational only — not financial or legal advice. Consult a CFP or estate attorney for personalised planning.
      </p>
    </div>
  )
}
