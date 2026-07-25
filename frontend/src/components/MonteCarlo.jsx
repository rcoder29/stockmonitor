import { useState, useMemo } from 'react'

const SIMS = 1000

function randn(mean, std) {
  let u1
  do { u1 = Math.random() } while (u1 === 0)
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random())
  return mean + std * z
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

function FanChart({ percentiles, years }) {
  if (!percentiles || !percentiles[50]?.length) return null
  const W = 600; const H = 200

  const allVals = [percentiles[10], percentiles[90]].flat().filter(v => v > 0)
  const maxVal = Math.max(...allVals, 1) * 1.05

  const xs = i => (i / years) * W
  const ys = v => H - (Math.max(0, v) / maxVal) * (H - 20) - 2

  const makePath = arr =>
    arr.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join(' ')

  const bandPath = (lo, hi) => [
    ...lo.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`),
    ...[...hi].reverse().map((v, i) => `L ${xs(hi.length - 1 - i).toFixed(1)} ${ys(v).toFixed(1)}`),
    'Z',
  ].join(' ')

  const gridVals = [0.25, 0.5, 0.75, 1].map(f => maxVal * f)
  const labelIdxs = [0, Math.floor(years / 2), years]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }}>
      {gridVals.map(v => (
        <g key={v}>
          <line x1={0} y1={ys(v)} x2={W} y2={ys(v)} stroke="#1f2937" strokeWidth="1" />
          <text x={2} y={ys(v) - 2} fontSize="8" fill="#4b5563">${(v / 1e6).toFixed(1)}M</text>
        </g>
      ))}
      <path d={bandPath(percentiles[10], percentiles[90])} fill="#3b82f6" opacity="0.08" />
      <path d={bandPath(percentiles[25], percentiles[75])} fill="#3b82f6" opacity="0.18" />
      <path d={makePath(percentiles[50])} fill="none" stroke="#60a5fa" strokeWidth="2" />
      <line x1={0} y1={ys(0)} x2={W} y2={ys(0)} stroke="#ef4444" strokeWidth="1" strokeDasharray="4 2" opacity="0.5" />
      {labelIdxs.map(i => (
        <text key={i} x={xs(i)} y={H - 1} textAnchor="middle" fontSize="9" fill="#6b7280">Yr {i}</text>
      ))}
    </svg>
  )
}

export default function MonteCarlo() {
  const [portfolioVal,     setPortfolioVal]     = useState(2000000)
  const [annualWithdrawal, setAnnualWithdrawal] = useState(80000)
  const [years,            setYears]            = useState(35)
  const [meanReturn,       setMeanReturn]       = useState(7)
  const [stdDev,           setStdDev]           = useState(15)
  const [inflationRate,    setInflationRate]    = useState(3)

  const results = useMemo(() => {
    const r   = meanReturn / 100
    const std = stdDev / 100
    const inf = inflationRate / 100

    const paths = []
    let successes = 0

    for (let s = 0; s < SIMS; s++) {
      const path = [portfolioVal]
      let bal = portfolioVal
      let withdrawal = annualWithdrawal
      let depleted = false

      for (let y = 1; y <= years; y++) {
        if (!depleted) {
          bal = (bal - withdrawal) * (1 + randn(r, std))
          withdrawal *= (1 + inf)
          if (bal <= 0) { depleted = true; bal = 0 }
        }
        path.push(bal)
      }
      paths.push(path)
      if (!depleted) successes++
    }

    const pctKeys = [10, 25, 50, 75, 90]
    const percentiles = {}
    pctKeys.forEach(p => {
      percentiles[p] = Array.from({ length: years + 1 }, (_, y) => {
        const vals = [...paths.map(path => path[y])].sort((a, b) => a - b)
        return vals[Math.floor((p / 100) * (SIMS - 1))]
      })
    })

    return {
      successRate: (successes / SIMS * 100).toFixed(1),
      percentiles,
      medianFinal: percentiles[50][years],
      p10Final:    percentiles[10][years],
      swrPct:      ((annualWithdrawal / portfolioVal) * 100).toFixed(2),
    }
  }, [portfolioVal, annualWithdrawal, years, meanReturn, stdDev, inflationRate])

  const dollarM = v => {
    const n = Math.max(0, v)
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
    return '$0'
  }

  const successColor = r => {
    const n = parseFloat(r)
    if (n >= 90) return 'text-emerald-400'
    if (n >= 75) return 'text-blue-400'
    if (n >= 60) return 'text-amber-400'
    return 'text-red-400'
  }

  const successMsg = r => {
    const n = parseFloat(r)
    if (n >= 90) return '✓ Excellent — very safe withdrawal rate'
    if (n >= 75) return '◈ Good — acceptable for most plans'
    if (n >= 60) return '⚠ Risky — consider reducing withdrawal'
    return '✗ High failure risk — portfolio likely depleted'
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-white">Monte Carlo Simulator</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Runs {SIMS.toLocaleString()} simulations with randomised annual returns to estimate the probability your portfolio survives retirement
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Parameters</h3>
          <InputRow label="Starting Portfolio" value={portfolioVal} onChange={setPortfolioVal} min={100000} max={20000000} step={50000} prefix="$" />
          <InputRow label="Annual Withdrawal" value={annualWithdrawal} onChange={setAnnualWithdrawal} min={10000} max={1000000} step={5000} prefix="$" />
          <InputRow label="Years in Retirement" value={years} onChange={setYears} min={10} max={60} />
          <InputRow label="Mean Annual Return" value={meanReturn} onChange={setMeanReturn} min={1} max={20} step={0.5} suffix="%" note="Nominal (historical S&P ~10%, 60/40 ~7%)" />
          <InputRow label="Return Std Deviation" value={stdDev} onChange={setStdDev} min={1} max={40} step={0.5} suffix="%" note="Historical S&P ~15%, 60/40 ~10%" />
          <InputRow label="Inflation Rate" value={inflationRate} onChange={setInflationRate} min={0} max={10} step={0.5} suffix="%" />
        </div>

        <div className="space-y-3">
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-5 text-center">
            <div className="text-xs text-gray-500 mb-2">Portfolio Survival Rate</div>
            <div className={`text-6xl font-bold ${successColor(results.successRate)}`}>{results.successRate}%</div>
            <div className="text-xs text-gray-600 mt-2">of {SIMS.toLocaleString()} simulations lasted {years} years</div>
            <div className={`mt-3 text-xs ${successColor(results.successRate)}`}>{successMsg(results.successRate)}</div>
            <div className="mt-2 text-xs text-gray-600">SWR: {results.swrPct}%</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
              <div className="text-xs text-gray-500 mb-1">Median Ending Balance</div>
              <div className="text-lg font-bold text-blue-400">{dollarM(results.medianFinal)}</div>
              <div className="text-xs text-gray-600">50th percentile</div>
            </div>
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
              <div className="text-xs text-gray-500 mb-1">Worst 10% Case</div>
              <div className={`text-lg font-bold ${results.p10Final > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                {results.p10Final > 0 ? dollarM(results.p10Final) : 'Depleted'}
              </div>
              <div className="text-xs text-gray-600">10th percentile</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Portfolio Value Over Retirement</h3>
        <div className="text-xs text-gray-600 mb-3">
          Dark band = 25th–75th percentile · Light band = 10th–90th · Blue line = median · Red line = zero
        </div>
        <FanChart percentiles={results.percentiles} years={years} />
      </div>

      <div className="mt-4 bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Final Balance by Scenario</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left py-2 text-gray-500">Scenario</th>
              <th className="text-right py-2 text-gray-500">Final Balance</th>
              <th className="text-right py-2 text-gray-500">vs Starting Portfolio</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'Best 10%  (90th pct)', key: 90, color: 'text-emerald-400' },
              { label: 'Good case (75th pct)', key: 75, color: 'text-blue-400' },
              { label: 'Median    (50th pct)', key: 50, color: 'text-blue-300' },
              { label: 'Bad case  (25th pct)', key: 25, color: 'text-amber-400' },
              { label: 'Worst 10% (10th pct)', key: 10, color: 'text-red-400' },
            ].map(row => {
              const val = results.percentiles[row.key]?.[years] ?? 0
              const pctChg = ((val / portfolioVal - 1) * 100).toFixed(0)
              return (
                <tr key={row.key} className="border-b border-gray-800/40">
                  <td className="py-2 text-gray-400 font-mono">{row.label}</td>
                  <td className={`py-2 text-right font-medium ${row.color}`}>
                    {val > 0 ? dollarM(val) : <span className="text-red-500">Depleted</span>}
                  </td>
                  <td className={`py-2 text-right ${val >= portfolioVal ? 'text-emerald-400' : val > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                    {val > 0 ? `${Number(pctChg) >= 0 ? '+' : ''}${pctChg}%` : '—'}
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
