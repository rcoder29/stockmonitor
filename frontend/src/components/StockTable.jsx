import { Fragment } from 'react'
import { fmt } from '../utils/format'

function ChangeCell({ value, isPercent }) {
  if (value == null) return <span className="text-gray-600">—</span>
  const pos = value >= 0
  const text = isPercent ? fmt.pct(value) : fmt.change(value)
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
        pos ? 'text-emerald-400 bg-emerald-900/40' : 'text-red-400 bg-red-900/40'
      }`}
    >
      {text}
    </span>
  )
}

function RangeCell({ lo, hi, current }) {
  const pct =
    lo != null && hi != null && hi !== lo
      ? Math.min(100, Math.max(0, ((current - lo) / (hi - lo)) * 100))
      : null

  return (
    <div className="text-right">
      <span className="text-red-400/80">{fmt.num(lo)}</span>
      <span className="text-gray-700 mx-1">–</span>
      <span className="text-emerald-400/80">{fmt.num(hi)}</span>
      {pct != null && (
        <div className="mt-1 h-0.5 bg-gray-700 rounded" style={{ width: '100%' }}>
          <div
            className="h-full bg-sky-500 rounded"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

export default function StockTable({ watchlist, quotes, priceFlash, onRemove, onChartOpen }) {

  if (watchlist.length === 0) {
    return (
      <div className="text-center text-gray-600 py-24 text-sm">
        Add a ticker above to start monitoring
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900">
            {[
              ['SYMBOL', 'text-left', 'w-40'],
              ['PRICE', 'text-right', 'w-28'],
              ['CHG ($)', 'text-right', 'w-28'],
              ['CHG (%)', 'text-right', 'w-28'],
              ['DAY RANGE', 'text-right', 'w-44'],
              ['VOLUME', 'text-right', 'w-28'],
              ['52W RANGE', 'text-right', 'w-44'],
              ['MKT CAP', 'text-right', 'w-28'],
              ['', 'text-right', 'w-10'],
            ].map(([label, align, width]) => (
              <th
                key={label}
                className={`py-2 px-3 ${align} ${width} text-gray-500 text-xs font-semibold tracking-wider`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {watchlist.map((sym, idx) => {
            const q = quotes[sym]
            const flash = priceFlash[sym]
            let rowBg = idx % 2 === 0 ? 'bg-gray-900/20' : 'bg-transparent'
            if (flash === 'up') rowBg = 'bg-emerald-900/25'
            if (flash === 'down') rowBg = 'bg-red-900/25'

            return (
              <Fragment key={sym}>
                <tr
                  onClick={() => onChartOpen(sym)}
                  className={`border-b border-gray-800/60 cursor-pointer transition-colors duration-300 hover:bg-gray-800/50 ${rowBg}`}
                >
                  {/* Symbol + Name */}
                  <td className="py-3 px-3">
                    <div className="font-bold text-white flex items-center gap-2">
                      {sym}
                      <span className="text-gray-700 text-xs">↗</span>
                    </div>
                    {q?.name && (
                      <div className="text-xs text-gray-500 truncate max-w-[140px]">{q.name}</div>
                    )}
                    {!q && (
                      <div className="text-xs text-yellow-600 animate-pulse">Loading…</div>
                    )}
                    {q?.error && (
                      <div className="text-xs text-red-500" title={q.error}>Error</div>
                    )}
                  </td>

                  {/* Price */}
                  <td className="py-3 px-3 text-right">
                    <span
                      className={`font-bold text-base transition-colors duration-300 ${
                        flash === 'up'
                          ? 'text-emerald-300'
                          : flash === 'down'
                          ? 'text-red-300'
                          : 'text-white'
                      }`}
                    >
                      {fmt.price(q?.price)}
                    </span>
                  </td>

                  {/* Change $ */}
                  <td className="py-3 px-3 text-right">
                    <ChangeCell value={q?.change} isPercent={false} />
                  </td>

                  {/* Change % */}
                  <td className="py-3 px-3 text-right">
                    <ChangeCell value={q?.changePercent} isPercent={true} />
                  </td>

                  {/* Day Range */}
                  <td className="py-3 px-3">
                    <RangeCell lo={q?.dayLow} hi={q?.dayHigh} current={q?.price} />
                  </td>

                  {/* Volume */}
                  <td className="py-3 px-3 text-right text-gray-300">
                    {fmt.volume(q?.volume)}
                  </td>

                  {/* 52W Range */}
                  <td className="py-3 px-3">
                    <RangeCell lo={q?.week52Low} hi={q?.week52High} current={q?.price} />
                  </td>

                  {/* Market Cap */}
                  <td className="py-3 px-3 text-right text-gray-300">
                    {fmt.marketCap(q?.marketCap)}
                  </td>

                  {/* Remove */}
                  <td className="py-3 px-3 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemove(sym) }}
                      className="text-gray-700 hover:text-red-400 transition-colors text-xl leading-none"
                      title="Remove"
                    >
                      ×
                    </button>
                  </td>
                </tr>

              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
