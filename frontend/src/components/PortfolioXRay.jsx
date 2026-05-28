import { useEffect, useState } from 'react'

const SECTOR_COLORS = {
  'Technology':         '#6366f1',
  'Health Care':        '#10b981',
  'Financials':         '#3b82f6',
  'Consumer Discr.':    '#f59e0b',
  'Communication':      '#8b5cf6',
  'Industrials':        '#06b6d4',
  'Consumer Staples':   '#84cc16',
  'Energy':             '#f97316',
  'Utilities':          '#ec4899',
  'Real Estate':        '#14b8a6',
  'Materials':          '#a855f7',
  'Unknown':            '#374151',
}

const CAP_COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']

function DonutChart({ slices, size = 120, thickness = 22, colors }) {
  const r = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r

  let offset = 0
  const paths = slices.map((s, i) => {
    const pct   = s.pct / 100
    const dash  = pct * circ
    const gap   = circ - dash
    const color = colors ? (colors[s.label] || colors[i % Object.keys(colors).length] || '#4b5563') : CAP_COLORS[i % CAP_COLORS.length]
    const el = (
      <circle key={i} cx={cx} cy={cy} r={r}
        fill="none" stroke={color} strokeWidth={thickness}
        strokeDasharray={`${dash} ${gap}`}
        strokeDashoffset={-offset * circ}
        strokeLinecap="butt"
        style={{ transform: `rotate(-90deg)`, transformOrigin: `${cx}px ${cy}px` }}
      />
    )
    offset += pct
    return el
  })

  return <svg width={size} height={size}>{paths}</svg>
}

function BreakdownRow({ label, pct, color }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-gray-400 text-xs flex-1 truncate">{label}</span>
      <div className="w-24 bg-gray-800 rounded-full h-1 overflow-hidden shrink-0">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-gray-400 text-xs w-8 text-right tabular-nums">{pct.toFixed(0)}%</span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
      <div className="text-gray-500 text-xs uppercase tracking-widest">{title}</div>
      {children}
    </div>
  )
}

export default function PortfolioXRay() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch('/api/portfolio/xray')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (d.detail) throw new Error(d.detail); setData(d) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="py-16 text-center text-gray-500 text-sm animate-pulse">Analyzing portfolio…</div>
  if (error)   return <div className="py-10 text-center text-red-400 text-sm">Failed: {error}</div>
  if (!data)   return null

  const sectorSlices = data.sector_breakdown || []
  const capSlices    = data.cap_breakdown    || []

  return (
    <div className="space-y-5">
      <div className="text-gray-500 text-xs uppercase tracking-widest">Portfolio X-Ray</div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Portfolio Value',   val: `$${(data.total_value ?? 0).toLocaleString()}`,    color: 'text-white' },
          { label: 'Weighted P/E',      val: data.weighted_pe != null ? data.weighted_pe.toFixed(1) : '—', color: 'text-sky-400' },
          { label: 'Weighted Beta',     val: data.weighted_beta != null ? data.weighted_beta.toFixed(2) : '—',
            color: (data.weighted_beta ?? 1) > 1.2 ? 'text-amber-400' : 'text-white' },
          { label: 'Top-3 Conc.',       val: `${data.concentration_top3 ?? '—'}%`, color: data.concentration_top3 > 60 ? 'text-amber-400' : 'text-white' },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-gray-800/60 border border-gray-700/40 rounded-xl p-3">
            <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">{label}</div>
            <div className={`font-bold text-lg tabular-nums ${color}`}>{val}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Sector breakdown */}
        <Section title="Sector Exposure">
          <div className="flex gap-4 items-start">
            <DonutChart slices={sectorSlices} size={110} thickness={20} colors={SECTOR_COLORS} />
            <div className="flex-1 space-y-1.5">
              {sectorSlices.map(s => (
                <BreakdownRow key={s.label} label={s.label} pct={s.pct} color={SECTOR_COLORS[s.label] || '#4b5563'} />
              ))}
            </div>
          </div>
        </Section>

        {/* Market cap */}
        <Section title="Market Cap Distribution">
          <div className="flex gap-4 items-start">
            <DonutChart slices={capSlices} size={110} thickness={20} />
            <div className="flex-1 space-y-1.5">
              {capSlices.map((s, i) => (
                <BreakdownRow key={s.label} label={s.label} pct={s.pct} color={CAP_COLORS[i % CAP_COLORS.length]} />
              ))}
            </div>
          </div>
        </Section>

        {/* Geographic */}
        <Section title="Geographic Exposure">
          <div className="space-y-1.5">
            {(data.country_breakdown || []).slice(0, 8).map((s, i) => (
              <BreakdownRow key={s.label} label={s.label} pct={s.pct} color={['#6366f1','#10b981','#f59e0b','#3b82f6','#ef4444','#8b5cf6','#06b6d4','#84cc16'][i % 8]} />
            ))}
          </div>
        </Section>

        {/* Holdings detail */}
        <Section title="Holdings">
          <div className="space-y-1">
            {(data.holdings || []).map(h => (
              <div key={h.symbol} className="flex items-center gap-2 text-xs">
                <span className="text-white font-semibold w-12 shrink-0">{h.symbol}</span>
                <div className="flex-1 bg-gray-800 rounded-full h-1 overflow-hidden">
                  <div className="h-full bg-indigo-500/70 rounded-full" style={{ width: `${h.weight}%` }} />
                </div>
                <span className="text-gray-400 w-8 text-right tabular-nums">{h.weight}%</span>
                <span className="text-gray-600 w-20 truncate">{h.sector}</span>
                {h.pe   && <span className="text-sky-500 text-[10px] w-12 text-right">P/E {h.pe}</span>}
                {h.beta && <span className="text-gray-500 text-[10px] w-10 text-right">β{h.beta}</span>}
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="text-gray-700 text-xs">Sector/cap/country from Yahoo Finance · Cached 1hr · Not investment advice</div>
    </div>
  )
}
