import { useEffect, useState } from 'react'

const VIEWS = ['bullish', 'bearish', 'neutral']

function PayoffBar({ maxProfit, maxLoss }) {
  const isUnlimited = maxProfit === 'unlimited'
  const profitW = isUnlimited ? 100 : Math.min(100, (maxProfit / (maxProfit + maxLoss)) * 100)
  const lossW   = 100 - profitW

  return (
    <div className="flex h-2 rounded-full overflow-hidden w-full">
      <div className={`bg-emerald-500/70 ${isUnlimited ? 'flex-1' : ''}`} style={!isUnlimited ? { width: `${profitW}%` } : {}} />
      <div className="bg-red-500/70" style={{ width: `${lossW}%` }} />
    </div>
  )
}

function fmt(v) {
  if (v === 'unlimited') return '∞'
  if (typeof v === 'string') return v
  if (v == null) return '—'
  return `$${Math.abs(v).toLocaleString()}`
}

function StrategyCard({ s }) {
  const isCredit = s.cost_debit < 0

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-white font-semibold text-sm">{s.name}</div>
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${isCredit ? 'bg-emerald-900/40 text-emerald-400' : 'bg-amber-900/30 text-amber-400'}`}>
          {isCredit ? `Credit $${Math.abs(s.cost_debit)}` : `Debit $${s.cost_debit}`}
        </span>
      </div>

      {/* Legs */}
      <div className="flex flex-wrap gap-2">
        {s.legs.map((leg, i) => (
          <div key={i} className={`text-xs px-2 py-1 rounded border ${leg.action === 'buy' ? 'border-emerald-700/40 text-emerald-400 bg-emerald-900/10' : 'border-red-700/40 text-red-400 bg-red-900/10'}`}>
            {leg.action === 'buy' ? 'LONG' : 'SHORT'} ${leg.strike} {leg.type.toUpperCase()} @ ${leg.cost}
          </div>
        ))}
      </div>

      {/* Payoff bar */}
      <PayoffBar maxProfit={s.max_profit === 'unlimited' ? 9999 : s.max_profit} maxLoss={s.max_loss} />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-gray-600 mb-0.5">Max Profit</div>
          <div className="text-emerald-400 font-semibold tabular-nums">{fmt(s.max_profit)}</div>
        </div>
        <div>
          <div className="text-gray-600 mb-0.5">Max Loss</div>
          <div className="text-red-400 font-semibold tabular-nums">{fmt(s.max_loss)}</div>
        </div>
        <div>
          <div className="text-gray-600 mb-0.5">Breakeven</div>
          <div className="text-white font-semibold tabular-nums">
            {typeof s.breakeven === 'number' ? `$${s.breakeven.toFixed(2)}` : s.breakeven ?? '—'}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function OptionsStrategies({ symbol, currentPrice }) {
  const [view,    setView]    = useState('bullish')
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true); setError(null); setData(null)
    fetch(`/api/options/strategies/${symbol}?view=${view}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol, view])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Options Strategy Builder</div>
        <div className="flex gap-1 bg-gray-900/60 rounded-lg p-1 border border-gray-800">
          {VIEWS.map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                view === v
                  ? v === 'bullish' ? 'bg-emerald-600 text-white' : v === 'bearish' ? 'bg-red-600 text-white' : 'bg-gray-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {data && (
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <span className="text-white font-semibold">{data.symbol}</span>
          <span className="text-gray-600">@</span>
          <span className="tabular-nums">${(currentPrice ?? data.price)?.toFixed(2)}</span>
          <span className="text-gray-700">·</span>
          <span className="text-gray-600 text-xs">Expiry: {data.expiry}</span>
        </div>
      )}

      {loading && <div className="py-10 text-center text-gray-500 text-sm animate-pulse">Loading strategies…</div>}
      {error   && <div className="py-10 text-center text-red-400 text-sm">Failed: {error}</div>}

      {!loading && data?.strategies?.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.strategies.map((s, i) => <StrategyCard key={i} s={s} />)}
        </div>
      )}

      {!loading && !error && data?.strategies?.length === 0 && (
        <div className="py-8 text-center text-gray-600 text-sm">No strategies available for this view.</div>
      )}

      <div className="text-gray-700 text-xs">Prices use mid-market. Cached 1 hour. Not investment advice.</div>
    </div>
  )
}
