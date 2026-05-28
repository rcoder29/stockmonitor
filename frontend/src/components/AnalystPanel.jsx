import { useEffect, useState } from 'react'
import { fmt } from '../utils/format'

const REC_LABELS = {
  strongBuy:  { label: 'Strong Buy',  cls: 'bg-emerald-700' },
  buy:        { label: 'Buy',         cls: 'bg-emerald-600' },
  hold:       { label: 'Hold',        cls: 'bg-amber-600'   },
  sell:       { label: 'Sell',        cls: 'bg-red-600'     },
  strongSell: { label: 'Strong Sell', cls: 'bg-red-800'     },
}

function consensusLabel(key) {
  if (!key) return { label: '—', cls: 'text-gray-500' }
  const k = key.toLowerCase().replace(/[_ ]/g, '')
  if (k === 'strongbuy')  return { label: 'Strong Buy',  cls: 'text-emerald-400' }
  if (k === 'buy')        return { label: 'Buy',         cls: 'text-emerald-400' }
  if (k === 'hold')       return { label: 'Hold',        cls: 'text-amber-400' }
  if (k === 'sell')       return { label: 'Sell',        cls: 'text-red-400' }
  if (k === 'strongsell') return { label: 'Strong Sell', cls: 'text-red-400' }
  return { label: key, cls: 'text-gray-300' }
}

export default function AnalystPanel({ symbol, currentPrice }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/analyst/${symbol}`)
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return <div className="py-16 text-center text-gray-500 text-sm animate-pulse">Loading analyst data…</div>
  if (error)   return <div className="py-16 text-center text-red-400 text-sm">Failed to load: {error}</div>
  if (!data)   return null

  const consensus = consensusLabel(data.recommendationKey)
  const price = currentPrice ?? data.currentPrice
  const mean  = data.targetMeanPrice
  const upside = price && mean ? ((mean / price - 1) * 100) : null

  // Build stacked bar from latest recommendation period
  const latestPeriod = data.history?.find(h => h.strongBuy != null)
  const totalVotes = latestPeriod
    ? (latestPeriod.strongBuy + latestPeriod.buy + latestPeriod.hold + latestPeriod.sell + latestPeriod.strongSell)
    : 0

  const isMonthlySummary = data.history?.length > 0 && data.history[0].strongBuy != null

  return (
    <div className="space-y-5">
      {/* Top KPI row */}
      <div className="flex flex-wrap gap-3">
        <div className="bg-gray-800/60 rounded-lg px-4 py-3 min-w-[120px]">
          <div className="text-gray-500 text-xs mb-0.5">Consensus</div>
          <div className={`font-bold text-base ${consensus.cls}`}>{consensus.label}</div>
          {data.numberOfAnalystOpinions && (
            <div className="text-gray-600 text-xs mt-0.5">{data.numberOfAnalystOpinions} analysts</div>
          )}
        </div>
        {mean != null && (
          <div className="bg-gray-800/60 rounded-lg px-4 py-3 min-w-[120px]">
            <div className="text-gray-500 text-xs mb-0.5">Mean Target</div>
            <div className="text-white font-bold text-base tabular-nums">{fmt.price(mean)}</div>
            {upside != null && (
              <div className={`text-xs mt-0.5 tabular-nums ${upside >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {upside >= 0 ? '+' : ''}{upside.toFixed(1)}% upside
              </div>
            )}
          </div>
        )}
        {data.targetHighPrice != null && (
          <div className="bg-gray-800/60 rounded-lg px-4 py-3 min-w-[100px]">
            <div className="text-gray-500 text-xs mb-0.5">Target High</div>
            <div className="text-emerald-400 font-bold text-sm tabular-nums">{fmt.price(data.targetHighPrice)}</div>
          </div>
        )}
        {data.targetLowPrice != null && (
          <div className="bg-gray-800/60 rounded-lg px-4 py-3 min-w-[100px]">
            <div className="text-gray-500 text-xs mb-0.5">Target Low</div>
            <div className="text-red-400 font-bold text-sm tabular-nums">{fmt.price(data.targetLowPrice)}</div>
          </div>
        )}
      </div>

      {/* Price target range bar */}
      {price && data.targetLowPrice != null && data.targetHighPrice != null && (
        <div className="bg-gray-800/40 rounded-lg p-4">
          <div className="text-gray-500 text-xs uppercase tracking-wider mb-3">Price Target Range</div>
          <div className="relative h-6">
            {/* Range bar */}
            {(() => {
              const lo = data.targetLowPrice, hi = data.targetHighPrice
              const pctLo = 0, pctHi = 100
              const pctCurrent = Math.min(100, Math.max(0, ((price - lo) / (hi - lo)) * 100))
              const pctMean = mean ? Math.min(100, Math.max(0, ((mean - lo) / (hi - lo)) * 100)) : null
              return (
                <>
                  <div className="absolute inset-y-2 left-0 right-0 bg-gray-700 rounded" />
                  <div className="absolute inset-y-2 rounded bg-gradient-to-r from-red-600/60 to-emerald-600/60" style={{ left: '0%', right: '0%' }} />
                  {/* Current price marker */}
                  <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: `${pctCurrent}%` }}>
                    <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-white text-[10px] whitespace-nowrap font-semibold">
                      {fmt.price(price)}
                    </div>
                  </div>
                  {/* Mean target marker */}
                  {pctMean != null && (
                    <div className="absolute top-0 bottom-0 w-0.5 bg-amber-400" style={{ left: `${pctMean}%` }}>
                      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-amber-400 text-[10px] whitespace-nowrap">
                        {fmt.price(mean)} mean
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
          <div className="flex justify-between mt-6 text-xs text-gray-500">
            <span>Low {fmt.price(data.targetLowPrice)}</span>
            <span>High {fmt.price(data.targetHighPrice)}</span>
          </div>
        </div>
      )}

      {/* Rating breakdown stacked bar */}
      {isMonthlySummary && latestPeriod && totalVotes > 0 && (
        <div className="bg-gray-800/40 rounded-lg p-4">
          <div className="text-gray-500 text-xs uppercase tracking-wider mb-3">
            Rating Breakdown — {latestPeriod.period}
          </div>
          <div className="flex h-5 rounded overflow-hidden mb-2">
            {['strongBuy', 'buy', 'hold', 'sell', 'strongSell'].map(k => {
              const v = latestPeriod[k] ?? 0
              if (!v) return null
              return (
                <div
                  key={k}
                  className={`${REC_LABELS[k].cls} h-full`}
                  style={{ width: `${(v / totalVotes) * 100}%` }}
                  title={`${REC_LABELS[k].label}: ${v}`}
                />
              )
            })}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-gray-400">
            {['strongBuy', 'buy', 'hold', 'sell', 'strongSell'].map(k => {
              const v = latestPeriod[k] ?? 0
              if (!v) return null
              return (
                <span key={k} className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-sm ${REC_LABELS[k].cls}`} />
                  {REC_LABELS[k].label}: <span className="text-white font-medium">{v}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* History table */}
      {data.history?.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900">
                {isMonthlySummary
                  ? ['Period', 'Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'].map((h, i) => (
                      <th key={h} className={`py-2 px-3 text-gray-500 font-medium tracking-wider uppercase ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))
                  : ['Date', 'Firm', 'Action', 'From', 'To'].map((h, i) => (
                      <th key={h} className={`py-2 px-3 text-gray-500 font-medium tracking-wider uppercase ${i < 2 ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))
                }
              </tr>
            </thead>
            <tbody>
              {[...data.history].reverse().map((r, i) => (
                <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                  {isMonthlySummary ? (
                    <>
                      <td className="py-2 px-3 text-gray-400">{r.period}</td>
                      <td className="py-2 px-3 text-right text-emerald-400 tabular-nums font-medium">{r.strongBuy ?? 0}</td>
                      <td className="py-2 px-3 text-right text-emerald-400/70 tabular-nums">{r.buy ?? 0}</td>
                      <td className="py-2 px-3 text-right text-amber-400 tabular-nums">{r.hold ?? 0}</td>
                      <td className="py-2 px-3 text-right text-red-400/70 tabular-nums">{r.sell ?? 0}</td>
                      <td className="py-2 px-3 text-right text-red-400 tabular-nums font-medium">{r.strongSell ?? 0}</td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 px-3 text-gray-500 tabular-nums">{r.date}</td>
                      <td className="py-2 px-3 text-gray-300 font-medium">{r.firm || '—'}</td>
                      <td className="py-2 px-3 text-right">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          (r.action ?? '').toLowerCase().includes('upgrade') ? 'bg-emerald-900/60 text-emerald-300' :
                          (r.action ?? '').toLowerCase().includes('downgrade') ? 'bg-red-900/60 text-red-300' :
                          'bg-gray-700 text-gray-300'
                        }`}>{r.action || '—'}</span>
                      </td>
                      <td className="py-2 px-3 text-right text-gray-500">{r.fromGrade || '—'}</td>
                      <td className="py-2 px-3 text-right text-gray-300 font-medium">{r.toGrade || '—'}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-gray-700 text-xs">Data from Yahoo Finance · Analyst estimates are forward-looking and may be incorrect</div>
    </div>
  )
}
