import { useState, useEffect } from 'react'

const TYPE_CONFIG = {
  fomc: { label: 'FOMC',  bg: 'bg-sky-900/50',    border: 'border-sky-700/60',    text: 'text-sky-300',    badge: 'bg-sky-700',    icon: '🏦' },
  cpi:  { label: 'CPI',   bg: 'bg-amber-900/40',  border: 'border-amber-700/50',  text: 'text-amber-300',  badge: 'bg-amber-600',  icon: '📊' },
  ppi:  { label: 'PPI',   bg: 'bg-orange-900/40', border: 'border-orange-700/50', text: 'text-orange-300', badge: 'bg-orange-600', icon: '🏭' },
  jobs: { label: 'Jobs',  bg: 'bg-emerald-900/30',border: 'border-emerald-700/40',text: 'text-emerald-300',badge: 'bg-emerald-700', icon: '💼' },
  pce:  { label: 'PCE',   bg: 'bg-pink-900/30',   border: 'border-pink-700/40',   text: 'text-pink-300',   badge: 'bg-pink-700',   icon: '🛒' },
  gdp:  { label: 'GDP',   bg: 'bg-purple-900/30', border: 'border-purple-700/40', text: 'text-purple-300', badge: 'bg-purple-700', icon: '📈' },
}

function daysLabel(d) {
  if (d < 0)  return `${Math.abs(d)}d ago`
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  return `${d}d`
}

function urgencyBg(d) {
  if (d <= 0)  return 'ring-1 ring-white/10'
  if (d <= 3)  return 'ring-1 ring-red-500/40'
  if (d <= 7)  return 'ring-1 ring-amber-500/20'
  return ''
}

export default function MacroCalendar() {
  const [events,  setEvents]  = useState([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('all')

  useEffect(() => {
    fetch('/api/market/economic-calendar')
      .then(r => r.json())
      .then(setEvents)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const types = ['all', ...Object.keys(TYPE_CONFIG)]
  const displayed = filter === 'all' ? events : events.filter(e => e.type === filter)

  // Group by month
  const grouped = {}
  for (const ev of displayed) {
    const month = ev.date.slice(0, 7) // YYYY-MM
    if (!grouped[month]) grouped[month] = []
    grouped[month].push(ev)
  }

  const formatMonth = (ym) => {
    const [y, m] = ym.split('-')
    return new Date(parseInt(y), parseInt(m) - 1, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  const formatDate = (d) => {
    const [y, mo, day] = d.split('-')
    return new Date(parseInt(y), parseInt(mo) - 1, parseInt(day))
      .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">

      <div className="flex items-center justify-between mb-5">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Economic Calendar</div>
        <div className="text-gray-600 text-xs">Dates are approximate — verify before trading</div>
      </div>

      {/* Type filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {types.map(t => {
          const cfg = t === 'all' ? null : TYPE_CONFIG[t]
          return (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                filter === t
                  ? cfg ? `${cfg.bg} ${cfg.border} ${cfg.text}` : 'bg-gray-700 border-gray-500 text-white'
                  : 'bg-gray-900/60 border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700'
              }`}
            >
              {cfg ? `${cfg.icon} ${cfg.label}` : 'All Events'}
            </button>
          )
        })}
      </div>

      {loading && (
        <div className="py-16 text-center text-gray-500 text-sm animate-pulse">Loading calendar…</div>
      )}

      {!loading && displayed.length === 0 && (
        <div className="py-16 text-center text-gray-600 text-sm">No upcoming events for this filter</div>
      )}

      {!loading && Object.entries(grouped).map(([month, evs]) => (
        <div key={month} className="mb-6">
          <div className="text-gray-500 text-xs uppercase tracking-widest mb-3 pb-1.5 border-b border-gray-800">
            {formatMonth(month)}
          </div>
          <div className="space-y-2">
            {evs.map((ev, i) => {
              const cfg = TYPE_CONFIG[ev.type] ?? TYPE_CONFIG.fomc
              const past = ev.daysUntil < 0
              return (
                <div
                  key={i}
                  className={`flex items-start gap-4 rounded-lg px-4 py-3 border ${cfg.bg} ${cfg.border} ${urgencyBg(ev.daysUntil)} ${past ? 'opacity-50' : ''}`}
                >
                  {/* Date column */}
                  <div className="shrink-0 w-28 text-xs">
                    <div className={`font-medium ${cfg.text}`}>{formatDate(ev.date)}</div>
                    <div className="text-gray-600 mt-0.5">{ev.date}</div>
                  </div>

                  {/* Event info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-white ${cfg.badge}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                      <span className="text-white text-sm font-medium">{ev.event}</span>
                      {ev.daysUntil <= 3 && ev.daysUntil >= 0 && (
                        <span className="text-red-400 text-xs font-semibold">⚠ Imminent</span>
                      )}
                    </div>
                    <div className={`text-xs mt-1 ${cfg.text} opacity-80`}>{ev.description}</div>
                  </div>

                  {/* Days until badge */}
                  <div className="shrink-0">
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                      past ? 'bg-gray-700 text-gray-500' :
                      ev.daysUntil === 0 ? 'bg-red-600 text-white' :
                      ev.daysUntil <= 3  ? 'bg-red-700/80 text-red-200' :
                      ev.daysUntil <= 7  ? 'bg-amber-700/80 text-amber-200' :
                      `${cfg.badge} text-white`
                    }`}>
                      {daysLabel(ev.daysUntil)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div className="mt-6 text-gray-700 text-xs border-t border-gray-800 pt-4">
        FOMC dates from Federal Reserve schedule · CPI/PPI/PCE from BLS release calendar · Jobs from BLS first-Friday schedule · GDP from BEA advance-estimate schedule
      </div>
    </div>
  )
}
