import { useState, useRef, useEffect, useCallback } from 'react'

// ── Allocation color palette ──────────────────────────────────────────────────
const COLOR_MAP = [
  ['US Large Cap',          '#3b82f6'],
  ['US Small',              '#60a5fa'],
  ['US Mid',                '#60a5fa'],
  ['International Developed','#8b5cf6'],
  ['International',         '#7c3aed'],
  ['Emerging',              '#a78bfa'],
  ['US Investment Grade',   '#f59e0b'],
  ['US Treasur',            '#fbbf24'],
  ['TIPS',                  '#fcd34d'],
  ['High Yield',            '#f97316'],
  ['Bond',                  '#d97706'],
  ['REIT',                  '#10b981'],
  ['Real Estate',           '#10b981'],
  ['Commodit',              '#f97316'],
  ['Gold',                  '#eab308'],
  ['Cash',                  '#6b7280'],
  ['Alternative',           '#ec4899'],
  ['Crypto',                '#facc15'],
]
const FALLBACK_COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#f97316','#ec4899','#06b6d4','#84cc16','#a78bfa','#fbbf24']

function allocationColor(name, idx) {
  for (const [key, color] of COLOR_MAP) {
    if (name.toLowerCase().includes(key.toLowerCase())) return color
  }
  return FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
}

// ── Simple markdown renderer ──────────────────────────────────────────────────
function mdToHtml(text) {
  let h = text
  // tables
  h = h.replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, (_, head, body) => {
    const th = head.split('|').filter(Boolean).map(c =>
      `<th class="px-3 py-1.5 text-left text-xs font-semibold text-gray-300 border-b border-gray-700">${c.trim()}</th>`
    ).join('')
    const rows = body.trim().split('\n').map(row => {
      const cells = row.split('|').filter(Boolean).map(c =>
        `<td class="px-3 py-1.5 text-xs text-gray-300 border-b border-gray-800">${c.trim()}</td>`
      ).join('')
      return `<tr class="hover:bg-gray-800/50">${cells}</tr>`
    }).join('')
    return `<div class="overflow-x-auto my-3"><table class="w-full border border-gray-700 rounded-lg overflow-hidden"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`
  })
  // bold
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
  // inline code
  h = h.replace(/`([^`]+)`/g, '<code class="bg-gray-700 text-emerald-300 px-1 rounded text-xs font-mono">$1</code>')
  // h2, h3
  h = h.replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-white mt-5 mb-2 pb-1 border-b border-gray-700">$1</h2>')
  h = h.replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-gray-200 mt-3 mb-1">$1</h3>')
  // bullets
  h = h.replace(/((?:^[-•*] .+\n?)+)/gm, blk => {
    const items = blk.trim().split('\n').map(l =>
      `<li class="ml-4 list-disc text-gray-300">${l.replace(/^[-•*] /, '')}</li>`
    ).join('')
    return `<ul class="my-1.5 space-y-0.5">${items}</ul>`
  })
  // numbered
  h = h.replace(/((?:^\d+\. .+\n?)+)/gm, blk => {
    const items = blk.trim().split('\n').map(l =>
      `<li class="ml-4 list-decimal text-gray-300">${l.replace(/^\d+\. /, '')}</li>`
    ).join('')
    return `<ol class="my-1.5 space-y-0.5">${items}</ol>`
  })
  // paragraph breaks
  h = h.replace(/\n{2,}/g, '</p><p class="mt-2 text-gray-300 text-sm leading-relaxed">')
  return `<p class="text-gray-300 text-sm leading-relaxed">${h}</p>`
}

// ── Allocation bar ────────────────────────────────────────────────────────────
function AllocationBar({ allocation }) {
  const entries = Object.entries(allocation)
  const total = entries.reduce((s, [, v]) => s + v, 0)

  return (
    <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700">
      <h3 className="text-sm font-semibold text-gray-200 mb-3">Target Asset Allocation</h3>
      {/* Stacked bar */}
      <div className="flex h-10 rounded-lg overflow-hidden mb-4 shadow-inner">
        {entries.map(([label, pct], i) => (
          <div
            key={label}
            style={{ width: `${(pct / total * 100).toFixed(2)}%`, backgroundColor: allocationColor(label, i) }}
            className="relative group transition-all"
            title={`${label}: ${pct}%`}
          >
            {pct >= 8 && (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/90 drop-shadow">
                {pct}%
              </span>
            )}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {entries.map(([label, pct], i) => (
          <div key={label} className="flex items-center gap-1.5 min-w-0">
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ backgroundColor: allocationColor(label, i) }}
            />
            <span className="text-xs text-gray-400 truncate">{label}</span>
            <span className="text-xs font-bold text-white ml-0.5">{pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Form options ──────────────────────────────────────────────────────────────
const GOALS = [
  { value: 'retirement',   label: 'Retirement',        icon: '🏖️', desc: 'Build long-term retirement income' },
  { value: 'house',        label: 'Home Purchase',      icon: '🏠', desc: 'Save for a down payment' },
  { value: 'education',    label: 'Education Fund',     icon: '🎓', desc: 'College or graduate school' },
  { value: 'wealth',       label: 'Wealth Building',    icon: '📈', desc: 'Grow net worth long-term' },
  { value: 'income',       label: 'Income Generation',  icon: '💰', desc: 'Dividends & regular income' },
  { value: 'preservation', label: 'Preserve Capital',   icon: '🛡️', desc: 'Low-risk capital protection' },
]

const RISKS = [
  {
    value: 'conservative',
    label: 'Conservative',
    sub: 'Capital preservation, low volatility',
    ring: 'border-blue-500 bg-blue-900/20',
    badge: 'text-blue-300',
    dot: 'bg-blue-400',
  },
  {
    value: 'moderate',
    label: 'Moderate',
    sub: 'Balanced growth and stability',
    ring: 'border-amber-500 bg-amber-900/20',
    badge: 'text-amber-300',
    dot: 'bg-amber-400',
  },
  {
    value: 'aggressive',
    label: 'Aggressive',
    sub: 'Maximum growth, higher volatility',
    ring: 'border-red-500 bg-red-900/20',
    badge: 'text-red-300',
    dot: 'bg-red-400',
  },
]

const TAX_OPTS = [
  { value: 'taxable',  label: 'Taxable Account' },
  { value: 'roth_ira', label: 'Roth IRA' },
  { value: 'trad_ira', label: 'Traditional IRA' },
  { value: '401k',     label: '401(k) / 403(b)' },
  { value: 'mix',      label: 'Multiple Account Types' },
]

const GEO_OPTS = [
  { value: 'us_focused', label: 'US-Focused' },
  { value: 'global',     label: 'Global Diversified' },
  { value: 'em_tilt',    label: 'Emerging Markets Tilt' },
]

function fmt(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FinancialAdvisor() {
  const [form, setForm] = useState({
    goal: 'retirement',
    horizon_years: 20,
    initial_amount: 50000,
    monthly_contribution: 1000,
    risk_tolerance: 'moderate',
    age: 35,
    tax_situation: 'mix',
    geography: 'global',
  })

  const [raw, setRaw]           = useState('')
  const [allocation, setAlloc]  = useState(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError]       = useState(null)
  const [generated, setGenerated] = useState(false)
  const abortRef   = useRef(null)
  const resultRef  = useRef(null)

  // Parse allocation JSON block as it streams in
  useEffect(() => {
    if (allocation) return
    const m = raw.match(/```allocation\n([\s\S]*?)\n```/)
    if (m) {
      try { setAlloc(JSON.parse(m[1])) } catch {}
    }
  }, [raw, allocation])

  const displayText = raw.replace(/```allocation[\s\S]*?```\n*/g, '').trim()

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const generate = useCallback(async () => {
    if (streaming) return
    setStreaming(true)
    setError(null)
    setRaw('')
    setAlloc(null)
    setGenerated(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/financial-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.error) { setError(evt.error); break }
            if (evt.done) break
            if (evt.text) setRaw(p => p + evt.text)
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setStreaming(false)
      abortRef.current = null
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }, [form, streaming])

  const stop = () => { abortRef.current?.abort(); setStreaming(false) }

  // Computed totals for summary pill
  const totalInvested = form.initial_amount + form.monthly_contribution * form.horizon_years * 12

  return (
    <div className="flex h-[calc(100vh-108px)] overflow-hidden">

      {/* ── Left panel: Form ─────────────────────────────────────── */}
      <div className="w-[380px] flex-shrink-0 overflow-y-auto bg-gray-900 border-r border-gray-800 p-4 space-y-5">

        {/* Goal */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Investment Goal</label>
          <div className="grid grid-cols-2 gap-1.5">
            {GOALS.map(g => (
              <button
                key={g.value}
                onClick={() => set('goal', g.value)}
                className={`text-left rounded-lg px-3 py-2.5 border transition-all ${
                  form.goal === g.value
                    ? 'border-emerald-500 bg-emerald-900/20 text-white'
                    : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                }`}
              >
                <div className="text-lg mb-0.5">{g.icon}</div>
                <div className="text-xs font-semibold">{g.label}</div>
                <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{g.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Horizon */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Investment Horizon</label>
            <span className="text-sm font-bold text-emerald-400">{form.horizon_years} yrs</span>
          </div>
          <input
            type="range" min="1" max="40" value={form.horizon_years}
            onChange={e => set('horizon_years', parseInt(e.target.value))}
            className="w-full accent-emerald-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
            <span>1 yr</span><span>10 yrs</span><span>20 yrs</span><span>30 yrs</span><span>40 yrs</span>
          </div>
        </div>

        {/* Amounts */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Starting Capital</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number" min="0" value={form.initial_amount}
                onChange={e => set('initial_amount', Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-full bg-gray-800 border border-gray-700 focus:border-emerald-500 rounded-lg pl-7 pr-3 py-2 text-sm text-gray-100 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Monthly Add</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number" min="0" value={form.monthly_contribution}
                onChange={e => set('monthly_contribution', Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-full bg-gray-800 border border-gray-700 focus:border-emerald-500 rounded-lg pl-7 pr-3 py-2 text-sm text-gray-100 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Total invested pill */}
        <div className="bg-gray-800/60 rounded-lg px-3 py-2 flex items-center justify-between">
          <span className="text-xs text-gray-500">Total capital deployed</span>
          <span className="text-sm font-bold text-white">{fmt(totalInvested)}</span>
        </div>

        {/* Risk tolerance */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Risk Tolerance</label>
          <div className="space-y-1.5">
            {RISKS.map(r => (
              <button
                key={r.value}
                onClick={() => set('risk_tolerance', r.value)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 border transition-all ${
                  form.risk_tolerance === r.value ? r.ring + ' border-2' : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${r.dot}`} />
                <div className="text-left flex-1 min-w-0">
                  <span className={`text-xs font-semibold ${form.risk_tolerance === r.value ? r.badge : 'text-gray-300'}`}>{r.label}</span>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{r.sub}</p>
                </div>
                {form.risk_tolerance === r.value && (
                  <span className={`text-xs font-bold ${r.badge}`}>✓</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Age */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Current Age</label>
            <span className="text-sm font-bold text-white">{form.age} yrs</span>
          </div>
          <input
            type="range" min="18" max="80" value={form.age}
            onChange={e => set('age', parseInt(e.target.value))}
            className="w-full accent-emerald-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
            <span>18</span><span>35</span><span>50</span><span>65</span><span>80</span>
          </div>
        </div>

        {/* Tax & Geography */}
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Account Type</label>
            <select
              value={form.tax_situation}
              onChange={e => set('tax_situation', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none cursor-pointer"
            >
              {TAX_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Geographic Focus</label>
            <select
              value={form.geography}
              onChange={e => set('geography', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none cursor-pointer"
            >
              {GEO_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* Generate button */}
        <div className="pb-2">
          {streaming ? (
            <button
              onClick={stop}
              className="w-full bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl py-3 transition-colors text-sm"
            >
              Stop Generating
            </button>
          ) : (
            <button
              onClick={generate}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl py-3 transition-colors text-sm shadow-lg shadow-emerald-900/30"
            >
              {generated ? '↻ Regenerate Strategy' : 'Generate My Investment Strategy'}
            </button>
          )}
          {generated && !streaming && (
            <p className="text-[10px] text-gray-600 text-center mt-1.5">
              Adjust inputs above and regenerate anytime
            </p>
          )}
        </div>
      </div>

      {/* ── Right panel: Results ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5" ref={resultRef}>

        {!generated && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4">
            <div className="text-5xl">🎯</div>
            <div>
              <h2 className="text-xl font-bold text-gray-200 mb-2">Build Your Investment Strategy</h2>
              <p className="text-sm text-gray-500 max-w-md">
                Configure your financial profile on the left — goals, horizon, risk tolerance, and account type — then click <strong className="text-gray-300">Generate</strong> to get a personalized AI-powered investment strategy with asset allocation, growth projections, and stress scenarios.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-2 text-left max-w-lg w-full">
              {[
                { icon: '📊', title: 'Asset Allocation', desc: 'Recommended mix across equities, bonds, and alternatives' },
                { icon: '📈', title: 'Growth Projections', desc: 'Portfolio value scenarios over your investment horizon' },
                { icon: '🌩️', title: 'Stress Testing', desc: 'Bull & bear market impact analysis and recovery timelines' },
              ].map(f => (
                <div key={f.title} className="bg-gray-800/40 rounded-xl p-3 border border-gray-700/50">
                  <div className="text-2xl mb-1.5">{f.icon}</div>
                  <div className="text-xs font-semibold text-gray-300 mb-0.5">{f.title}</div>
                  <div className="text-[11px] text-gray-500 leading-tight">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {generated && (
          <div className="max-w-4xl mx-auto space-y-5">

            {/* Profile summary banner */}
            <div className="bg-gray-800/40 rounded-xl px-4 py-3 border border-gray-700/50 flex flex-wrap gap-x-6 gap-y-1.5">
              {[
                { label: 'Goal', value: GOALS.find(g => g.value === form.goal)?.label },
                { label: 'Horizon', value: `${form.horizon_years} years` },
                { label: 'Starting Capital', value: fmt(form.initial_amount) },
                { label: 'Monthly', value: fmt(form.monthly_contribution) },
                { label: 'Risk', value: form.risk_tolerance.charAt(0).toUpperCase() + form.risk_tolerance.slice(1) },
                { label: 'Age', value: `${form.age}` },
                { label: 'Total Invested', value: fmt(totalInvested) },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">{label}:</span>
                  <span className="text-xs font-semibold text-gray-200">{value}</span>
                </div>
              ))}
              {!streaming && (
                <button
                  onClick={generate}
                  className="ml-auto text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                >
                  ↻ Regenerate
                </button>
              )}
            </div>

            {/* Allocation bar — appears as soon as JSON block is parsed */}
            {allocation && <AllocationBar allocation={allocation} />}

            {/* Streaming indicator while allocation is still parsing */}
            {streaming && !allocation && (
              <div className="bg-gray-800/40 rounded-xl p-4 border border-gray-700/50 flex items-center gap-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-sm text-gray-400">Analyzing your profile and building allocation…</span>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-sm text-red-300">
                <strong>Error:</strong> {error}
                {error.includes('401') || error.includes('authentication') ? (
                  <p className="mt-1 text-xs text-red-400">
                    Set <code className="bg-red-900/60 px-1 rounded">ANTHROPIC_API_KEY</code> in <code className="bg-red-900/60 px-1 rounded">backend/.env</code> and restart the backend.
                  </p>
                ) : null}
              </div>
            )}

            {/* Markdown narrative */}
            {displayText && (
              <div className="bg-gray-900/40 rounded-xl p-5 border border-gray-700/50">
                <div
                  className="prose-invert"
                  dangerouslySetInnerHTML={{ __html: mdToHtml(displayText) }}
                />
                {streaming && (
                  <span className="inline-block w-0.5 h-4 bg-emerald-400 ml-0.5 animate-pulse" />
                )}
              </div>
            )}

            {/* Disclaimer */}
            {!streaming && displayText && (
              <p className="text-xs text-gray-600 text-center pb-2">
                This analysis is for educational and informational purposes only. It does not constitute personalized financial advice.
                Consult a licensed financial advisor before making investment decisions.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
