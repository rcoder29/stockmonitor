import { useState, useRef, useEffect, useCallback } from 'react'

const SUGGESTED = [
  'What are the best AI infrastructure stocks to buy right now?',
  'Explain the current macro environment and its impact on equities.',
  'What technical indicators should I watch for a breakout trade?',
  'How do I evaluate a stock using a DCF model?',
  'Compare growth vs value investing in a high-interest-rate environment.',
  'What sectors typically outperform during a Fed rate-cut cycle?',
  'Explain options strategies for hedging a long equity portfolio.',
  'What are the key risks to watch in the market this quarter?',
]

function renderMarkdown(text) {
  // Bold
  let html = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-700 text-emerald-300 px-1 rounded text-sm font-mono">$1</code>')
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-white mt-3 mb-1">$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-white mt-4 mb-1">$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-white mt-4 mb-2">$1</h1>')
  // Bullet lists — group consecutive bullet lines into <ul>
  html = html.replace(/((?:^[-•*] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(line =>
      `<li class="ml-4 list-disc">${line.replace(/^[-•*] /, '')}</li>`
    ).join('')
    return `<ul class="my-1 space-y-0.5">${items}</ul>`
  })
  // Numbered lists
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(line =>
      `<li class="ml-4 list-decimal">${line.replace(/^\d+\. /, '')}</li>`
    ).join('')
    return `<ol class="my-1 space-y-0.5">${items}</ol>`
  })
  // Paragraph breaks
  html = html.replace(/\n{2,}/g, '</p><p class="mt-2">')
  html = `<p>${html}</p>`
  return html
}

function Message({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
        isUser ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white'
      }`}>
        {isUser ? 'You' : 'AI'}
      </div>
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
        isUser
          ? 'bg-emerald-700/40 text-gray-100 rounded-tr-sm'
          : 'bg-gray-800 text-gray-100 rounded-tl-sm'
      }`}>
        {isUser
          ? <p>{msg.content}</p>
          : <div
              className="prose-invert"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
            />
        }
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 bg-indigo-600 text-white">AI</div>
      <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center">
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}

export default function AiBot() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  const send = useCallback(async (text) => {
    const trimmed = (text || input).trim()
    if (!trimmed || streaming) return

    setInput('')
    setError(null)

    const userMsg = { role: 'user', content: trimmed }
    const history = [...messages, userMsg]
    setMessages(history)
    setStreaming(true)

    // Placeholder for assistant response we'll stream into
    const assistantIndex = history.length
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      })

      if (!res.ok) throw new Error(`Server error ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (!payload) continue
          try {
            const evt = JSON.parse(payload)
            if (evt.error) { setError(evt.error); break }
            if (evt.done) break
            if (evt.text) {
              setMessages(prev => {
                const updated = [...prev]
                updated[assistantIndex] = {
                  ...updated[assistantIndex],
                  content: updated[assistantIndex].content + evt.text,
                }
                return updated
              })
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setStreaming(false)
      abortRef.current = null
      inputRef.current?.focus()
    }
  }, [input, messages, streaming])

  const stop = () => {
    abortRef.current?.abort()
    setStreaming(false)
  }

  const clear = () => {
    if (streaming) stop()
    setMessages([])
    setError(null)
    setInput('')
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex flex-col h-[calc(100vh-108px)]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 bg-gray-900/60">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-sm font-medium text-gray-200">AI Financial Advisor</span>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">claude-sonnet-4-6</span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clear}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear chat
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div>
              <div className="text-4xl mb-3">📈</div>
              <h2 className="text-lg font-semibold text-gray-200 mb-1">Ask me anything about markets</h2>
              <p className="text-sm text-gray-500 max-w-md">
                Get analysis on stocks, sectors, macro trends, trading strategies, and more.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
              {SUGGESTED.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="text-left text-xs text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-xl px-3 py-2.5 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <Message key={i} msg={msg} />
        ))}

        {streaming && messages[messages.length - 1]?.content === '' && (
          <TypingIndicator />
        )}

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggested follow-ups — only when there are messages and not streaming */}
      {!isEmpty && !streaming && (
        <div className="px-4 pb-1 flex gap-2 flex-wrap">
          {SUGGESTED.slice(0, 3).map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full px-3 py-1 transition-colors truncate max-w-xs"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="p-4 border-t border-gray-800 bg-gray-900/40">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about stocks, markets, trading strategies…"
            rows={1}
            disabled={streaming}
            className="flex-1 bg-gray-800 border border-gray-700 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 outline-none resize-none transition-colors disabled:opacity-60"
            style={{ minHeight: '44px', maxHeight: '120px' }}
            onInput={(e) => {
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
          />
          {streaming ? (
            <button
              onClick={stop}
              className="bg-red-600 hover:bg-red-500 text-white rounded-xl px-4 py-3 text-sm font-medium transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!input.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl px-4 py-3 text-sm font-medium transition-colors"
            >
              Send
            </button>
          )}
        </div>
        <p className="text-xs text-gray-600 mt-1.5 px-1">
          For informational purposes only — not personalized financial advice.
          Press <kbd className="text-gray-500">Enter</kbd> to send, <kbd className="text-gray-500">Shift+Enter</kbd> for newline.
        </p>
      </div>
    </div>
  )
}
