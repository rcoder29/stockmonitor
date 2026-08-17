import { useState, useEffect, useCallback } from 'react'

const fmtMoney = v => v == null ? '—' : `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
const fmtPct   = v => v == null ? '—' : `${v.toFixed(1)}%`

function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
      <div className="text-gray-500 text-xs uppercase tracking-widest">{label}</div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-gray-600 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

const SLEEVE_COLORS = {
  stocks: '#10b981', options: '#3b82f6', cppi: '#a855f7',
  mergerarb: '#6b7280', spacs: '#6b7280',
}

function ExposureBar({ sleeves }) {
  const betaSleeves = sleeves.filter(s => s.includedInBeta && s.marketExposure)
  const total = betaSleeves.reduce((sum, s) => sum + Math.abs(s.marketExposure), 0) || 1
  return (
    <div className="space-y-2">
      <div className="h-6 rounded-lg overflow-hidden flex bg-gray-800 border border-gray-700">
        {betaSleeves.map(s => (
          <div
            key={s.key}
            style={{ width: `${Math.abs(s.marketExposure) / total * 100}%`, backgroundColor: SLEEVE_COLORS[s.key] || '#6b7280' }}
            title={`${s.label}: ${fmtMoney(s.marketExposure)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
        {betaSleeves.map(s => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: SLEEVE_COLORS[s.key] || '#6b7280' }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function NetExposure() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/portfolio/net-exposure')
      if (!r.ok) throw new Error('Failed to load net exposure')
      setData(await r.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const betaSleeves  = data?.sleeves?.filter(s => s.includedInBeta) ?? []
  const otherSleeves = data?.sleeves?.filter(s => !s.includedInBeta) ?? []
  const hasNothing = !loading && data && data.totalCapitalDeployed === 0

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-5">
      <div>
        <h2 className="text-white font-bold text-lg">Net Market Exposure</h2>
        <p className="text-gray-500 text-xs mt-0.5">
          Stocks, options, and CPPI rolled into one beta-adjusted "how much market risk am I carrying right now" number.
          Merger Arb and SPACs are shown separately — those are event-driven strategies, not a bet on market direction.
        </p>
      </div>

      {loading && <div className="text-gray-500 text-sm">Loading…</div>}
      {error && <div className="text-red-400 text-sm bg-red-950/30 border border-red-800/50 rounded-lg p-3">{error}</div>}

      {hasNothing && (
        <div className="text-center text-gray-600 text-sm py-10 border border-dashed border-gray-700 rounded-xl">
          No positions in Portfolio, Options, Merger Arb, SPACs, or CPPI yet — add some to see your aggregate exposure here.
        </div>
      )}

      {!loading && data && !hasNothing && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Capital Deployed" value={fmtMoney(data.totalCapitalDeployed)}
              sub="Across all sleeves" />
            <StatCard label="Net Market Exposure" value={fmtMoney(data.netMarketExposure)}
              color="text-amber-400" sub="SPY-equivalent, beta-adjusted" />
            <StatCard label="Exposure / Capital" value={fmtPct(data.netMarketExposurePct)}
              color={data.netMarketExposurePct > 110 ? 'text-red-400' : data.netMarketExposurePct < 70 ? 'text-blue-400' : 'text-gray-300'}
              sub={data.netMarketExposurePct > 100 ? 'Levered to the market' : 'De-levered vs. market'} />
            <StatCard label="Stock VaR 95% (1d)" value={fmtMoney(data.stockVar95)}
              color="text-red-400" sub={`vs ${fmtMoney(data.stockVar99)} at 99% · stocks only`} />
          </div>

          {betaSleeves.length > 0 && (
            <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
              <div className="text-gray-500 text-xs uppercase tracking-widest mb-3">Beta-Adjusted Exposure Composition</div>
              <ExposureBar sleeves={betaSleeves} />
            </div>
          )}

          <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 text-gray-500 text-xs uppercase tracking-widest">
              Sleeve Breakdown
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                    <th className="text-left py-2 px-4">Sleeve</th>
                    <th className="text-right py-2 px-4">Capital / Value</th>
                    <th className="text-right py-2 px-4">Beta</th>
                    <th className="text-right py-2 px-4">Beta-Adj. Exposure</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sleeves.map(s => (
                    <tr key={s.key} className="border-b border-gray-800/40">
                      <td className="py-2.5 px-4">
                        <div className="text-gray-200 font-medium flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: SLEEVE_COLORS[s.key] || '#6b7280' }} />
                          {s.label}
                        </div>
                        {s.note && <div className="text-gray-600 text-xs mt-0.5 max-w-md">{s.note}</div>}
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-300 tabular-nums">{fmtMoney(s.capitalValue)}</td>
                      <td className="py-2.5 px-4 text-right text-gray-400 tabular-nums">{s.beta != null ? s.beta.toFixed(2) : '—'}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-medium text-gray-200">
                        {s.includedInBeta ? fmtMoney(s.marketExposure) : <span className="text-gray-600">excluded</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {otherSleeves.length > 0 && (
            <div className="text-gray-600 text-xs px-1">
              Event-driven capital (Merger Arb / SPACs) totals {fmtMoney(otherSleeves.reduce((s, x) => s + (x.capitalValue || 0), 0))}
              {' '}and is deliberately excluded from Net Market Exposure above — its risk is deal completion / trust redemption, not market direction.
            </div>
          )}

          <div className="text-gray-700 text-xs pt-1">
            Options exposure uses a Black-Scholes delta computed from strike, expiry, and implied volatility (yfinance
            doesn't reliably supply live Greeks), then beta-weights it by the underlying's beta. Cached 2 minutes.
          </div>
        </>
      )}
    </div>
  )
}
