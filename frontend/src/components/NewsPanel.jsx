import { useState, useEffect } from 'react'

export default function NewsPanel({ symbol }) {
  const [articles, setArticles] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/news/${symbol}`)
      .then(r => { if (!r.ok) throw new Error(`Server error ${r.status}`); return r.json() })
      .then(data => { if (!cancelled) { setArticles(data); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [symbol])

  if (loading) return (
    <div className="py-8 text-center text-gray-500 text-sm animate-pulse">Loading news…</div>
  )
  if (error) return (
    <div className="py-8 text-center text-red-400 text-sm">{error}</div>
  )
  if (!articles || articles.length === 0) return (
    <div className="py-8 text-center text-gray-500 text-sm">No news available</div>
  )

  return (
    <div className="py-1 space-y-2">
      <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">Latest News</div>
      {articles.map((a, i) => (
        <a
          key={i}
          href={a.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-gray-800/60 border border-gray-700/40 rounded-lg px-4 py-3 hover:bg-gray-800 hover:border-gray-600 transition-colors group"
        >
          <div className="text-white text-sm font-medium leading-snug group-hover:text-sky-300 transition-colors">
            {a.title}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            {a.publisher && (
              <span className="text-gray-500 text-xs">{a.publisher}</span>
            )}
            {a.publisher && a.publishedAt && (
              <span className="text-gray-700 text-xs">·</span>
            )}
            {a.publishedAt && (
              <span className="text-gray-600 text-xs">
                {new Date(a.publishedAt).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric'
                })}
              </span>
            )}
            <span className="ml-auto text-gray-700 text-xs group-hover:text-sky-600 transition-colors">↗</span>
          </div>
        </a>
      ))}
    </div>
  )
}
