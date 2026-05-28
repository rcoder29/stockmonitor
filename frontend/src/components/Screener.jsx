import { useState, useEffect, useCallback, useRef } from 'react'
import { fmt } from '../utils/format'

const CUSTOM_FIELDS = [
  { id: 'price',         label: 'Price ($)',           unit: '$'  },
  { id: 'changePercent', label: 'Change %',            unit: '%'  },
  { id: 'marketCap',     label: 'Market Cap ($B)',      unit: '$B' },
  { id: 'peRatio',       label: 'P/E (TTM)',            unit: ''   },
  { id: 'forwardPE',     label: 'Forward P/E',          unit: ''   },
  { id: 'profitMargin',  label: 'Profit Margin %',      unit: '%'  },
  { id: 'revenueGrowth', label: 'Revenue Growth %',     unit: '%'  },
  { id: 'roe',           label: 'Return on Equity %',   unit: '%'  },
  { id: 'beta',          label: 'Beta',                 unit: ''   },
  { id: 'dividendYield', label: 'Dividend Yield %',     unit: '%'  },
  { id: 'debtToEquity',  label: 'Debt / Equity',        unit: ''   },
  { id: 'volume',        label: 'Volume',               unit: ''   },
  { id: 'week52High',    label: '52W High ($)',          unit: '$'  },
  { id: 'week52Low',     label: '52W Low ($)',           unit: '$'  },
]

const CUSTOM_OPS = [
  { id: 'gt',      label: '>  greater than'         },
  { id: 'gte',     label: '≥  ≥ greater or equal'   },
  { id: 'lt',      label: '<  less than'             },
  { id: 'lte',     label: '≤  ≤ less or equal'       },
  { id: 'between', label: '↔  between'               },
]

function CustomFilterRow({ filter, idx, onChange, onRemove }) {
  const field = CUSTOM_FIELDS.find(f => f.id === filter.field) ?? CUSTOM_FIELDS[0]
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={filter.field}
        onChange={e => onChange(idx, 'field', e.target.value)}
        className="bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500 w-44"
      >
        {CUSTOM_FIELDS.map(f => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </select>
      <select
        value={filter.op}
        onChange={e => onChange(idx, 'op', e.target.value)}
        className="bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500 w-40"
      >
        {CUSTOM_OPS.map(o => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <input
        type="number"
        value={filter.value}
        onChange={e => onChange(idx, 'value', e.target.value)}
        placeholder={field.unit || 'value'}
        className="bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500 w-24 tabular-nums"
      />
      {filter.op === 'between' && (
        <>
          <span className="text-gray-600 text-xs">and</span>
          <input
            type="number"
            value={filter.value2}
            onChange={e => onChange(idx, 'value2', e.target.value)}
            placeholder={field.unit || 'value'}
            className="bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500 w-24 tabular-nums"
          />
        </>
      )}
      <button onClick={() => onRemove(idx)} className="text-gray-700 hover:text-red-400 transition-colors text-lg leading-none">×</button>
    </div>
  )
}

function CustomResults({ data, loading, error }) {
  const [sortCol, setSortCol] = useState('symbol')
  const [sortDir, setSortDir] = useState('asc')

  function handleSort(key) {
    if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(key); setSortDir('desc') }
  }

  const cols = [
    { label: 'Symbol',    key: 'symbol',        align: 'text-left'  },
    { label: 'Name',      key: 'name',          align: 'text-left'  },
    { label: 'Price',     key: 'price',         align: 'text-right' },
    { label: 'Chg %',     key: 'changePercent', align: 'text-right' },
    { label: 'Mkt Cap',   key: 'marketCap',     align: 'text-right' },
    { label: 'P/E',       key: 'peRatio',       align: 'text-right' },
    { label: 'Margin %',  key: 'profitMargin',  align: 'text-right' },
    { label: 'Rev Gr %',  key: 'revenueGrowth', align: 'text-right' },
    { label: 'Beta',      key: 'beta',          align: 'text-right' },
    { label: 'Sector',    key: 'sector',        align: 'text-left'  },
  ]

  const fmtCap = (v) => {
    if (v == null) return '—'
    if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`
    if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`
    return `$${(v / 1e6).toFixed(0)}M`
  }

  const sorted = [...(data || [])].sort((a, b) => {
    const av = a[sortCol] ?? null, bv = b[sortCol] ?? null
    if (av == null && bv == null) return 0
    if (av == null) return 1; if (bv == null) return -1
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortDir === 'asc' ? av - bv : bv - av
  })

  if (loading) return <div className="text-gray-500 text-sm text-center py-20 animate-pulse">Running custom screen…</div>
  if (error)   return <div className="text-red-400 text-sm text-center py-10">Error: {error}</div>
  if (!data)   return null
  if (data.length === 0) return <div className="text-gray-600 text-sm text-center py-16">No stocks matched your filters</div>

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/60">
            {cols.map(({ label, key, align }) => (
              <th key={key} onClick={() => handleSort(key)}
                className={`py-2.5 px-3 text-gray-500 font-medium tracking-wider uppercase cursor-pointer select-none hover:text-gray-300 ${align}`}>
                {label}<SortArrow active={sortCol === key} dir={sortDir} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={row.symbol} className="border-b border-gray-800/40 hover:bg-gray-800/40 transition-colors">
              <td className="py-2.5 px-3 text-white font-bold">{row.symbol}</td>
              <td className="py-2.5 px-3 text-gray-400 max-w-[140px] truncate">{row.name ?? '—'}</td>
              <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{row.price != null ? `$${row.price.toFixed(2)}` : '—'}</td>
              <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${(row.changePercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {row.changePercent != null ? `${row.changePercent >= 0 ? '+' : ''}${row.changePercent.toFixed(2)}%` : '—'}
              </td>
              <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{fmtCap(row.marketCap)}</td>
              <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{row.peRatio != null ? row.peRatio.toFixed(1) : '—'}</td>
              <td className={`py-2.5 px-3 text-right tabular-nums ${(row.profitMargin ?? 0) > 20 ? 'text-emerald-400' : 'text-gray-300'}`}>
                {row.profitMargin != null ? `${row.profitMargin.toFixed(1)}%` : '—'}
              </td>
              <td className={`py-2.5 px-3 text-right tabular-nums ${(row.revenueGrowth ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {row.revenueGrowth != null ? `${row.revenueGrowth.toFixed(1)}%` : '—'}
              </td>
              <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{row.beta != null ? row.beta.toFixed(2) : '—'}</td>
              <td className="py-2.5 px-3 text-gray-500 text-[10px]">{row.sector ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2 text-gray-700 text-xs border-t border-gray-800">{sorted.length} results · S&P 100 universe</div>
    </div>
  )
}

const TECH_SCANS = [
  { id: '52w_high',      label: '52W High',      desc: 'Within 3% of 52-week high — breakout candidates',       icon: '🚀' },
  { id: 'golden_cross',  label: 'Golden Cross',  desc: '50-day MA crossed above 200-day MA (last 30 days)',       icon: '✨' },
  { id: 'death_cross',   label: 'Death Cross',   desc: '50-day MA crossed below 200-day MA (last 30 days)',       icon: '💀' },
  { id: 'rsi_oversold',  label: 'RSI Oversold',  desc: 'RSI(14) below 30 — potential reversal setup',            icon: '📉' },
  { id: 'rsi_overbought',label: 'RSI Overbought','desc': 'RSI(14) above 70 — potential pullback ahead',          icon: '📈' },
  { id: 'high_volume',    label: 'High Volume',    desc: 'Today\'s volume ≥ 2× 20-day average — unusual activity', icon: '🔊' },
  { id: 'short_interest', label: 'Short Interest', desc: 'Short float >10% — high short interest / potential squeeze', icon: '🩳' },
]

const FUND_SCREENS = [
  { id: 'quality_growth',  label: 'Quality Growth',    desc: 'Margin >15%, revenue growth >8%, low leverage',      icon: '💎' },
  { id: 'deep_value',      label: 'Deep Value',        desc: 'P/E <15, P/B <2 — cheap vs book and earnings',       icon: '🏷️' },
  { id: 'dividend_income', label: 'Dividend Income',   desc: 'Yield >2%, P/E <35 — income + reasonable valuation', icon: '💰' },
  { id: 'momentum_quality','label': 'Momentum + Quality','desc': 'ROE >15%, margin >10% — profitable growth',      icon: '⚡' },
]

function SortArrow({ active, dir }) {
  return <span className={`ml-1 text-xs ${active ? 'text-emerald-400' : 'text-gray-700'}`}>{active ? (dir === 'asc' ? '↑' : '↓') : '⇅'}</span>
}

function TechResults({ data, loading, error, scan }) {
  const [sortCol, setSortCol] = useState('changePercent')
  const [sortDir, setSortDir] = useState('desc')

  function handleSort(key) {
    if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(key); setSortDir('desc') }
  }

  const cols = [
    { label: 'Symbol',    key: 'symbol',        align: 'text-left' },
    { label: 'Price',     key: 'price',         align: 'text-right' },
    { label: 'Chg %',     key: 'changePercent', align: 'text-right' },
    ...(scan === '52w_high'     ? [{ label: '52W High', key: 'high52w',    align: 'text-right' },
                                   { label: '% From High', key: 'pctFromHigh', align: 'text-right' }] : []),
    ...(scan === 'golden_cross' || scan === 'death_cross'
                                ? [{ label: 'MA50', key: 'ma50', align: 'text-right' },
                                   { label: 'MA200', key: 'ma200', align: 'text-right' }] : []),
    ...(scan === 'rsi_oversold' || scan === 'rsi_overbought'
                                ? [{ label: 'RSI(14)', key: 'rsi', align: 'text-right' }] : []),
    ...(scan === 'high_volume'    ? [{ label: 'Volume',      key: 'volume',              align: 'text-right' },
                                     { label: 'Vol Ratio',  key: 'volRatio',             align: 'text-right' }] : []),
    ...(scan === 'short_interest' ? [{ label: 'Short Float %', key: 'shortPercentOfFloat', align: 'text-right' },
                                     { label: 'Days to Cover', key: 'shortRatio',          align: 'text-right' },
                                     { label: 'Sector',        key: 'sector',              align: 'text-left'  }] : []),
  ]

  const sorted = [...(data || [])].sort((a, b) => {
    const av = a[sortCol] ?? null, bv = b[sortCol] ?? null
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortDir === 'asc' ? av - bv : bv - av
  })

  if (loading) return <div className="text-gray-500 text-sm text-center py-20 animate-pulse">Running scan across {100}+ stocks…</div>
  if (error)   return <div className="text-red-400 text-sm text-center py-10">Error: {error}</div>
  if (!data)   return null
  if (data.length === 0) return <div className="text-gray-600 text-sm text-center py-16">No stocks matched this scan right now</div>

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/60">
            {cols.map(({ label, key, align }) => (
              <th key={key} onClick={() => handleSort(key)}
                className={`py-2.5 px-3 text-gray-500 font-medium tracking-wider uppercase cursor-pointer select-none hover:text-gray-300 ${align}`}>
                {label}<SortArrow active={sortCol === key} dir={sortDir} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={row.symbol} className="border-b border-gray-800/40 hover:bg-gray-800/40 transition-colors">
              <td className="py-2.5 px-3 text-white font-bold">{row.symbol}</td>
              <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{row.price != null ? `$${row.price.toFixed(2)}` : '—'}</td>
              <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${row.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {row.changePercent != null ? `${row.changePercent >= 0 ? '+' : ''}${row.changePercent.toFixed(2)}%` : '—'}
              </td>
              {scan === '52w_high' && <>
                <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{row.high52w != null ? `$${row.high52w.toFixed(2)}` : '—'}</td>
                <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${(row.pctFromHigh ?? -999) >= -1 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {row.pctFromHigh != null ? `${row.pctFromHigh.toFixed(2)}%` : '—'}
                </td>
              </>}
              {(scan === 'golden_cross' || scan === 'death_cross') && <>
                <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{row.ma50 != null ? `$${row.ma50.toFixed(2)}` : '—'}</td>
                <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{row.ma200 != null ? `$${row.ma200.toFixed(2)}` : '—'}</td>
              </>}
              {(scan === 'rsi_oversold' || scan === 'rsi_overbought') && (
                <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${row.rsi < 30 ? 'text-blue-400' : 'text-orange-400'}`}>
                  {row.rsi != null ? row.rsi.toFixed(1) : '—'}
                </td>
              )}
              {scan === 'high_volume' && <>
                <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{row.volume != null ? fmt.volume(row.volume) : '—'}</td>
                <td className={`py-2.5 px-3 text-right tabular-nums font-semibold ${row.volRatio >= 3 ? 'text-red-400' : 'text-amber-400'}`}>
                  {row.volRatio != null ? `${row.volRatio.toFixed(1)}×` : '—'}
                </td>
              </>}
              {scan === 'short_interest' && <>
                <td className={`py-2.5 px-3 text-right tabular-nums font-semibold ${row.shortPercentOfFloat >= 25 ? 'text-red-400' : row.shortPercentOfFloat >= 15 ? 'text-amber-400' : 'text-gray-300'}`}>
                  {row.shortPercentOfFloat != null ? `${row.shortPercentOfFloat.toFixed(1)}%` : '—'}
                </td>
                <td className={`py-2.5 px-3 text-right tabular-nums ${row.shortRatio >= 10 ? 'text-red-400' : row.shortRatio >= 5 ? 'text-amber-400' : 'text-gray-400'}`}>
                  {row.shortRatio != null ? `${row.shortRatio.toFixed(1)}d` : '—'}
                </td>
                <td className="py-2.5 px-3 text-left text-gray-500">{row.sector ?? '—'}</td>
              </>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2 text-gray-700 text-xs border-t border-gray-800">{sorted.length} results</div>
    </div>
  )
}

function FundResults({ data, loading, error }) {
  const [sortCol, setSortCol] = useState('profitMargin')
  const [sortDir, setSortDir] = useState('desc')

  function handleSort(key) {
    if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(key); setSortDir('desc') }
  }

  const cols = [
    { label: 'Symbol',   key: 'symbol',        align: 'text-left'  },
    { label: 'Name',     key: 'name',          align: 'text-left'  },
    { label: 'Price',    key: 'price',         align: 'text-right' },
    { label: 'P/E',      key: 'peRatio',       align: 'text-right' },
    { label: 'Fwd P/E',  key: 'forwardPE',     align: 'text-right' },
    { label: 'Margin %', key: 'profitMargin',  align: 'text-right' },
    { label: 'Rev Gr %', key: 'revenueGrowth', align: 'text-right' },
    { label: 'Yield %',  key: 'dividendYield', align: 'text-right' },
    { label: 'D/E',      key: 'debtToEquity',  align: 'text-right' },
    { label: 'ROE %',    key: 'roe',           align: 'text-right' },
    { label: 'Sector',   key: 'sector',        align: 'text-left'  },
  ]

  const sorted = [...(data || [])].sort((a, b) => {
    const av = a[sortCol] ?? null, bv = b[sortCol] ?? null
    if (av == null && bv == null) return 0
    if (av == null) return 1; if (bv == null) return -1
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortDir === 'asc' ? av - bv : bv - av
  })

  const fmt2 = (v, decimals = 1) => v != null ? v.toFixed(decimals) : '—'

  if (loading) return <div className="text-gray-500 text-sm text-center py-20 animate-pulse">Scanning fundamentals…</div>
  if (error)   return <div className="text-red-400 text-sm text-center py-10">Error: {error}</div>
  if (!data)   return null
  if (data.length === 0) return <div className="text-gray-600 text-sm text-center py-16">No stocks matched this screen right now</div>

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/60">
            {cols.map(({ label, key, align }) => (
              <th key={key} onClick={() => handleSort(key)}
                className={`py-2.5 px-3 text-gray-500 font-medium tracking-wider uppercase cursor-pointer select-none hover:text-gray-300 ${align}`}>
                {label}<SortArrow active={sortCol === key} dir={sortDir} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={row.symbol} className="border-b border-gray-800/40 hover:bg-gray-800/40 transition-colors">
              <td className="py-2.5 px-3 text-white font-bold">{row.symbol}</td>
              <td className="py-2.5 px-3 text-gray-400 max-w-[160px] truncate">{row.name}</td>
              <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{row.price != null ? `$${row.price.toFixed(2)}` : '—'}</td>
              <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{fmt2(row.peRatio)}×</td>
              <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{fmt2(row.forwardPE)}×</td>
              <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${(row.profitMargin ?? 0) > 20 ? 'text-emerald-400' : 'text-gray-300'}`}>{fmt2(row.profitMargin)}%</td>
              <td className={`py-2.5 px-3 text-right tabular-nums ${(row.revenueGrowth ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt2(row.revenueGrowth)}%</td>
              <td className="py-2.5 px-3 text-right text-amber-400 tabular-nums">{row.dividendYield > 0 ? `${fmt2(row.dividendYield, 2)}%` : '—'}</td>
              <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{fmt2(row.debtToEquity)}</td>
              <td className={`py-2.5 px-3 text-right tabular-nums ${(row.roe ?? 0) > 20 ? 'text-emerald-400' : 'text-gray-300'}`}>{fmt2(row.roe)}%</td>
              <td className="py-2.5 px-3 text-gray-500 text-[10px]">{row.sector}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2 text-gray-700 text-xs border-t border-gray-800">{sorted.length} results</div>
    </div>
  )
}

export default function Screener() {
  const [mode, setMode]       = useState('technical')
  const [techScan, setTechScan] = useState('52w_high')
  const [fundScreen, setFundScreen] = useState('quality_growth')
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [lastRun, setLastRun] = useState(null)

  // Custom screener state
  const [customFilters, setCustomFilters] = useState([
    { field: 'peRatio', op: 'lt', value: '20', value2: '' },
    { field: 'profitMargin', op: 'gt', value: '10', value2: '' },
  ])

  const runScan = useCallback(async (m, key) => {
    setLoading(true); setError(null); setData(null)
    const url = m === 'technical'
      ? `/api/screener/technical?scan=${key}`
      : `/api/screener/fundamental?screen=${key}`
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(await r.text())
      setData(await r.json())
      setLastRun(new Date())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  const runCustom = useCallback(async () => {
    setLoading(true); setError(null); setData(null)
    const filters = customFilters
      .filter(f => f.value !== '')
      .map(f => ({
        field: f.field,
        op: f.op,
        value: parseFloat(f.value),
        value2: f.op === 'between' ? parseFloat(f.value2) : undefined,
      }))
    if (!filters.length) { setLoading(false); return }
    try {
      const r = await fetch('/api/screener/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      })
      if (!r.ok) throw new Error(await r.text())
      setData(await r.json())
      setLastRun(new Date())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [customFilters])

  useEffect(() => {
    if (mode !== 'custom') {
      runScan(mode, mode === 'technical' ? techScan : fundScreen)
    }
  }, [mode, techScan, fundScreen])

  function changeFilter(idx, key, val) {
    setCustomFilters(prev => prev.map((f, i) => i === idx ? { ...f, [key]: val } : f))
  }

  function addFilter() {
    setCustomFilters(prev => [...prev, { field: 'price', op: 'gt', value: '', value2: '' }])
  }

  function removeFilter(idx) {
    setCustomFilters(prev => prev.filter((_, i) => i !== idx))
  }

  const activeScan   = TECH_SCANS.find(s => s.id === techScan)
  const activeScreen = FUND_SCREENS.find(s => s.id === fundScreen)

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* Mode toggle */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Stock Screener</div>
        <div className="flex items-center gap-3">
          <div className="flex rounded overflow-hidden border border-gray-700">
            {[['technical', 'Technical'], ['fundamental', 'Fundamental'], ['custom', 'Custom']].map(([id, label]) => (
              <button key={id} onClick={() => { setMode(id); setData(null) }}
                className={`px-4 py-1.5 text-xs transition-colors ${mode === id ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}>
                {label}
              </button>
            ))}
          </div>
          {lastRun && (
            <span className="text-gray-600 text-xs">
              Last run {lastRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {mode !== 'custom' && (
            <button onClick={() => runScan(mode, mode === 'technical' ? techScan : fundScreen)}
              disabled={loading}
              className="text-xs text-gray-500 hover:text-emerald-400 border border-gray-700 rounded px-3 py-1.5 transition-colors disabled:opacity-40">
              {loading ? '…' : '↺ Refresh'}
            </button>
          )}
        </div>
      </div>

      {/* Scan/screen selector */}
      {mode === 'technical' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
          {TECH_SCANS.map(s => (
            <button key={s.id} onClick={() => setTechScan(s.id)}
              className={`p-3 rounded-xl border text-left transition-all ${techScan === s.id ? 'border-emerald-600 bg-emerald-900/20 text-white' : 'border-gray-800 bg-gray-900/40 text-gray-400 hover:border-gray-600'}`}>
              <div className="text-lg mb-1">{s.icon}</div>
              <div className="text-xs font-semibold">{s.label}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{s.desc}</div>
            </button>
          ))}
        </div>
      )}

      {mode === 'fundamental' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {FUND_SCREENS.map(s => (
            <button key={s.id} onClick={() => setFundScreen(s.id)}
              className={`p-4 rounded-xl border text-left transition-all ${fundScreen === s.id ? 'border-sky-600 bg-sky-900/20 text-white' : 'border-gray-800 bg-gray-900/40 text-gray-400 hover:border-gray-600'}`}>
              <div className="text-2xl mb-2">{s.icon}</div>
              <div className="text-sm font-semibold">{s.label}</div>
              <div className="text-xs text-gray-500 mt-1">{s.desc}</div>
            </button>
          ))}
        </div>
      )}

      {/* Custom filter builder */}
      {mode === 'custom' && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 mb-5 space-y-4">
          <div className="text-gray-400 text-xs uppercase tracking-widest">Filter Builder — S&P 100 Universe</div>
          <div className="space-y-2.5">
            {customFilters.map((f, i) => (
              <CustomFilterRow key={i} filter={f} idx={i} onChange={changeFilter} onRemove={removeFilter} />
            ))}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button onClick={addFilter}
              className="text-xs text-gray-500 hover:text-emerald-400 border border-gray-700 hover:border-emerald-700 rounded px-3 py-1.5 transition-colors">
              + Add Filter
            </button>
            <button onClick={runCustom} disabled={loading || customFilters.length === 0}
              className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded px-4 py-1.5 transition-colors font-medium">
              {loading ? 'Screening…' : 'Run Screener'}
            </button>
          </div>
        </div>
      )}

      {/* Active description */}
      {mode === 'technical' && activeScan && (
        <div className="mb-4 text-gray-500 text-sm">
          <span className="text-gray-300 font-medium">{activeScan.label}</span> — {activeScan.desc}
        </div>
      )}
      {mode === 'fundamental' && activeScreen && (
        <div className="mb-4 text-gray-500 text-sm">
          <span className="text-gray-300 font-medium">{activeScreen.label}</span> — {activeScreen.desc}
        </div>
      )}

      {/* Results */}
      {mode === 'technical' && <TechResults data={data} loading={loading} error={error} scan={techScan} />}
      {mode === 'fundamental' && <FundResults data={data} loading={loading} error={error} />}
      {mode === 'custom' && <CustomResults data={data} loading={loading} error={error} />}
    </div>
  )
}
