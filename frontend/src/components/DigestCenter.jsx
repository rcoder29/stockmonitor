import { useCallback, useEffect, useState } from 'react'

// AI Tools → Digests. Configure, preview, send, and review the daily/weekly
// digests. The digest itself is built and delivered by the backend scheduler;
// this tab only manages settings and shows what was (or would be) sent.

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const COMMON_ZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
]
const STATUS_STYLE = {
  sent:    'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
  failed:  'bg-red-900/40 text-red-300 border-red-700/50',
  pending: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  })
  let body = null
  try { body = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    const d = body?.detail
    const msg = Array.isArray(d) ? d.map(e => e.msg).join('; ') : d
    throw new Error(msg || `Request failed (${res.status})`)
  }
  return body
}

function formatWhen(iso, timeZone) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    })
  } catch {
    return iso
  }
}

function Card({ title, children, right }) {
  return (
    <section className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-semibold text-sm">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

function Toggle({ label, checked, onChange, id }) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
      <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-emerald-500 w-4 h-4" />
      {label}
    </label>
  )
}

const inputCls = 'bg-gray-800 border border-gray-700 text-white rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-sky-600'
const btnCls = 'text-xs font-medium rounded-lg px-3 py-2 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const btnPrimary = `${btnCls} bg-emerald-900/30 border-emerald-700/60 text-emerald-300 hover:border-emerald-500`
const btnGhost = `${btnCls} bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white`

export default function DigestCenter() {
  const [settings, setSettings] = useState(null)
  const [draft, setDraft] = useState(null)
  const [status, setStatus] = useState(null)
  const [history, setHistory] = useState([])
  const [output, setOutput] = useState(null)        // { title, text }
  const [busy, setBusy] = useState(null)            // 'save' | 'test' | 'preview:daily' | 'send:weekly' ...
  const [notice, setNotice] = useState(null)        // { ok, msg }
  const [loadError, setLoadError] = useState(null)

  const refreshStatus = useCallback(async () => setStatus(await api('/api/digest/status')), [])
  const refreshHistory = useCallback(async () => setHistory(await api('/api/digest/history')), [])

  useEffect(() => {
    let cancelled = false
    Promise.all([api('/api/digest/settings'), api('/api/digest/status'), api('/api/digest/history')])
      .then(([s, st, h]) => {
        if (cancelled) return
        setSettings(s); setDraft(s); setStatus(st); setHistory(h)
      })
      .catch(e => { if (!cancelled) setLoadError(e.message) })
    return () => { cancelled = true }
  }, [])

  // Run an async action with a busy flag and a success/failure notice.
  async function run(key, action) {
    setBusy(key); setNotice(null)
    try {
      await action()
    } catch (e) {
      setNotice({ ok: false, msg: e.message })
    } finally {
      setBusy(null)
    }
  }

  const set = (patch) => setDraft(d => ({ ...d, ...patch }))
  const dirty = settings && draft && JSON.stringify(settings) !== JSON.stringify(draft)
  const telegramReady = !!status?.channels?.telegram

  const save = () => run('save', async () => {
    const saved = await api('/api/digest/settings', { method: 'PUT', body: JSON.stringify(draft) })
    setSettings(saved); setDraft(saved)
    await refreshStatus()
    setNotice({ ok: true, msg: 'Schedule saved.' })
  })

  const sendTest = () => run('test', async () => {
    const r = await api('/api/digest/test', { method: 'POST' })
    const err = Object.values(r.channels).find(c => !c.ok)?.error
    setNotice(r.ok ? { ok: true, msg: 'Test message sent — check Telegram.' } : { ok: false, msg: `Test failed: ${err || 'unknown error'}` })
  })

  const preview = (kind) => run(`preview:${kind}`, async () => {
    const r = await api('/api/digest/preview', { method: 'POST', body: JSON.stringify({ kind }) })
    setOutput({ title: `Preview — ${kind} digest (not sent)`, text: r.text })
  })

  const sendNow = (kind) => run(`send:${kind}`, async () => {
    const r = await api('/api/digest/send', { method: 'POST', body: JSON.stringify({ kind }) })
    setOutput({ title: `Sent — ${kind} digest`, text: r.text })
    setNotice(r.status === 'sent' ? { ok: true, msg: 'Digest sent.' } : { ok: false, msg: `Send failed: ${r.error || 'unknown error'}` })
    await refreshHistory()
  })

  const openHistory = (row) => run(`log:${row.id}`, async () => {
    const r = await api(`/api/digest/history/${row.id}`)
    setOutput({ title: `${row.kind} digest — ${new Date(row.created_at).toLocaleString()}`, text: r.text || '(no content recorded)' })
  })

  if (loadError) {
    return <div className="p-6 text-sm text-red-400">Couldn't load digest settings: {loadError}</div>
  }
  if (!draft || !status) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-5 space-y-4">
        <div>
          <h1 className="text-white font-bold text-xl mb-1">Digests</h1>
          <p className="text-gray-500 text-sm">
            A pre-market daily digest and a weekly recap of your markets, portfolio, watchlist, upcoming events, and alerts — sent to your phone on a schedule.
          </p>
        </div>

        {notice && (
          <div role="status" className={`text-sm rounded-lg px-3 py-2 border ${notice.ok ? 'bg-emerald-900/20 border-emerald-800/50 text-emerald-300' : 'bg-red-900/20 border-red-800/50 text-red-300'}`}>
            {notice.msg}
          </div>
        )}

        <Card
          title="Delivery"
          right={
            <span className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 border ${telegramReady ? STATUS_STYLE.sent : STATUS_STYLE.pending}`}>
              Telegram: {telegramReady ? 'connected' : 'not set up'}
            </span>
          }
        >
          {telegramReady ? (
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm text-gray-400 flex-1 min-w-48">Digests are delivered to your Telegram chat.</p>
              <button className={btnGhost} disabled={busy === 'test'} onClick={sendTest}>
                {busy === 'test' ? 'Sending…' : 'Send test message'}
              </button>
            </div>
          ) : (
            <div className="text-sm text-gray-400 space-y-2">
              <p>Nothing is sent until a delivery channel is set up. Telegram takes about two minutes:</p>
              <ol className="list-decimal ml-5 space-y-1 text-gray-400">
                <li>In Telegram, message <span className="text-white">@BotFather</span>, send <code className="text-emerald-300">/newbot</code>, and copy the bot token it gives you.</li>
                <li>Send any message to your new bot, then open <code className="text-emerald-300">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> and copy the number at <code className="text-emerald-300">chat → id</code>.</li>
                <li>Add both to <code className="text-emerald-300">backend/.env</code> and restart the backend:
                  <pre className="mt-1 bg-gray-950 border border-gray-800 rounded-md px-3 py-2 text-xs text-gray-300 overflow-x-auto">{'TELEGRAM_BOT_TOKEN=123456:ABC...\nTELEGRAM_CHAT_ID=123456789'}</pre>
                </li>
              </ol>
            </div>
          )}
        </Card>

        <Card
          title="Schedule"
          right={
            <span className={`text-[11px] ${status.scheduler_running ? 'text-emerald-400' : 'text-gray-500'}`}>
              {status.scheduler_running ? '● Scheduler running' : '○ Scheduler off'}
            </span>
          }
        >
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-gray-300 flex-wrap">
              Timezone
              <input
                aria-label="Timezone" list="digest-zones" value={draft.timezone}
                onChange={e => set({ timezone: e.target.value })} className={`${inputCls} w-56`}
              />
              <datalist id="digest-zones">{COMMON_ZONES.map(z => <option key={z} value={z} />)}</datalist>
            </label>

            <div className="border-t border-gray-800 pt-3 flex items-center gap-x-5 gap-y-2 flex-wrap">
              <Toggle id="daily-on" label="Daily digest" checked={draft.daily_enabled} onChange={v => set({ daily_enabled: v })} />
              <label className="flex items-center gap-2 text-sm text-gray-400">
                at <input aria-label="Daily time" type="time" value={draft.daily_time} onChange={e => set({ daily_time: e.target.value })} className={inputCls} />
              </label>
              <Toggle id="weekdays" label="Weekdays only" checked={draft.daily_weekdays_only} onChange={v => set({ daily_weekdays_only: v })} />
              <span className="text-xs text-gray-600 ml-auto">Next: {formatWhen(status.next_daily, settings.timezone)}</span>
            </div>

            <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
              <Toggle id="weekly-on" label="Weekly digest" checked={draft.weekly_enabled} onChange={v => set({ weekly_enabled: v })} />
              <label className="flex items-center gap-2 text-sm text-gray-400">
                on
                <select aria-label="Weekly day" value={draft.weekly_day} onChange={e => set({ weekly_day: Number(e.target.value) })} className={inputCls}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
                at <input aria-label="Weekly time" type="time" value={draft.weekly_time} onChange={e => set({ weekly_time: e.target.value })} className={inputCls} />
              </label>
              <span className="text-xs text-gray-600 ml-auto">Next: {formatWhen(status.next_weekly, settings.timezone)}</span>
            </div>

            <div className="border-t border-gray-800 pt-3">
              <Toggle id="use-ai" label="Add an AI-written summary at the top" checked={draft.use_ai} onChange={v => set({ use_ai: v })} />
              <p className="text-xs text-gray-600 mt-1 ml-6">
                {status.ai_available
                  ? 'Uses your Anthropic API key. If the key is rejected or the call fails, the digest is sent without it.'
                  : 'No ANTHROPIC_API_KEY is set, so the digest will be sent without a summary.'}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button className={btnPrimary} disabled={!dirty || busy === 'save'} onClick={save}>
                {busy === 'save' ? 'Saving…' : 'Save schedule'}
              </button>
              {dirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
            </div>
            <p className="text-xs text-gray-600">
              Digests are sent by the backend, so it needs to be running. If it was off at the scheduled time, a daily digest still goes out when the backend starts within 6 hours of it, and a weekly one the same day.
            </p>
          </div>
        </Card>

        <Card title="Preview & send">
          <div className="flex gap-2 flex-wrap">
            {['daily', 'weekly'].map(kind => (
              <button key={`p${kind}`} className={btnGhost} disabled={!!busy} onClick={() => preview(kind)}>
                {busy === `preview:${kind}` ? 'Building…' : `Preview ${kind}`}
              </button>
            ))}
            {['daily', 'weekly'].map(kind => (
              <button
                key={`s${kind}`} className={btnPrimary} disabled={!!busy || !telegramReady}
                title={telegramReady ? undefined : 'Set up Telegram first'} onClick={() => sendNow(kind)}
              >
                {busy === `send:${kind}` ? 'Sending…' : `Send ${kind} now`}
              </button>
            ))}
          </div>
          {busy?.startsWith('preview') || busy?.startsWith('send') ? (
            <p className="text-xs text-gray-500 mt-3">Collecting live data — the first run can take up to a minute; later ones are a few seconds.</p>
          ) : null}
          {output && (
            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-1">{output.title}</div>
              <pre data-testid="digest-output" className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed max-h-[28rem] overflow-y-auto">{output.text}</pre>
            </div>
          )}
        </Card>

        <Card title="History">
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing sent yet.</p>
          ) : (
            <div className="divide-y divide-gray-800">
              {history.map(row => (
                <button
                  key={row.id} onClick={() => openHistory(row)}
                  className="w-full text-left flex items-center gap-3 py-2 text-xs hover:bg-gray-800/40 px-1 rounded"
                >
                  <span className="text-gray-400 w-40 shrink-0">{new Date(row.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  <span className="text-white capitalize w-14 shrink-0">{row.kind}</span>
                  <span className="text-gray-500 w-20 shrink-0">{row.trigger}</span>
                  <span className={`border rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[row.status] || STATUS_STYLE.pending}`}>{row.status}</span>
                  {row.attempts > 1 && <span className="text-gray-600">attempt {row.attempts}</span>}
                  {row.error && <span className="text-red-400 truncate">{row.error}</span>}
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
