import { useState, useRef, useCallback } from 'react'

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6']
const PERIODS = [
  { id: '1mo', label: '1M' },
  { id: '3mo', label: '3M' },
  { id: '6mo', label: '6M' },
  { id: '1y',  label: '1Y' },
]

function fmtPct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}
function fmtNum(v, dec = 2) {
  return v != null ? v.toFixed(dec) : '—'
}
function fmtCap(v) {
  if (v == null) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toLocaleString()}`
}

function CompChart({ series, labels, colors }) {
  if (!series.length || !series[0]?.length) return null

  const W = 700, H = 220
  const PL = 45, PR = 10, PT = 15, PB = 30

  const allVals = series.flat().filter(v => v != null)
  const lo = Math.min(...allVals), hi = Math.max(...allVals)
  const pad = (hi - lo) * 0.05 || 1
  const yLo = lo - pad, yHi = hi + pad
  const n = series[0].length

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

  const yTicks = []
  const range = yHi - yLo
  const step = range < 5 ? 1 : range < 20 ? 5 : 10
  for (let v = Math.ceil(yLo / step) * step; v <= yHi; v += step)
    yTicks.push(v)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {yTicks.map(v => (
        <g key={v}>
          <line x1={PL} y1={toY(v)} x2={W - PR} y2={toY(v)} stroke="#1f2937" strokeWidth="1" />
          <text x={PL - 4} y={toY(v)} textAnchor="end" dominantBaseline="middle" fill="#4b5563" fontSize="9">
            {v >= 0 ? '+' : ''}{v.toFixed(0)}%
          </text>
        </g>
      ))}
      {lo < 0 && hi > 0 && (
        <line x1={PL} y1={toY(0)} x2={W - PR} y2={toY(0)} stroke="#374151" strokeWidth="1" strokeDasharray="4,3" />
      )}
      {series.map((pts, si) => (
        <path key={si} d={makePath(pts)} fill="none" stroke={colors[si]} strokeWidth="2" opacity="0.9" />
      ))}
    </svg>
  )
}

export default function StockComparison() {
  const [symbols,  setSymbols]  = useState([])
  const [input,    setInput]    = useState('')
  const [period,   setPeriod]   = useState('3mo')
  const [quotes,   setQuotes]   = useState({})
  const [series,   setSeries]   = useState({})  // symbol → normalized returns []
  const [dates,    setDates]    = useState([])
  const [loading,  setLoading]  = useState({})
  const [error,    setError]    = useState('')

  async function fetchData(sym, existingSyms) {
    const allSyms = [...existingSyms, sym]
    setLoading(prev => ({ ...prev, [sym]: true }))
    try {
      // Fetch quote for metrics
      const qRes  = await fetch(`/api/quotes?symbols=${sym}`)
      const qData = await qRes.json()
      setQuotes(prev => ({ ...prev, [sym]: qData[0] }))

      // Fetch chart data for normalized return chart
      const cRes  = await fetch(`/api/chart/${sym}?period=${period}`)
      const cData = await cRes.json()
      const closes = cData.map(d => d.close).filter(v => v != null)
      if (!closes.length) throw new Error('No price data')
      const base = closes[0]
      const norm = closes.map(v => +((v / base - 1) * 100).toFixed(4))

      setSeries(prev => ({ ...prev, [sym]: norm }))
      setDates(cData.map(d => d.time))
      setError('')
    } catch (e) {
      setError(`Failed to load ${sym}: ${e.message}`)
    } finally {
      setLoading(prev => ({ ...prev, [sym]: false }))
    }
  }

  function addSymbol() {
    const sym = input.trim().toUpperCase()
    if (!sym || symbols.includes(sym) || symbols.length >= 5) return
    const next = [...symbols, sym]
    setSymbols(next)
    setInput('')
    fetchData(sym, symbols)
  }

  function removeSymbol(sym) {
    const next = symbols.filter(s => s !== sym)
    setSymbols(next)
    setQuotes(prev => { const n = {...prev}; delete n[sym]; return n })
    setSeries(prev => { const n = {...prev}; delete n[sym]; return n })
  }

  // Re-fetch all when period changes
  async function changePeriod(p) {
    setPeriod(p)
    setSeries({})
    setDates([])
    for (const sym of symbols) {
      setLoading(prev => ({ ...prev, [sym]: true }))
      try {
        const cRes  = await fetch(`/api/chart/${sym}?period=${p}`)
        const cData = await cRes.json()
        const closes = cData.map(d => d.close).filter(v => v != null)
        if (!closes.length) continue
        const base = closes[0]
        const norm = closes.map(v => +((v / base - 1) * 100).toFixed(4))
        setSeries(prev => ({ ...prev, [sym]: norm }))
        setDates(cData.map(d => d.time))
      } catch {}
      finally { setLoading(prev => ({ ...prev, [sym]: false })) }
    }
  }

  const chartSeries = symbols.map(s => series[s]).filter(Boolean)
  const allLoading  = Object.values(loading).some(Boolean)

  const METRICS = [
    { label: 'Price',         fn: q => q.price != null ? `$${q.price.toFixed(2)}` : '—' },
    { label: 'Change',        fn: q => fmtPct(q.changePercent), color: q => (q.changePercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Market Cap',    fn: q => fmtCap(q.marketCap) },
    { label: 'P/E (TTM)',     fn: q => fmtNum(q.peRatio) },
    { label: 'P/E (Fwd)',     fn: q => fmtNum(q.forwardPE) },
    { label: 'Beta',          fn: q => fmtNum(q.beta) },
    { label: 'Div Yield',     fn: q => q.dividendYield != null ? `${(q.dividendYield*100).toFixed(2)}%` : '—' },
    { label: '52W High',      fn: q => q.week52High != null ? `$${q.week52High.toFixed(2)}` : '—' },
    { label: '52W Low',       fn: q => q.week52Low  != null ? `$${q.week52Low.toFixed(2)}`  : '—' },
    { label: 'Sector',        fn: q => q.sector || '—' },
  ]

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-5">
      <div>
        <h2 className="text-white font-bold text-lg">Stock Comparison</h2>
        <p className="text-gray-500 text-xs mt-0.5">Compare up to 5 stocks on a normalized return chart</p>
      </div>

      {/* Symbol input */}
      <div className="flex gap-2 flex-wrap">
        {symbols.map((sym, i) => (
          <span key={sym} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium"
            style={{ borderColor: COLORS[i] + '80', background: COLORS[i] + '15', color: COLORS[i] }}>
            {loading[sym] ? <span className="animate-pulse">…</span> : sym}
            <button onClick={() => removeSymbol(sym)} className="opacity-60 hover:opacity-100 text-sm leading-none">×</button>
          </span>
        ))}
        {symbols.length < 5 && (
          <form onSubmit={e => { e.preventDefault(); addSymbol() }} className="flex gap-1.5">
            <input
              value={input}
              onChange={e => setInput(e.target.value.toUpperCase())}
              placeholder="Add symbol…"
              maxLength={10}
              className="bg-gray-800 border border-gray-700 text-white placeholder-gray-600 px-3 py-1.5 text-sm rounded-lg focus:outline-none focus:border-emerald-500 w-32"
            />
            <button type="submit" className="bg-emerald-700 hover:bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-lg transition-colors">
              Add
            </button>
          </form>
        )}
        <div className="flex rounded overflow-hidden border border-gray-700 ml-auto">
          {PERIODS.map(({ id, label }) => (
            <button key={id} onClick={() => changePeriod(id)}
              className={`px-3 py-1.5 text-xs transition-colors ${period === id ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      {symbols.length === 0 && (
        <div className="flex items-center justify-center h-48 border border-dashed border-gray-700 rounded-xl text-gray-600 text-sm">
          Add symbols above to compare them
        </div>
      )}

      {/* Chart */}
      {chartSeries.length > 0 && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          {allLoading && <div className="text-center text-gray-600 text-xs mb-2 animate-pulse">Updating…</div>}
          <CompChart series={chartSeries} labels={symbols} colors={COLORS} />
          <div className="flex items-center gap-5 justify-center mt-2">
            {symbols.filter(s => series[s]).map((sym, i) => (
              <span key={sym} className="flex items-center gap-1.5 text-xs text-gray-400">
                <span className="w-4 h-0.5 inline-block rounded" style={{ backgroundColor: COLORS[i] }} />
                {sym}
                {series[sym] && (
                  <span className={`ml-1 font-medium tabular-nums ${(series[sym].at(-1) ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtPct(series[sym].at(-1))}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Metrics table */}
      {symbols.length > 0 && Object.keys(quotes).length > 0 && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900">
                <th className="py-2.5 px-4 text-left text-gray-500 font-medium uppercase tracking-wider">Metric</th>
                {symbols.map((sym, i) => (
                  <th key={sym} className="py-2.5 px-4 text-right font-bold" style={{ color: COLORS[i] }}>{sym}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map(({ label, fn, color }) => (
                <tr key={label} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                  <td className="py-2 px-4 text-gray-500 uppercase tracking-wider">{label}</td>
                  {symbols.map(sym => {
                    const q = quotes[sym]
                    const val = q ? fn(q) : '—'
                    const cls = q && color ? color(q) : 'text-gray-300'
                    return <td key={sym} className={`py-2 px-4 text-right tabular-nums font-medium ${cls}`}>{val}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
