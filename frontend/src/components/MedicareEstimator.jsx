import { useState } from 'react'

// 2025 Medicare IRMAA brackets (MFJ)
const IRMAA_BRACKETS_MFJ = [
  { magi: 212000,    partB: 185.00,  partD: 0 },
  { magi: 266000,    partB: 259.00,  partD: 13.70 },
  { magi: 334000,    partB: 370.00,  partD: 35.30 },
  { magi: 400000,    partB: 480.90,  partD: 57.00 },
  { magi: 750000,    partB: 591.90,  partD: 78.60 },
  { magi: Infinity,  partB: 628.90,  partD: 85.80 },
]

// 2025 Medicare Part A deductible, Part B standard, Part D avg
const PART_A_DEDUCTIBLE  = 1676
const PART_B_BASE        = 185.00
const PART_D_AVG         = 55
const MEDIGAP_AVG        = 180   // average Plan G per person/mo
const DENTAL_AVG         = 50    // standalone dental

function irmaaLookup(magi) {
  for (const b of IRMAA_BRACKETS_MFJ) {
    if (magi <= b.magi) return b
  }
  return IRMAA_BRACKETS_MFJ[IRMAA_BRACKETS_MFJ.length - 1]
}

function fmt(n) { return n.toLocaleString('en-US', { minimumFractionDigits: 0 }) }

function CostBar({ label, monthly, color }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 w-28 shrink-0">{label}</span>
      <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(100, (monthly / 1200) * 100)}%` }} />
      </div>
      <span className="text-xs text-slate-300 w-16 text-right tabular-nums">${fmt(monthly)}/mo</span>
    </div>
  )
}

export default function MedicareEstimator() {
  const [magi, setMagi]         = useState(80000)
  const [persons, setPersons]   = useState(2)   // 1 or 2 enrolled
  const [partD, setPartD]       = useState(true)
  const [medigap, setMedigap]   = useState(true)
  const [dental, setDental]     = useState(false)
  const [year, setYear]         = useState(65)

  const bracket    = irmaaLookup(magi)
  const partBMo    = bracket.partB * persons
  const partDMo    = partD  ? (bracket.partD + PART_D_AVG) * persons : 0
  const medigapMo  = medigap ? MEDIGAP_AVG * persons : 0
  const dentalMo   = dental  ? DENTAL_AVG * persons : 0
  const totalMo    = partBMo + partDMo + medigapMo + dentalMo
  const totalYr    = totalMo * 12

  const isIrmaa = magi > IRMAA_BRACKETS_MFJ[0].magi

  // projection table: age 65–85
  const projRows = []
  for (let age = 65; age <= 85; age++) {
    // assume 2% annual Medicare inflation
    const factor = Math.pow(1.02, age - 65)
    const mo = totalMo * factor
    projRows.push({ age, mo, yr: mo * 12 })
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Medicare Cost Estimator</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Estimate your Medicare premiums including IRMAA surcharges based on your income. 2025 figures.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        {/* Inputs */}
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Your Profile</h3>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Modified AGI (MAGI) — 2 years prior to Medicare enrollment
              <span className="ml-1 text-slate-500">(Medicare uses your income from 2 years ago)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
              <input type="number" value={magi} onChange={e => setMagi(Number(e.target.value))}
                step="5000" min="0"
                className="w-full pl-7 pr-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-2">Enrolled persons</label>
            <div className="flex gap-2">
              {[1, 2].map(n => (
                <button key={n} onClick={() => setPersons(n)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${persons === n ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:text-white'}`}>
                  {n === 1 ? 'Just me' : 'Both spouses'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-slate-400 font-medium mb-2">Coverage selections</p>
            {[
              [partD, setPartD, 'Medicare Part D (drug coverage)', 'Covers prescription drugs'],
              [medigap, setMedigap, 'Medigap / Supplement (Plan G avg)', 'Covers most Part A/B cost-sharing'],
              [dental, setDental, 'Standalone Dental Plan (avg)', 'Medicare doesn\'t include dental'],
            ].map(([val, setter, label, sub]) => (
              <label key={label} className="flex items-start gap-3 cursor-pointer group">
                <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-blue-500" />
                <span>
                  <span className="text-sm text-slate-200">{label}</span>
                  <span className="block text-xs text-slate-500">{sub}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="space-y-4">
          {isIrmaa && (
            <div className="bg-orange-900/20 border border-orange-700/50 rounded-xl p-4">
              <p className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-1">IRMAA Applies</p>
              <p className="text-xs text-orange-300">
                Your MAGI of <span className="font-bold">${fmt(magi)}</span> exceeds the ${fmt(IRMAA_BRACKETS_MFJ[0].magi)} MFJ threshold.
                You'll pay a higher Part B (and Part D) premium surcharge.
                Consider Roth conversions and income planning to stay below brackets.
              </p>
            </div>
          )}

          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Monthly Breakdown</h3>
            <CostBar label="Part B" monthly={partBMo} color="bg-blue-500" />
            {partD  && <CostBar label="Part D" monthly={partDMo} color="bg-purple-500" />}
            {medigap && <CostBar label="Medigap" monthly={medigapMo} color="bg-emerald-500" />}
            {dental  && <CostBar label="Dental" monthly={dentalMo} color="bg-yellow-500" />}
            <div className="border-t border-slate-700 pt-3">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-bold text-white">Total Monthly</span>
                <span className="text-2xl font-bold text-white">${fmt(totalMo)}</span>
              </div>
              <div className="flex justify-between items-baseline mt-1">
                <span className="text-xs text-slate-400">Annual</span>
                <span className="text-base font-bold text-slate-300">${fmt(totalYr)}</span>
              </div>
            </div>
          </div>

          {/* IRMAA bracket table */}
          <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
            <div className="px-4 py-3 border-b border-slate-700">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">2025 IRMAA Brackets (MFJ)</h3>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/40">
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">MAGI Up To</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Part B / person</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Part D surcharge</th>
                </tr>
              </thead>
              <tbody>
                {IRMAA_BRACKETS_MFJ.map((b, i) => {
                  const active = irmaaLookup(magi) === b
                  return (
                    <tr key={i} className={`border-b border-slate-700/40 ${active ? 'bg-blue-900/20' : ''}`}>
                      <td className={`px-3 py-2 tabular-nums ${active ? 'text-blue-300 font-bold' : 'text-slate-400'}`}>
                        {b.magi === Infinity ? '> $750,000' : `≤ $${fmt(b.magi)}`}
                        {active && <span className="ml-2 text-xs bg-blue-600 text-white px-1.5 rounded">YOU</span>}
                      </td>
                      <td className={`px-3 py-2 tabular-nums text-right ${active ? 'text-blue-300 font-bold' : 'text-slate-300'}`}>
                        ${b.partB.toFixed(2)}
                      </td>
                      <td className={`px-3 py-2 tabular-nums text-right ${active ? 'text-blue-300 font-bold' : 'text-slate-400'}`}>
                        {b.partD > 0 ? `+$${b.partD.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Projection table */}
      <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
        <div className="px-5 py-3 border-b border-slate-700">
          <h3 className="text-sm font-bold text-white">20-Year Cost Projection <span className="text-xs text-slate-500 font-normal ml-2">(2% annual inflation)</span></h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/40">
                <th className="px-4 py-2 text-left text-slate-400 font-semibold">Age</th>
                <th className="px-4 py-2 text-right text-slate-400 font-semibold">Monthly</th>
                <th className="px-4 py-2 text-right text-slate-400 font-semibold">Annual</th>
                <th className="px-4 py-2 text-right text-slate-400 font-semibold">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {projRows.map((r, i) => {
                const cum = projRows.slice(0, i + 1).reduce((s, x) => s + x.yr, 0)
                return (
                  <tr key={r.age} className={`border-b border-slate-700/40 ${i % 2 ? 'bg-slate-900/20' : ''}`}>
                    <td className="px-4 py-2 text-slate-300 font-medium">{r.age}</td>
                    <td className="px-4 py-2 text-slate-300 tabular-nums text-right">${fmt(r.mo)}</td>
                    <td className="px-4 py-2 text-slate-300 tabular-nums text-right">${fmt(r.yr)}</td>
                    <td className="px-4 py-2 text-orange-400 tabular-nums text-right font-semibold">${fmt(cum)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs text-slate-600 space-y-1">
        <p>Premiums based on 2025 CMS figures. Part D estimate uses 2025 national average base + IRMAA surcharge. Medigap Plan G estimate based on national average for age 65. Dental estimate based on typical standalone plans.</p>
        <p>IRMAA determination uses MAGI from 2 years prior. A life-changing event (retirement, divorce) may allow an IRMAA appeal. Medicare costs subject to annual revision.</p>
      </div>
    </div>
  )
}
