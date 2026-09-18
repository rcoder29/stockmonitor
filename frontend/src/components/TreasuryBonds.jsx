import { useState, useEffect, useRef } from 'react'
import { createChart, LineSeries, ColorType } from 'lightweight-charts'

const API = import.meta.env.VITE_API_URL || ''

const RANGES = [
  { key: '1m',  label: '1M' },
  { key: '6m',  label: '6M' },
  { key: '1y',  label: '1Y' },
  { key: '5y',  label: '5Y' },
  { key: '10y', label: '10Y' },
  { key: 'max', label: 'Max' },
]

// Categorical colors matched to this app's existing chart palette (ChartModal's
// blue/amber/emerald family) with a dashed/dotted secondary encoding on top so
// the two lighter lines stay distinguishable for color-vision-deficient viewers.
const CURVE_STYLE = {
  'Today':       { stroke: '#3b82f6', dash: 'none' },
  '1 Month Ago': { stroke: '#f59e0b', dash: '6,4' },
  '1 Year Ago':  { stroke: '#10b981', dash: '2,3' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(v, digits = 2) {
  if (v == null) return '—'
  return `${v.toFixed(digits)}%`
}

function changeColor(v) {
  if (v == null) return 'text-slate-400'
  return v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-slate-400'
}

// ── Current rates table ──────────────────────────────────────────────────────

function CurrentRatesTable({ rates, selected, onSelect }) {
  if (!rates || rates.length === 0) {
    return <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center text-slate-500 text-sm">No rate data available.</div>
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-800 text-slate-500 text-xs uppercase tracking-wider">
            <th className="text-left py-2.5 px-3 font-medium">Maturity</th>
            <th className="text-right py-2.5 px-3 font-medium">Yield</th>
            <th className="text-right py-2.5 px-3 font-medium">Chg (1d)</th>
          </tr>
        </thead>
        <tbody>
          {rates.map(r => (
            <tr key={r.key}
              onClick={() => onSelect(r.key)}
              className={`border-t border-slate-800 cursor-pointer hover:bg-slate-800/50 transition-colors ${selected === r.key ? 'bg-sky-950/60' : ''}`}>
              <td className="py-2 px-3 text-white">{r.label}</td>
              <td className="py-2 px-3 text-right text-white font-mono">{fmtPct(r.yield, 3)}</td>
              <td className={`py-2 px-3 text-right font-mono ${changeColor(r.change)}`}>
                {r.change == null ? '—' : `${r.change > 0 ? '+' : ''}${r.change.toFixed(3)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Yield curve (custom SVG — lightweight-charts is time-axis only, and this
// axis is ordinal maturity, not calendar time) ─────────────────────────────────

function YieldCurveChart({ curves }) {
  const [hoverIdx, setHoverIdx] = useState(null)

  if (!curves || curves.length === 0) {
    return <div className="text-slate-500 text-sm py-12 text-center">No yield curve data available.</div>
  }

  const todayCurve = curves.find(c => c.label === 'Today') || curves[0]
  const maturityKeys = todayCurve.points.map(p => p.key)
  const n = maturityKeys.length
  if (n === 0) return <div className="text-slate-500 text-sm py-12 text-center">No yield curve data available.</div>

  const seriesByLabel = curves.map(c => ({
    label: c.label,
    date: c.date,
    valuesByKey: Object.fromEntries(c.points.map(p => [p.key, p.yield])),
  }))

  const allYields = curves.flatMap(c => c.points.map(p => p.yield))
  const rawMin = Math.min(...allYields), rawMax = Math.max(...allYields)
  const yMin = Math.floor((Math.min(rawMin, 0)) * 2) / 2 - 0.25
  const yMax = Math.ceil(rawMax * 2) / 2 + 0.25

  const W = 900, H = 340
  const padL = 46, padR = 16, padT = 20, padB = 36
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const xFor = i => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const yFor = v => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH

  const tickStep = (yMax - yMin) > 4 ? 1 : 0.5
  const yTicks = []
  for (let v = Math.ceil(yMin / tickStep) * tickStep; v <= yMax + 1e-9; v += tickStep) {
    yTicks.push(Math.round(v * 100) / 100)
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 380 }}
        onMouseLeave={() => setHoverIdx(null)}>
        {yTicks.map(v => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={yFor(v)} y2={yFor(v)} stroke="#1e293b" strokeWidth="1" />
            <text x={padL - 8} y={yFor(v) + 3} textAnchor="end" fontSize="10" fill="#64748b">{v.toFixed(1)}%</text>
          </g>
        ))}

        {maturityKeys.map((k, i) => (
          <text key={k} x={xFor(i)} y={H - padB + 16} textAnchor="middle" fontSize="10" fill="#64748b">
            {todayCurve.points[i].label}
          </text>
        ))}

        {seriesByLabel.map(s => {
          const style = CURVE_STYLE[s.label] || { stroke: '#94a3b8', dash: 'none' }
          const pts = maturityKeys
            .map((k, i) => (s.valuesByKey[k] != null ? `${xFor(i)},${yFor(s.valuesByKey[k])}` : null))
            .filter(Boolean)
          if (pts.length < 2) return null
          return (
            <polyline key={s.label} points={pts.join(' ')} fill="none" stroke={style.stroke} strokeWidth="2"
              strokeDasharray={style.dash} strokeLinecap="round" strokeLinejoin="round" />
          )
        })}

        {maturityKeys.map((k, i) => {
          const v = seriesByLabel.find(s => s.label === 'Today')?.valuesByKey[k]
          if (v == null) return null
          return (
            <g key={k}>
              <circle cx={xFor(i)} cy={yFor(v)} r="3" fill="#3b82f6" />
              <text x={xFor(i)} y={yFor(v) - 8} textAnchor="middle" fontSize="9" fill="#93c5fd">{v.toFixed(2)}</text>
            </g>
          )
        })}

        {maturityKeys.map((k, i) => (
          <rect key={k} x={xFor(i) - plotW / (2 * n)} y={padT} width={plotW / n} height={plotH}
            fill="transparent" onMouseEnter={() => setHoverIdx(i)} />
        ))}

        {hoverIdx != null && (
          <line x1={xFor(hoverIdx)} x2={xFor(hoverIdx)} y1={padT} y2={H - padB}
            stroke="#475569" strokeWidth="1" strokeDasharray="3,3" />
        )}
      </svg>

      <div className="flex flex-wrap gap-4 justify-center mt-1">
        {seriesByLabel.map(s => {
          const style = CURVE_STYLE[s.label] || { stroke: '#94a3b8', dash: 'none' }
          return (
            <div key={s.label} className="flex items-center gap-1.5 text-xs text-slate-400">
              <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={style.stroke} strokeWidth="2" strokeDasharray={style.dash} /></svg>
              {s.label} <span className="text-slate-600">({s.date})</span>
            </div>
          )
        })}
      </div>

      {hoverIdx != null && (
        <div className="absolute top-2 right-2 bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs shadow-lg min-w-[150px]">
          <div className="text-slate-400 mb-1.5 font-semibold">{todayCurve.points[hoverIdx].label}</div>
          {seriesByLabel.map(s => {
            const v = s.valuesByKey[maturityKeys[hoverIdx]]
            const style = CURVE_STYLE[s.label] || { stroke: '#94a3b8' }
            return (
              <div key={s.label} className="flex items-center gap-3 justify-between">
                <span className="flex items-center gap-1.5" style={{ color: style.stroke }}>● {s.label}</span>
                <span className="text-white font-mono">{v != null ? `${v.toFixed(2)}%` : '—'}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Historical trend (time-series, so lightweight-charts fits naturally) ──────

function HistoryChart({ maturity, range }) {
  const containerRef = useRef(null)
  const [series, setSeries] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`${API}/api/treasury/history?maturity=${encodeURIComponent(maturity)}&rng=${encodeURIComponent(range)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setSeries(d.series || []); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [maturity, range])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !series || series.length === 0) return

    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: '#030712' }, textColor: '#6b7280', fontSize: 11 },
      grid:   { vertLines: { color: '#111827' }, horzLines: { color: '#111827' } },
      timeScale: { borderColor: '#1f2937' },
      rightPriceScale: { borderColor: '#1f2937' },
      width: el.clientWidth,
      height: 280,
    })

    const line = chart.addSeries(LineSeries, {
      color: '#3b82f6', lineWidth: 2,
      priceFormat: { type: 'custom', formatter: v => `${v.toFixed(2)}%`, minMove: 0.001 },
    })
    line.setData(series.map(s => ({ time: s.date, value: s.yield })))
    chart.timeScale().fitContent()

    const observer = new ResizeObserver(entries => {
      chart.applyOptions({ width: entries[0].contentRect.width })
    })
    observer.observe(el)

    return () => { observer.disconnect(); chart.remove() }
  }, [series])

  if (loading) return <div className="h-[280px] flex items-center justify-center text-slate-500 text-sm animate-pulse">Loading…</div>
  if (error) return <div className="h-[280px] flex items-center justify-center text-red-400 text-sm">Failed to load: {error}</div>
  if (!series || series.length === 0) return <div className="h-[280px] flex items-center justify-center text-slate-500 text-sm">No data for this range.</div>
  return <div ref={containerRef} className="w-full" style={{ height: 280 }} />
}

// ── Main component ───────────────────────────────────────────────────────────

export default function TreasuryBonds() {
  const [current, setCurrent]     = useState(null)
  const [curveData, setCurveData] = useState(null)
  const [selectedMaturity, setSelectedMaturity] = useState('10yr')
  const [range, setRange]         = useState('1y')
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API}/api/treasury/current`).then(r => r.json()),
      fetch(`${API}/api/treasury/yield-curve`).then(r => r.json()),
    ])
      .then(([cur, curve]) => {
        if (cancelled) return
        setCurrent(cur)
        setCurveData(curve)
        setLoading(false)
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const rates = current?.rates || []
  const selectedLabel = rates.find(r => r.key === selectedMaturity)?.label || selectedMaturity

  return (
    <div className="p-4 text-white max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold">Treasury Bonds</h1>
        <p className="text-sm text-slate-400">Daily par yields across the full Treasury curve</p>
      </div>

      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 mb-4 text-xs text-slate-400">
        Data is the U.S. Treasury's own official "Daily Treasury Par Yield Curve Rates" — the same source
        FRED's DGS* series are derived from, published once per trading day directly by Treasury.gov. No
        API key, no estimation — these are the actual par yields used to construct the curve.
      </div>

      {error && <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-red-300 text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-12 text-center text-slate-400 text-sm">Loading Treasury yields…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
            <div className="lg:col-span-2">
              <div className="text-sm font-semibold text-slate-300 mb-2">
                Current Rates{current?.date && <span className="text-slate-500 font-normal"> · as of {current.date}</span>}
              </div>
              <CurrentRatesTable rates={rates} selected={selectedMaturity} onSelect={setSelectedMaturity} />
              <div className="text-[11px] text-slate-600 mt-1.5">Click a row to chart its history below.</div>
            </div>
            <div className="lg:col-span-3">
              <div className="text-sm font-semibold text-slate-300 mb-2">Yield Curve</div>
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-3">
                <YieldCurveChart curves={curveData?.curves || []} />
              </div>
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="text-sm font-semibold text-slate-300">Historical Trend — {selectedLabel}</div>
              <div className="flex gap-1">
                {RANGES.map(r => (
                  <button key={r.key} onClick={() => setRange(r.key)}
                    className={`px-2.5 py-1 rounded text-xs transition-colors ${range === r.key ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
              {rates.map(r => (
                <button key={r.key} onClick={() => setSelectedMaturity(r.key)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${selectedMaturity === r.key ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                  {r.label}
                </button>
              ))}
            </div>
            <HistoryChart maturity={selectedMaturity} range={range} />
          </div>
        </>
      )}
    </div>
  )
}
