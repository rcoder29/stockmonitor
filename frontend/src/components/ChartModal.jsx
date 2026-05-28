import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType, CrosshairMode } from 'lightweight-charts'
import FundamentalsPanel from './FundamentalsPanel'
import NewsPanel from './NewsPanel'
import OptionsChain from './OptionsChain'
import InsiderPanel from './InsiderPanel'
import AnalystPanel from './AnalystPanel'
import InstitutionalPanel from './InstitutionalPanel'
import SentimentPanel from './SentimentPanel'

// ── Technical indicator calculations ─────────────────────────────────────────

function calcEMA(values, period) {
  const k = 2 / (period + 1)
  const result = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]
  result[period - 1] = sum / period
  for (let i = period; i < values.length; i++)
    result[i] = values[i] * k + result[i - 1] * (1 - k)
  return result
}

function calcRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null)
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= period; avgLoss /= period
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return result
}

function calcMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = calcEMA(closes, fast)
  const emaSlow = calcEMA(closes, slow)
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  )
  const macdValues = macdLine.filter(v => v != null)
  const sigRaw = calcEMA(macdValues, signalPeriod)
  let si = 0
  const sigLine = macdLine.map(v => v == null ? null : (sigRaw[si++] ?? null))
  const hist = macdLine.map((v, i) => v != null && sigLine[i] != null ? v - sigLine[i] : null)
  return { macdLine, sigLine, hist }
}

function calcBB(closes, period = 20, mult = 2) {
  const upper = [], mid = [], lower = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(null); mid.push(null); lower.push(null); continue }
    const slice = closes.slice(i - period + 1, i + 1)
    const sma = slice.reduce((a, b) => a + b) / period
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - sma) ** 2, 0) / period)
    upper.push(sma + mult * std); mid.push(sma); lower.push(sma - mult * std)
  }
  return { upper, mid, lower }
}
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
  const [period, setPeriod]         = useState('1d')
  const [tab, setTab]               = useState('chart')
  const [chartData, setChartData]   = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [indicators, setIndicators] = useState({ bb: false, rsi: false, macd: false })
  const chartContainerRef           = useRef(null)
  const chartWrapperRef             = useRef(null)
  const rsiContainerRef             = useRef(null)
  const macdContainerRef            = useRef(null)

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

    const closes    = chartData.data.map(d => d.close)
    const isIntraday = chartData.period === '1d' || chartData.period === '5d'

    const baseOpts = {
      layout: { background: { type: ColorType.Solid, color: '#030712' }, textColor: '#6b7280', fontSize: 11 },
      grid:   { vertLines: { color: '#111827' }, horzLines: { color: '#111827' } },
      timeScale: { timeVisible: isIntraday, secondsVisible: false, borderColor: '#1f2937', fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: CrosshairMode.Normal },
      width: el.clientWidth,
    }

    // ── Main chart ──
    const chart = createChart(el, { ...baseOpts, height: el.clientHeight,
      rightPriceScale: { borderColor: '#1f2937', scaleMargins: { top: 0.08, bottom: 0.28 } } })

    chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    }).setData(chartData.data.map(d => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close })))

    const volSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume' })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } })
    volSeries.setData(chartData.data.map(d => ({ time: d.time, value: d.volume, color: d.close >= d.open ? '#10b98155' : '#ef444455' })))

    // ── Bollinger Bands overlay ──
    if (indicators.bb) {
      const bb = calcBB(closes)
      const addBB = (vals, color) => {
        const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
        s.setData(chartData.data.map((d, i) => vals[i] != null ? { time: d.time, value: vals[i] } : null).filter(Boolean))
      }
      addBB(bb.upper, '#3b82f670')
      addBB(bb.mid,   '#6b728060')
      addBB(bb.lower, '#3b82f670')
    }

    chart.timeScale().fitContent()

    // ── RSI sub-chart ──
    let rsiChart = null
    if (indicators.rsi && rsiContainerRef.current) {
      const rsiEl = rsiContainerRef.current
      rsiChart = createChart(rsiEl, { ...baseOpts, height: rsiEl.clientHeight,
        rightPriceScale: { borderColor: '#1f2937', scaleMargins: { top: 0.1, bottom: 0.1 } } })
      const rsiVals = calcRSI(closes)
      rsiChart.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true })
        .setData(chartData.data.map((d, i) => rsiVals[i] != null ? { time: d.time, value: rsiVals[i] } : null).filter(Boolean))
      rsiChart.addSeries(LineSeries, { color: '#ef444440', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(chartData.data.map(d => ({ time: d.time, value: 70 })))
      rsiChart.addSeries(LineSeries, { color: '#10b98140', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(chartData.data.map(d => ({ time: d.time, value: 30 })))
      rsiChart.timeScale().fitContent()
    }

    // ── MACD sub-chart ──
    let macdChart = null
    if (indicators.macd && macdContainerRef.current) {
      const macdEl = macdContainerRef.current
      macdChart = createChart(macdEl, { ...baseOpts, height: macdEl.clientHeight,
        rightPriceScale: { borderColor: '#1f2937', scaleMargins: { top: 0.1, bottom: 0.1 } } })
      const { macdLine, sigLine, hist } = calcMACD(closes)
      macdChart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false })
        .setData(chartData.data.map((d, i) => hist[i] != null ? { time: d.time, value: hist[i], color: hist[i] >= 0 ? '#10b98155' : '#ef444455' } : null).filter(Boolean))
      macdChart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false })
        .setData(chartData.data.map((d, i) => macdLine[i] != null ? { time: d.time, value: macdLine[i] } : null).filter(Boolean))
      macdChart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(chartData.data.map((d, i) => sigLine[i] != null ? { time: d.time, value: sigLine[i] } : null).filter(Boolean))
      macdChart.timeScale().fitContent()
    }

    // ── Time scale sync ──
    let syncing = false
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (syncing || !range) return
      syncing = true
      rsiChart?.timeScale().setVisibleLogicalRange(range)
      macdChart?.timeScale().setVisibleLogicalRange(range)
      syncing = false
    })

    // ── Resize observer ──
    const wrapper = chartWrapperRef.current
    const observer = new ResizeObserver(entries => {
      const { width } = entries[0].contentRect
      chart.applyOptions({ width })
      rsiChart?.applyOptions({ width })
      macdChart?.applyOptions({ width })
    })
    if (wrapper) observer.observe(wrapper)

    return () => {
      observer.disconnect()
      chart.remove()
      rsiChart?.remove()
      macdChart?.remove()
    }
  }, [chartData, indicators])

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
          {[['chart', 'Chart'], ['fundamentals', 'Fundamentals'], ['news', 'News'], ['earnings', 'Earnings'], ['options', 'Options'], ['insider', 'Insider'], ['analyst', 'Analyst'], ['institutional', 'Institutional'], ['sentiment', 'Sentiment']].map(([val, label]) => (
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
              {/* Period + indicator toolbar */}
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <div className="flex gap-1">
                  {PERIODS.map(p => (
                    <button key={p.value} onClick={() => setPeriod(p.value)}
                      className={`px-3 py-1 rounded text-xs font-semibold tracking-wide transition-colors ${
                        period === p.value ? 'bg-sky-600 text-white' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800'
                      }`}>{p.label}</button>
                  ))}
                </div>
                <div className="flex gap-1 ml-auto">
                  {[['bb', 'BB'], ['rsi', 'RSI'], ['macd', 'MACD']].map(([key, label]) => (
                    <button key={key}
                      onClick={() => setIndicators(prev => ({ ...prev, [key]: !prev[key] }))}
                      className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                        indicators[key] ? 'bg-purple-700 text-white' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800'
                      }`}>{label}</button>
                  ))}
                </div>
              </div>

              {/* Chart wrapper — main + optional indicator panels */}
              <div ref={chartWrapperRef} className="rounded-lg overflow-hidden bg-gray-950">
                {/* Main candlestick chart */}
                <div className="relative" style={{ height: '360px' }}>
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

                {/* RSI panel */}
                {indicators.rsi && (
                  <div className="relative border-t border-gray-800" style={{ height: '100px' }}>
                    <span className="absolute top-1 left-2 text-gray-600 text-[9px] uppercase tracking-wider z-10 pointer-events-none">RSI (14)</span>
                    <div ref={rsiContainerRef} className="w-full h-full" />
                  </div>
                )}

                {/* MACD panel */}
                {indicators.macd && (
                  <div className="relative border-t border-gray-800" style={{ height: '110px' }}>
                    <span className="absolute top-1 left-2 text-gray-600 text-[9px] uppercase tracking-wider z-10 pointer-events-none">MACD (12,26,9)</span>
                    <div ref={macdContainerRef} className="w-full h-full" />
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

          {tab === 'options'  && <OptionsChain symbol={symbol} />}

          {tab === 'insider'  && <InsiderPanel symbol={symbol} />}

          {tab === 'analyst'        && <AnalystPanel symbol={symbol} currentPrice={quote?.price} />}
          {tab === 'institutional'  && <InstitutionalPanel symbol={symbol} />}
          {tab === 'sentiment'      && <SentimentPanel symbol={symbol} />}
        </div>
      </div>
    </div>
  )
}
