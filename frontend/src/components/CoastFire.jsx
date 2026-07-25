import { useState, useMemo } from 'react'

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
          <input type="number" value={value} min={min} max={max} step={step}
            onChange={e => onChange(Number(e.target.value))}
            className="w-28 bg-gray-800 border border-gray-700 text-white text-xs text-right px-2 py-1.5 rounded focus:outline-none focus:border-emerald-500"
          />
          {suffix && <span className="text-gray-500 text-xs">{suffix}</span>}
        </div>
      </div>
    </div>
  )
}

// 2024 single filer brackets (simplified)
const BRACKETS = [
  { max: 11600,   rate: 10 },
  { max: 47150,   rate: 12 },
  { max: 100525,  rate: 22 },
  { max: 191950,  rate: 24 },
  { max: 243725,  rate: 32 },
  { max: 609350,  rate: 35 },
  { max: Infinity, rate: 37 },
]

function marginalRate(income) {
  return (BRACKETS.find(b => income <= b.max) || BRACKETS[BRACKETS.length - 1]).rate
}

export default function CoastFire() {
  // Coast FIRE
  const [currentAge,    setCurrentAge]    = useState(35)
  const [retireAge,     setRetireAge]     = useState(60)
  const [fireNumber,    setFireNumber]    = useState(2000000)
  const [currentSavings, setCurrentSavings] = useState(300000)
  const [expectedReturn, setExpectedReturn] = useState(7)

  // Roth Ladder
  const [tradBalance,   setTradBalance]   = useState(300000)
  const [rothBalance,   setRothBalance]   = useState(50000)
  const [accessAge,     setAccessAge]     = useState(55)
  const [annualSpending, setAnnualSpending] = useState(70000)
  const [otherIncome,   setOtherIncome]   = useState(0)

  const coast = useMemo(() => {
    const r = expectedReturn / 100
    const yrs = Math.max(retireAge - currentAge, 1)
    const coastNum = fireNumber / (1 + r) ** yrs
    const reached = currentSavings >= coastNum
    const gap = Math.max(0, coastNum - currentSavings)
    const yearsToCoast = !reached && currentSavings > 0
      ? Math.log(coastNum / currentSavings) / Math.log(1 + r)
      : 0

    const byAge = [50, 55, 60, 65, 70]
      .filter(a => a > currentAge)
      .map(a => {
        const cn = fireNumber / (1 + r) ** Math.max(a - currentAge, 1)
        return { age: a, coastNum: cn, reached: currentSavings >= cn }
      })

    return { coastNum, reached, gap, yearsToCoast, byAge }
  }, [currentAge, retireAge, fireNumber, currentSavings, expectedReturn])

  const roth = useMemo(() => {
    const clampedAccess = Math.max(accessAge, currentAge + 6) // need at least 5yr conversion window
    const bridgeYears = Math.max(clampedAccess - currentAge - 5, 1)
    const bridgeNeeded = Math.max(annualSpending * Math.max(clampedAccess - currentAge, 0), 0)
    const annualConversion = bridgeNeeded / bridgeYears

    const taxableIncome = Math.max(0, annualConversion + otherIncome - 14600) // 2024 standard deduction
    const rate = marginalRate(taxableIncome)
    const taxOwed = annualConversion * rate / 100

    const schedule = Array.from({ length: Math.min(bridgeYears, 10) }, (_, y) => ({
      year: new Date().getFullYear() + y,
      age: currentAge + y,
      convert: annualConversion,
      tradLeft: Math.max(0, tradBalance - annualConversion * (y + 1)),
      accessYear: new Date().getFullYear() + y + 5,
      accessAge: currentAge + y + 5,
    }))

    return { annualConversion, rate, taxOwed, bridgeYears, bridgeNeeded, schedule }
  }, [currentAge, accessAge, annualSpending, otherIncome, tradBalance])

  const dollarM = v => {
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
    if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
    return `$${v.toFixed(0)}`
  }

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-8">
      <div>
        <h2 className="text-lg font-bold text-white">Coast FIRE & Roth Conversion Ladder</h2>
        <p className="text-xs text-gray-500 mt-0.5">Stop contributing once your savings can coast — and access retirement funds early, penalty-free</p>
      </div>

      {/* ── Coast FIRE ── */}
      <section>
        <h3 className="text-sm font-semibold text-emerald-400 mb-4">Coast FIRE</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Inputs</h4>
            <InputRow label="Current Age" value={currentAge} onChange={setCurrentAge} min={18} max={70} />
            <InputRow label="Target Retirement Age" value={retireAge} onChange={setRetireAge} min={40} max={80} />
            <InputRow label="FIRE Number" value={fireNumber} onChange={setFireNumber} min={100000} max={20000000} step={50000} prefix="$" note="Total portfolio needed at retirement" />
            <InputRow label="Current Savings" value={currentSavings} onChange={setCurrentSavings} min={0} max={10000000} step={10000} prefix="$" />
            <InputRow label="Expected Annual Return" value={expectedReturn} onChange={setExpectedReturn} min={1} max={20} step={0.5} suffix="%" />
          </div>

          <div className="space-y-3">
            <div className={`bg-gray-900 rounded-lg border p-5 text-center ${coast.reached ? 'border-emerald-700' : 'border-gray-800'}`}>
              <div className="text-xs text-gray-500 mb-2">Your Coast FIRE Number</div>
              <div className="text-3xl font-bold text-emerald-400">{dollarM(coast.coastNum)}</div>
              <div className="text-xs text-gray-600 mt-1">needed today so portfolio reaches {dollarM(fireNumber)} by age {retireAge} with no contributions</div>
              {coast.reached ? (
                <div className="mt-4 bg-emerald-900/30 border border-emerald-700/50 rounded p-3">
                  <div className="text-emerald-400 font-bold">🎉 You've Coasted!</div>
                  <div className="text-xs text-gray-400 mt-1">Your savings will compound to your FIRE number without further contributions</div>
                </div>
              ) : (
                <div className="mt-4">
                  <div className="text-xs text-gray-500">Gap to Coast FIRE</div>
                  <div className="text-2xl font-bold text-amber-400 mt-1">{dollarM(coast.gap)}</div>
                  <div className="text-xs text-gray-600 mt-1">~{coast.yearsToCoast.toFixed(1)} more years of growth needed</div>
                </div>
              )}
            </div>

            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Coast # by Retirement Age</h4>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left py-1.5 text-gray-500">Retire At</th>
                    <th className="text-right py-1.5 text-gray-500">Coast # Needed Today</th>
                    <th className="text-right py-1.5 text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {coast.byAge.map(row => (
                    <tr key={row.age} className={`border-b border-gray-800/40 ${row.age === retireAge ? 'bg-emerald-900/10' : ''}`}>
                      <td className="py-1.5 text-white">Age {row.age} {row.age === retireAge && <span className="text-emerald-400 text-[10px] ml-1">← selected</span>}</td>
                      <td className="py-1.5 text-right text-gray-300">{dollarM(row.coastNum)}</td>
                      <td className="py-1.5 text-right">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${row.reached ? 'bg-emerald-900/50 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}>
                          {row.reached ? 'Reached ✓' : 'Not yet'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ── Roth Ladder ── */}
      <section>
        <h3 className="text-sm font-semibold text-blue-400 mb-1">Roth Conversion Ladder</h3>
        <p className="text-xs text-gray-600 mb-4">
          For retiring before age 59½: convert Traditional IRA → Roth IRA each year, wait 5 years, then withdraw converted principal penalty-free.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Inputs</h4>
            <InputRow label="Current Age" value={currentAge} onChange={setCurrentAge} min={18} max={58} />
            <InputRow label="Traditional IRA / 401k" value={tradBalance} onChange={setTradBalance} min={0} max={10000000} step={10000} prefix="$" />
            <InputRow label="Roth IRA Balance" value={rothBalance} onChange={setRothBalance} min={0} max={5000000} step={5000} prefix="$" note="Contributions withdrawable anytime" />
            <InputRow label="Age You Need Funds" value={accessAge} onChange={setAccessAge} min={40} max={59} note="First conversions available 5 years after start" />
            <InputRow label="Annual Spending" value={annualSpending} onChange={setAnnualSpending} min={10000} max={500000} step={5000} prefix="$" />
            <InputRow label="Other Income (part-time etc.)" value={otherIncome} onChange={setOtherIncome} min={0} max={200000} step={1000} prefix="$" />
          </div>

          <div className="space-y-3">
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
              <div className="text-xs text-gray-500 mb-2">Suggested Annual Conversion</div>
              <div className="text-3xl font-bold text-blue-400">{dollarM(roth.annualConversion)}</div>
              <div className="text-xs text-gray-600 mt-1">for {roth.bridgeYears} year{roth.bridgeYears !== 1 ? 's' : ''} to bridge {dollarM(roth.bridgeNeeded)} needed</div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <div className="text-xs text-gray-500">Marginal Tax Rate</div>
                  <div className="text-xl font-bold text-amber-400">{roth.rate}%</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Est. Tax per Year</div>
                  <div className="text-xl font-bold text-red-400">{dollarM(roth.taxOwed)}</div>
                </div>
              </div>
            </div>

            <div className="bg-gray-900 rounded-lg border border-gray-800 p-3 text-xs text-gray-500 space-y-2">
              <div className="text-gray-400 font-semibold">How the Ladder Works</div>
              <div>① Each year: convert Traditional IRA → Roth (pay income tax on converted amount)</div>
              <div>② Each conversion unlocks after exactly <span className="text-blue-400">5 years</span></div>
              <div>③ Withdraw converted principal penalty-free before age 59½</div>
              <div>④ Existing Roth contributions always withdrawable tax &amp; penalty-free</div>
              <div>⑤ At 59½, all Roth funds freely accessible</div>
            </div>
          </div>
        </div>

        {roth.schedule.length > 0 && (
          <div className="mt-4 bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Conversion Schedule (first 10 years)</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-2 text-gray-500">Year</th>
                  <th className="text-left py-2 text-gray-500">Age</th>
                  <th className="text-right py-2 text-gray-500">Convert Amount</th>
                  <th className="text-right py-2 text-gray-500">Trad. Balance After</th>
                  <th className="text-right py-2 text-gray-500">Penalty-Free Access</th>
                </tr>
              </thead>
              <tbody>
                {roth.schedule.map((row, i) => (
                  <tr key={i} className="border-b border-gray-800/40">
                    <td className="py-1.5 text-gray-300">{row.year}</td>
                    <td className="py-1.5 text-gray-300">{row.age}</td>
                    <td className="py-1.5 text-right text-blue-400">{dollarM(row.convert)}</td>
                    <td className="py-1.5 text-right text-gray-400">{dollarM(row.tradLeft)}</td>
                    <td className="py-1.5 text-right text-emerald-400">{row.accessYear} (age {row.accessAge})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
