import { useState, useMemo } from 'react'

// Benefit relative to FRA monthly amount
function getBenefit(fraMonthly, claimAge, fra) {
  const months = Math.round((claimAge - fra) * 12)
  if (months === 0) return fraMonthly
  if (months < 0) {
    const early = Math.abs(months)
    const reduction = early <= 36
      ? early * (5 / 9 / 100)
      : 36 * (5 / 9 / 100) + (early - 36) * (5 / 12 / 100)
    return fraMonthly * (1 - reduction)
  }
  return fraMonthly * (1 + months * (8 / 12 / 100))
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

function CumulativeChart({ rows, lifeExpectancy }) {
  if (!rows.length) return null
  const W = 600; const H = 160
  const maxAge = lifeExpectancy
  const maxVal = Math.max(...rows.map(r => r.cumulative)) * 1.05

  const xs = age => ((age - 62) / (maxAge - 62)) * W
  const ys = v => H - (v / maxVal) * (H - 15)

  const colors = { 62: '#ef4444', 67: '#3b82f6', 70: '#10b981' }

  const linePaths = rows
    .filter(r => [62, 67, 70].includes(r.age))
    .map(r => {
      const points = Array.from({ length: maxAge - r.age + 1 }, (_, i) => {
        const a = r.age + i
        return `${i === 0 ? 'M' : 'L'} ${xs(a).toFixed(1)} ${ys(r.monthly * 12 * (a - r.age + 1)).toFixed(1)}`
      }).join(' ')
      return { age: r.age, path: points, color: colors[r.age] }
    })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }}>
      {[0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={0} y1={ys(maxVal * f)} x2={W} y2={ys(maxVal * f)} stroke="#1f2937" strokeWidth="1" />
      ))}
      {linePaths.map(({ age, path, color }) => (
        <path key={age} d={path} fill="none" stroke={color} strokeWidth="2" />
      ))}
      {[62, 67, 70, 75, 80, lifeExpectancy].filter((a, i, arr) => arr.indexOf(a) === i && a <= maxAge).map(a => (
        <text key={a} x={xs(a)} y={H - 1} textAnchor="middle" fontSize="9" fill="#6b7280">{a}</text>
      ))}
      {[{ age: 62, color: '#ef4444', label: 'Claim 62' }, { age: 67, color: '#3b82f6', label: 'FRA' }, { age: 70, color: '#10b981', label: 'Age 70' }].map(({ age, color, label }) => {
        const row = rows.find(r => r.age === age)
        if (!row) return null
        return <text key={age} x={W - 2} y={ys(row.monthly * 12 * (maxAge - age + 1)) - 4} textAnchor="end" fontSize="8" fill={color}>{label}</text>
      })}
    </svg>
  )
}

export default function SocialSecurity() {
  const [currentAge,     setCurrentAge]     = useState(45)
  const [fra,            setFra]            = useState(67)
  const [fraMonthly,     setFraMonthly]     = useState(2500)
  const [portfolioWd,    setPortfolioWd]    = useState(4000)
  const [lifeExpectancy, setLifeExpectancy] = useState(85)

  const results = useMemo(() => {
    const ages = [62, 63, 64, 65, 66, 67, 68, 69, 70]
    const rows = ages.map(age => {
      const monthly = getBenefit(fraMonthly, age, fra)
      const yearsCollecting = Math.max(lifeExpectancy - age, 0)
      const cumulative = monthly * 12 * yearsCollecting
      return { age, monthly, annual: monthly * 12, cumulative }
    })

    // Breakeven: 62 vs 70
    const r62 = rows[0]; const r70 = rows[rows.length - 1]
    const missedYears = r70.age - r62.age
    const missedIncome = r62.annual * missedYears
    const diffPerYr = r70.annual - r62.annual
    const breakeven62v70 = diffPerYr > 0 ? Math.round(70 + missedIncome / diffPerYr) : null

    // Breakeven: 62 vs FRA
    const rFra = rows.find(r => r.age === fra)
    const missedVsFra = rFra ? r62.annual * (fra - 62) : 0
    const diffVsFra = rFra ? rFra.annual - r62.annual : 0
    const breakeven62vFra = diffVsFra > 0 ? Math.round(fra + missedVsFra / diffVsFra) : null

    return { rows, breakeven62v70, breakeven62vFra }
  }, [fraMonthly, fra, lifeExpectancy])

  const dollar = v => `$${Math.round(v).toLocaleString()}`
  const pctVsFra = m => {
    const p = ((m / fraMonthly) - 1) * 100
    return `${p >= 0 ? '+' : ''}${p.toFixed(0)}%`
  }
  const ageColor = age => {
    if (age <= 63) return 'text-red-400'
    if (age <= 65) return 'text-amber-400'
    if (age === 67) return 'text-blue-400'
    return 'text-emerald-400'
  }

  const quick62 = getBenefit(fraMonthly, 62, fra)
  const quickFra = fraMonthly
  const quick70 = getBenefit(fraMonthly, 70, fra)

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white">Social Security Optimizer</h2>
        <p className="text-xs text-gray-500 mt-0.5">Compare claiming ages 62–70 to maximise lifetime benefits and find your breakeven age</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Your Details</h3>
          <InputRow label="Current Age" value={currentAge} onChange={setCurrentAge} min={25} max={70} />
          <InputRow label="Full Retirement Age (FRA)" value={fra} onChange={setFra} min={65} max={67} note="67 if born 1960+, 66 if born 1943–1959" />
          <InputRow label="Est. Monthly Benefit at FRA" value={fraMonthly} onChange={setFraMonthly} min={500} max={5000} step={50} prefix="$" note="From your SSA.gov my Social Security statement" />
          <InputRow label="Portfolio Withdrawal / mo" value={portfolioWd} onChange={setPortfolioWd} min={0} max={20000} step={100} prefix="$" note="Added to SS for combined income column" />
          <InputRow label="Life Expectancy" value={lifeExpectancy} onChange={setLifeExpectancy} min={70} max={100} suffix="yrs" />
        </div>

        <div className="space-y-3">
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <div className="text-xs text-gray-500 mb-3">Quick Comparison — Monthly Benefit</div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[{ age: 62, monthly: quick62, label: 'Earliest' },
                { age: fra, monthly: quickFra, label: 'FRA' },
                { age: 70, monthly: quick70, label: 'Maximum' }].map(({ age, monthly, label }) => (
                <div key={age} className={`rounded border p-3 ${age === 70 ? 'border-emerald-700/60 bg-emerald-900/10' : age === fra ? 'border-blue-700/40' : 'border-gray-700'}`}>
                  <div className="text-[10px] text-gray-500 mb-0.5">{label}</div>
                  <div className="text-xs text-gray-400">Age {age}</div>
                  <div className={`text-xl font-bold mt-1 ${ageColor(age)}`}>{dollar(monthly)}</div>
                  <div className={`text-[10px] mt-1 ${monthly >= fraMonthly ? 'text-emerald-600' : 'text-red-500'}`}>
                    {pctVsFra(monthly)} vs FRA
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 text-xs space-y-2">
            <div className="text-gray-400 font-semibold mb-1">Breakeven Analysis</div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Claim 62 vs FRA ({fra})</span>
              <span className={`font-medium ${results.breakeven62vFra ? 'text-amber-400' : 'text-gray-600'}`}>
                {results.breakeven62vFra ? `Breakeven age ${results.breakeven62vFra}` : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Claim 62 vs age 70</span>
              <span className={`font-medium ${results.breakeven62v70 ? 'text-emerald-400' : 'text-gray-600'}`}>
                {results.breakeven62v70 ? `Breakeven age ${results.breakeven62v70}` : 'N/A'}
              </span>
            </div>
            {results.breakeven62v70 && (
              <div className="text-gray-600 pt-1 border-t border-gray-800">
                If you live past age {results.breakeven62v70}, delaying to 70 pays more in total lifetime benefits.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cumulative chart */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Cumulative Lifetime Benefits by Claiming Age</h3>
        <div className="text-xs text-gray-600 mb-3">Lines show running total received — where they cross is the breakeven point</div>
        <CumulativeChart rows={results.rows} lifeExpectancy={lifeExpectancy} />
      </div>

      {/* Full table */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Benefit by Claiming Age</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left py-2 text-gray-500">Claim Age</th>
              <th className="text-right py-2 text-gray-500">Monthly</th>
              <th className="text-right py-2 text-gray-500">Annual</th>
              <th className="text-right py-2 text-gray-500">vs FRA</th>
              <th className="text-right py-2 text-gray-500">Lifetime Total (to {lifeExpectancy})</th>
              <th className="text-right py-2 text-gray-500">Combined w/ Portfolio</th>
            </tr>
          </thead>
          <tbody>
            {results.rows.map(row => (
              <tr key={row.age} className={`border-b border-gray-800/40 ${row.age === fra ? 'bg-blue-900/10' : row.age === 70 ? 'bg-emerald-900/10' : ''}`}>
                <td className="py-2">
                  <span className={`font-medium ${ageColor(row.age)}`}>Age {row.age}</span>
                  {row.age === fra && <span className="ml-1.5 text-[10px] text-blue-400 bg-blue-900/30 px-1 rounded">FRA</span>}
                  {row.age === 70 && <span className="ml-1.5 text-[10px] text-emerald-400 bg-emerald-900/30 px-1 rounded">Max</span>}
                </td>
                <td className={`py-2 text-right font-medium ${ageColor(row.age)}`}>{dollar(row.monthly)}</td>
                <td className="py-2 text-right text-gray-300">{dollar(row.annual)}</td>
                <td className={`py-2 text-right ${row.monthly >= fraMonthly ? 'text-emerald-400' : 'text-red-400'}`}>{pctVsFra(row.monthly)}</td>
                <td className="py-2 text-right text-gray-300">{dollar(row.cumulative)}</td>
                <td className="py-2 text-right text-gray-300">{dollar(row.monthly + portfolioWd)}/mo</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Strategy guide */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
        <div>
          <div className="text-red-400 font-semibold mb-2">Claim Early (62–64)</div>
          <div className="text-gray-500 space-y-1.5">
            <div>✓ More years of payments</div>
            <div>✓ Better if health is a concern</div>
            <div>✓ Reduces early portfolio drawdown</div>
            <div>✗ Permanent 20–30% reduction</div>
            <div>✗ Earnings limit if still working</div>
          </div>
        </div>
        <div>
          <div className="text-blue-400 font-semibold mb-2">Claim at FRA ({fra})</div>
          <div className="text-gray-500 space-y-1.5">
            <div>✓ No reduction, no penalty</div>
            <div>✓ Solid middle ground</div>
            <div>✓ No earnings limit applies</div>
            <div>✓ Aligns with Medicare at 65</div>
          </div>
        </div>
        <div>
          <div className="text-emerald-400 font-semibold mb-2">Delay to 70</div>
          <div className="text-gray-500 space-y-1.5">
            <div>✓ +24% vs FRA benefit</div>
            <div>✓ Best inflation protection</div>
            <div>✓ Maximises survivor benefit</div>
            <div>✓ Ideal for long life expectancy</div>
            <div>✗ Needs portfolio bridge 65–70</div>
          </div>
        </div>
      </div>
    </div>
  )
}
