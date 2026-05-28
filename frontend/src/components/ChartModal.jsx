import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode } from 'lightweight-charts'
import FundamentalsPanel from './FundamentalsPanel'
import NewsPanel from './NewsPanel'
import { fmt } from '../utils/format'

// ── Earnings history panel ────────────────────────────────────────────────────

function fmtRev(v) {
  if (v == null) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toLocaleString()}`
}

function EarningsPanel({ symbol }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/earnings/history/${symbol}`)
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json() })
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return <div className="py-16 text-center text-gray-500 text-sm animate-pulse">Loading earnings history…</div>
  if (error)   return <div className="py-16 text-center text-red-400 text-sm">Failed to load: {error}</div>
  if (!data?.earnings?.length) return <div className="py-16 text-center text-gray-600 text-sm">No earnings history available</div>

  const rows = [...data.earnings].reverse() // oldest → newest for chart
  const beats = rows.filter(r => (r.epsDifference ?? 0) > 0).length
  const beatRate = rows.length ? Math.round((beats / rows.length) * 100) : 0
  const avgSurprise = rows.length
    ? (rows.reduce((s, r) => s + (r.surprisePercent ?? 0), 0) / rows.length).toFixed(1)
    : 0

  // SVG bar chart
  const W = 480, H = 120, PAD = { t: 12, b: 24, l: 8, r: 8 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const barGroupW = innerW / rows.length
  const barW = Math.min(barGroupW * 0.35, 18)
  const maxEps = Math.max(...rows.flatMap(r => [Math.abs(r.epsActual ?? 0), Math.abs(r.epsEstimate ?? 0)]), 0.01)

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="flex gap-3 flex-wrap">
        {[
          { label: 'Quarters', value: rows.length },
          { label: 'Beat Rate', value: `${beatRate}%`, cls: beatRate >= 70 ? 'text-emerald-400' : beatRate >= 50 ? 'text-amber-400' : 'text-red-400' },
          { label: 'Avg Surprise', value: `${avgSurprise > 0 ? '+' : ''}${avgSurprise}%`, cls: avgSurprise > 0 ? 'text-emerald-400' : 'text-red-400' },
        ].map(({ label, value, cls = 'text-white' }) => (
          <div key={label} className="bg-gray-800/60 rounded-lg px-4 py-2.5 min-w-[100px]">
            <div className="text-gray-600 text-xs mb-0.5">{label}</div>
            <div className={`font-bold text-sm tabular-nums ${cls}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* SVG bar chart */}
      <div className="bg-gray-950 rounded-lg p-3">
        <div className="text-gray-600 text-xs mb-2 uppercase tracking-wider">EPS — Actual vs Estimate</div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
          {rows.map((r, i) => {
            const cx = PAD.l + (i + 0.5) * barGroupW
            const scaleY = v => PAD.t + innerH * (1 - Math.min(Math.abs(v ?? 0) / maxEps, 1))
            const estH = innerH * Math.min(Math.abs(r.epsEstimate ?? 0) / maxEps, 1)
            const actH = innerH * Math.min(Math.abs(r.epsActual ?? 0) / maxEps, 1)
            const beat = (r.epsDifference ?? 0) >= 0
            return (
              <g key={r.date}>
                {/* Estimate bar */}
                <rect
                  x={cx - barW - 1} y={scaleY(r.epsEstimate ?? 0)}
                  width={barW} height={Math.max(estH, 1)}
                  fill="#374151" rx="1"
                />
                {/* Actual bar */}
                <rect
                  x={cx + 1} y={scaleY(r.epsActual ?? 0)}
                  width={barW} height={Math.max(actH, 1)}
                  fill={beat ? '#10b981' : '#ef4444'} rx="1"
                />
                {/* Quarter label */}
                <text
                  x={cx} y={H - 4}
                  textAnchor="middle" fontSize="7" fill="#4b5563"
                >
                  {r.quarter?.replace('Q', 'Q').slice(-6) ?? ''}
                </text>
              </g>
            )
          })}
          {/* Legend */}
          <rect x={PAD.l} y={PAD.t - 8} width={8} height={4} fill="#374151" rx="1" />
          <text x={PAD.l + 10} y={PAD.t - 4} fontSize="7" fill="#6b7280">Est</text>
          <rect x={PAD.l + 32} y={PAD.t - 8} width={8} height={4} fill="#10b981" rx="1" />
          <text x={PAD.l + 42} y={PAD.t - 4} fontSize="7" fill="#6b7280">Actual</text>
        </svg>
      </div>

      {/* Results table */}
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              {['Quarter', 'EPS Est.', 'EPS Actual', 'Surprise', 'Surprise %', 'Revenue'].map((h, i) => (
                <th key={h} className={`py-2 px-4 text-gray-500 font-medium tracking-wider uppercase ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data.earnings].map(r => {
              const beat = (r.epsDifference ?? 0) >= 0
              const surprise = r.surprisePercent
              return (
                <tr key={r.date} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                  <td className="py-2.5 px-4 text-gray-300 font-medium">{r.quarter}</td>
                  <td className="py-2.5 px-4 text-right text-gray-500 tabular-nums">
                    {r.epsEstimate != null ? `$${r.epsEstimate.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-white">
                    {r.epsActual != null ? `$${r.epsActual.toFixed(2)}` : '—'}
                  </td>
                  <td className={`py-2.5 px-4 text-right tabular-nums ${beat ? 'text-emerald-400' : 'text-red-400'}`}>
                    {r.epsDifference != null ? `${beat ? '+' : ''}$${r.epsDifference.toFixed(2)}` : '—'}
                  </td>
                  <td className={`py-2.5 px-4 text-right tabular-nums ${beat ? 'text-emerald-400' : 'text-red-400'}`}>
                    {surprise != null
                      ? <span className={`px-1.5 py-0.5 rounded text-[11px] ${beat ? 'bg-emerald-900/40' : 'bg-red-900/40'}`}>
                          {beat ? '+' : ''}{surprise.toFixed(1)}%
                        </span>
                      : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right text-gray-400 tabular-nums">{fmtRev(r.revenue)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const PERIODS = [
  { label: '1D',  value: '1d' },
  { label: '5D',  value: '5d' },
  { label: '1M',  value: '1mo' },
  { label: '3M',  value: '3mo' },
  { label: '6M',  value: '6mo' },
  { label: '1Y',  value: '1y' },
  { label: '2Y',  value: '2y' },
  { label: '5Y',  value: '5y' },
]

export default function ChartModal({ symbol, quote, onClose }) {
  const [period, setPeriod]       = useState('1d')
  const [tab, setTab]             = useState('chart')
  const [chartData, setChartData] = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const chartContainerRef         = useRef(null)

  const isPos = quote?.change == null || quote.change >= 0

  const fetchChart = useCallback(async (sym, per) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/chart/${sym}?period=${per}`)
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      setChartData(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'chart') fetchChart(symbol, period)
  }, [symbol, period, tab, fetchChart])

  useEffect(() => {
    const el = chartContainerRef.current
    if (!el || !chartData || chartData.data.length === 0) return

    const isIntraday = chartData.period === '1d' || chartData.period === '5d'

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#030712' },
        textColor: '#6b7280',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#111827' },
        horzLines: { color: '#111827' },
      },
      timeScale: {
        timeVisible: isIntraday,
        secondsVisible: false,
        borderColor: '#1f2937',
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      rightPriceScale: {
        borderColor: '#1f2937',
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      crosshair: { mode: CrosshairMode.Normal },
      width:  el.clientWidth,
      height: el.clientHeight,
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:      '#10b981',
      downColor:    '#ef4444',
      borderVisible: false,
      wickUpColor:   '#10b981',
      wickDownColor: '#ef4444',
    })
    candleSeries.setData(
      chartData.data.map(d => ({
        time:  d.time,
        open:  d.open,
        high:  d.high,
        low:   d.low,
        close: d.close,
      }))
    )

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat:   { type: 'volume' },
      priceScaleId:  'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    })
    volSeries.setData(
      chartData.data.map(d => ({
        time:  d.time,
        value: d.volume,
        color: d.close >= d.open ? '#10b98155' : '#ef444455',
      }))
    )

    chart.timeScale().fitContent()

    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      chart.applyOptions({ width, height })
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
      chart.remove()
    }
  }, [chartData])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-lg font-bold text-white">{symbol}</span>
            {quote?.name && (
              <span className="text-gray-500 text-sm">{quote.name}</span>
            )}
            {quote?.price != null && (
              <span className="text-xl font-semibold text-white">{fmt.price(quote.price)}</span>
            )}
            {quote?.change != null && (
              <span className={`text-sm font-medium ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmt.change(quote.change)} ({fmt.pct(quote.changePercent)})
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-white transition-colors text-2xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 shrink-0"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 px-6 shrink-0">
          {[['chart', 'Chart'], ['fundamentals', 'Fundamentals'], ['news', 'News'], ['earnings', 'Earnings']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setTab(val)}
              className={`py-2.5 px-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === val
                  ? 'border-sky-500 text-sky-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6 min-h-0">

          {tab === 'chart' && (
            <>
              {/* Period selector */}
              <div className="flex gap-1 mb-4">
                {PERIODS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setPeriod(p.value)}
                    className={`px-3 py-1 rounded text-xs font-semibold tracking-wide transition-colors ${
                      period === p.value
                        ? 'bg-sky-600 text-white'
                        : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Chart container */}
              <div className="relative rounded-lg overflow-hidden bg-gray-950" style={{ height: '400px' }}>
                <div ref={chartContainerRef} className="w-full h-full" />
                {loading && (
                  <div className="absolute inset-0 bg-gray-950/80 flex items-center justify-center z-10">
                    <span className="text-gray-400 text-sm animate-pulse">Loading chart…</span>
                  </div>
                )}
                {!loading && error && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <span className="text-red-400 text-sm">{error}</span>
                  </div>
                )}
                {!loading && !error && chartData?.data?.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <span className="text-gray-500 text-sm">No data available for this period</span>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'fundamentals' && (
            quote && !quote.error
              ? <FundamentalsPanel quote={quote} />
              : <div className="text-gray-500 text-sm py-4">No fundamental data available</div>
          )}

          {tab === 'news' && <NewsPanel symbol={symbol} />}

          {tab === 'earnings' && <EarningsPanel symbol={symbol} />}
        </div>
      </div>
    </div>
  )
}
