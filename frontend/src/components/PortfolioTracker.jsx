import { useState, useEffect, useCallback, useRef } from 'react'
import { fmt } from '../utils/format'
import ChartModal from './ChartModal'

const COLORS = [
  '#10b981','#3b82f6','#8b5cf6','#f59e0b','#ef4444',
  '#06b6d4','#ec4899','#84cc16','#f97316','#6366f1',
  '#14b8a6','#a855f7','#0ea5e9','#22c55e','#fb923c',
]

// ── Treemap layout (squarified algorithm) ─────────────────────────────────────

function worstAspect(row, sideLen) {
  if (row.length === 0) return Infinity
  const s = row.reduce((acc, n) => acc + n._area, 0)
  const max = Math.max(...row.map(n => n._area))
  const min = Math.min(...row.map(n => n._area))
  return Math.max(
    (sideLen * sideLen * max) / (s * s),
    (s * s) / (sideLen * sideLen * min),
  )
}

function placeRow(row, x, y, w, h) {
  const s = row.reduce((acc, n) => acc + n._area, 0)
  const cells = []
  if (w >= h) {
    const rw = s / h
    let cy = y
    for (const n of row) {
      const ch = n._area / rw
      cells.push({ ...n, x, y: cy, w: rw, h: ch })
      cy += ch
    }
  } else {
    const rh = s / w
    let cx = x
    for (const n of row) {
      const cw = n._area / rh
      cells.push({ ...n, x: cx, y, w: cw, h: rh })
      cx += cw
    }
  }
  return cells
}

function squarify(nodes, x, y, w, h) {
  if (nodes.length === 0) return []
  const total = nodes.reduce((acc, n) => acc + n._area, 0)
  if (total <= 0) return []

  // Scale areas to fit w×h
  const scale = (w * h) / total
  const scaled = nodes.map(n => ({ ...n, _area: n._area * scale }))

  const result = []
  let remaining = [...scaled]
  let rx = x, ry = y, rw = w, rh = h

  while (remaining.length > 0) {
    const side = Math.min(rw, rh)
    let row = []
    for (let i = 0; i < remaining.length; i++) {
      const candidate = [...row, remaining[i]]
      if (row.length > 0 && worstAspect(candidate, side) > worstAspect(row, side)) break
      row = candidate
    }

    const cells = placeRow(row, rx, ry, rw, rh)
    result.push(...cells)

    const rowArea = row.reduce((acc, n) => acc + n._area, 0)
    remaining = remaining.slice(row.length)

    if (rw >= rh) {
      const used = rowArea / rh
      rx += used; rw -= used
    } else {
      const used = rowArea / rw
      ry += used; rh -= used
    }
  }

  return result
}

// ── Heat colour scale ─────────────────────────────────────────────────────────

function heatColor(pct) {
  if (pct == null)   return '#374151'   // neutral — no data
  if (pct >= 5)      return '#14532d'   // deep green
  if (pct >= 3)      return '#166534'
  if (pct >= 1.5)    return '#16a34a'
  if (pct >= 0.5)    return '#22c55e'
  if (pct >= -0.5)   return '#374151'   // flat
  if (pct >= -1.5)   return '#dc2626'
  if (pct >= -3)     return '#b91c1c'
  if (pct >= -5)     return '#991b1b'
  return '#7f1d1d'                      // deep red
}

// ── Heatmap component ─────────────────────────────────────────────────────────

const HEATMAP_H = 600

function PortfolioHeatmap({ positions, onSymbolClick }) {
  const containerRef = useRef(null)
  const [containerW, setContainerW] = useState(900)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerW(el.getBoundingClientRect().width || 900)
    const ro = new ResizeObserver(([e]) => setContainerW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const nodes = positions
    .filter(p => p.price > 0)
    .map(p => ({ ...p, _area: p.curVal ?? p.price ?? 1 }))
    .sort((a, b) => b._area - a._area)

  const cells = containerW > 0 && nodes.length > 0
    ? squarify(nodes, 0, 0, containerW, HEATMAP_H)
    : []

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
        <span className="text-gray-600 text-xs uppercase tracking-wider">Performance</span>
        {[
          { label: '< −5%',  color: '#7f1d1d' },
          { label: '−3%',    color: '#991b1b' },
          { label: '−1.5%',  color: '#dc2626' },
          { label: '0',      color: '#374151' },
          { label: '+1.5%',  color: '#22c55e' },
          { label: '+3%',    color: '#16a34a' },
          { label: '> +5%',  color: '#14532d' },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1 text-xs text-gray-400">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
        <span className="text-gray-700 text-xs ml-auto">Cell area = position market value · click to chart</span>
      </div>

      {/* Treemap */}
      <div
        ref={containerRef}
        className="relative w-full rounded-lg overflow-hidden border border-gray-800 bg-gray-950"
        style={{ height: HEATMAP_H }}
      >
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
            Waiting for price data…
          </div>
        )}
        {cells.map((cell) => {
          const bg       = heatColor(cell.changePercent)
          const showSym   = cell.w > 34 && cell.h > 20
          const showPct   = cell.w > 50 && cell.h > 36
          const showPrice = cell.w > 66 && cell.h > 50
          const fs        = Math.min(Math.max(Math.min(cell.w, cell.h) / 5, 8), 15)

          return (
            <button
              key={cell.id}
              onClick={() => onSymbolClick?.(cell)}
              style={{
                position: 'absolute',
                left:   cell.x + 0.5,
                top:    cell.y + 0.5,
                width:  Math.max(cell.w - 1, 1),
                height: Math.max(cell.h - 1, 1),
                backgroundColor: bg,
              }}
              className="flex flex-col items-center justify-center overflow-hidden transition-opacity hover:opacity-80 focus:outline-none"
              title={`${cell.symbol}  ${cell.price != null ? fmt.price(cell.price) : '—'}  ${cell.changePercent != null ? (cell.changePercent >= 0 ? '+' : '') + cell.changePercent.toFixed(2) + '%' : 'N/A'}`}
            >
              {showSym && (
                <div style={{ fontSize: fs, fontWeight: 700, color: 'rgba(255,255,255,0.95)', lineHeight: 1.15 }}>
                  {cell.symbol}
                </div>
              )}
              {showPct && cell.changePercent != null && (
                <div style={{ fontSize: fs * 0.82, color: 'rgba(255,255,255,0.80)', lineHeight: 1.15 }}>
                  {cell.changePercent >= 0 ? '+' : ''}{cell.changePercent.toFixed(2)}%
                </div>
              )}
              {showPrice && cell.price != null && (
                <div style={{ fontSize: fs * 0.70, color: 'rgba(255,255,255,0.55)', lineHeight: 1.15 }}>
                  {fmt.price(cell.price)}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, positive }) {
  const isNeutral = positive === null || positive === undefined
  const color = isNeutral ? 'text-white' : positive ? 'text-emerald-400' : 'text-red-400'
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3 min-w-[140px]">
      <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className={`text-xs tabular-nums mt-0.5 ${color} opacity-80`}>{sub}</div>}
    </div>
  )
}

function pct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function money(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Main component ────────────────────────────────────────────────────────────

function SortArrow({ active, dir }) {
  return (
    <span className={`ml-1 text-xs ${active ? 'text-emerald-400' : 'text-gray-700'}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '⇅'}
    </span>
  )
}

const PORT_COLS = [
  { label: 'Symbol',       align: 'text-left',  key: 'symbol' },
  { label: 'Name',         align: 'text-left',  key: 'name' },
  { label: 'Shares',       align: 'text-right', key: 'shares' },
  { label: 'Avg Cost',     align: 'text-right', key: 'avgCost' },
  { label: 'Price',        align: 'text-right', key: 'price' },
  { label: 'Market Value', align: 'text-right', key: 'curVal' },
  { label: 'P&L',         align: 'text-right', key: 'pl' },
  { label: 'P&L %',       align: 'text-right', key: 'plPct' },
  { label: 'Day P&L',     align: 'text-right', key: 'dayPL' },
  { label: 'Weight',       align: 'text-right', key: 'weight' },
  { label: '',             align: 'text-right', key: null },
]

export default function PortfolioTracker() {
  const [positions,    setPositions]    = useState([])
  const [quotes,       setQuotes]       = useState({})
  const [loading,      setLoading]      = useState(false)
  const [lastUpdated,  setLastUpdated]  = useState(null)
  const [countdown,    setCountdown]    = useState(30)
  const [chartSymbol,  setChartSymbol]  = useState(null)
  const [chartQuote,   setChartQuote]   = useState(null)
  const [viewMode,     setViewMode]     = useState('heatmap')
  const [sortCol,      setSortCol]      = useState(null)
  const [sortDir,      setSortDir]      = useState('asc')
  const [portQuery,    setPortQuery]    = useState('')

  function handleSort(key) {
    if (!key) return
    if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(key); setSortDir('asc') }
  }

  // Form state
  const [sym,     setSym]     = useState('')
  const [shares,  setShares]  = useState('')
  const [cost,    setCost]    = useState('')
  const [formErr, setFormErr] = useState('')

  // Load positions from API; migrate localStorage on first empty load
  useEffect(() => {
    fetch('/api/portfolio')
      .then(r => r.json())
      .then(async (rows) => {
        if (rows.length === 0) {
          try {
            const saved = localStorage.getItem('stockmonitor-portfolio')
            if (saved) {
              const legacy = JSON.parse(saved)
              const migrated = await Promise.all(
                legacy.map(p =>
                  fetch('/api/portfolio', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol: p.symbol, shares: p.shares, avgCost: p.avgCost }),
                  }).then(r => r.json())
                )
              )
              localStorage.removeItem('stockmonitor-portfolio')
              setPositions(migrated)
              return
            }
          } catch { /* ignore */ }
        }
        setPositions(rows)
      })
      .catch(() => setPositions([]))
  }, [])

  const fetchQuotes = useCallback(async () => {
    const syms = [...new Set(positions.map(p => p.symbol))]
    if (syms.length === 0) return
    setLoading(true)
    try {
      // Fetch in batches of 50 to avoid query-string limits
      const batches = []
      for (let i = 0; i < syms.length; i += 50) batches.push(syms.slice(i, i + 50))
      const results = await Promise.all(
        batches.map(b => fetch(`/api/quotes?symbols=${b.join(',')}`).then(r => r.json()))
      )
      const map = {}
      results.flat().forEach(q => { map[q.symbol] = q })
      setQuotes(map)
      setLastUpdated(new Date())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [positions])

  useEffect(() => {
    fetchQuotes()
    setCountdown(30)
    const iv = setInterval(() => { fetchQuotes(); setCountdown(30) }, 30000)
    return () => clearInterval(iv)
  }, [fetchQuotes])

  useEffect(() => {
    setCountdown(30)
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [lastUpdated])

  const addPosition = async (e) => {
    e.preventDefault()
    const s  = sym.trim().toUpperCase()
    const sh = parseFloat(shares)
    const co = parseFloat(cost)
    if (!s)                    { setFormErr('Symbol required'); return }
    if (isNaN(sh) || sh <= 0)  { setFormErr('Enter valid shares'); return }
    if (isNaN(co) || co <= 0)  { setFormErr('Enter valid avg cost'); return }
    setFormErr('')
    try {
      const r = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: s, shares: sh, avgCost: co }),
      })
      if (!r.ok) throw new Error('Server error')
      const pos = await r.json()
      setPositions(prev => [...prev, pos])
      setSym(''); setShares(''); setCost('')
    } catch { setFormErr('Failed to add position') }
  }

  const removePosition = async (id) => {
    await fetch(`/api/portfolio/${id}`, { method: 'DELETE' })
    setPositions(prev => prev.filter(p => p.id !== id))
  }

  // Enrich with live data
  const enriched = positions.map((p, i) => {
    const q      = quotes[p.symbol]
    const price  = q?.price ?? null
    const prev   = q?.previousClose ?? null
    const curVal = price != null ? p.shares * price : null
    const basis  = p.shares * p.avgCost
    const pl     = curVal != null ? curVal - basis : null
    const plPct  = pl != null ? (pl / basis) * 100 : null
    const dayPL  = price != null && prev != null ? p.shares * (price - prev) : null
    return {
      ...p,
      name: q?.name ?? p.symbol,
      price, prev, curVal, basis, pl, plPct, dayPL,
      change:        q?.change ?? null,
      changePercent: q?.changePercent ?? null,
      color: COLORS[i % COLORS.length],
    }
  })

  const totalBasis = enriched.reduce((s, p) => s + p.basis, 0)
  const totalVal   = enriched.reduce((s, p) => s + (p.curVal ?? p.basis), 0)
  const totalPL    = totalVal - totalBasis
  const totalPLPct = totalBasis > 0 ? (totalPL / totalBasis) * 100 : 0
  const totalDayPL = enriched.reduce((s, p) => s + (p.dayPL ?? 0), 0)

  const withWeight = enriched.map(p => ({
    ...p,
    weight: totalVal > 0 ? ((p.curVal ?? p.basis) / totalVal) * 100 : 0,
  }))

  const openChart = (sym, name, price, change, changePercent) => {
    setChartSymbol(sym)
    setChartQuote({ name, price, change, changePercent })
  }

  return (
    <div className="p-4 max-w-7xl mx-auto">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-gray-500 text-xs uppercase tracking-widest">Portfolio Tracker</div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex rounded overflow-hidden border border-gray-700">
            {[['heatmap', 'Heatmap'], ['table', 'Table']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setViewMode(id)}
                className={`px-3 py-1 text-xs transition-colors ${
                  viewMode === id
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {lastUpdated && (
            <span className="text-gray-600 text-xs">
              {loading
                ? <span className="text-emerald-400 animate-pulse">● Updating…</span>
                : `Updated ${lastUpdated.toLocaleTimeString()} · next in ${countdown}s`}
            </span>
          )}
          <button onClick={fetchQuotes} disabled={loading || positions.length === 0}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-400 hover:text-white px-3 py-1 text-xs rounded transition-colors">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Add position form ── */}
      <form onSubmit={addPosition} className="flex flex-wrap items-end gap-3 mb-6 bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3">
        <div>
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Symbol</div>
          <input value={sym} onChange={e => setSym(e.target.value.toUpperCase())}
            placeholder="AAPL" maxLength={10}
            className="bg-gray-800 border border-gray-700 text-white placeholder-gray-600 px-3 py-1.5 text-sm rounded w-28 focus:outline-none focus:border-emerald-500 uppercase" />
        </div>
        <div>
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Shares</div>
          <input value={shares} onChange={e => setShares(e.target.value)} type="number" min="0" step="any"
            placeholder="100"
            className="bg-gray-800 border border-gray-700 text-white placeholder-gray-600 px-3 py-1.5 text-sm rounded w-28 focus:outline-none focus:border-emerald-500" />
        </div>
        <div>
          <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Avg Cost ($)</div>
          <input value={cost} onChange={e => setCost(e.target.value)} type="number" min="0" step="any"
            placeholder="150.00"
            className="bg-gray-800 border border-gray-700 text-white placeholder-gray-600 px-3 py-1.5 text-sm rounded w-32 focus:outline-none focus:border-emerald-500" />
        </div>
        <button type="submit"
          className="bg-emerald-800 hover:bg-emerald-700 text-emerald-100 px-4 py-1.5 text-sm rounded transition-colors">
          + Add Position
        </button>
        {formErr && <span className="text-red-400 text-xs self-center">{formErr}</span>}
      </form>

      {positions.length === 0 && (
        <div className="text-gray-600 text-sm text-center py-20">
          Add your first position above to start tracking your portfolio
        </div>
      )}

      {positions.length > 0 && (
        <div className="space-y-6">

          {/* ── Summary cards ── */}
          <div className="flex flex-wrap gap-3">
            <SummaryCard label="Total Invested"  value={`$${totalBasis.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`} />
            <SummaryCard label="Market Value"    value={`$${totalVal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`} />
            <SummaryCard label="Total P&L"       value={money(totalPL)}   sub={pct(totalPLPct)}   positive={totalPL >= 0} />
            <SummaryCard label="Day's P&L"       value={money(totalDayPL)}                         positive={totalDayPL >= 0} />
            <SummaryCard label="Positions"       value={positions.length} />
          </div>

          {/* ── Allocation bar (only in table view) ── */}
          {viewMode === 'table' && (
            <section>
              <div className="text-gray-600 text-xs uppercase tracking-widest mb-2">Allocation</div>
              <div className="w-full h-3 rounded-full overflow-hidden flex mb-3">
                {withWeight.map(p => (
                  <div key={p.id} style={{ width: `${p.weight}%`, backgroundColor: p.color }}
                    title={`${p.symbol}: ${p.weight.toFixed(1)}%`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {withWeight.map(p => (
                  <span key={p.id} className="text-xs text-gray-400 flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
                    {p.symbol} <span className="text-gray-600">{p.weight.toFixed(1)}%</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* ── Heatmap view ── */}
          {viewMode === 'heatmap' && (
            <section>
              <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">Portfolio Heatmap</div>
              <PortfolioHeatmap
                positions={withWeight}
                onSymbolClick={cell => openChart(cell.symbol, cell.name, cell.price, cell.change, cell.changePercent)}
              />
            </section>
          )}

          {/* ── Table view ── */}
          {viewMode === 'table' && (
            <section>
              {/* Search bar */}
              <div className="relative mb-3">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
                  fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={portQuery}
                  onChange={e => setPortQuery(e.target.value)}
                  placeholder="Filter by symbol or company name…"
                  className="w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 pl-9 pr-8 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 transition-colors"
                />
                {portQuery && (
                  <button
                    onClick={() => setPortQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
              {portQuery.trim() && (() => {
                const q = portQuery.trim().toLowerCase()
                const matchCount = withWeight.filter(p =>
                  p.symbol.toLowerCase().includes(q) || (p.name ?? '').toLowerCase().includes(q)
                ).length
                return (
                  <div className="text-xs text-gray-500 mb-3">
                    {matchCount === 0
                      ? `No matches for "${portQuery}"`
                      : `${matchCount} of ${withWeight.length} positions`}
                  </div>
                )
              })()}

              <div className="bg-gray-900/60 border border-gray-800 rounded-lg overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {PORT_COLS.map(({ label, align, key }) => (
                        <th
                          key={key ?? '_action'}
                          onClick={() => handleSort(key)}
                          className={`py-2.5 px-3 text-gray-600 font-medium tracking-wider uppercase ${align}${key ? ' cursor-pointer select-none hover:text-gray-400' : ''}`}
                        >
                          {label}
                          {key && <SortArrow active={sortCol === key} dir={sortDir} />}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const q = portQuery.trim().toLowerCase()
                      const base = q
                        ? withWeight.filter(p =>
                            p.symbol.toLowerCase().includes(q) ||
                            (p.name ?? '').toLowerCase().includes(q)
                          )
                        : withWeight
                      const rows = sortCol
                        ? [...base].sort((a, b) => {
                            const av = a[sortCol] ?? null
                            const bv = b[sortCol] ?? null
                            if (av == null && bv == null) return 0
                            if (av == null) return 1
                            if (bv == null) return -1
                            if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
                            return sortDir === 'asc' ? av - bv : bv - av
                          })
                        : base
                      if (rows.length === 0 && q) {
                        return (
                          <tr>
                            <td colSpan={PORT_COLS.length} className="py-16 text-center text-gray-600 text-sm">
                              No positions match &ldquo;{portQuery}&rdquo;
                            </td>
                          </tr>
                        )
                      }
                      return rows.map(p => (
                      <tr key={p.id} className="border-b border-gray-800/40 hover:bg-gray-800/40 transition-colors">
                        <td className="py-2.5 px-3">
                          <button
                            onClick={() => openChart(p.symbol, p.name, p.price, p.change, p.changePercent)}
                            className="flex items-center gap-1.5 text-white font-bold hover:text-sky-300 transition-colors"
                          >
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
                            {p.symbol}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-gray-400 max-w-[160px] truncate">{p.name}</td>
                        <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{p.shares.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{fmt.price(p.avgCost)}</td>
                        <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{fmt.price(p.price)}</td>
                        <td className="py-2.5 px-3 text-right text-white font-medium tabular-nums">
                          {p.curVal != null ? `$${p.curVal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—'}
                        </td>
                        <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${p.pl==null?'text-gray-600':p.pl>=0?'text-emerald-400':'text-red-400'}`}>
                          {money(p.pl)}
                        </td>
                        <td className={`py-2.5 px-3 text-right tabular-nums ${p.plPct==null?'text-gray-600':p.plPct>=0?'text-emerald-400':'text-red-400'}`}>
                          {pct(p.plPct)}
                        </td>
                        <td className={`py-2.5 px-3 text-right tabular-nums ${p.dayPL==null?'text-gray-600':p.dayPL>=0?'text-emerald-400':'text-red-400'}`}>
                          {money(p.dayPL)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-gray-500 tabular-nums">{p.weight.toFixed(1)}%</td>
                        <td className="py-2.5 px-3 text-right">
                          <button onClick={() => removePosition(p.id)}
                            className="text-gray-700 hover:text-red-400 transition-colors text-base leading-none px-1">×</button>
                        </td>
                      </tr>
                    ))
                  })()}
                  </tbody>
                </table>
              </div>
            </section>
          )}

        </div>
      )}

      {chartSymbol && (
        <ChartModal
          symbol={chartSymbol}
          quote={chartQuote}
          onClose={() => { setChartSymbol(null); setChartQuote(null) }}
        />
      )}
    </div>
  )
}
