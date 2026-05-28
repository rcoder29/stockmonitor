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
  const divYield    = q.dividendYield != null ? `${(q.dividendYield * 100).toFixed(2)}%` : null
  const profitMargin = q.profitMargin != null ? `${(q.profitMargin * 100).toFixed(1)}%` : null
  const roe         = q.roe != null ? `${(q.roe * 100).toFixed(1)}%` : null
  const eps         = q.eps != null ? `$${q.eps.toFixed(2)}` : null
  const siPct       = q.shortPercentOfFloat != null ? `${(q.shortPercentOfFloat * 100).toFixed(1)}%` : null
  const siChange    = q.sharesShort != null && q.sharesShortPriorMonth != null && q.sharesShortPriorMonth > 0
    ? ((q.sharesShort / q.sharesShortPriorMonth - 1) * 100).toFixed(1)
    : null

  return (
    <div className="py-1 space-y-4">
      <div>
        <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">Fundamentals</div>
        <div className="flex flex-wrap gap-2">
          <Metric label="P/E (TTM)"     value={fmt.ratio(q.peRatio)} />
          <Metric label="P/E (Fwd)"     value={fmt.ratio(q.forwardPE)} />
          <Metric label="EPS (TTM)"     value={eps} />
          <Metric label="Div Yield"     value={divYield} />
          <Metric label="Beta"          value={fmt.ratio(q.beta)} />
          <Metric label="P/B Ratio"     value={fmt.ratio(q.priceToBook)} />
          <Metric label="Revenue (TTM)" value={fmt.marketCap(q.revenue)} />
          <Metric label="Profit Margin" value={profitMargin} />
          <Metric label="ROE"           value={roe} />
          <Metric label="Debt / Equity" value={fmt.ratio(q.debtToEquity)} />
        </div>
      </div>

      {(siPct || q.shortRatio != null) && (
        <div>
          <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">Short Interest</div>
          <div className="flex flex-wrap gap-2">
            {siPct && (
              <div className="bg-gray-800/70 border border-gray-700/50 rounded px-3 py-2 min-w-[130px]">
                <div className="text-gray-500 text-xs mb-1 uppercase tracking-wider">Short Float %</div>
                <div className={`font-medium text-sm ${parseFloat(siPct) > 20 ? 'text-red-400' : parseFloat(siPct) > 10 ? 'text-amber-400' : 'text-white'}`}>
                  {siPct}
                </div>
              </div>
            )}
            {q.shortRatio != null && (
              <div className="bg-gray-800/70 border border-gray-700/50 rounded px-3 py-2 min-w-[130px]">
                <div className="text-gray-500 text-xs mb-1 uppercase tracking-wider">Days to Cover</div>
                <div className={`font-medium text-sm ${q.shortRatio > 10 ? 'text-red-400' : q.shortRatio > 5 ? 'text-amber-400' : 'text-white'}`}>
                  {q.shortRatio.toFixed(1)}d
                </div>
              </div>
            )}
            {q.sharesShort != null && (
              <div className="bg-gray-800/70 border border-gray-700/50 rounded px-3 py-2 min-w-[130px]">
                <div className="text-gray-500 text-xs mb-1 uppercase tracking-wider">Shares Short</div>
                <div className="font-medium text-sm text-white">
                  {q.sharesShort >= 1e6 ? `${(q.sharesShort / 1e6).toFixed(1)}M` : q.sharesShort.toLocaleString()}
                </div>
                {siChange != null && (
                  <div className={`text-xs mt-0.5 ${parseFloat(siChange) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {parseFloat(siChange) > 0 ? '+' : ''}{siChange}% vs prior mo
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
