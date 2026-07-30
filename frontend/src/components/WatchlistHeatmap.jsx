import { useState, useCallback, useMemo } from 'react'

// ── Color scale ───────────────────────────────────────────────────────────────

function heatColor(pct) {
  if (pct == null) return { bg: '#1e293b', border: '#334155', text: '#64748b' }
  if (pct <= -5)   return { bg: '#7f1d1d', border: '#991b1b', text: '#fca5a5' }
  if (pct <= -3)   return { bg: '#991b1b', border: '#b91c1c', text: '#fca5a5' }
  if (pct <= -1)   return { bg: '#b91c1c', border: '#dc2626', text: '#fecaca' }
  if (pct <   0)   return { bg: '#7f1d1d99', border: '#991b1b', text: '#fecaca' }
  if (pct <   1)   return { bg: '#14532d99', border: '#15803d', text: '#bbf7d0' }
  if (pct <   3)   return { bg: '#15803d',   border: '#16a34a', text: '#dcfce7' }
  if (pct <   5)   return { bg: '#166534',   border: '#15803d', text: '#86efac' }
  return               { bg: '#14532d',   border: '#166534', text: '#4ade80' }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(v) {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}
function fmtPrice(v) {
  if (v == null) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtCap(v) {
  if (!v) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toLocaleString()}`
}

function RetBadge({ v }) {
  if (v == null) return <span className="text-slate-600 text-xs tabular-nums">—</span>
  const cls = v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-slate-400'
  return <span className={`text-xs font-bold tabular-nums ${cls}`}>{fmtPct(v)}</span>
}

// ── Heatmap grid ──────────────────────────────────────────────────────────────

function HeatmapGrid({ tiles, field, sizeBy, totalMktCap }) {
  const [hovered, setHovered] = useState(null)

  return (
    <div className="bg-slate-900/60 rounded-xl p-1.5 border border-slate-700 relative">
      <div className="flex flex-wrap gap-0.5" style={{ minHeight: '320px' }}>
        {tiles.map(tile => {
          const ret    = tile[field]
          const col    = heatColor(ret)
          const weight = sizeBy === 'marketCap'
            ? Math.max(2, ((tile.marketCap || 1e9) / (totalMktCap || 1)) * 120)
            : 6
          const isHov  = hovered === tile.symbol

          return (
            <div
              key={tile.symbol}
              onMouseEnter={() => setHovered(tile.symbol)}
              onMouseLeave={() => setHovered(null)}
              style={{
                flexGrow: weight,
                flexShrink: 0,
                flexBasis: `${Math.max(5, Math.min(45, weight))}%`,
                backgroundColor: col.bg,
                borderColor: col.border,
                color: col.text,
                minHeight: '88px',
                transition: 'filter 0.12s',
                filter: isHov ? 'brightness(1.3)' : 'brightness(1)',
                zIndex: isHov ? 10 : 0,
              }}
              className="flex flex-col items-center justify-center rounded border p-1.5 cursor-default select-none relative"
            >
              <span className="font-bold text-sm leading-tight text-center">{tile.symbol}</span>
              <span className={`text-xs font-semibold leading-tight ${ret == null ? 'opacity-40' : ''}`}>
                {ret != null ? fmtPct(ret) : '—'}
              </span>
              {tile.price != null && (
                <span className="text-[10px] opacity-75 leading-tight tabular-nums">{fmtPrice(tile.price)}</span>
              )}

              {/* Tooltip */}
              {isHov && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white shadow-xl z-50 whitespace-nowrap pointer-events-none">
                  <p className="font-bold text-sm mb-1">{tile.symbol}</p>
                  <p className="text-slate-300 truncate max-w-[180px] text-[11px]">{tile.name}</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1.5">
                    <span className="text-slate-500">Price</span><span className="tabular-nums">{fmtPrice(tile.price)}</span>
                    <span className="text-slate-500">Mkt Cap</span><span className="tabular-nums">{fmtCap(tile.marketCap)}</span>
                    {tile.sector && <><span className="text-slate-500">Sector</span><span>{tile.sector}</span></>}
                    <span className="text-slate-500">1D</span><span className={tile.ret1d > 0 ? 'text-emerald-400' : tile.ret1d < 0 ? 'text-red-400' : ''}>{fmtPct(tile.ret1d)}</span>
                    {tile.ret5d != null && <><span className="text-slate-500">5D</span><span className={tile.ret5d > 0 ? 'text-emerald-400' : tile.ret5d < 0 ? 'text-red-400' : ''}>{fmtPct(tile.ret5d)}</span></>}
                    {tile.ret1m != null && <><span className="text-slate-500">1M</span><span className={tile.ret1m > 0 ? 'text-emerald-400' : tile.ret1m < 0 ? 'text-red-400' : ''}>{fmtPct(tile.ret1m)}</span></>}
                    {tile.ret3m != null && <><span className="text-slate-500">3M</span><span className={tile.ret3m > 0 ? 'text-emerald-400' : tile.ret3m < 0 ? 'text-red-400' : ''}>{fmtPct(tile.ret3m)}</span></>}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Color legend */}
      <div className="flex items-center gap-2 mt-2 px-1">
        <span className="text-slate-600 text-[10px]">Return:</span>
        {[['≤−5%','#7f1d1d','#fca5a5'],['-3%','#991b1b','#fca5a5'],['-1%','#b91c1c','#fecaca'],
          ['0','#334155','#64748b'],['+1%','#14532d99','#bbf7d0'],['+3%','#15803d','#dcfce7'],
          ['≥+5%','#14532d','#4ade80']].map(([label, bg, text]) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-3.5 h-3.5 rounded-sm border" style={{ backgroundColor: bg, borderColor: bg }} />
            <span className="text-[10px] text-slate-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Sort header ───────────────────────────────────────────────────────────────

function SortHdr({ col, label, sortCol, sortAsc, onSort }) {
  const active = sortCol === col
  return (
    <th
      className={`px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors ${active ? 'text-white' : 'text-slate-400'}`}
      onClick={() => onSort(col)}
    >
      {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const PERIODS = [
  { id: '1d', label: '1D', field: 'ret1d', live: true },
  { id: '5d', label: '5D', field: 'ret5d', live: false },
  { id: '1m', label: '1M', field: 'ret1m', live: false },
  { id: '3m', label: '3M', field: 'ret3m', live: false },
]

export default function WatchlistHeatmap({ watchlist, quotes }) {
  const [period,   setPeriod]   = useState('1d')
  const [viewMode, setViewMode] = useState('heatmap')
  const [sizeBy,   setSizeBy]   = useState('marketCap')
  const [extData,  setExtData]  = useState({})
  const [loading,  setLoading]  = useState(false)
  const [sortCol,  setSortCol]  = useState('ret1d')
  const [sortAsc,  setSortAsc]  = useState(false)

  const currentPeriod = PERIODS.find(p => p.id === period)

  const loadExtData = useCallback(async () => {
    if (!watchlist.length) return
    setLoading(true)
    try {
      const r = await fetch(`/api/market/watchlist-heatmap?symbols=${watchlist.join(',')}`)
      const data = await r.json()
      const map = {}
      data.forEach(d => { map[d.symbol] = d })
      setExtData(map)
    } catch (e) { console.error('WL heatmap:', e) }
    finally { setLoading(false) }
  }, [watchlist.join(',')])

  function handlePeriod(p) {
    setPeriod(p)
    if (p !== '1d' && Object.keys(extData).length === 0) loadExtData()
  }

  function handleSort(col) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  // Build enriched tiles — merge live quotes with extended period data
  const tiles = useMemo(() => {
    return watchlist
      .map(sym => {
        const q   = quotes[sym] || {}
        const ext = extData[sym] || {}
        return {
          symbol:    sym,
          name:      q.name      || ext.name      || sym,
          price:     q.price     ?? ext.price     ?? null,
          marketCap: q.marketCap ?? ext.marketCap ?? null,
          sector:    q.sector    ?? ext.sector     ?? null,
          ret1d:     q.changePercent ?? ext.ret1d ?? null,
          ret5d:     ext.ret5d ?? null,
          ret1m:     ext.ret1m ?? null,
          ret3m:     ext.ret3m ?? null,
        }
      })
      .filter(t => t.price != null || t.marketCap != null)
  }, [watchlist, quotes, extData])

  const totalMktCap = tiles.reduce((s, t) => s + (t.marketCap || 0), 0)
  const field       = currentPeriod.field

  // Heatmap: sorted by market cap desc so largest tiles go first (top-left)
  const heatmapTiles = useMemo(
    () => [...tiles].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)),
    [tiles]
  )

  // Table: user-sortable
  const tableTiles = useMemo(() => {
    return [...tiles].sort((a, b) => {
      const av = a[sortCol] ?? (sortAsc ?  Infinity : -Infinity)
      const bv = b[sortCol] ?? (sortAsc ?  Infinity : -Infinity)
      return sortAsc ? av - bv : bv - av
    })
  }, [tiles, sortCol, sortAsc])

  // Summary stats
  const withData   = tiles.filter(t => t[field] != null)
  const advancing  = withData.filter(t => t[field] > 0).length
  const declining  = withData.filter(t => t[field] < 0).length
  const unchanged  = withData.filter(t => t[field] === 0).length
  const topGainer  = withData.length ? [...withData].sort((a, b) => b[field] - a[field])[0] : null
  const topLoser   = withData.length ? [...withData].sort((a, b) => a[field] - b[field])[0] : null
  const hasExt     = Object.keys(extData).length > 0
  const needsLoad  = !currentPeriod.live && !hasExt && !loading

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Watchlist Heatmap</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {tiles.length} symbols · tiles sized by{' '}
            <span className="text-slate-300">{sizeBy === 'marketCap' ? 'market cap' : 'equal weight'}</span>
            {' '}· {currentPeriod.label} return
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {!currentPeriod.live && (
            <button onClick={loadExtData} disabled={loading}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-xl transition-colors disabled:opacity-50">
              {loading ? '…' : '↻ Refresh'}
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Period selector */}
        <div className="flex gap-0.5 bg-slate-800 rounded-xl p-1">
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => handlePeriod(p.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${period === p.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {p.label}
              {p.live && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block align-middle" title="Live" />}
            </button>
          ))}
        </div>

        {/* Size by */}
        <div className="flex gap-0.5 bg-slate-800 rounded-xl p-1">
          {[['marketCap', '⊞ Mkt Cap'], ['equal', '▦ Equal']].map(([k, l]) => (
            <button key={k} onClick={() => setSizeBy(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${sizeBy === k ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {l}
            </button>
          ))}
        </div>

        {/* View mode */}
        <div className="flex gap-0.5 bg-slate-800 rounded-xl p-1 ml-auto">
          {[['heatmap', '⬛ Heatmap'], ['table', '☰ Table']].map(([k, l]) => (
            <button key={k} onClick={() => setViewMode(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${viewMode === k ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      {tiles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-slate-800 rounded-xl p-3.5 border border-slate-700">
            <p className="text-xs text-slate-400">Symbols</p>
            <p className="text-xl font-bold text-white mt-1">{tiles.length}</p>
          </div>
          <div className="bg-emerald-900/20 rounded-xl p-3.5 border border-emerald-800/30">
            <p className="text-xs text-slate-400">Advancing</p>
            <p className="text-xl font-bold text-emerald-400 mt-1">{advancing}</p>
          </div>
          <div className="bg-red-900/15 rounded-xl p-3.5 border border-red-800/25">
            <p className="text-xs text-slate-400">Declining</p>
            <p className="text-xl font-bold text-red-400 mt-1">{declining}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-3.5 border border-slate-700">
            <p className="text-xs text-slate-400">Top Gainer</p>
            {topGainer ? (
              <>
                <p className="text-sm font-bold text-white mt-1">{topGainer.symbol}</p>
                <p className="text-xs text-emerald-400 font-semibold">{fmtPct(topGainer[field])}</p>
              </>
            ) : <p className="text-slate-600 text-sm mt-1">—</p>}
          </div>
          <div className="bg-slate-800 rounded-xl p-3.5 border border-slate-700">
            <p className="text-xs text-slate-400">Biggest Loser</p>
            {topLoser && topLoser[field] < 0 ? (
              <>
                <p className="text-sm font-bold text-white mt-1">{topLoser.symbol}</p>
                <p className="text-xs text-red-400 font-semibold">{fmtPct(topLoser[field])}</p>
              </>
            ) : <p className="text-slate-600 text-sm mt-1">—</p>}
          </div>
        </div>
      )}

      {/* Load extended data prompt */}
      {needsLoad && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-10 text-center">
          <p className="text-slate-300 font-semibold mb-1.5">{currentPeriod.label} data not yet loaded</p>
          <p className="text-slate-400 text-sm mb-5">
            Fetches {currentPeriod.label} returns for all {watchlist.length} symbols from Yahoo Finance (cached 5 min).
          </p>
          <button onClick={loadExtData}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
            Load {currentPeriod.label} returns
          </button>
        </div>
      )}

      {/* Loading spinner */}
      {loading && (
        <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-8 text-center text-slate-400 text-sm">
          Fetching {currentPeriod.label} returns for {watchlist.length} symbols…
        </div>
      )}

      {/* Heatmap view */}
      {viewMode === 'heatmap' && !needsLoad && !loading && tiles.length > 0 && (
        <HeatmapGrid
          tiles={heatmapTiles}
          field={field}
          sizeBy={sizeBy}
          totalMktCap={totalMktCap}
        />
      )}

      {/* Table view */}
      {viewMode === 'table' && !loading && tiles.length > 0 && (
        <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/60">
                  <SortHdr col="symbol" label="Symbol" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <SortHdr col="price" label="Price" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <SortHdr col="ret1d" label="1D%" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  {hasExt && <SortHdr col="ret5d" label="5D%" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />}
                  {hasExt && <SortHdr col="ret1m" label="1M%" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />}
                  {hasExt && <SortHdr col="ret3m" label="3M%" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />}
                  <SortHdr col="marketCap" label="Mkt Cap" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Sector</th>
                </tr>
              </thead>
              <tbody>
                {tableTiles.map(t => {
                  const col = heatColor(t[field])
                  return (
                    <tr key={t.symbol} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-8 rounded-sm shrink-0" style={{ backgroundColor: col.bg }} />
                          <div>
                            <p className="font-bold text-white">{t.symbol}</p>
                            <p className="text-xs text-slate-500 truncate max-w-[120px]">{t.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-white tabular-nums">{fmtPrice(t.price)}</td>
                      <td className="px-3 py-2.5"><RetBadge v={t.ret1d} /></td>
                      {hasExt && <td className="px-3 py-2.5"><RetBadge v={t.ret5d} /></td>}
                      {hasExt && <td className="px-3 py-2.5"><RetBadge v={t.ret1m} /></td>}
                      {hasExt && <td className="px-3 py-2.5"><RetBadge v={t.ret3m} /></td>}
                      <td className="px-3 py-2.5 text-slate-300 tabular-nums text-xs">{fmtCap(t.marketCap)}</td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs">{t.sector || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {watchlist.length === 0 && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-10 text-center">
          <p className="text-slate-300 font-semibold text-lg mb-2">No watchlist symbols</p>
          <p className="text-slate-400 text-sm">Add tickers to your watchlist using the input in the header to see the heatmap.</p>
        </div>
      )}

      <p className="text-xs text-slate-600">
        1D is live from your WebSocket feed (green dot = real-time). Extended periods (5D/1M/3M) fetch from Yahoo Finance on demand and cache for 5 minutes. Hover tiles for full detail tooltip.
      </p>
    </div>
  )
}
