import { fmt } from '../utils/format'

function Metric({ label, value }) {
  return (
    <div className="bg-gray-800/70 border border-gray-700/50 rounded px-3 py-2 min-w-[130px]">
      <div className="text-gray-500 text-xs mb-1 uppercase tracking-wider">{label}</div>
      <div className="text-white font-medium text-sm">{value ?? '—'}</div>
    </div>
  )
}

export default function FundamentalsPanel({ quote: q }) {
  const divYield =
    q.dividendYield != null ? `${(q.dividendYield * 100).toFixed(2)}%` : null
  const profitMargin =
    q.profitMargin != null ? `${(q.profitMargin * 100).toFixed(1)}%` : null
  const roe =
    q.roe != null ? `${(q.roe * 100).toFixed(1)}%` : null
  const eps =
    q.eps != null ? `$${q.eps.toFixed(2)}` : null

  return (
    <div className="py-1">
      <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">Fundamentals</div>
      <div className="flex flex-wrap gap-2">
        <Metric label="P/E (TTM)" value={fmt.ratio(q.peRatio)} />
        <Metric label="P/E (Fwd)" value={fmt.ratio(q.forwardPE)} />
        <Metric label="EPS (TTM)" value={eps} />
        <Metric label="Div Yield" value={divYield} />
        <Metric label="Beta" value={fmt.ratio(q.beta)} />
        <Metric label="P/B Ratio" value={fmt.ratio(q.priceToBook)} />
        <Metric label="Revenue (TTM)" value={fmt.marketCap(q.revenue)} />
        <Metric label="Profit Margin" value={profitMargin} />
        <Metric label="ROE" value={roe} />
        <Metric label="Debt / Equity" value={fmt.ratio(q.debtToEquity)} />
      </div>
    </div>
  )
}
