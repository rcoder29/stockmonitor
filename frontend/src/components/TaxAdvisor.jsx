import { useState, useRef } from 'react'

// ── States list ───────────────────────────────────────────────────────────────
const STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],
  ['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],
  ['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
  ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],
  ['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],
  ['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],
  ['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
  ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],
  ['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
  ['DC','Washington D.C.'],
]

const NO_TAX_STATES = new Set(['AK','FL','NV','SD','TN','TX','WA','WY'])

// ── Simple markdown renderer (matches FinancialAdvisor style) ─────────────────
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
  h = h.replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-white mt-6 mb-3 pb-1.5 border-b border-slate-700 flex items-center gap-2">$1</h2>')
  h = h.replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-slate-200 mt-4 mb-1.5">$1</h3>')
  h = h.replace(/((?:^[-•*] .+\n?)+)/gm, blk => {
    const items = blk.trim().split('\n').map(l =>
      `<li class="ml-4 list-disc text-slate-300">${l.replace(/^[-•*] /, '')}</li>`
    ).join('')
    return `<ul class="my-2 space-y-1">${items}</ul>`
  })
  h = h.replace(/((?:^\d+\. .+\n?)+)/gm, blk => {
    const items = blk.trim().split('\n').map(l =>
      `<li class="ml-4 list-decimal text-slate-300">${l.replace(/^\d+\. /, '')}</li>`
    ).join('')
    return `<ol class="my-2 space-y-1">${items}</ol>`
  })
  h = h.replace(/\n{2,}/g, '</p><p class="mt-2 text-slate-300 text-sm leading-relaxed">')
  return `<p class="text-slate-300 text-sm leading-relaxed">${h}</p>`
}

// ── Field helpers ─────────────────────────────────────────────────────────────
function DollarField({ label, name, value, onChange, help }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-300 mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
        <input
          type="number" min="0" step="1000"
          value={value}
          onChange={e => onChange(name, Number(e.target.value))}
          className="w-full pl-6 pr-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
      </div>
      {help && <p className="text-xs text-slate-500 mt-0.5">{help}</p>}
    </div>
  )
}

function SectionCard({ title, children }) {
  return (
    <div className="bg-slate-800 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-bold text-white uppercase tracking-wider border-b border-slate-700 pb-2">{title}</h3>
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
const DEFAULTS = {
  state: 'CA',
  wages: 0, self_emp_income: 0, short_term_gains: 0, long_term_gains: 0,
  qualified_dividends: 0, rental_income: 0, other_income: 0,
  trad_401k_contrib: 0, roth_401k_contrib: 0, ira_contrib: 0,
  hsa_contrib: 0, fsa_contrib: 0,
  mortgage_interest: 0, property_taxes: 0, charitable: 0,
  student_loan_interest: 0, childcare_expenses: 0,
  num_children: 0, ages_over_50: 0,
  has_employer_health: true, is_self_employed: false, has_hsa_eligible_plan: false,
}

export default function TaxAdvisor() {
  const [form, setForm] = useState(DEFAULTS)
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const outputRef = useRef(null)

  function setField(name, value) {
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const grossIncome = form.wages + form.self_emp_income + form.short_term_gains +
    form.long_term_gains + form.qualified_dividends + form.rental_income + form.other_income

  async function runAnalysis() {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    setAnalysis('')

    try {
      const res = await fetch('/api/tax/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const d = JSON.parse(line.slice(6))
            if (d.text) setAnalysis(prev => prev + d.text)
            if (d.error) setError(d.error)
          } catch {}
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function stop() {
    if (abortRef.current) abortRef.current.abort()
    setLoading(false)
  }

  const isNoTax = NO_TAX_STATES.has(form.state)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Tax Advisor</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Married Filing Jointly · 2025 Federal + State tax optimisation
        </p>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* ── Left: Form ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* State selector */}
          <SectionCard title="Location & Filing">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">State of Residence</label>
              <select
                value={form.state}
                onChange={e => setField('state', e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                {STATES.map(([abbr, name]) => (
                  <option key={abbr} value={abbr}>{name}</option>
                ))}
              </select>
              {isNoTax && (
                <p className="text-xs text-emerald-400 mt-1">No state income tax</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Qualifying Children</label>
                <input type="number" min="0" max="10" value={form.num_children}
                  onChange={e => setField('num_children', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Spouses Age 50+</label>
                <select value={form.ages_over_50} onChange={e => setField('ages_over_50', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500">
                  <option value={0}>Neither</option>
                  <option value={1}>One spouse</option>
                  <option value={2}>Both spouses</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              {[
                ['is_self_employed',    'One or both spouses are self-employed'],
                ['has_employer_health', 'Have employer-sponsored health insurance'],
                ['has_hsa_eligible_plan','Enrolled in an HSA-eligible (HDHP) health plan'],
              ].map(([key, lbl]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form[key]}
                    onChange={e => setField(key, e.target.checked)}
                    className="w-4 h-4 accent-blue-500" />
                  <span className="text-xs text-slate-300">{lbl}</span>
                </label>
              ))}
            </div>
          </SectionCard>

          {/* Income */}
          <SectionCard title="Annual Income">
            <div className="grid grid-cols-2 gap-3">
              <DollarField label="W-2 / Salary" name="wages" value={form.wages} onChange={setField} />
              <DollarField label="Self-Employment" name="self_emp_income" value={form.self_emp_income} onChange={setField} />
              <DollarField label="Short-Term Gains" name="short_term_gains" value={form.short_term_gains} onChange={setField} />
              <DollarField label="Long-Term Gains" name="long_term_gains" value={form.long_term_gains} onChange={setField} />
              <DollarField label="Qualified Dividends" name="qualified_dividends" value={form.qualified_dividends} onChange={setField} />
              <DollarField label="Rental Income" name="rental_income" value={form.rental_income} onChange={setField} />
              <DollarField label="Other Income" name="other_income" value={form.other_income} onChange={setField} />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-700">
              <span className="text-xs text-slate-400">Total Gross Income</span>
              <span className="text-base font-bold text-white">${grossIncome.toLocaleString()}</span>
            </div>
          </SectionCard>

          {/* Retirement & Tax-Advantaged */}
          <SectionCard title="Retirement & Tax-Advantaged Accounts">
            <div className="grid grid-cols-2 gap-3">
              <DollarField label="Traditional 401(k)" name="trad_401k_contrib" value={form.trad_401k_contrib} onChange={setField} help="Limit: $23,500 (+$7,500 if 50+)" />
              <DollarField label="Roth 401(k)" name="roth_401k_contrib" value={form.roth_401k_contrib} onChange={setField} />
              <DollarField label="IRA Contributions" name="ira_contrib" value={form.ira_contrib} onChange={setField} help="Limit: $7,000/person (+$1,000 if 50+)" />
              <DollarField label="HSA Contributions" name="hsa_contrib" value={form.hsa_contrib} onChange={setField} help="Family limit: $8,300" />
              <DollarField label="FSA Contributions" name="fsa_contrib" value={form.fsa_contrib} onChange={setField} help="Limit: $3,300" />
            </div>
          </SectionCard>

          {/* Deductions */}
          <SectionCard title="Deductions & Credits">
            <div className="grid grid-cols-2 gap-3">
              <DollarField label="Mortgage Interest" name="mortgage_interest" value={form.mortgage_interest} onChange={setField} />
              <DollarField label="Property Taxes" name="property_taxes" value={form.property_taxes} onChange={setField} help="SALT cap: $10,000" />
              <DollarField label="Charitable Giving" name="charitable" value={form.charitable} onChange={setField} />
              <DollarField label="Student Loan Interest" name="student_loan_interest" value={form.student_loan_interest} onChange={setField} help="Max: $2,500" />
              <DollarField label="Child/Dependent Care" name="childcare_expenses" value={form.childcare_expenses} onChange={setField} />
            </div>
          </SectionCard>

          {/* CTA */}
          <div className="flex gap-3">
            <button
              onClick={runAnalysis}
              disabled={loading || grossIncome === 0}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors"
            >
              {loading ? 'Analysing…' : 'Get Tax Analysis'}
            </button>
            {loading && (
              <button onClick={stop} className="px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm transition-colors">
                Stop
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 text-center">
            AI analysis is educational only — not personalised tax advice. Consult a CPA for filing.
          </p>
        </div>

        {/* ── Right: Analysis output ── */}
        <div className="lg:col-span-3">
          {!analysis && !loading && !error && (
            <div className="h-full min-h-96 flex flex-col items-center justify-center text-center bg-slate-800/40 rounded-xl border border-slate-700/60 p-8 gap-4">
              <div className="text-4xl">💡</div>
              <div>
                <p className="text-white font-semibold">Your personalised tax plan will appear here</p>
                <p className="text-slate-400 text-sm mt-1">Fill in your income, contributions, and deductions on the left, then click "Get Tax Analysis".</p>
              </div>
              <div className="grid grid-cols-2 gap-3 w-full max-w-sm mt-2">
                {[
                  ['Priority actions', 'ranked by estimated savings'],
                  ['Account optimisation', '401k, IRA, HSA gaps'],
                  ['Deduction strategy', 'standard vs itemised'],
                  ['State-specific tips', `tailored to your state`],
                ].map(([title, sub]) => (
                  <div key={title} className="bg-slate-800 rounded-lg p-3 text-left">
                    <p className="text-white text-xs font-semibold">{title}</p>
                    <p className="text-slate-500 text-xs mt-0.5">{sub}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
              Error: {error}
            </div>
          )}

          {(analysis || loading) && (
            <div ref={outputRef} className="bg-slate-800/60 rounded-xl border border-slate-700/60 p-6 min-h-96">
              {loading && !analysis && (
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <span className="animate-pulse">●</span> Analysing your tax situation…
                </div>
              )}
              <div
                className="prose-tax"
                dangerouslySetInnerHTML={{ __html: mdToHtml(analysis) }}
              />
              {loading && analysis && (
                <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
