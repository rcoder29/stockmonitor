import { useState, useEffect, useMemo, useRef } from 'react'

function scoreItem(item, q) {
  const label = item.label.toLowerCase()
  const group = item.group.toLowerCase()
  if (label === q) return 100
  if (label.startsWith(q)) return 80
  if (label.includes(q)) return 60
  if (group.startsWith(q)) return 40
  if (group.includes(q)) return 20
  return -1
}

export default function CommandPalette({ open, onClose, items, recents = [], onNavigate }) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlight(0)
      // Focus after the modal has actually mounted
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const recentItems = useMemo(() => {
    const byId = Object.fromEntries(items.map(i => [i.id, i]))
    return recents.map(id => byId[id]).filter(Boolean)
  }, [items, recents])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return recentItems
    return items
      .map(item => ({ item, score: scoreItem(item, q) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
      .slice(0, 30)
      .map(x => x.item)
  }, [items, query, recentItems])

  useEffect(() => { setHighlight(0) }, [results.length, query])

  useEffect(() => {
    listRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  if (!open) return null

  function select(item) {
    if (!item) return
    onNavigate(item.id)
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => (results.length ? (h + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => (results.length ? (h - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      select(results[highlight])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[12vh] px-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-800">
          <svg viewBox="0 0 16 16" className="w-4 h-4 text-gray-500 shrink-0" fill="currentColor">
            <path d="M11.2 10.1a5.5 5.5 0 10-1.1 1.1l3.1 3.1 1.1-1.1-3.1-3.1zm-4.7.9a4 4 0 110-8 4 4 0 010 8z"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Jump to any tool…"
            className="flex-1 bg-transparent text-white placeholder-gray-600 text-sm focus:outline-none"
          />
          <kbd className="text-[10px] text-gray-600 border border-gray-700 rounded px-1.5 py-0.5">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto py-1.5">
          {!query && recentItems.length > 0 && (
            <div className="px-4 pt-1 pb-1 text-[10px] text-gray-600 uppercase tracking-widest">Recent</div>
          )}
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-600 text-sm">
              {query ? `No tools match "${query}"` : 'Start typing to search 90+ tools…'}
            </div>
          )}
          {results.map((item, i) => (
            <button
              key={item.id}
              data-highlighted={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => select(item)}
              className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left transition-colors ${
                i === highlight ? 'bg-emerald-900/30 text-white' : 'text-gray-300 hover:bg-gray-800/60'
              }`}
            >
              <span className="text-sm truncate">{item.label}</span>
              <span className="text-[11px] text-gray-600 shrink-0">{item.group}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-800 text-[10px] text-gray-600">
          <span className="flex items-center gap-1"><kbd className="border border-gray-700 rounded px-1">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="border border-gray-700 rounded px-1">↵</kbd> open</span>
        </div>
      </div>
    </div>
  )
}
