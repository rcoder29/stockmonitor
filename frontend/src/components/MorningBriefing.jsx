import { useState, useEffect, useRef } from 'react'

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA']

const SNAPSHOT_SYMS = ['^GSPC', '^IXIC', '^DJI', '^RUT', '^VIX', '^TNX']
const SNAPSHOT_LABELS = {
  '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq', '^DJI': 'Dow',
  '^RUT':  'Russell', '^VIX':  'VIX',    '^TNX': '10-Yr',
}

const CACHE_PREFIX = 'morning_briefing_'
const WL_KEY = 'morning_briefing_watchlist'

function todayKey() {
  return CACHE_PREFIX + new Date().toISOString().slice(0, 10)
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'
}

function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const hr = Math.floor(m / 60)
  return `${hr}h ${m % 60}m ago`
}

// minimal markdown → html (same pattern as TaxAdvisor)
function mdToHtml(text) {
  let h = text
  h = h.replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, (_, head, body) => {
    const th = head.split('|').filter(Boolean).map(c =>
      `<th class="px-3 py-2 text-left text-xs font-semibold text-slate-300 border-b border-slate-700">${c.trim()}</th>`
    ).join('')
    const rows = body.trim().split('\n').map(row => {
      const cells = row.split('|').filter(Boolean).map(c =>
        `<td class="px-3 py-2 text-xs text-slate-300 border-b border-slate-800">${c.trim()}</td>`
      ).join('')
      return `<tr class="hover:bg-slate-800/50">${cells}</tr>`
    }).join('')
    return `<div class="overflow-x-auto my-3"><table class="w-full border border-slate-700 rounded-lg overflow-hidden"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`
  })
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
  h = h.replace(/`([^`]+)`/g, '<code class="bg-slate-700 text-emerald-300 px-1 rounded text-xs font-mono">$1</code>')
  h = h.replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-white mt-7 mb-3 pb-1.5 border-b border-slate-700">$1</h2>')
  h = h.replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-slate-200 mt-4 mb-1.5">$1</h3>')
  h = h.replace(/((?:^[-•*] .+\n?)+)/gm, blk => {
    const items = blk.trim().split('\n').map(l =>
      `<li class="ml-4 list-disc text-slate-300">${l.replace(/^[-•*] /, '')}</li>`
    ).join('')
    return `<ul class="my-2 space-y-1.5">${items}</ul>`
  })
  h = h.replace(/((?:^\d+\. .+\n?)+)/gm, blk => {
    const items = blk.trim().split('\n').map(l =>
      `<li class="ml-4 list-decimal text-slate-300">${l.replace(/^\d+\. /, '')}</li>`
    ).join('')
    return `<ol class="my-2 space-y-1.5">${items}</ol>`
  })
  h = h.replace(/\n{2,}/g, '</p><p class="mt-2 text-slate-300 text-sm leading-relaxed">')
  return `<p class="text-slate-300 text-sm leading-relaxed">${h}</p>`
}

function SnapshotCard({ q }) {
  if (!q) return null
  const sym = q.symbol
  const label = SNAPSHOT_LABELS[sym] || sym
  const chg = q.changePercent
  const isVix = sym === '^VIX'
  const isYield = sym === '^TNX'
  const up = chg != null ? (isVix ? chg < 0 : chg >= 0) : null
  const price = q.price != null
    ? (isVix || isYield ? q.price.toFixed(2) : `$${q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    : '—'

  return (
    <div className="bg-slate-800 rounded-xl p-3.5 border border-slate-700 min-w-[110px]">
      <p className="text-xs text-slate-400 font-medium">{label}</p>
      <p className="text-sm font-bold text-white mt-1">{price}</p>
      {chg != null && (
        <p className={`text-xs font-semibold mt-0.5 ${up ? 'text-emerald-400' : 'text-red-400'}`}>
          {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
        </p>
      )}
    </div>
  )
}

export default function MorningBriefing() {
  const [snapshots, setSnapshots]     = useState([])
  const [snapLoading, setSnapLoading] = useState(true)
  const [symbols, setSymbols]         = useState(() => {
    try { return JSON.parse(localStorage.getItem(WL_KEY)) || DEFAULT_SYMBOLS }
    catch { return DEFAULT_SYMBOLS }
  })
  const [tagInput, setTagInput]       = useState('')
  const [editingWl, setEditingWl]     = useState(false)
  const [briefing, setBriefing]       = useState('')
  const [generating, setGenerating]   = useState(false)
  const [error, setError]             = useState(null)
  const [cachedAt, setCachedAt]       = useState(null)
  const [done, setDone]               = useState(false)
  const scrollRef = useRef(null)

  // load cache on mount
  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(todayKey()))
      if (cached?.text) {
        setBriefing(cached.text)
        setCachedAt(cached.generatedAt)
        setDone(true)
      }
    } catch { /* ignore */ }
  }, [])

  // auto-scroll while streaming
  useEffect(() => {
    if (generating && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [briefing, generating])

  // fetch snapshot
  useEffect(() => {
    fetch(`/api/quotes?symbols=${SNAPSHOT_SYMS.join(',')}`)
      .then(r => r.json())
      .then(setSnapshots)
      .catch(() => {})
      .finally(() => setSnapLoading(false))
  }, [])

  function saveSymbols(syms) {
    setSymbols(syms)
    localStorage.setItem(WL_KEY, JSON.stringify(syms))
  }

  function addTag(raw) {
    const sym = raw.trim().toUpperCase().replace(/[^A-Z0-9.\-^]/g, '')
    if (sym && !symbols.includes(sym) && symbols.length < 15) {
      saveSymbols([...symbols, sym])
    }
    setTagInput('')
  }

  function removeTag(sym) {
    saveSymbols(symbols.filter(s => s !== sym))
  }

  async function generate() {
    setGenerating(true)
    setError(null)
    setBriefing('')
    setDone(false)
    setCachedAt(null)

    let full = ''
    try {
      const res = await fetch('/api/ai/morning-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      })
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done: rd } = await reader.read()
        if (rd) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.text) { full += ev.text; setBriefing(full) }
            if (ev.done) setDone(true)
            if (ev.error) setError(ev.error)
          } catch { /* ignore */ }
        }
      }
      if (full) {
        const now = new Date().toISOString()
        localStorage.setItem(todayKey(), JSON.stringify({ text: full, generatedAt: now }))
        setCachedAt(now)
        setDone(true)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{greeting()}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{today}</p>
          <p className="text-xs text-slate-500 mt-1">AI-powered daily market briefing — personalized to your watchlist</p>
        </div>
        {done && cachedAt && (
          <div className="text-right shrink-0">
            <p className="text-xs text-slate-500">Last generated</p>
            <p className="text-xs text-emerald-400 font-medium">{timeAgo(cachedAt)}</p>
          </div>
        )}
      </div>

      {/* Market Snapshot */}
      <div>
        <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">Market Snapshot</p>
        {snapLoading ? (
          <div className="text-xs text-slate-500">Loading market data…</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {SNAPSHOT_SYMS.map(sym => {
              const q = snapshots.find(s => s.symbol === sym)
              return <SnapshotCard key={sym} q={q ? { ...q, symbol: sym } : null} />
            })}
          </div>
        )}
      </div>

      {/* Watchlist config */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Your Watchlist</p>
          <button
            onClick={() => setEditingWl(e => !e)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            {editingWl ? 'Done' : 'Edit'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {symbols.map(sym => (
            <span key={sym} className="inline-flex items-center gap-1 bg-slate-700 text-slate-200 text-xs px-2 py-1 rounded-full font-medium">
              {sym}
              {editingWl && (
                <button onClick={() => removeTag(sym)} className="text-slate-400 hover:text-red-400 leading-none">×</button>
              )}
            </span>
          ))}
          {editingWl && symbols.length < 15 && (
            <input
              value={tagInput}
              onChange={e => setTagInput(e.target.value.toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                  e.preventDefault()
                  addTag(tagInput)
                }
              }}
              onBlur={() => tagInput && addTag(tagInput)}
              placeholder="Add ticker…"
              className="bg-slate-600 text-white text-xs px-2 py-1 rounded-full w-24 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-400"
            />
          )}
        </div>
        {editingWl && (
          <p className="text-xs text-slate-500 mt-2">Press Enter or comma to add. Up to 15 symbols.</p>
        )}
      </div>

      {/* Generate button */}
      <div className="flex items-center gap-3">
        <button
          onClick={generate}
          disabled={generating}
          className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            generating
              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-900/30'
          }`}
        >
          {generating ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Generating briefing…
            </span>
          ) : done ? 'Refresh Briefing' : 'Generate Morning Briefing'}
        </button>
        {generating && (
          <p className="text-xs text-slate-400">Pulling live market data + streaming Claude analysis…</p>
        )}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>
      )}

      {/* Briefing output */}
      {briefing ? (
        <div
          ref={scrollRef}
          className="bg-slate-800/60 border border-slate-700 rounded-xl p-6 prose-invert max-h-[70vh] overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: mdToHtml(briefing) }}
        />
      ) : !generating && (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-10 text-center space-y-3">
          <div className="text-4xl">☀️</div>
          <p className="text-slate-300 font-medium">Start your trading day informed</p>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            Claude will analyze live market data, sector rotation, your watchlist, and breaking news — then deliver a structured briefing in seconds.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mt-3 text-xs text-slate-500">
            {['Market Pulse', 'Sector Rotation', 'Watchlist Spotlight', 'Key Headlines', 'Risk Radar', 'Action Checklist'].map(s => (
              <span key={s} className="bg-slate-700/60 px-2.5 py-1 rounded-full">{s}</span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-600">
        Briefing generated by Claude claude-sonnet-4-6 using live yfinance data. For informational purposes only — not financial advice. Results cached for the trading day; click Refresh to regenerate.
      </p>
    </div>
  )
}
