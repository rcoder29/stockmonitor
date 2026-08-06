import { useState, useEffect, useMemo, useCallback, useRef } from 'react'

const API = 'http://localhost:8000'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(v) {
  if (v == null) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtPct(v, digits = 2) {
  if (v == null) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(digits) + '%'
}

function perfColor(v) {
  if (v == null) return 'text-slate-500'
  return v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-slate-400'
}

function catBadge(cat) {
  const cfg = {
    Equity:       'bg-sky-900 text-sky-300',
    Debt:         'bg-purple-900 text-purple-300',
    Derivative:   'bg-orange-900 text-orange-300',
    'Short-Term': 'bg-slate-700 text-slate-300',
    ABS:          'bg-teal-900 text-teal-300',
    MBS:          'bg-indigo-900 text-indigo-300',
    Other:        'bg-slate-700 text-slate-400',
  }
  const cls = cfg[cat] || 'bg-slate-700 text-slate-400'
  return <span className={`px-1.5 py-0.5 rounded text-xs ${cls}`}>{cat}</span>
}

// ── 52W Range Bar ─────────────────────────────────────────────────────────────

function RangeBar({ low, high, current }) {
  if (!low || !high || low >= high) return <span className="text-slate-600 text-xs">—</span>
  const pct = v => Math.max(0, Math.min(100, ((v - low) / (high - low)) * 100))
  const curPct = current ? pct(current) : null
  return (
    <div className="flex flex-col gap-0.5 w-28">
      <div className="relative h-1.5 bg-slate-700 rounded-full">
        <div className="absolute inset-y-0 bg-gradient-to-r from-red-700 to-green-600 rounded-full"
          style={{ left: 0, right: 0 }} />
        {curPct != null && (
          <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white border border-slate-400 z-10"
            style={{ left: `calc(${curPct}% - 4px)` }} />
        )}
      </div>
      <div className="flex justify-between text-xs text-slate-600">
        <span>${low?.toFixed(0)}</span>
        <span>${high?.toFixed(0)}</span>
      </div>
    </div>
  )
}

// ── Weight Bar ────────────────────────────────────────────────────────────────

function WeightBar({ weight, maxWeight }) {
  if (weight == null) return <span className="text-slate-500">—</span>
  const pct = maxWeight > 0 ? (weight / maxWeight) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full bg-sky-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-300 w-12 text-right">{weight.toFixed(2)}%</span>
    </div>
  )
}

// ── Search Box ────────────────────────────────────────────────────────────────

function SearchBox({ onSelect }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen]       = useState(false)
  const debounceRef           = useRef(null)
  const wrapRef               = useRef(null)

  const search = useCallback(async q => {
    if (!q.trim()) { setResults([]); setOpen(false); return }
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/edgar/fund-search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResults(data)
      setOpen(data.length > 0)
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query), 400)
    return () => clearTimeout(debounceRef.current)
  }, [query, search])

  useEffect(() => {
    const handler = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const pick = useCallback(item => {
    setQuery(item.name)
    setOpen(false)
    onSelect(item)
  }, [onSelect])

  return (
    <div className="relative" ref={wrapRef}>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search by fund name or ticker (e.g. SPY, ARK Innovation)…"
          className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
        />
        {loading && <div className="self-center text-slate-400 text-xs">Searching…</div>}
      </div>
      {open && (
        <ul className="absolute z-50 top-full mt-1 left-0 right-0 bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-64 overflow-y-auto">
          {results.map(r => (
            <li key={r.cik}
              onClick={() => pick(r)}
              className="px-3 py-2 hover:bg-slate-700 cursor-pointer border-b border-slate-700 last:border-0">
              <div className="text-sm text-white">{r.name}</div>
              <div className="text-xs text-slate-500">CIK {r.cik}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Sort indicator ────────────────────────────────────────────────────────────

function SortHdr({ col, label, sort, setSort }) {
  const active = sort.col === col
  return (
    <th className="text-left px-3 py-2 cursor-pointer select-none hover:text-white"
      onClick={() => setSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }))}>
      <div className="flex items-center gap-1">
        {label}
        {active ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : <span className="text-slate-700"> ↕</span>}
      </div>
    </th>
  )
}

// ── Holdings Table ────────────────────────────────────────────────────────────

function HoldingsTable({ holdings }) {
  const [sort, setSort]       = useState({ col: 'weight', dir: 'desc' })
  const [catFilter, setCat]   = useState('All')
  const [search, setSearch]   = useState('')
  const [showTop, setShowTop] = useState(100)

  const categories = useMemo(() => {
    const s = new Set(holdings.map(h => h.assetCat).filter(Boolean))
    return ['All', ...Array.from(s).sort()]
  }, [holdings])

  const maxWeight = useMemo(() => Math.max(...holdings.map(h => h.weight || 0)), [holdings])

  const filtered = useMemo(() => {
    let rows = holdings
    if (catFilter !== 'All') rows = rows.filter(h => h.assetCat === catFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(h =>
        h.name?.toLowerCase().includes(q) ||
        h.ticker?.toLowerCase().includes(q) ||
        h.cusip?.includes(q)
      )
    }
    return rows
  }, [holdings, catFilter, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const { col, dir } = sort
    arr.sort((a, b) => {
      let av = a[col], bv = b[col]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return dir === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1)
    })
    return arr.slice(0, showTop)
  }, [filtered, sort, showTop])

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter holdings…"
          className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 w-44"
        />
        <div className="flex flex-wrap gap-1">
          {categories.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`px-2 py-0.5 rounded text-xs ${catFilter === c ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
          Show:
          {[25, 50, 100, 250, 9999].map(n => (
            <button key={n} onClick={() => setShowTop(n)}
              className={`px-2 py-0.5 rounded ${showTop === n ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
              {n === 9999 ? 'All' : n}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">{filtered.length} holdings</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-700 bg-slate-800/80">
              <th className="text-left px-3 py-2 w-10">#</th>
              <SortHdr col="name"    label="Name"        sort={sort} setSort={setSort} />
              <th className="text-left px-3 py-2">Category</th>
              <SortHdr col="weight"    label="Weight"      sort={sort} setSort={setSort} />
              <SortHdr col="fairValue" label="Fair Value"  sort={sort} setSort={setSort} />
              <SortHdr col="price"     label="Price"       sort={sort} setSort={setSort} />
              <th className="text-left px-3 py-2">52W Range</th>
              <SortHdr col="pctFromHigh" label="From High" sort={sort} setSort={setSort} />
              <SortHdr col="perf1m"  label="1M"          sort={sort} setSort={setSort} />
              <SortHdr col="perf3m"  label="3M"          sort={sort} setSort={setSort} />
              <SortHdr col="perf6m"  label="6M"          sort={sort} setSort={setSort} />
              <SortHdr col="perf1y"  label="1Y"          sort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((h, i) => (
              <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-750">
                <td className="px-3 py-2 text-slate-600 text-xs">{filtered.indexOf(h) + 1 || i + 1}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-white text-sm truncate max-w-[200px]" title={h.name}>{h.name}</div>
                  {h.ticker && <div className="text-xs text-sky-400">{h.ticker}</div>}
                  {!h.ticker && h.cusip && <div className="text-xs text-slate-600">{h.cusip}</div>}
                </td>
                <td className="px-3 py-2">{catBadge(h.assetCat)}</td>
                <td className="px-3 py-2">
                  <WeightBar weight={h.weight} maxWeight={maxWeight} />
                </td>
                <td className="px-3 py-2 text-slate-400 text-xs text-right">
                  {fmt$(h.fairValue)}
                </td>
                <td className="px-3 py-2 text-slate-300 text-sm text-right">
                  {h.price != null ? `$${h.price.toFixed(2)}` : '—'}
                </td>
                <td className="px-3 py-2">
                  <RangeBar low={h.low52w} high={h.high52w} current={h.price} />
                </td>
                <td className={`px-3 py-2 text-xs text-right ${perfColor(h.pctFromHigh)}`}>
                  {h.pctFromHigh != null ? `${h.pctFromHigh.toFixed(1)}%` : '—'}
                </td>
                <td className={`px-3 py-2 text-xs text-right ${perfColor(h.perf1m)}`}>{fmtPct(h.perf1m)}</td>
                <td className={`px-3 py-2 text-xs text-right ${perfColor(h.perf3m)}`}>{fmtPct(h.perf3m)}</td>
                <td className={`px-3 py-2 text-xs text-right ${perfColor(h.perf6m)}`}>{fmtPct(h.perf6m)}</td>
                <td className={`px-3 py-2 text-xs text-right ${perfColor(h.perf1y)}`}>{fmtPct(h.perf1y)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Fund Header ───────────────────────────────────────────────────────────────

function FundHeader({ fund, cik, accession, holdingCount }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{fund.seriesName || 'Fund Holdings'}</h2>
          <div className="text-sm text-slate-400 mt-0.5">
            Holdings as of <span className="text-slate-300">{fund.period || '—'}</span> · SEC N-PORT filing
          </div>
          <div className="text-xs text-slate-600 mt-0.5">CIK {cik} · Accession {accession}</div>
        </div>
        <div className="flex gap-4">
          {fund.netAssets != null && (
            <div className="text-right">
              <div className="text-xs text-slate-500">Net Assets</div>
              <div className="text-base font-semibold text-white">{fmt$(fund.netAssets)}</div>
            </div>
          )}
          {fund.totAssets != null && (
            <div className="text-right">
              <div className="text-xs text-slate-500">Total Assets</div>
              <div className="text-base font-semibold text-white">{fmt$(fund.totAssets)}</div>
            </div>
          )}
          <div className="text-right">
            <div className="text-xs text-slate-500">Holdings</div>
            <div className="text-base font-semibold text-white">{holdingCount}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

// CIKs pre-resolved so popular picks load without a search round-trip
const POPULAR = [
  { ticker: 'SPY',  name: 'SPDR S&P 500',        cik: '884394'  },
  { ticker: 'QQQ',  name: 'Invesco QQQ',          cik: '1067839' },
  { ticker: 'IVV',  name: 'iShares Core S&P 500', cik: '1100663' },
  { ticker: 'VTI',  name: 'Vanguard Total Mkt',   cik: '1075817' },
  { ticker: 'ARKK', name: 'ARK Innovation',        cik: '1579982' },
  { ticker: 'XLK',  name: 'Tech SPDR',             cik: '1064642' },
  { ticker: 'XLF',  name: 'Financial SPDR',        cik: '1064641' },
  { ticker: 'IWM',  name: 'Russell 2000',          cik: '1100624' },
  { ticker: 'GLD',  name: 'SPDR Gold',             cik: '1222333' },
  { ticker: 'VOO',  name: 'Vanguard S&P 500',      cik: '1479240' },
]

export default function FundHoldingsExplorer() {
  const [selectedFund, setSelectedFund] = useState(null)  // {cik, name}
  const [data, setData]                 = useState(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState(null)
  const [enrichN, setEnrichN]           = useState(50)

  const loadHoldings = useCallback(async (cik, n = enrichN) => {
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const res = await fetch(`${API}/api/edgar/fund-holdings?cik=${cik}&enrich=${n}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      setData(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [enrichN])

  const handleSelect = useCallback(fund => {
    setSelectedFund(fund)
    loadHoldings(fund.cik)
  }, [loadHoldings])

  const handlePopular = useCallback(async item => {
    // CIK is pre-resolved in the POPULAR list — load directly without a search
    setSelectedFund({ cik: item.cik, name: item.name })
    loadHoldings(item.cik)
  }, [loadHoldings])

  return (
    <div className="p-4 text-white max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold">Fund Holdings Explorer</h1>
        <p className="text-sm text-slate-400">
          SEC EDGAR N-PORT filings — official monthly portfolio disclosures for ETFs & mutual funds
        </p>
      </div>

      {/* Search */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 mb-4">
        <div className="mb-3">
          <SearchBox onSelect={handleSelect} />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-slate-500">Popular:</span>
          {POPULAR.map(p => (
            <button key={p.ticker} onClick={() => handlePopular(p)}
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded text-xs transition-colors">
              {p.ticker}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-12 text-center">
          <div className="text-slate-400 text-sm mb-2">Fetching N-PORT filing from EDGAR…</div>
          <div className="text-slate-500 text-xs">
            Large funds may take 15–30 seconds on first load. Data is cached for 6 hours.
          </div>
        </div>
      )}

      {/* Results */}
      {!loading && data && (
        <>
          <FundHeader
            fund={data.fund}
            cik={data.cik}
            accession={data.accession}
            holdingCount={data.holdingCount}
          />

          {/* Enrich controls */}
          <div className="flex items-center gap-3 mb-3 text-xs text-slate-400">
            <span>Live market data enriched for top:</span>
            {[25, 50, 100, 200].map(n => (
              <button key={n} onClick={() => { setEnrichN(n); loadHoldings(data.cik, n) }}
                className={`px-2 py-0.5 rounded ${enrichN === n ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                {n} holdings
              </button>
            ))}
            <span className="text-slate-600">(price, 52W range, and performance)</span>
          </div>

          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <HoldingsTable holdings={data.holdings} />
          </div>

          <div className="mt-3 text-xs text-slate-600 text-center">
            Source: SEC EDGAR N-PORT-P · Accession {data.accession} · Period {data.fund.period}
            · Market data: Yahoo Finance
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && !data && !error && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-12 text-center text-slate-500">
          <div className="text-4xl mb-3">📋</div>
          <div className="text-sm">Search for a fund above or click a popular ETF to explore its holdings</div>
          <div className="text-xs mt-2 text-slate-600">Data sourced directly from SEC EDGAR N-PORT filings</div>
        </div>
      )}
    </div>
  )
}
