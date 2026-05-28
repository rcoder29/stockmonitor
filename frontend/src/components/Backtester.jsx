import { useState } from 'react'

const STRATEGIES = [
  { id: 'ma_cross', label: 'MA Crossover',    desc: 'Buy when fast MA crosses above slow MA' },
  { id: 'rsi',      label: 'RSI Reversal',     desc: 'Buy oversold, sell overbought' },
  { id: 'bb',       label: 'Bollinger Bands',  desc: 'Buy lower band touch, sell upper band' },
]

const PERIODS = [
  { id: '6mo', label: '6M' },
  { id: '1y',  label: '1Y' },
  { id: '2y',  label: '2Y' },
  { id: '5y',  label: '5Y' },
]

function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
      <div className="text-gray-500 text-xs uppercase tracking-widest">{label}</div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-gray-600 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

function EquityChart({ dates, equity, benchmark }) {
  if (!equity?.length) return null
  const W = 680, H = 220, PL = 55, PR = 10, PT = 15, PB = 28
  const n = equity.length
  const allVals = [...equity, ...benchmark].filter(v => v != null)
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
  const step = range < 2000 ? 500 : range < 5000 ? 1000 : 2000
  for (let v = Math.ceil(yLo / step) * step; v <= yHi; v += step)
    ticks.push(v)

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
            ${(v / 1000).toFixed(0)}k
          </text>
        </g>
      ))}
      {xLabels.map(({ idx, label }) => (
        <text key={idx} x={toX(idx)} y={H - 6} textAnchor="middle" fill="#4b5563" fontSize="9">{label}</text>
      ))}
      <path d={makePath(benchmark)} fill="none" stroke="#3b82f6" strokeWidth="1.5" opacity="0.6" strokeDasharray="4,3" />
      <path d={makePath(equity)}    fill="none" stroke="#10b981" strokeWidth="2.5" />
    </svg>
  )
}

export default function Backtester() {
  const [symbol,      setSymbol]      = useState('')
  const [strategy,    setStrategy]    = useState('ma_cross')
  const [period,      setPeriod]      = useState('1y')
  const [fastPeriod,  setFastPeriod]  = useState(20)
  const [slowPeriod,  setSlowPeriod]  = useState(50)
  const [rsiPeriod,   setRsiPeriod]   = useState(14)
  const [rsiOs,       setRsiOs]       = useState(30)
  const [rsiOb,       setRsiOb]       = useState(70)
  const [bbPeriod,    setBbPeriod]    = useState(20)
  const [bbStd,       setBbStd]       = useState(2)
  const [capital,     setCapital]     = useState(10000)
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')

  async function runBacktest(e) {
    e.preventDefault()
    if (!symbol.trim()) return
    setLoading(true); setError(''); setData(null)
    try {
      const body = {
        symbol: symbol.trim().toUpperCase(),
        strategy,
        period,
        fast_period:    fastPeriod,
        slow_period:    slowPeriod,
        rsi_period:     rsiPeriod,
        rsi_oversold:   rsiOs,
        rsi_overbought: rsiOb,
        bb_period:      bbPeriod,
        bb_std:         bbStd,
        initial_capital: capital,
      }
      const r = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error((await r.json()).detail || 'Backtest failed')
      setData(await r.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const s = data?.stats
  const fmtPct = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
  const fmtMoney = v => v == null ? '—' : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-5">
      <div>
        <h2 className="text-white font-bold text-lg">Strategy Backtester</h2>
        <p className="text-gray-500 text-xs mt-0.5">Test technical strategies against historical data</p>
      </div>

      <form onSubmit={runBacktest} className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
        {/* Row 1: Symbol + Period + Capital */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Symbol</label>
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. AAPL"
              maxLength={10}
              required
              className="bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-28"
            />
          </div>
          <div>
            <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Period</label>
            <div className="flex rounded overflow-hidden border border-gray-700">
              {PERIODS.map(({ id, label }) => (
                <button key={id} type="button" onClick={() => setPeriod(id)}
                  className={`px-3 py-2 text-xs transition-colors ${period === id ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-gray-500 text-xs uppercase tracking-widest block mb-1">Starting Capital</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                value={capital}
                onChange={e => setCapital(Number(e.target.value))}
                min={100}
                step={1000}
                className="bg-gray-800 border border-gray-700 text-white pl-6 pr-3 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-32"
              />
            </div>
          </div>
        </div>

        {/* Strategy selector */}
        <div>
          <label className="text-gray-500 text-xs uppercase tracking-widest block mb-2">Strategy</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {STRATEGIES.map(st => (
              <button
                key={st.id}
                type="button"
                onClick={() => setStrategy(st.id)}
                className={`text-left px-4 py-3 rounded-lg border transition-colors ${
                  strategy === st.id
                    ? 'border-emerald-600 bg-emerald-900/30 text-emerald-300'
                    : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
                }`}
              >
                <div className="font-medium text-sm">{st.label}</div>
                <div className="text-xs text-gray-600 mt-0.5">{st.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Strategy params */}
        <div className="flex flex-wrap gap-4">
          {strategy === 'ma_cross' && (
            <>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Fast MA</label>
                <input type="number" value={fastPeriod} onChange={e => setFastPeriod(+e.target.value)} min={2} max={200}
                  className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 text-sm rounded-lg w-20 focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Slow MA</label>
                <input type="number" value={slowPeriod} onChange={e => setSlowPeriod(+e.target.value)} min={2} max={200}
                  className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 text-sm rounded-lg w-20 focus:outline-none focus:border-emerald-500" />
              </div>
            </>
          )}
          {strategy === 'rsi' && (
            <>
              <div>
                <label className="text-gray-500 text-xs block mb-1">RSI Period</label>
                <input type="number" value={rsiPeriod} onChange={e => setRsiPeriod(+e.target.value)} min={2} max={50}
                  className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 text-sm rounded-lg w-20 focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Oversold</label>
                <input type="number" value={rsiOs} onChange={e => setRsiOs(+e.target.value)} min={1} max={49}
                  className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 text-sm rounded-lg w-20 focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Overbought</label>
                <input type="number" value={rsiOb} onChange={e => setRsiOb(+e.target.value)} min={51} max={99}
                  className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 text-sm rounded-lg w-20 focus:outline-none focus:border-emerald-500" />
              </div>
            </>
          )}
          {strategy === 'bb' && (
            <>
              <div>
                <label className="text-gray-500 text-xs block mb-1">BB Period</label>
                <input type="number" value={bbPeriod} onChange={e => setBbPeriod(+e.target.value)} min={5} max={100}
                  className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 text-sm rounded-lg w-20 focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Std Dev</label>
                <input type="number" value={bbStd} onChange={e => setBbStd(+e.target.value)} min={0.5} max={4} step={0.5}
                  className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 text-sm rounded-lg w-20 focus:outline-none focus:border-emerald-500" />
              </div>
            </>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-6 py-2 rounded-lg transition-colors text-sm"
        >
          {loading ? 'Running backtest…' : 'Run Backtest'}
        </button>
      </form>

      {error && <div className="text-red-400 text-sm bg-red-950/30 border border-red-800/50 rounded-lg p-3">{error}</div>}

      {data && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Return" value={fmtPct(s.total_return)}
              color={s.total_return >= 0 ? 'text-emerald-400' : 'text-red-400'}
              sub={`vs ${fmtPct(s.bh_return)} buy & hold`} />
            <StatCard label="Alpha" value={fmtPct(s.alpha)}
              color={s.alpha >= 0 ? 'text-emerald-400' : 'text-red-400'}
              sub="vs buy & hold" />
            <StatCard label="Max Drawdown" value={fmtPct(s.max_drawdown)}
              color={s.max_drawdown < -20 ? 'text-red-400' : s.max_drawdown < -10 ? 'text-amber-400' : 'text-gray-300'} />
            <StatCard label="Sharpe Ratio" value={s.sharpe.toFixed(2)}
              color={s.sharpe >= 1.5 ? 'text-emerald-400' : s.sharpe >= 0.5 ? 'text-amber-400' : 'text-gray-300'}
              sub={s.sharpe >= 1.5 ? 'Excellent' : s.sharpe >= 0.5 ? 'Average' : 'Below average'} />
            <StatCard label="Win Rate" value={`${s.win_rate.toFixed(1)}%`}
              color={s.win_rate >= 60 ? 'text-emerald-400' : s.win_rate >= 45 ? 'text-amber-400' : 'text-red-400'} />
            <StatCard label="# Trades" value={s.num_trades}
              sub={s.num_trades === 0 ? 'No signals fired' : null} />
            <StatCard label="Final Equity" value={fmtMoney(s.final_equity)}
              color={s.final_equity >= capital ? 'text-emerald-400' : 'text-red-400'}
              sub={`Started ${fmtMoney(capital)}`} />
            <StatCard label="B&H Return" value={fmtPct(s.bh_return)}
              color={s.bh_return >= 0 ? 'text-blue-400' : 'text-red-400'}
              sub="Passive benchmark" />
          </div>

          {/* Equity curve */}
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
            <div className="text-gray-500 text-xs uppercase tracking-widest mb-3">Equity Curve</div>
            <EquityChart dates={data.dates} equity={data.equity} benchmark={data.benchmark} />
            <div className="flex items-center gap-5 justify-center mt-2">
              {[['Strategy', '#10b981', false], ['Buy & Hold', '#3b82f6', true]].map(([label, color, dashed]) => (
                <span key={label} className="flex items-center gap-1.5 text-xs text-gray-400">
                  <svg width="16" height="4" className="inline">
                    <line x1="0" y1="2" x2="16" y2="2" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '4,2' : 'none'} />
                  </svg>
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Trade log */}
          {data.trades.length > 0 && (
            <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 text-gray-500 text-xs uppercase tracking-widest">
                Trade Log ({data.trades.length} trades)
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900">
                    <tr className="border-b border-gray-800">
                      {['Date', 'Action', 'Price', 'Value', 'P&L', 'P&L %'].map((h, i) => (
                        <th key={h} className={`py-2 px-3 text-gray-500 font-medium uppercase tracking-wider ${i === 0 || i === 1 ? 'text-left' : 'text-right'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.trades.map((t, i) => (
                      <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                        <td className="py-2 px-3 text-gray-500 tabular-nums">{t.date}</td>
                        <td className="py-2 px-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${t.action === 'BUY' ? 'bg-emerald-900/60 text-emerald-400' : 'bg-red-900/60 text-red-400'}`}>
                            {t.action}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-gray-300 tabular-nums">${t.price.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right text-gray-300 tabular-nums">{fmtMoney(t.value)}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${t.pnl == null ? 'text-gray-600' : t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {t.pnl != null ? (t.pnl >= 0 ? '+' : '') + `$${t.pnl.toFixed(2)}` : '—'}
                        </td>
                        <td className={`py-2 px-3 text-right tabular-nums ${t.pnl_pct == null ? 'text-gray-600' : t.pnl_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {t.pnl_pct != null ? fmtPct(t.pnl_pct) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.trades.length === 0 && (
            <div className="text-center text-gray-600 text-sm py-6 border border-dashed border-gray-700 rounded-xl">
              No signals fired for this strategy and period. Try adjusting parameters.
            </div>
          )}
        </>
      )}
    </div>
  )
}
