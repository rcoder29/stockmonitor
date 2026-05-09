import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode } from 'lightweight-charts'
import FundamentalsPanel from './FundamentalsPanel'
import { fmt } from '../utils/format'

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
          {[['chart', 'Chart'], ['fundamentals', 'Fundamentals']].map(([val, label]) => (
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
        </div>
      </div>
    </div>
  )
}
