import { useState, useEffect, useCallback } from 'react'

const PRESET_TOPICS = [
  { key: 'sp500',          label: 'S&P 500' },
  { key: 'nasdaq',         label: 'Nasdaq' },
  { key: 'dowjones',       label: 'Dow Jones' },
  { key: 'tech',           label: 'Technology' },
  { key: 'financials',     label: 'Financials' },
  { key: 'healthcare',     label: 'Healthcare' },
  { key: 'energy',         label: 'Energy' },
  { key: 'consumer',       label: 'Consumer' },
  { key: 'industrials',    label: 'Industrials' },
  { key: 'realestate',     label: 'Real Estate' },
  { key: 'utilities',      label: 'Utilities' },
  { key: 'communications', label: 'Communications' },
  { key: 'materials',      label: 'Materials' },
  { key: 'rates',          label: 'Rates / Fed' },
  { key: 'gold',           label: 'Gold' },
  { key: 'oil',            label: 'Oil' },
  { key: 'crypto',         label: 'Crypto' },
]

const PRESET_KEYS = new Set(PRESET_TOPICS.map(p => p.key))
const LS_KEY = 'news_selected_topics'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function topicLabel(key) {
  const preset = PRESET_TOPICS.find(p => p.key === key)
  return preset ? preset.label : key.toUpperCase()
}

export default function CustomNews() {
  const [selectedTopics, setSelectedTopics] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY))
      return Array.isArray(saved) && saved.length ? saved : ['sp500', 'tech', 'rates']
    } catch {
      return ['sp500', 'tech', 'rates']
    }
  })
  const [customTicker, setCustomTicker] = useState('')
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [activeFilter, setActiveFilter] = useState('all')
  const [error, setError] = useState(null)

  const customTopics = selectedTopics.filter(t => !PRESET_KEYS.has(t))

  const fetchNews = useCallback(async () => {
    if (!selectedTopics.length) { setArticles([]); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/news-feed?topics=${selectedTopics.join(',')}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setArticles(data)
      setLastUpdated(new Date())
    } catch (e) {
      setError('Failed to load news. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [selectedTopics])

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(selectedTopics))
    fetchNews()
  }, [selectedTopics, fetchNews])

  function toggleTopic(key) {
    setSelectedTopics(prev =>
      prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]
    )
    if (activeFilter === key) setActiveFilter('all')
  }

  function addCustomTicker() {
    const t = customTicker.trim().toUpperCase()
    if (!t) return
    const key = t.toLowerCase()
    if (!selectedTopics.includes(key)) {
      setSelectedTopics(prev => [...prev, key])
    }
    setCustomTicker('')
  }

  function removeTicker(key) {
    setSelectedTopics(prev => prev.filter(t => t !== key))
    if (activeFilter === key) setActiveFilter('all')
  }

  const filteredArticles = activeFilter === 'all'
    ? articles
    : articles.filter(a => a.topic === activeFilter)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Customized News</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Select topics to follow — your picks are saved automatically
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-slate-500">
              Updated {timeAgo(lastUpdated.toISOString())}
            </span>
          )}
          <button
            onClick={fetchNews}
            disabled={loading}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Topic selector */}
      <div className="bg-slate-800 rounded-xl p-4 space-y-4">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Market Topics</p>
        <div className="flex flex-wrap gap-2">
          {PRESET_TOPICS.map(({ key, label }) => {
            const on = selectedTopics.includes(key)
            return (
              <button
                key={key}
                onClick={() => toggleTopic(key)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                  on
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-slate-700 border-slate-600 text-slate-300 hover:border-blue-500 hover:text-white'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Custom ticker input */}
        <div className="pt-2 border-t border-slate-700">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-2">Custom Tickers</p>
          <div className="flex gap-2 flex-wrap items-center">
            {customTopics.map(t => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-violet-600 rounded-full text-sm text-white font-medium"
              >
                {t.toUpperCase()}
                <button
                  onClick={() => removeTicker(t)}
                  className="ml-1 hover:text-red-300 transition-colors text-xs leading-none"
                >
                  ×
                </button>
              </span>
            ))}
            <div className="flex gap-2">
              <input
                type="text"
                value={customTicker}
                onChange={e => setCustomTicker(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && addCustomTicker()}
                placeholder="Add ticker (e.g. AAPL)"
                className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-44"
              />
              <button
                onClick={addCustomTicker}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white text-sm rounded-lg transition-colors"
              >
                + Add
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      {selectedTopics.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              activeFilter === 'all'
                ? 'bg-white text-slate-900'
                : 'bg-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            All ({articles.length})
          </button>
          {selectedTopics.map(key => {
            const count = articles.filter(a => a.topic === key).length
            return (
              <button
                key={key}
                onClick={() => setActiveFilter(activeFilter === key ? 'all' : key)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeFilter === key
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {topicLabel(key)} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* News feed */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading && articles.length === 0 && (
        <div className="text-center py-16 text-slate-500">Loading news…</div>
      )}

      {!loading && !error && selectedTopics.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          Select at least one topic above to see news.
        </div>
      )}

      {!loading && !error && selectedTopics.length > 0 && filteredArticles.length === 0 && (
        <div className="text-center py-16 text-slate-500">No articles found for this filter.</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredArticles.map((article, i) => (
          <a
            key={i}
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-blue-600 rounded-xl p-4 flex flex-col gap-2 transition-all group"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/60 text-blue-300 truncate max-w-[60%]">
                {topicLabel(article.topic)}
              </span>
              <span className="text-xs text-slate-500 shrink-0">{timeAgo(article.publishedAt)}</span>
            </div>

            <p className="text-sm font-semibold text-white leading-snug group-hover:text-blue-300 transition-colors line-clamp-3">
              {article.title}
            </p>

            <p className="text-xs text-slate-400 mt-auto">{article.publisher}</p>
          </a>
        ))}
      </div>
    </div>
  )
}
