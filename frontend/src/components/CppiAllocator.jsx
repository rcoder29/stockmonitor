import { useState, useEffect, useCallback } from 'react'

const PERIODS = [
  { id: '6mo', label: '6M' },
  { id: '1y',  label: '1Y' },
  { id: '2y',  label: '2Y' },
  { id: '5y',  label: '5Y' },
]

const fmtMoney = v => v == null ? '—' : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPct   = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
      <div className="text-gray-500 text-xs uppercase tracking-widest">{label}</div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-gray-600 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

function AllocationBar({ targetPct, actualPct }) {
  const t = Math.max(0, Math.min(100, targetPct))
  const a = Math.max(0, Math.min(100, actualPct))
  return (
    <div className="space-y-3">
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Actual allocation</span>
          <span className="tabular-nums">{a.toFixed(1)}% risky / {(100 - a).toFixed(1)}% safe</span>
        </div>
        <div className="h-6 rounded-lg overflow-hidden flex bg-gray-800 border border-gray-700">
          <div className="bg-amber-500/80 flex items-center justify-center text-[10px] font-medium text-gray-900" style={{ width: `${a}%` }} />
          <div className="bg-blue-500/60 flex-1" />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Target allocation (CPPI formula)</span>
          <span className="tabular-nums">{t.toFixed(1)}% risky / {(100 - t).toFixed(1)}% safe</span>
        </div>
        <div className="h-6 rounded-lg overflow-hidden flex bg-gray-800 border border-gray-700">
          <div className="bg-emerald-500/80" style={{ width: `${t}%` }} />
          <div className="bg-blue-500/60 flex-1" />
        </div>
      </div>
      <div className="flex items-center gap-4 justify-center text-xs text-gray-500 pt-1">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500/80 inline-block" />Actual risky</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80 inline-block" />Target risky</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500/60 inline-block" />Safe asset</span>
      </div>
    </div>
  )
}

function CppiChart({ dates, cppiEquity, benchmark, floorLine }) {
  if (!cppiEquity?.length) return null
  const W = 680, H = 240, PL = 55, PR = 10, PT = 15, PB = 28
  const n = cppiEquity.length
  const allVals = [...cppiEquity, ...benchmark, ...floorLine].filter(v => v != null)
  const lo = Math.min(...allVals), hi = Math.max(...allVals)
  const pad = (hi - lo) * 0.05 || 1
  const yLo = lo - pad, yHi = hi + pad

  const toX = i => PL + (i / (n - 1)) * (W - PL - PR)
  const toY = v => PT + (1 - (v - yLo) / (yHi - yLo)) * (H - PT - PB)

  const makePath = pts => {
    let d = ''
    pts.forEach((v, i) => {
      if (v == null) return
      d += d ? ` L${toX(i).toFixed(1)},${toY(v).toFixed(1)}` : `M${toX(i).toFixed(1)},${toY(v).toFixed(1)}`
    })
    return d
  }

  const ticks = []
  const range = yHi - yLo
  const step = range < 2000 ? 500 : range < 5000 ? 1000 : range < 20000 ? 2000 : 5000
  for (let v = Math.ceil(yLo / step) * step; v <= yHi; v += step) ticks.push(v)

  const xLabels = [0, 1, 2, 3, 4].map(i => {
    const idx = Math.round(i * (n - 1) / 4)
    return { idx, label: dates[idx]?.slice(0, 7) ?? '' }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {ticks.map(v => (
        <g key={v}>
          <line x1={PL} y1={toY(v)} x2={W - PR} y2={toY(v)} stroke="#1f2937" strokeWidth="1" />
          <text x={PL - 4} y={toY(v)} textAnchor="end" dominantBaseline="middle" fill="#4b5563" fontSize="9">
            ${(v / 1000).toFixed(1)}k
          </text>
        </g>
      ))}
      {xLabels.map(({ idx, label }) => (
        <text key={idx} x={toX(idx)} y={H - 6} textAnchor="middle" fill="#4b5563" fontSize="9">{label}</text>
      ))}
      <path d={makePath(floorLine)} fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="2,3" opacity="0.7" />
      <path d={makePath(benchmark)} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.6" />
      <path d={makePath(cppiEquity)} fill="none" stroke="#10b981" strokeWidth="2.5" />
    </svg>
  )
}

export default function CppiAllocator() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rebalancing, setRebalancing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  // Setup form
  const [symbol, setSymbol] = useState('SPY')
  const [capital, setCapital] = useState(10000)
  const [floorPct, setFloorPct] = useState(90)
  const [multiplier, setMultiplier] = useState(4)
  const [safeRate, setSafeRate] = useState(4.5)
  const [band, setBand] = useState(5)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Backtest
  const [btSymbol, setBtSymbol] = useState('SPY')
  const [btPeriod, setBtPeriod] = useState('2y')
  const [btCapital, setBtCapital] = useState(10000)
  const [btFloor, setBtFloor] = useState(90)
  const [btMult, setBtMult] = useState(4)
  const [btSafeRate, setBtSafeRate] = useState(4.5)
  const [btBand, setBtBand] = useState(5)
  const [btData, setBtData] = useState(null)
  const [btLoading, setBtLoading] = useState(false)
  const [btError, setBtError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/cppi')
      if (!r.ok) throw new Error('Failed to load CPPI strategy')
      setData(await r.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function createStrategy(e) {
    e.preventDefault()
    setCreating(true); setCreateError('')
    try {
      const r = await fetch('/api/cppi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          risky_symbol: symbol.trim().toUpperCase(),
          initial_capital: capital,
          floor_pct: floorPct,
          multiplier,
          safe_rate_pct: safeRate,
          rebalance_band_pct: band,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).detail || 'Could not create strategy')
      await load()
    } catch (e) {
      setCreateError(e.message)
    } finally {
      setCreating(false)
    }
  }

  async function doRebalance() {
    setRebalancing(true)
    try {
      const r = await fetch('/api/cppi/rebalance', { method: 'POST' })
      if (!r.ok) throw new Error((await r.json()).detail || 'Rebalance failed')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setRebalancing(false)
    }
  }

  async function doReset() {
    setResetting(true)
    try {
      await fetch('/api/cppi', { method: 'DELETE' })
      setConfirmReset(false)
      await load()
    } finally {
      setResetting(false)
    }
  }

  async function runBacktest(e) {
    e.preventDefault()
    setBtLoading(true); setBtError(''); setBtData(null)
    try {
      const r = await fetch('/api/cppi/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: btSymbol.trim().toUpperCase(),
          period: btPeriod,
          initial_capital: btCapital,
          floor_pct: btFloor,
          multiplier: btMult,
          safe_rate_pct: btSafeRate,
          rebalance_band_pct: btBand,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).detail || 'Backtest failed')
      setBtData(await r.json())
    } catch (e) {
      setBtError(e.message)
    } finally {
      setBtLoading(false)
    }
  }

  const s = data?.state
  const c = data?.config
  const bs = btData?.stats

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-5">
      <div>
        <h2 className="text-white font-bold text-lg">CPPI Allocator</h2>
        <p className="text-gray-500 text-xs mt-0.5">
          Constant Proportion Portfolio Insurance — dynamically shifts capital between a risky asset and a safe asset
          so the portfolio never (in theory) falls below a floor value. Exposure = multiplier × (portfolio value − floor).
        </p>
      </div>

      {loading && <div className="text-gray-500 text-sm">Loading…</div>}
      {error && <div className="text-red-400 text-sm bg-red-950/30 border border-red-800/50 rounded-lg p-3">{error}</div>}

      {!loading && data && !data.active && (
        <form onSubmit={createStrategy} className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="text-gray-300 text-sm font-medium">Start a CPPI strategy</div>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Risky Asset</label>
              <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="e.g. SPY" maxLength={10} required
                className="bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-28" />
            </div>
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Initial Capital</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input type="number" value={capital} onChange={e => setCapital(Number(e.target.value))} min={100} step={1000}
                  className="bg-gray-800 border border-gray-700 text-white pl-6 pr-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-32" />
              </div>
            </div>
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Floor %</label>
              <input type="number" value={floorPct} onChange={e => setFloorPct(Number(e.target.value))} min={1} max={99} step={1}
                className="bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-20" />
            </div>
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Multiplier</label>
              <input type="number" value={multiplier} onChange={e => setMultiplier(Number(e.target.value))} min={1} max={10} step={0.5}
                className="bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-20" />
            </div>
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Safe Rate %/yr</label>
              <input type="number" value={safeRate} onChange={e => setSafeRate(Number(e.target.value))} min={0} max={20} step={0.25}
                className="bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-24" />
            </div>
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Rebalance Band %</label>
              <input type="number" value={band} onChange={e => setBand(Number(e.target.value))} min={1} max={30} step={1}
                className="bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-24" />
            </div>
          </div>
          <p className="text-gray-600 text-xs">
            Floor = {floorPct}% of initial capital, growing at the safe rate. When the risky asset's weight drifts more
            than {band} percentage points from target, a rebalance is recommended.
          </p>
          {createError && <div className="text-red-400 text-xs">{createError}</div>}
          <button type="submit" disabled={creating}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-6 py-2 rounded-lg transition-colors text-sm">
            {creating ? 'Starting…' : 'Start Strategy'}
          </button>
        </form>
      )}

      {!loading && data && data.active && s && c && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Portfolio Value" value={fmtMoney(s.portfolioValue)}
              color={s.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}
              sub={`${fmtPct(s.totalReturnPct)} since ${c.startDate}`} />
            <StatCard label="Floor" value={fmtMoney(s.floorValue)}
              sub={s.distanceToFloorPct != null ? `${s.distanceToFloorPct.toFixed(1)}% above floor` : null}
              color="text-red-300" />
            <StatCard label="Cushion" value={fmtMoney(s.cushion)} sub={`${c.multiplier}× multiplier`} />
            <StatCard label="Risky Exposure" value={fmtMoney(s.riskyExposure)}
              color="text-amber-400" sub={`${s.actualExposurePct.toFixed(1)}% of portfolio · ${c.riskySymbol} @ $${s.riskyPrice}`} />
            <StatCard label="Safe Allocation" value={fmtMoney(s.safeCash)} color="text-blue-400"
              sub={`${(100 - s.actualExposurePct).toFixed(1)}% of portfolio`} />
            <StatCard label="Target Exposure" value={fmtMoney(s.targetExposure)}
              sub={`${s.targetExposurePct.toFixed(1)}% target`} />
            <StatCard label="Drift" value={`${s.driftPct >= 0 ? '+' : ''}${s.driftPct.toFixed(1)}pp`}
              color={Math.abs(s.driftPct) > c.rebalanceBandPct ? 'text-red-400' : 'text-gray-300'}
              sub={`band ±${c.rebalanceBandPct}pp`} />
            <StatCard label="Shares Held" value={s.riskySharesHeld.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              sub={c.riskySymbol} />
          </div>

          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
            <div className="text-gray-500 text-xs uppercase tracking-widest mb-3">Allocation</div>
            <AllocationBar targetPct={s.targetExposurePct} actualPct={s.actualExposurePct} />
          </div>

          {s.needsRebalance ? (
            <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="text-amber-300 text-sm">
                <span className="font-semibold">Rebalance recommended</span> — drift is {Math.abs(s.driftPct).toFixed(1)}pp,
                beyond the ±{c.rebalanceBandPct}pp band. {s.recommendedTrade >= 0 ? 'Buy' : 'Sell'}{' '}
                <span className="tabular-nums font-medium">{fmtMoney(Math.abs(s.recommendedTrade))}</span> of {c.riskySymbol}
                {s.recommendedTrade >= 0 ? ', funded from the safe asset.' : ', moving proceeds to the safe asset.'}
              </div>
              <button onClick={doRebalance} disabled={rebalancing}
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm shrink-0">
                {rebalancing ? 'Rebalancing…' : 'Rebalance Now'}
              </button>
            </div>
          ) : (
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="text-gray-500 text-sm">Within band — no rebalance needed right now.</div>
              <button onClick={doRebalance} disabled={rebalancing}
                className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 font-medium px-4 py-2 rounded-lg text-sm shrink-0 border border-gray-700">
                {rebalancing ? 'Rebalancing…' : 'Force Rebalance'}
              </button>
            </div>
          )}

          {data.log?.length > 0 && (
            <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 text-gray-500 text-xs uppercase tracking-widest">
                Rebalance Log ({data.log.length})
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900">
                    <tr className="border-b border-gray-800">
                      {['Date', 'Price', 'Portfolio', 'Floor', 'Trade', 'Trigger'].map((h, i) => (
                        <th key={h} className={`py-2 px-3 text-gray-500 font-medium uppercase tracking-wider ${i === 0 || i === 5 ? 'text-left' : 'text-right'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.log.map((r, i) => (
                      <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                        <td className="py-2 px-3 text-gray-500 tabular-nums">{r.date}</td>
                        <td className="py-2 px-3 text-right text-gray-300 tabular-nums">${r.riskyPrice.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right text-gray-300 tabular-nums">{fmtMoney(r.portfolioValue)}</td>
                        <td className="py-2 px-3 text-right text-gray-500 tabular-nums">{fmtMoney(r.floorValue)}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${r.tradeAmount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {r.tradeAmount >= 0 ? '+' : ''}{fmtMoney(r.tradeAmount)}
                        </td>
                        <td className="py-2 px-3">
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">{r.trigger}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            {!confirmReset ? (
              <button onClick={() => setConfirmReset(true)}
                className="text-gray-600 hover:text-red-400 text-xs transition-colors">
                Reset strategy…
              </button>
            ) : (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">End this strategy and clear its history?</span>
                <button onClick={doReset} disabled={resetting}
                  className="text-red-400 hover:text-red-300 font-medium disabled:opacity-50">
                  {resetting ? 'Resetting…' : 'Confirm reset'}
                </button>
                <button onClick={() => setConfirmReset(false)} className="text-gray-500 hover:text-gray-300">Cancel</button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Backtest panel */}
      <div className="pt-4 border-t border-gray-800 space-y-4">
        <div>
          <h3 className="text-white font-semibold text-sm">Backtest CPPI</h3>
          <p className="text-gray-500 text-xs mt-0.5">See how this strategy would have performed historically vs. buy &amp; hold.</p>
        </div>

        <form onSubmit={runBacktest} className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Symbol</label>
              <input value={btSymbol} onChange={e => setBtSymbol(e.target.value.toUpperCase())} placeholder="e.g. SPY" maxLength={10} required
                className="bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-28" />
            </div>
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Period</label>
              <div className="flex rounded overflow-hidden border border-gray-700">
                {PERIODS.map(({ id, label }) => (
                  <button key={id} type="button" onClick={() => setBtPeriod(id)}
                    className={`px-3 py-2 text-xs transition-colors ${btPeriod === id ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Capital</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input type="number" value={btCapital} onChange={e => setBtCapital(Number(e.target.value))} min={100} step={1000}
                  className="bg-gray-800 border border-gray-700 text-white pl-6 pr-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-32" />
              </div>
            </div>
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Floor %</label>
              <input type="number" value={btFloor} onChange={e => setBtFloor(Number(e.target.value))} min={1} max={99}
                className="bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-20" />
            </div>
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Multiplier</label>
              <input type="number" value={btMult} onChange={e => setBtMult(Number(e.target.value))} min={1} max={10} step={0.5}
                className="bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-20" />
            </div>
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Safe Rate %/yr</label>
              <input type="number" value={btSafeRate} onChange={e => setBtSafeRate(Number(e.target.value))} min={0} max={20} step={0.25}
                className="bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-24" />
            </div>
            <div>
              <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Band %</label>
              <input type="number" value={btBand} onChange={e => setBtBand(Number(e.target.value))} min={1} max={30}
                className="bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-20" />
            </div>
          </div>
          <button type="submit" disabled={btLoading}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-6 py-2 rounded-lg transition-colors text-sm">
            {btLoading ? 'Running backtest…' : 'Run Backtest'}
          </button>
        </form>

        {btError && <div className="text-red-400 text-sm bg-red-950/30 border border-red-800/50 rounded-lg p-3">{btError}</div>}

        {btData && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="CPPI Return" value={fmtPct(bs.totalReturn)}
                color={bs.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}
                sub={`vs ${fmtPct(bs.bhReturn)} buy & hold`} />
              <StatCard label="Alpha" value={fmtPct(bs.alpha)} color={bs.alpha >= 0 ? 'text-emerald-400' : 'text-red-400'} />
              <StatCard label="CPPI Max Drawdown" value={fmtPct(bs.maxDrawdown)}
                color={bs.maxDrawdown < -20 ? 'text-red-400' : bs.maxDrawdown < -10 ? 'text-amber-400' : 'text-gray-300'}
                sub={`vs ${fmtPct(bs.bhMaxDrawdown)} buy & hold`} />
              <StatCard label="Rebalances" value={bs.numRebalances}
                sub={bs.floorBreached ? 'Floor was breached (gap risk)' : 'Floor never breached'}
                color={bs.floorBreached ? 'text-red-400' : 'text-emerald-400'} />
            </div>

            <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
              <div className="text-gray-500 text-xs uppercase tracking-widest mb-3">CPPI vs Buy &amp; Hold vs Floor</div>
              <CppiChart dates={btData.dates} cppiEquity={btData.cppiEquity} benchmark={btData.benchmark} floorLine={btData.floorLine} />
              <div className="flex items-center gap-5 justify-center mt-2">
                {[['CPPI', '#10b981', 'solid'], ['Buy & Hold', '#3b82f6', 'dashed'], ['Floor', '#ef4444', 'dotted']].map(([label, color, style]) => (
                  <span key={label} className="flex items-center gap-1.5 text-xs text-gray-400">
                    <svg width="16" height="4" className="inline">
                      <line x1="0" y1="2" x2="16" y2="2" stroke={color} strokeWidth="2"
                        strokeDasharray={style === 'dashed' ? '4,2' : style === 'dotted' ? '2,3' : 'none'} />
                    </svg>
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {btData.rebalances?.length > 0 && (
              <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800 text-gray-500 text-xs uppercase tracking-widest">
                  Simulated Rebalances ({btData.rebalances.length})
                </div>
                <div className="overflow-x-auto max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-900">
                      <tr className="border-b border-gray-800">
                        {['Date', 'Action', 'Price', 'Risky %'].map((h, i) => (
                          <th key={h} className={`py-2 px-3 text-gray-500 font-medium uppercase tracking-wider ${i < 2 ? 'text-left' : 'text-right'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {btData.rebalances.map((r, i) => (
                        <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                          <td className="py-2 px-3 text-gray-500 tabular-nums">{r.date}</td>
                          <td className="py-2 px-3">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                              r.action === 'BUY' ? 'bg-emerald-900/60 text-emerald-400'
                              : r.action === 'SELL' ? 'bg-red-900/60 text-red-400'
                              : 'bg-gray-800 text-gray-400'}`}>
                              {r.action}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-gray-300 tabular-nums">${r.price.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-gray-300 tabular-nums">{r.exposurePct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
