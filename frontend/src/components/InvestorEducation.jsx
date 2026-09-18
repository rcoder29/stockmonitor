import { useEffect, useMemo, useState } from 'react'
import { LAYERS, TOPICS } from '../data/investorEducationTopics'

// Static (non-interpolated) Tailwind classes per layer — dynamic template
// strings like `fill-${color}-600` aren't picked up by Tailwind's build-time
// scanner, so each layer's classes are spelled out here in full.
const LAYER_COLORS = {
  macro:     { fill: 'fill-sky-700',     ring: 'hover:fill-sky-600',     dot: 'bg-sky-500',     text: 'text-sky-400',     border: 'border-sky-700/40',     bg: 'bg-sky-900/25' },
  structure: { fill: 'fill-violet-700',  ring: 'hover:fill-violet-600',  dot: 'bg-violet-500',  text: 'text-violet-400',  border: 'border-violet-700/40',  bg: 'bg-violet-900/25' },
  assets:    { fill: 'fill-emerald-700', ring: 'hover:fill-emerald-600', dot: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-700/40', bg: 'bg-emerald-900/25' },
  risk:      { fill: 'fill-amber-700',   ring: 'hover:fill-amber-600',   dot: 'bg-amber-500',   text: 'text-amber-400',   border: 'border-amber-700/40',   bg: 'bg-amber-900/25' },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pathTo(id) {
  const path = []
  let cur = TOPICS[id]
  while (cur) {
    path.unshift(cur)
    cur = cur.parentId ? TOPICS[cur.parentId] : null
  }
  return path
}

function rootOf(layerId) {
  return Object.values(TOPICS).find(t => t.layer === layerId && !t.parentId)
}

// ── Onion map (landing view) ───────────────────────────────────────────────────

function OnionMap({ onSelectLayer }) {
  const size = 360
  const c = size / 2
  // Outermost (broadest, Macro) to innermost (most granular, Risk).
  const radii = [168, 128, 88, 48]

  return (
    <div className="flex flex-col items-center gap-6 py-6 px-4">
      <div>
        <h1 className="text-white font-bold text-xl mb-1 text-center">Investor Education</h1>
        <p className="text-gray-500 text-sm text-center max-w-md">
          Four layers, peeled from the outside in. Click a ring or a card to start exploring.
        </p>
      </div>

      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="max-w-full">
        {LAYERS.map((l, i) => (
          <circle
            key={l.id}
            cx={c} cy={c} r={radii[i]}
            className={`cursor-pointer transition-colors ${LAYER_COLORS[l.id].fill} ${LAYER_COLORS[l.id].ring}`}
            stroke="#030712" strokeWidth="2"
            onClick={() => onSelectLayer(l.id)}
          >
            <title>{l.label}</title>
          </circle>
        ))}
        <text x={c} y={c} textAnchor="middle" dominantBaseline="middle" className="fill-white text-[12px] font-bold pointer-events-none select-none">
          Risk
        </text>
      </svg>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-2xl">
        {LAYERS.map(l => (
          <button
            key={l.id}
            onClick={() => onSelectLayer(l.id)}
            className="text-left rounded-lg border border-gray-800 hover:border-gray-600 bg-gray-900/40 hover:bg-gray-900/70 px-3 py-2.5 transition-colors"
          >
            <span className={`inline-block w-2.5 h-2.5 rounded-full mb-1.5 ${LAYER_COLORS[l.id].dot}`} />
            <div className="text-xs font-semibold text-white">{l.label}</div>
            <div className="text-[10.5px] text-gray-500 mt-0.5 leading-snug">{l.subtitle}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Outline (nested tree for the active layer) ────────────────────────────────

function OutlineNode({ node, depth, activeId, onSelect }) {
  const isActive = node.id === activeId
  return (
    <div>
      <button
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${16 + depth * 14}px` }}
        className={`w-full text-left text-xs py-1.5 pr-3 transition-colors relative ${
          isActive ? 'text-white font-semibold bg-emerald-900/25' : 'text-gray-500 hover:text-white hover:bg-gray-800/60'
        }`}
      >
        {isActive && <span className="absolute left-0 top-0.5 bottom-0.5 w-0.5 bg-emerald-400 rounded-r" />}
        {node.title}
      </button>
      {(node.childIds || []).map(cid => (
        <OutlineNode key={cid} node={TOPICS[cid]} depth={depth + 1} activeId={activeId} onSelect={onSelect} />
      ))}
    </div>
  )
}

// ── Live data snapshot ─────────────────────────────────────────────────────────

function LiveStat({ topic }) {
  const [state, setState] = useState({ status: 'loading', data: null })

  useEffect(() => {
    if (!topic.liveStat) return
    let cancelled = false
    setState({ status: 'loading', data: null })
    fetch(topic.liveStat.endpoint)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        const parsed = topic.liveStat.parse(json)
        setState(parsed ? { status: 'ok', data: parsed } : { status: 'empty', data: null })
      })
      .catch(() => { if (!cancelled) setState({ status: 'error', data: null }) })
    return () => { cancelled = true }
  }, [topic.id])

  if (!topic.liveStat || state.status === 'empty') return null

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold mb-1.5 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Live
      </div>
      {state.status === 'loading' && <div className="text-xs text-gray-600">Loading live data…</div>}
      {state.status === 'error' && <div className="text-xs text-gray-600">Live data unavailable right now.</div>}
      {state.status === 'ok' && (
        <>
          <div className="text-xs text-gray-500">{state.data.label}</div>
          <div className="text-2xl font-bold text-white tabular-nums">{state.data.value}</div>
          {state.data.sub && <div className="text-xs text-gray-500 mt-0.5">{state.data.sub}</div>}
        </>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InvestorEducation({ onNavigate }) {
  const [view, setView] = useState('map') // 'map' | 'topic'
  const [activeId, setActiveId] = useState(rootOf('macro').id)
  const topic = TOPICS[activeId]
  const activeLayer = LAYERS.find(l => l.id === topic.layer)
  const colors = LAYER_COLORS[activeLayer.id]

  const breadcrumb = useMemo(() => pathTo(activeId), [activeId])
  const children = (topic.childIds || []).map(id => TOPICS[id])
  const related = (topic.relatedIds || []).map(id => TOPICS[id])

  function goto(id) {
    setActiveId(id)
    setView('topic')
  }

  function selectLayer(layerId) {
    setActiveId(rootOf(layerId).id)
    setView('topic')
  }

  if (view === 'map') {
    return (
      <div className="h-full min-h-0 overflow-y-auto">
        <OnionMap onSelectLayer={selectLayer} />
      </div>
    )
  }

  return (
    <div className="flex gap-0 h-full min-h-0">

      {/* Sidebar: layers + outline (desktop) */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-gray-800 overflow-y-auto py-4">
        <button
          onClick={() => setView('map')}
          className="mx-3 mb-4 flex items-center gap-2 text-xs text-gray-400 hover:text-white border border-gray-800 hover:border-gray-600 rounded-lg px-3 py-2 transition-colors"
        >
          <span aria-hidden>◎</span> Onion Map
        </button>

        <div className="text-gray-600 text-[10px] uppercase tracking-widest px-4 mb-2">Layers</div>
        <div className="px-3 flex flex-col gap-1 mb-5">
          {LAYERS.map(l => (
            <button
              key={l.id}
              onClick={() => selectLayer(l.id)}
              className={`text-left rounded-lg px-3 py-2 transition-colors border ${
                l.id === activeLayer.id
                  ? `${LAYER_COLORS[l.id].bg} ${LAYER_COLORS[l.id].border} text-white`
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-gray-800/60'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span className={`inline-block w-2 h-2 rounded-full ${LAYER_COLORS[l.id].dot}`} />
                {l.label}
              </div>
              <div className="text-[10.5px] text-gray-500 mt-0.5 leading-snug">{l.subtitle}</div>
            </button>
          ))}
        </div>

        <div className="text-gray-600 text-[10px] uppercase tracking-widest px-4 mb-2">{activeLayer.label} — Contents</div>
        <div>
          <OutlineNode node={rootOf(activeLayer.id)} depth={0} activeId={activeId} onSelect={goto} />
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* Mobile-only nav */}
        <div className="lg:hidden flex flex-col gap-2 -mt-1 mb-2">
          <button
            onClick={() => setView('map')}
            className="self-start flex items-center gap-2 text-xs text-gray-400 hover:text-white border border-gray-800 hover:border-gray-600 rounded-lg px-3 py-1.5 transition-colors"
          >
            <span aria-hidden>◎</span> Onion Map
          </button>
          <select
            value={activeLayer.id}
            onChange={e => selectLayer(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-600"
          >
            {LAYERS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <select
            value={activeId}
            onChange={e => goto(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-600"
          >
            {Object.values(TOPICS).filter(t => t.layer === activeLayer.id).map(t => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
        </div>

        <div>
          <div className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold mb-2 ${colors.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
            {activeLayer.label}
          </div>
          <div className="flex items-center flex-wrap gap-1 text-xs text-gray-500">
            {breadcrumb.map((b, i) => (
              <span key={b.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-gray-700">/</span>}
                <button
                  onClick={() => goto(b.id)}
                  className={i === breadcrumb.length - 1 ? 'text-emerald-400 font-semibold' : 'hover:text-white'}
                >
                  {b.title}
                </button>
              </span>
            ))}
          </div>
        </div>

        <div>
          <h1 className="text-white font-bold text-xl mb-1.5">{topic.title}</h1>
          <p className="text-gray-400 text-sm italic leading-relaxed mb-3">{topic.oneLiner}</p>
          <p className="text-gray-300 text-sm leading-relaxed">{topic.summary}</p>
        </div>

        <ul className="space-y-1.5">
          {topic.keyPoints.map((kp, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-gray-400 leading-relaxed">
              <span className="text-gray-600 shrink-0 mt-1">•</span>
              <span>{kp}</span>
            </li>
          ))}
        </ul>

        <LiveStat topic={topic} />

        {topic.linkTab && (
          <button
            onClick={() => onNavigate?.(topic.linkTab)}
            className="inline-flex items-center gap-1.5 bg-sky-900/25 border border-sky-800/50 hover:border-sky-600 text-sky-300 hover:text-sky-200 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
          >
            {topic.linkLabel} →
          </button>
        )}

        {children.length > 0 && (
          <div>
            <h3 className="text-white font-semibold text-sm mb-2">Go Deeper</h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {children.map(c => (
                <button
                  key={c.id}
                  onClick={() => goto(c.id)}
                  className="text-left bg-gray-900/60 border border-gray-800 hover:border-emerald-700/50 rounded-lg px-3 py-2.5 transition-colors"
                >
                  <div className="text-sm text-white font-medium mb-0.5">{c.title}</div>
                  <div className="text-xs text-gray-500 leading-snug">{c.oneLiner}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {related.length > 0 && (
          <div>
            <h3 className="text-white font-semibold text-sm mb-2">Related Concepts</h3>
            <div className="flex flex-wrap gap-2">
              {related.map(r => (
                <button
                  key={r.id}
                  onClick={() => goto(r.id)}
                  className="text-xs text-gray-400 hover:text-white bg-gray-900/60 border border-gray-800 hover:border-gray-600 rounded-full px-3 py-1.5 transition-colors"
                >
                  {LAYERS.find(l => l.id === r.layer).label} · {r.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {!topic.parentId && (
          <div className="text-gray-700 text-xs pt-4">
            This is the top of the {activeLayer.label} layer. Use "Go Deeper" above, or pick a related concept, to keep exploring.
          </div>
        )}
      </div>
    </div>
  )
}
