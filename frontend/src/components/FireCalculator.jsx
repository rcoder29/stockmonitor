import { useState, useMemo } from 'react'

const PRESETS = [
  { label: 'Retire at 55', age: 55 },
  { label: 'Retire at 60', age: 60 },
  { label: 'Retire at 65', age: 65 },
]

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

function ProjectionChart({ dataPoints, fireNumber }) {
  if (!dataPoints.length) return null
  const W = 600; const H = 180
  const maxVal = Math.max(fireNumber * 1.15, ...dataPoints.map(d => d.value))
  const xs = i => (i / (dataPoints.length - 1)) * W
  const ys = v => H - (v / maxVal) * H

  const linePath = dataPoints.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(d.value).toFixed(1)}`).join(' ')
  const fillPath = linePath + ` L ${W} ${H} L 0 ${H} Z`
  const fireLine = ys(fireNumber)
  const crossIdx = dataPoints.findIndex(d => d.value >= fireNumber)
  const labelIdxs = [0, Math.floor((dataPoints.length - 1) / 2), dataPoints.length - 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 180 }}>
      <defs>
        <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={0} y1={ys(maxVal * f)} x2={W} y2={ys(maxVal * f)} stroke="#1f2937" strokeWidth="1" />
      ))}
      <line x1={0} y1={fireLine} x2={W} y2={fireLine} stroke="#10b981" strokeWidth="1" strokeDasharray="5 3" opacity="0.6" />
      <text x={4} y={fireLine - 4} fontSize="9" fill="#10b981" opacity="0.8">FIRE Target</text>
      <path d={fillPath} fill="url(#portGrad)" opacity="0.25" />
      <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="2" />
      {crossIdx > 0 && crossIdx < dataPoints.length && (
        <circle cx={xs(crossIdx)} cy={fireLine} r="5" fill="#10b981" />
      )}
      {labelIdxs.map(i => (
        <text key={i} x={xs(i)} y={H - 2} textAnchor="middle" fontSize="9" fill="#6b7280">
          {dataPoints[i]?.year}
        </text>
      ))}
    </svg>
  )
}

export default function FireCalculator() {
  const [currentAge,    setCurrentAge]    = useState(35)
  const [targetAge,     setTargetAge]     = useState(60)
  const [annualExpenses, setAnnualExpenses] = useState(80000)
  const [currentSavings, setCurrentSavings] = useState(250000)
  const [monthlyContrib, setMonthlyContrib] = useState(3000)
  const [annualReturn,  setAnnualReturn]  = useState(7)
  const [inflation,     setInflation]     = useState(3)
  const [swr,           setSwr]           = useState(4)

  const r = useMemo(() => {
    const nom = annualReturn / 100
    const inf = inflation / 100
    return (1 + nom) / (1 + inf) - 1  // real return
  }, [annualReturn, inflation])

  const results = useMemo(() => {
    const nomR = annualReturn / 100
    const fireNumber = annualExpenses / (swr / 100)
    const annualContrib = monthlyContrib * 12

    const maxYears = 55
    const dataPoints = []
    let bal = currentSavings
    let fireYear = null; let fireAge = null

    for (let y = 0; y <= maxYears; y++) {
      const year = new Date().getFullYear() + y
      const age = currentAge + y
      dataPoints.push({ year, age, value: bal })
      if (!fireYear && bal >= fireNumber) { fireYear = year; fireAge = age }
      bal = bal * (1 + nomR) + annualContrib
    }

    const n = targetAge - currentAge
    const savingsAtTarget = n > 0
      ? currentSavings * (1 + nomR) ** n + annualContrib * ((1 + nomR) ** n - 1) / nomR
      : currentSavings

    const progress = Math.min(100, (currentSavings / fireNumber) * 100)
    const onTrack = savingsAtTarget >= fireNumber

    return { fireNumber, yearsToFire: fireAge ? fireAge - currentAge : null, fireAge, fireYear, progress, dataPoints, onTrack, savingsAtTarget }
  }, [currentAge, targetAge, annualExpenses, currentSavings, monthlyContrib, annualReturn, swr])

  const dollarM = v => {
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
    if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
    return `$${v.toFixed(0)}`
  }

  const comparisonAges = [50, 55, 60, 65, 70].filter(a => a > currentAge)

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-white">FIRE Calculator</h2>
        <p className="text-xs text-gray-500 mt-0.5">Financial Independence, Retire Early — find your number and timeline</p>
      </div>

      <div className="flex gap-2 mb-6">
        {PRESETS.map(p => (
          <button key={p.age} onClick={() => setTargetAge(p.age)}
            className={`px-4 py-1.5 rounded text-xs font-medium transition-colors ${targetAge === p.age ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Your Numbers</h3>
          <InputRow label="Current Age" value={currentAge} onChange={setCurrentAge} min={18} max={80} />
          <InputRow label="Target Retirement Age" value={targetAge} onChange={setTargetAge} min={40} max={80} />
          <InputRow label="Annual Expenses (Today's $)" value={annualExpenses} onChange={setAnnualExpenses} min={10000} max={1000000} step={5000} prefix="$" />
          <InputRow label="Current Savings / Portfolio" value={currentSavings} onChange={setCurrentSavings} min={0} max={10000000} step={10000} prefix="$" />
          <InputRow label="Monthly Contribution" value={monthlyContrib} onChange={setMonthlyContrib} min={0} max={50000} step={100} prefix="$" />
          <InputRow label="Expected Annual Return" value={annualReturn} onChange={setAnnualReturn} min={1} max={20} step={0.5} suffix="%" note="Nominal (before inflation)" />
          <InputRow label="Inflation Rate" value={inflation} onChange={setInflation} min={0} max={10} step={0.5} suffix="%" />
          <InputRow label="Safe Withdrawal Rate" value={swr} onChange={setSwr} min={2} max={6} step={0.25} suffix="%" note="4% = Trinity Study baseline" />
        </div>

        <div className="space-y-4">
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <div className="text-xs text-gray-500 mb-1">Your FIRE Number</div>
            <div className="text-3xl font-bold text-emerald-400">{dollarM(results.fireNumber)}</div>
            <div className="text-xs text-gray-600 mt-0.5">{dollarM(annualExpenses)}/yr expenses ÷ {swr}% SWR</div>
            <div className="mt-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-500">Progress to FIRE</span>
                <span className="text-gray-300">{results.progress.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-2 bg-emerald-500 rounded-full transition-all" style={{ width: `${results.progress}%` }} />
              </div>
              <div className="flex justify-between text-xs mt-1 text-gray-600">
                <span>{dollarM(currentSavings)} now</span>
                <span>{dollarM(results.fireNumber)} goal</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
              <div className="text-xs text-gray-500 mb-1">Time to FIRE</div>
              <div className={`text-2xl font-bold ${results.yearsToFire != null ? 'text-white' : 'text-gray-600'}`}>
                {results.yearsToFire != null ? `${results.yearsToFire} yrs` : '> 55 yrs'}
              </div>
              <div className="text-xs text-gray-600 mt-0.5">
                {results.fireAge ? `Age ${results.fireAge} · ${results.fireYear}` : '—'}
              </div>
            </div>
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
              <div className="text-xs text-gray-500 mb-1">At Age {targetAge}</div>
              <div className={`text-2xl font-bold ${results.onTrack ? 'text-emerald-400' : 'text-amber-400'}`}>
                {dollarM(results.savingsAtTarget)}
              </div>
              <div className={`text-xs mt-0.5 ${results.onTrack ? 'text-emerald-600' : 'text-amber-600'}`}>
                {results.onTrack ? '✓ On track' : `Gap: ${dollarM(results.fireNumber - results.savingsAtTarget)}`}
              </div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
            <div className="text-xs text-gray-500 mb-1">Monthly Withdrawable Income</div>
            <div className="text-2xl font-bold text-blue-400">
              ${Math.round(annualExpenses / 12).toLocaleString()}/mo
            </div>
            <div className="text-xs text-gray-600">from {dollarM(results.fireNumber)} at {swr}% SWR</div>
          </div>
        </div>
      </div>

      <div className="mt-6 bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Portfolio Growth Projection
          {results.fireAge && <span className="ml-2 text-emerald-400 normal-case font-normal">→ FIRE at age {results.fireAge}</span>}
        </h3>
        <ProjectionChart
          dataPoints={results.dataPoints.slice(0, Math.max(targetAge - currentAge + 8, 25))}
          fireNumber={results.fireNumber}
        />
      </div>

      <div className="mt-4 bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Retirement Age Comparison</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left py-2 text-gray-500">Target Age</th>
              <th className="text-right py-2 text-gray-500">Portfolio Value</th>
              <th className="text-right py-2 text-gray-500">vs FIRE #</th>
              <th className="text-right py-2 text-gray-500">Monthly Income</th>
              <th className="text-right py-2 text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {comparisonAges.map(age => {
              const n = age - currentAge
              const nomR = annualReturn / 100
              const ac = monthlyContrib * 12
              const bal = currentSavings * (1 + nomR) ** n + ac * ((1 + nomR) ** n - 1) / nomR
              const monthly = bal * (swr / 100) / 12
              const pct = ((bal / results.fireNumber) * 100).toFixed(0)
              const ok = bal >= results.fireNumber
              return (
                <tr key={age} className={`border-b border-gray-800/40 ${age === targetAge ? 'bg-emerald-900/10' : ''}`}>
                  <td className="py-2 font-medium text-white">
                    Age {age} {age === targetAge && <span className="text-emerald-400 text-[10px] ml-1">← target</span>}
                  </td>
                  <td className="py-2 text-right text-gray-300">{dollarM(bal)}</td>
                  <td className={`py-2 text-right ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>{pct}%</td>
                  <td className="py-2 text-right text-gray-300">${Math.round(monthly).toLocaleString()}/mo</td>
                  <td className="py-2 text-right">
                    <span className={`px-2 py-0.5 rounded text-[10px] ${ok ? 'bg-emerald-900/50 text-emerald-400' : 'bg-amber-900/30 text-amber-400'}`}>
                      {ok ? 'FIRE ✓' : 'Not yet'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
