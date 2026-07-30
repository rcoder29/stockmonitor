import { useState, useRef, useEffect } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCap(v) {
  if (v == null) return '—'
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (Math.abs(v) >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`
  return `$${v.toLocaleString()}`
}

function fmtPct(v, showSign = false) {
  if (v == null) return '—'
  return `${showSign && v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

function fmtX(v) {
  if (v == null) return '—'
  return `${v.toFixed(1)}x`
}

function fmtPrice(v) {
  if (v == null) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function mdToHtml(md) {
  if (!md) return ''
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-white mt-6 mb-2 pb-1 border-b border-slate-700">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-bold text-white mt-4 mb-1">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em class="text-slate-300">$1</em>')
    .replace(/^[-•] (.+)$/gm, '<li class="ml-4 list-disc text-slate-300 my-0.5">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-slate-300 my-0.5">$2</li>')
    .replace(/`([^`]+)`/g, '<code class="bg-slate-700 px-1 rounded text-xs font-mono text-blue-300">$1</code>')
    .replace(/\n\n/g, '</p><p class="mb-2 text-slate-300 leading-relaxed">')
}

function Stat({ label, value, sub, color }) {
  return (
    <div className="bg-slate-900/60 rounded-lg p-2.5 min-w-0">
      <p className="text-xs text-slate-500 truncate">{label}</p>
      <p className={`text-sm font-bold mt-0.5 tabular-nums truncate ${color || 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

function RecBadge({ rec }) {
  if (!rec) return null
  const r = rec.toLowerCase()
  const map = {
    'strong_buy': ['STRONG BUY', 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50'],
    'buy':        ['BUY',        'bg-emerald-900/40 text-emerald-400 border-emerald-700/40'],
    'hold':       ['HOLD',       'bg-yellow-900/40 text-yellow-400 border-yellow-700/40'],
    'sell':       ['SELL',       'bg-red-900/40 text-red-400 border-red-700/40'],
    'strong_sell':['STRONG SELL','bg-red-900/60 text-red-300 border-red-700/50'],
  }
  const [label, cls] = map[r] || [rec.toUpperCase(), 'bg-slate-700 text-slate-300 border-slate-600']
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
  )
}

// ── Snapshot card panel ───────────────────────────────────────────────────────

function SnapshotPanel({ snap }) {
  const up = (snap.changePct || 0) >= 0

  const ma50   = snap.ma50
  const ma200  = snap.ma200
  const price  = snap.price
  const above50  = ma50  ? (price > ma50  ? '▲ above 50d' : '▼ below 50d')  : null
  const above200 = ma200 ? (price > ma200 ? '▲ above 200d' : '▼ below 200d') : null

  const tgtMean = snap.targetMeanPrice
  const upside = tgtMean && price ? ((tgtMean - price) / price * 100).toFixed(1) : null

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-white">{snap.name}</h2>
            <span className="text-xs text-slate-500 font-mono bg-slate-700 px-2 py-0.5 rounded">{snap.symbol}</span>
            {snap.exchange && <span className="text-xs text-slate-500">{snap.exchange}</span>}
          </div>
          {snap.sector && (
            <p className="text-xs text-slate-400 mt-0.5">{snap.sector} · {snap.industry}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-white tabular-nums">{fmtPrice(snap.price)}</p>
          <p className={`text-sm font-semibold tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}>
            {up ? '+' : ''}{fmtPrice(snap.change)} ({fmtPct(snap.changePct, true)}) today
          </p>
        </div>
      </div>

      {/* Stat grids */}
      <div>
        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Price & Returns</p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <Stat label="52W High"  value={fmtPrice(snap.week52High)} />
          <Stat label="52W Low"   value={fmtPrice(snap.week52Low)} />
          <Stat label="YTD"       value={fmtPct(snap.ytdReturn, true)} color={snap.ytdReturn >= 0 ? 'text-emerald-400' : 'text-red-400'} />
          <Stat label="1 Month"   value={fmtPct(snap.return1m, true)} color={(snap.return1m||0) >= 0 ? 'text-emerald-400' : 'text-red-400'} />
          <Stat label="3 Month"   value={fmtPct(snap.return3m, true)} color={(snap.return3m||0) >= 0 ? 'text-emerald-400' : 'text-red-400'} />
          <Stat label="Beta"      value={snap.beta?.toFixed(2) ?? '—'} />
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Technicals</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="RSI (14)"    value={snap.rsi14?.toFixed(1) ?? '—'}
            color={snap.rsi14 > 70 ? 'text-red-400' : snap.rsi14 < 30 ? 'text-emerald-400' : 'text-white'} />
          <Stat label="50-day MA"   value={fmtPrice(snap.ma50)}  sub={above50}
            color={ma50 && price > ma50 ? 'text-emerald-400' : 'text-red-400'} />
          <Stat label="200-day MA"  value={fmtPrice(snap.ma200)} sub={above200}
            color={ma200 && price > ma200 ? 'text-emerald-400' : 'text-red-400'} />
          <Stat label="Short Float" value={fmtPct(snap.shortPct)} />
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Fundamentals</p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <Stat label="Market Cap"   value={fmtCap(snap.marketCap)} />
          <Stat label="Revenue"      value={fmtCap(snap.revenue)} sub={snap.revenueGrowth != null ? `+${snap.revenueGrowth.toFixed(1)}% YoY` : null} />
          <Stat label="Free CF"      value={fmtCap(snap.freeCashflow)} />
          <Stat label="Profit Margin" value={fmtPct(snap.profitMargin)} />
          <Stat label="ROE"          value={fmtPct(snap.roe)} />
          <Stat label="Debt/Equity"  value={snap.debtToEquity?.toFixed(1) ?? '—'} />
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Valuation</p>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          <Stat label="P/E (TTM)"   value={fmtX(snap.peRatio)} />
          <Stat label="Fwd P/E"     value={fmtX(snap.forwardPE)} />
          <Stat label="P/S"         value={fmtX(snap.priceToSales)} />
          <Stat label="P/B"         value={fmtX(snap.priceToBook)} />
          <Stat label="EV/EBITDA"   value={fmtX(snap.evEbitda)} />
        </div>
      </div>

      {/* Analyst consensus */}
      {(snap.recommendation || snap.targetMeanPrice) && (
        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-700">
          {snap.recommendation && <RecBadge rec={snap.recommendation} />}
          {snap.analystCount && <span className="text-xs text-slate-400">{snap.analystCount} analysts</span>}
          {snap.targetLowPrice && (
            <span className="text-xs text-slate-400">
              Target: <span className="text-red-400">{fmtPrice(snap.targetLowPrice)}</span>
              {' '}–{' '}
              <span className="text-white font-semibold">{fmtPrice(snap.targetMeanPrice)}</span>
              {' '}–{' '}
              <span className="text-emerald-400">{fmtPrice(snap.targetHighPrice)}</span>
            </span>
          )}
          {upside && (
            <span className={`text-xs font-bold ${parseFloat(upside) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {parseFloat(upside) >= 0 ? '+' : ''}{upside}% to mean target
            </span>
          )}
          {snap.earningsDate && (
            <span className="text-xs text-slate-500 ml-auto">Next earnings: {snap.earningsDate}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const RECENT_KEY = 'stock_analyzer_recent'
const MAX_RECENT = 8

export default function StockAnalyzer() {
  const [input, setInput]         = useState('')
  const [snap, setSnap]           = useState(null)
  const [snapLoading, setSnapLoading] = useState(false)
  const [generating, setGenerating]   = useState(false)
  const [analysis, setAnalysis]   = useState('')
  const [error, setError]         = useState(null)
  const [recent, setRecent]       = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') }
    catch { return [] }
  })
  const abortRef   = useRef(null)
  const outputRef  = useRef(null)

  function addRecent(sym) {
    const next = [sym, ...recent.filter(s => s !== sym)].slice(0, MAX_RECENT)
    setRecent(next)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  }

  async function analyze(sym) {
    sym = sym.trim().toUpperCase()
    if (!sym) return
    setInput(sym)
    setError(null)
    setSnap(null)
    setAnalysis('')

    // 1. Fetch snapshot
    setSnapLoading(true)
    let snapshot
    try {
      const r = await fetch(`/api/market/stock-snapshot/${sym}`)
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.detail || `HTTP ${r.status}`)
      }
      snapshot = await r.json()
      setSnap(snapshot)
      addRecent(sym)
    } catch (e) {
      setError(e.message)
      setSnapLoading(false)
      return
    }
    setSnapLoading(false)

    // 2. Stream AI analysis
    setGenerating(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const resp = await fetch('/api/ai/stock-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym }),
        signal: ctrl.signal,
      })
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}))
        throw new Error(e.detail || `HTTP ${resp.status}`)
      }
      const reader = resp.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const chunk = line.slice(6)
            if (chunk === '[DONE]') break
            if (chunk.startsWith('[ERROR]')) { setError(chunk.slice(7).trim()); break }
            setAnalysis(prev => prev + chunk)
            if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  function stop() {
    abortRef.current?.abort()
    setGenerating(false)
  }

  function handleSubmit(e) {
    e.preventDefault()
    analyze(input)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">AI Stock Analyzer</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Enter any ticker for a deep-dive: business overview, competitive moat, financials, valuation, bull/bear case, and verdict — powered by Claude.
        </p>
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          placeholder="Ticker symbol — e.g. AAPL, NVDA, MSFT"
          className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm font-mono placeholder-slate-500 focus:outline-none focus:border-blue-500 uppercase"
        />
        <button type="submit" disabled={snapLoading || generating || !input.trim()}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition-colors disabled:opacity-50">
          {snapLoading ? 'Loading…' : 'Analyze →'}
        </button>
        {generating && (
          <button type="button" onClick={stop}
            className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-xl transition-colors">
            ■ Stop
          </button>
        )}
      </form>

      {/* Recent tickers */}
      {recent.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-slate-600 self-center">Recent:</span>
          {recent.map(sym => (
            <button key={sym} onClick={() => analyze(sym)}
              disabled={snapLoading || generating}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-mono rounded-lg transition-colors disabled:opacity-40">
              {sym}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>
      )}

      {/* Snapshot panel */}
      {snap && <SnapshotPanel snap={snap} />}

      {/* AI analysis output */}
      {(analysis || generating) && (
        <div ref={outputRef}
          className="bg-slate-800 rounded-xl border border-slate-700 p-6 max-h-[640px] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">AI Analysis — {snap?.symbol}</h2>
            {analysis && !generating && (
              <button onClick={() => navigator.clipboard.writeText(analysis)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                Copy report
              </button>
            )}
          </div>
          <div
            className="text-slate-300 text-sm leading-relaxed space-y-1"
            dangerouslySetInnerHTML={{
              __html: '<p class="mb-2 text-slate-300 leading-relaxed">' + mdToHtml(analysis) + '</p>'
            }}
          />
          {generating && (
            <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5 rounded-sm align-middle" />
          )}
        </div>
      )}

      {!snap && !snapLoading && !error && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 text-center">
          <p className="text-slate-400 text-sm">Enter a ticker above to generate an AI-powered research report.</p>
          <p className="text-xs text-slate-600 mt-2">
            Works for US stocks, ETFs, and major international ADRs. Data from Yahoo Finance, analysis by Claude claude-sonnet-4-6.
          </p>
        </div>
      )}

      <p className="text-xs text-slate-600">
        Fundamental and price data from Yahoo Finance. Analysis generated by Claude claude-sonnet-4-6. For informational and educational purposes only — not personalised investment advice.
      </p>
    </div>
  )
}
