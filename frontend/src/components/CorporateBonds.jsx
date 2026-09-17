import { useState, useCallback, useEffect, Fragment } from 'react'

const API = import.meta.env.VITE_API_URL || ''

const EXAMPLES = ['BA', 'F', 'T', 'C', 'JPM', 'CCL', 'UAL']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(v) {
  if (v == null) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toLocaleString()}`
}

function fmtDate(d) {
  if (!d) return '—'
  return d
}

function yearsToMaturity(d) {
  if (!d) return null
  const ms = new Date(d).getTime() - Date.now()
  return ms / (365.25 * 24 * 3600 * 1000)
}

function GradeBadge({ grades }) {
  if (!grades || grades.length === 0) return <span className="text-slate-600 text-xs">—</span>
  return (
    <div className="flex gap-1">
      {grades.map(g => (
        <span key={g} className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
          g === 'IG' ? 'bg-sky-900 text-sky-300' : 'bg-amber-900 text-amber-300'
        }`}>{g === 'IG' ? 'Inv. Grade' : 'High Yield'}</span>
      ))}
    </div>
  )
}

function CouponBadge({ type }) {
  if (!type) return null
  const cls = type === 'Fixed' ? 'bg-slate-700 text-slate-300' : 'bg-purple-900 text-purple-300'
  return <span className={`px-1.5 py-0.5 rounded text-[10px] ml-1.5 ${cls}`}>{type}</span>
}

// ── Bond detail panel ────────────────────────────────────────────────────────

function RatingsMentions({ ticker }) {
  const [state, setState] = useState({ loading: true, mentions: [], error: null })

  useEffect(() => {
    if (!ticker) { setState({ loading: false, mentions: [], error: 'no-ticker' }); return }
    let cancelled = false
    setState({ loading: true, mentions: [], error: null })
    fetch(`${API}/api/bonds/ratings-mentions/${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setState({ loading: false, mentions: d.mentions || [], error: null }) })
      .catch(e => { if (!cancelled) setState({ loading: false, mentions: [], error: e.message }) })
    return () => { cancelled = true }
  }, [ticker])

  return (
    <div className="mt-3">
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1.5">Credit Rating Mentions</div>
      <p className="text-[11px] text-slate-600 mb-2">
        No free structured ratings-history API exists — these are rating-action mentions pulled from{' '}
        {ticker || 'the issuer'}'s own 8-K/10-K/10-Q filings on SEC EDGAR. Coverage depends on how the
        company phrased its disclosure, so this is best-effort, not a complete timeline.
      </p>
      {state.error === 'no-ticker' && (
        <div className="text-slate-600 text-xs py-2">Couldn't resolve a stock ticker for this issuer to search filings.</div>
      )}
      {state.loading && <div className="text-slate-500 text-xs py-2 animate-pulse">Searching SEC filings…</div>}
      {!state.loading && state.error && state.error !== 'no-ticker' && (
        <div className="text-red-400 text-xs py-2">Failed to load: {state.error}</div>
      )}
      {!state.loading && !state.error && state.mentions.length === 0 && (
        <div className="text-slate-600 text-xs py-2">No rating-action language found in recent filings.</div>
      )}
      {!state.loading && state.mentions.length > 0 && (
        <ul className="space-y-2">
          {state.mentions.map((m, i) => (
            <li key={i} className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-800">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded">{m.formType}</span>
                <span className="text-[11px] text-slate-500">{m.filingDate}</span>
                <a href={m.filingUrl} target="_blank" rel="noreferrer"
                  className="text-[11px] text-sky-400 hover:text-sky-300 ml-auto">View filing →</a>
              </div>
              {m.excerpt && <div className="text-xs text-slate-300 leading-relaxed">"{m.excerpt}"</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BondDetail({ bond, resolvedTicker }) {
  return (
    <div className="bg-slate-950 border-t border-slate-800 p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {[
          ['CUSIP', bond.cusip || '—'],
          ['ISIN', bond.isin || '—'],
          ['Coupon', bond.couponRate != null ? `${bond.couponRate.toFixed(3)}%` : '—'],
          ['Maturity', fmtDate(bond.maturityDate)],
        ].map(([label, val]) => (
          <div key={label} className="bg-slate-800/60 rounded-lg px-3 py-2">
            <div className="text-[10px] text-slate-600 uppercase tracking-wider">{label}</div>
            <div className="text-sm text-white font-mono">{val}</div>
          </div>
        ))}
      </div>

      {bond.isDefault && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-xs mb-3">
          ⚠ Flagged as in default in the fund's most recent N-PORT filing.
        </div>
      )}

      {bond.heldBy && bond.heldBy.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-1.5">Held By (from latest N-PORT filings)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-600 border-b border-slate-800">
                  <th className="text-left py-1.5 font-medium">Fund</th>
                  <th className="text-right py-1.5 font-medium">Weight</th>
                  <th className="text-right py-1.5 font-medium">Market Value</th>
                  <th className="text-right py-1.5 font-medium">Approx. Price</th>
                </tr>
              </thead>
              <tbody>
                {bond.heldBy.map((h, i) => (
                  <tr key={i} className="border-b border-slate-800/60 last:border-0">
                    <td className="py-1.5 text-white font-semibold">{h.fund}</td>
                    <td className="py-1.5 text-right text-slate-300">{h.weight != null ? `${h.weight.toFixed(2)}%` : '—'}</td>
                    <td className="py-1.5 text-right text-slate-300">{fmt$(h.marketValue)}</td>
                    <td className="py-1.5 text-right text-slate-300 font-mono">{h.price != null ? `$${h.price.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {bond.source === 'prospectus' && (
        <div className="bg-amber-900/30 border border-amber-800 rounded-lg px-3 py-2 text-amber-300 text-xs mb-3">
          No tracked fund currently holds this bond — terms shown are from the issuer's SEC prospectus at
          issuance, not live pricing.{' '}
          {bond.filingUrl && <a href={bond.filingUrl} target="_blank" rel="noreferrer" className="underline">View prospectus →</a>}
        </div>
      )}

      <RatingsMentions ticker={resolvedTicker} />
    </div>
  )
}

// ── Results table ─────────────────────────────────────────────────────────────

function BondsTable({ bonds, resolvedTicker }) {
  const [expanded, setExpanded] = useState(null)

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-800 text-slate-500 text-xs uppercase tracking-wider">
            <th className="text-left py-2.5 px-3 font-medium">Issuer</th>
            <th className="text-right py-2.5 px-3 font-medium">Coupon</th>
            <th className="text-right py-2.5 px-3 font-medium">Maturity</th>
            <th className="text-right py-2.5 px-3 font-medium">Yrs</th>
            <th className="text-left py-2.5 px-3 font-medium">Grade</th>
            <th className="text-right py-2.5 px-3 font-medium">Price</th>
            <th className="text-left py-2.5 px-3 font-medium">Held By</th>
          </tr>
        </thead>
        <tbody>
          {bonds.map((b, i) => {
            const key = b.cusip || `${i}`
            const isOpen = expanded === key
            const topPrice = b.heldBy && b.heldBy[0] ? b.heldBy[0].price : null
            const yrs = yearsToMaturity(b.maturityDate)
            return (
              <Fragment key={key}>
                <tr
                  onClick={() => setExpanded(isOpen ? null : key)}
                  className={`border-t border-slate-800 cursor-pointer hover:bg-slate-800/50 transition-colors ${isOpen ? 'bg-slate-800/60' : ''}`}>
                  <td className="py-2.5 px-3 text-white">
                    {b.issuerName}
                    <CouponBadge type={b.couponType} />
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-200 font-mono">
                    {b.couponRate != null ? `${b.couponRate.toFixed(3)}%` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-300 font-mono">{fmtDate(b.maturityDate)}</td>
                  <td className="py-2.5 px-3 text-right text-slate-500">{yrs != null ? yrs.toFixed(1) : '—'}</td>
                  <td className="py-2.5 px-3"><GradeBadge grades={b.grades} /></td>
                  <td className="py-2.5 px-3 text-right text-slate-200 font-mono">
                    {topPrice != null ? `$${topPrice.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex flex-wrap gap-1">
                      {(b.heldBy || []).slice(0, 4).map(h => (
                        <span key={h.fund} className="px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded text-[10px]">{h.fund}</span>
                      ))}
                      {b.source === 'prospectus' && (
                        <span className="px-1.5 py-0.5 bg-amber-900 text-amber-300 rounded text-[10px]">Prospectus</span>
                      )}
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <BondDetail bond={b} resolvedTicker={resolvedTicker} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function CorporateBonds() {
  const [query, setQuery]     = useState('')
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const runSearch = useCallback(async q => {
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const res = await fetch(`${API}/api/bonds/search?q=${encodeURIComponent(q.trim())}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <div className="p-4 text-white max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold">Corporate Bonds</h1>
        <p className="text-sm text-slate-400">
          Research investment-grade and high-yield corporate bonds by issuer
        </p>
      </div>

      {/* Data source note */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 mb-4 text-xs text-slate-400">
        There's no free per-bond pricing API. Bond characteristics here come from SEC N-PORT filings —
        the issuer's bonds as currently held by major investment-grade (LQD, VCIT, VCSH, USIG) and
        high-yield (HYG, JNK, USHY) bond ETFs. If no tracked fund holds the issuer's bonds, results fall
        back to terms disclosed in the issuer's own SEC prospectus filings at issuance.
      </div>

      {/* Search */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 mb-4">
        <div className="flex gap-2 mb-3">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runSearch(query)}
            placeholder="Ticker or company name (e.g. BA, Boeing)…"
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
          <button
            onClick={() => runSearch(query)}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-semibold transition-colors"
          >Search</button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-slate-500">Examples:</span>
          {EXAMPLES.map(t => (
            <button key={t} onClick={() => { setQuery(t); runSearch(t) }}
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded text-xs transition-colors">
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-red-300 text-sm mb-4">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-12 text-center">
          <div className="text-slate-400 text-sm mb-2">Scanning bond ETF holdings and SEC filings…</div>
          <div className="text-slate-500 text-xs">First search for a fund can take up to 30 seconds; results are cached after that.</div>
        </div>
      )}

      {/* Results */}
      {!loading && data && (
        <>
          {data.source === 'prospectus' && data.bonds.length > 0 && (
            <div className="bg-amber-900/30 border border-amber-800 rounded-lg px-3 py-2 text-amber-300 text-xs mb-3">
              No tracked bond ETF currently holds {data.query}'s debt — showing terms from SEC prospectus filings at issuance instead.
            </div>
          )}
          {data.bonds.length === 0 ? (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-12 text-center text-slate-500 text-sm">
              No bonds found for "{data.query}" in tracked fund holdings or SEC prospectus filings.
            </div>
          ) : (
            <BondsTable bonds={data.bonds} resolvedTicker={data.resolvedTicker} />
          )}
        </>
      )}
    </div>
  )
}
