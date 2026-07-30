import { useState, useEffect, useRef } from 'react'

function mdToHtml(md) {
  if (!md) return ''
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-bold text-white mt-5 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-white mt-6 mb-2">$2</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-white mt-6 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-slate-300">$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc text-slate-300">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-slate-300">$2</li>')
    .replace(/`([^`]+)`/g, '<code class="bg-slate-700 px-1 py-0.5 rounded text-sm font-mono text-blue-300">$1</code>')
    .replace(/\n\n/g, '</p><p class="mb-3 text-slate-300">')
    .replace(/^(?!<[hlcp])/gm, '')
}

function fmt(n, dec = 2) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function fmtDollar(n) {
  if (n == null) return '—'
  const neg = n < 0
  const abs = Math.abs(n)
  let s
  if (abs >= 1e6)   s = `$${(abs / 1e6).toFixed(2)}M`
  else if (abs >= 1e3) s = `$${(abs / 1e3).toFixed(1)}K`
  else               s = `$${abs.toFixed(2)}`
  return neg ? `-${s}` : s
}

function PnlBadge({ v }) {
  if (v == null) return <span className="text-slate-500">—</span>
  const up = v >= 0
  return (
    <span className={`font-semibold tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? '+' : ''}{fmtDollar(v)}
    </span>
  )
}

function PctBadge({ v }) {
  if (v == null) return <span className="text-slate-500">—</span>
  const up = v >= 0
  return (
    <span className={`font-semibold tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? '+' : ''}{fmt(v)}%
    </span>
  )
}

function WeightBar({ pct, color = 'bg-blue-500' }) {
  return (
    <div className="w-full bg-slate-700 rounded-full h-1.5 mt-1">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.min(100, pct || 0)}%` }} />
    </div>
  )
}

export default function PortfolioReview() {
  const [portfolio, setPortfolio] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [generating, setGenerating] = useState(false)
  const [review, setReview]       = useState('')
  const [error, setError]         = useState(null)
  const abortRef = useRef(null)
  const reviewRef = useRef(null)

  useEffect(() => {
    fetch('/api/portfolio')
      .then(r => r.json())
      .then(d => { setPortfolio(Array.isArray(d) ? d : (d.positions || [])); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  async function generateReview() {
    if (generating) {
      abortRef.current?.abort()
      setGenerating(false)
      return
    }
    setGenerating(true)
    setReview('')
    setError(null)
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const resp = await fetch('/api/ai/portfolio-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${resp.status}`)
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
            setReview(prev => prev + chunk)
            if (reviewRef.current) {
              reviewRef.current.scrollTop = reviewRef.current.scrollHeight
            }
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  const positions = portfolio || []
  // Preview uses avgCost × shares as the invested amount (live prices come from streaming review)
  const totalInvested = positions.reduce((s, p) => s + (p.avgCost || 0) * (p.shares || 0), 0)
  const sortedPositions = [...positions].sort((a, b) =>
    ((b.avgCost || 0) * (b.shares || 0)) - ((a.avgCost || 0) * (a.shares || 0))
  )

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">AI Portfolio Review</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Claude analyzes your portfolio's holdings, weights, diversification, and risk to generate a personalized 6-section review.
        </p>
      </div>

      {loading && (
        <div className="py-12 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-slate-600 border-t-blue-500 animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Loading portfolio…</p>
        </div>
      )}

      {!loading && positions.length === 0 && !error && (
        <div className="bg-slate-800 rounded-xl p-10 text-center border border-slate-700">
          <p className="text-slate-300 font-semibold text-lg mb-2">No positions yet</p>
          <p className="text-slate-400 text-sm max-w-sm mx-auto">
            Add holdings in the Portfolio section first. Once you have positions, come back here for an AI-powered review.
          </p>
        </div>
      )}

      {!loading && positions.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'Positions',     value: positions.length,         color: 'text-white' },
              { label: 'Total Invested', value: fmtDollar(totalInvested), color: 'text-slate-300' },
              { label: 'Live P&L',      value: 'In AI Review →',         color: 'text-blue-400' },
            ].map(c => (
              <div key={c.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <p className="text-xs text-slate-400">{c.label}</p>
                <p className={`text-xl font-bold mt-1 ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* Positions table */}
          <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
            <div className="px-4 py-3 border-b border-slate-700">
              <h2 className="text-sm font-bold text-white">Holdings ({positions.length})</h2>
            </div>
            <div className="overflow-x-auto max-h-72">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="border-b border-slate-700 bg-slate-900">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Ticker</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Shares</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Avg Cost</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Invested</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Est. Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPositions.map(p => {
                    const invested = (p.avgCost || 0) * (p.shares || 0)
                    const weight   = totalInvested > 0 ? (invested / totalInvested) * 100 : 0
                    return (
                      <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                        <td className="px-3 py-2.5 font-bold text-white">{p.symbol}</td>
                        <td className="px-3 py-2.5 text-slate-300 tabular-nums text-right text-xs">{fmt(p.shares, 0)}</td>
                        <td className="px-3 py-2.5 text-slate-400 tabular-nums text-right text-xs">${fmt(p.avgCost)}</td>
                        <td className="px-3 py-2.5 text-white tabular-nums text-right font-medium text-xs">{fmtDollar(invested)}</td>
                        <td className="px-3 py-2.5 text-slate-300 tabular-nums text-right text-xs">
                          <div>{fmt(weight, 1)}%</div>
                          <WeightBar pct={weight} />
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          {/* Generate button */}
          <div className="flex items-center gap-4">
            <button onClick={generateReview}
              className={`px-5 py-3 rounded-xl font-semibold text-sm transition-all ${
                generating
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}>
              {generating ? '■ Stop Generating' : '✦ Generate AI Review'}
            </button>
            {generating && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <div className="w-4 h-4 rounded-full border-2 border-slate-600 border-t-blue-500 animate-spin" />
                Analyzing your portfolio…
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>
          )}

          {/* Streaming review output */}
          {review && (
            <div ref={reviewRef}
              className="bg-slate-800 rounded-xl border border-slate-700 p-6 space-y-2 max-h-[600px] overflow-y-auto">
              <div
                className="prose prose-invert max-w-none text-slate-300 leading-relaxed text-sm space-y-1"
                dangerouslySetInnerHTML={{ __html: '<p class="mb-3 text-slate-300">' + mdToHtml(review) + '</p>' }}
              />
              {generating && (
                <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5 rounded-sm" />
              )}
            </div>
          )}

          {!review && !generating && (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 text-center">
              <p className="text-slate-400 text-sm">
                Click <span className="text-blue-400 font-medium">Generate AI Review</span> to get a personalized 6-section portfolio analysis powered by Claude.
              </p>
              <p className="text-xs text-slate-500 mt-2">
                Covers: Portfolio Snapshot · Top Holdings Analysis · Sector &amp; Diversification · Risk Assessment · Opportunities &amp; Concerns · Action Items
              </p>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-slate-600">
        AI analysis powered by Claude claude-sonnet-4-6. Portfolio data from your holdings. Market quotes from Yahoo Finance. Not investment advice.
      </p>
    </div>
  )
}
