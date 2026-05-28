import { useState, useRef } from 'react'

function renderMarkdown(text) {
  const lines = text.split('\n')
  const out = []
  let key = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('## ')) {
      out.push(
        <h2 key={key++} className="text-white font-bold text-base mt-5 mb-1 border-b border-gray-800 pb-1">
          {line.slice(3)}
        </h2>
      )
    } else if (line.trim() === '---') {
      out.push(<hr key={key++} className="border-gray-800 my-4" />)
    } else if (line.trim() === '') {
      out.push(<div key={key++} className="h-1" />)
    } else {
      // Inline **bold** parsing
      const parts = line.split(/(\*\*[^*]+\*\*)/)
      const rendered = parts.map((p, j) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return <strong key={j} className="text-white font-semibold">{p.slice(2, -2)}</strong>
        }
        return <span key={j}>{p}</span>
      })
      out.push(
        <p key={key++} className="text-gray-300 text-sm leading-relaxed">
          {rendered}
        </p>
      )
    }
  }
  return out
}

export default function TradeIdeas({ watchlist, quotes, alerts }) {
  const [content,  setContent]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const abortRef = useRef(null)

  async function generate() {
    if (loading) {
      abortRef.current?.abort()
      return
    }
    setContent(''); setError(null); setLoading(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch('/api/trade-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchlist, quotes: quotes || {}, alerts: alerts || [] }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop()
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          try {
            const msg = JSON.parse(part.slice(6))
            if (msg.text)  setContent(prev => prev + msg.text)
            if (msg.done)  break
            if (msg.error) throw new Error(msg.error)
          } catch {}
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-gray-500 text-xs uppercase tracking-widest">Claude Trade Ideas</div>
          <div className="text-gray-600 text-xs mt-0.5">{watchlist.length} symbols · {(alerts || []).length} active alerts</div>
        </div>
        <button
          onClick={generate}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            loading
              ? 'bg-red-700 hover:bg-red-600 text-white'
              : 'bg-violet-600 hover:bg-violet-500 text-white'
          }`}
        >
          {loading ? '■ Stop' : '✦ Generate Ideas'}
        </button>
      </div>

      {error && (
        <div className="text-red-400 text-sm py-2">{error}</div>
      )}

      {loading && !content && (
        <div className="py-10 text-center text-gray-500 text-sm animate-pulse">
          Analyzing watchlist and generating trade ideas…
        </div>
      )}

      {content && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5 space-y-0.5">
          {renderMarkdown(content)}
          {loading && (
            <span className="inline-block w-1.5 h-4 bg-violet-400 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
      )}

      {!content && !loading && !error && (
        <div className="py-10 text-center text-gray-700 text-sm">
          Click "Generate Ideas" to get Claude's take on your current watchlist.
        </div>
      )}

      <div className="text-gray-700 text-xs">AI-generated. Not investment advice. Always do your own research.</div>
    </div>
  )
}
