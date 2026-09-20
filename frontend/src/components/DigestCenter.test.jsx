import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DigestCenter from './DigestCenter'

const SETTINGS = {
  timezone: 'America/New_York',
  daily_enabled: false, daily_time: '08:00', daily_weekdays_only: true,
  weekly_enabled: false, weekly_day: 6, weekly_time: '18:00', use_ai: true,
}
const STATUS = { channels: { telegram: false }, scheduler_running: true, ai_available: true, next_daily: null, next_weekly: null }

// Route table for the mocked fetch; each entry is a body or a function(init) → body | { status, body }.
function mockApi(routes) {
  const calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined })
    const handler = routes[`${method} ${url}`]
    if (handler === undefined) throw new Error(`unmocked ${method} ${url}`)
    const out = typeof handler === 'function' ? handler(init) : handler
    const { status = 200, body } = out && out.__resp ? out : { body: out }
    return { ok: status < 400, status, json: async () => body }
  })
  return calls
}
const resp = (status, body) => ({ __resp: true, status, body })

const base = (over = {}) => ({
  'GET /api/digest/settings': SETTINGS,
  'GET /api/digest/status': STATUS,
  'GET /api/digest/history': [],
  ...over,
})

beforeEach(() => vi.restoreAllMocks())
afterEach(() => { delete global.fetch })

describe('DigestCenter', () => {
  it('shows Telegram setup steps and disables sending when not configured', async () => {
    mockApi(base())
    render(<DigestCenter />)
    expect(await screen.findByText(/Telegram: not set up/)).toBeInTheDocument()
    expect(screen.getByText(/@BotFather/)).toBeInTheDocument()
    expect(screen.getByText(/TELEGRAM_BOT_TOKEN=123456/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send daily now' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send weekly now' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Preview daily' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Send test message' })).toBeNull()
  })

  it('shows connected state, enables sending, and sends a test message', async () => {
    const calls = mockApi(base({
      'GET /api/digest/status': { ...STATUS, channels: { telegram: true } },
      'POST /api/digest/test': { ok: true, channels: { telegram: { ok: true, error: null } } },
    }))
    render(<DigestCenter />)
    expect(await screen.findByText(/Telegram: connected/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send daily now' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Send test message' }))
    expect(await screen.findByText(/Test message sent/)).toBeInTheDocument()
    expect(calls.some(c => c.method === 'POST' && c.url === '/api/digest/test')).toBe(true)
  })

  it('surfaces a failed test message with the channel error', async () => {
    mockApi(base({
      'GET /api/digest/status': { ...STATUS, channels: { telegram: true } },
      'POST /api/digest/test': { ok: false, channels: { telegram: { ok: false, error: 'Bad Request: chat not found' } } },
    }))
    render(<DigestCenter />)
    fireEvent.click(await screen.findByRole('button', { name: 'Send test message' }))
    expect(await screen.findByText(/Test failed: Bad Request: chat not found/)).toBeInTheDocument()
  })

  it('saves only after editing, sending the full draft, and shows the next run', async () => {
    const saved = { ...SETTINGS, daily_enabled: true, daily_time: '07:30' }
    const calls = mockApi(base({
      'PUT /api/digest/settings': saved,
      'GET /api/digest/status': STATUS,
    }))
    render(<DigestCenter />)
    const save = await screen.findByRole('button', { name: 'Save schedule' })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Daily digest'))
    fireEvent.change(screen.getByLabelText('Daily time'), { target: { value: '07:30' } })
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    fireEvent.click(save)
    expect(await screen.findByText('Schedule saved.')).toBeInTheDocument()
    const put = calls.find(c => c.method === 'PUT')
    expect(put.body).toMatchObject({ daily_enabled: true, daily_time: '07:30', timezone: 'America/New_York', weekly_day: 6 })
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('shows the server validation message when saving is rejected', async () => {
    mockApi(base({ 'PUT /api/digest/settings': resp(422, { detail: [{ msg: 'Value error, unknown timezone' }] }) }))
    render(<DigestCenter />)
    fireEvent.change(await screen.findByLabelText('Timezone'), { target: { value: 'Mars/Olympus' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/unknown timezone/)).toBeInTheDocument()
  })

  it('previews a digest without sending it', async () => {
    const calls = mockApi(base({ 'POST /api/digest/preview': { digest: {}, text: 'Daily Digest — Mon Sep 21\n\nMarkets' } }))
    render(<DigestCenter />)
    fireEvent.click(await screen.findByRole('button', { name: 'Preview daily' }))
    await waitFor(() => expect(screen.getByTestId('digest-output')).toHaveTextContent('Daily Digest — Mon Sep 21'))
    expect(screen.getByText(/not sent/)).toBeInTheDocument()
    expect(calls.find(c => c.url === '/api/digest/preview').body).toEqual({ kind: 'daily' })
    expect(calls.some(c => c.url === '/api/digest/send')).toBe(false)
  })

  it('sends now, shows the result, and refreshes history', async () => {
    let history = []
    const calls = mockApi(base({
      'GET /api/digest/status': { ...STATUS, channels: { telegram: true } },
      'GET /api/digest/history': () => history,
      'POST /api/digest/send': () => {
        history = [{ id: 1, kind: 'weekly', trigger: 'manual', status: 'sent', attempts: 1, error: null, created_at: '2026-09-20T22:30:00Z' }]
        return { ...history[0], text: 'Weekly Digest — Sun Sep 20' }
      },
    }))
    render(<DigestCenter />)
    expect(await screen.findByText('Nothing sent yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send weekly now' }))
    expect(await screen.findByText('Digest sent.')).toBeInTheDocument()
    expect(screen.getByTestId('digest-output')).toHaveTextContent('Weekly Digest — Sun Sep 20')
    expect(calls.find(c => c.url === '/api/digest/send').body).toEqual({ kind: 'weekly' })
    expect(await screen.findByText('sent')).toBeInTheDocument()
  })

  it('reports a failed send instead of claiming success', async () => {
    mockApi(base({
      'GET /api/digest/status': { ...STATUS, channels: { telegram: true } },
      'POST /api/digest/send': { id: 2, kind: 'daily', status: 'failed', error: 'Bad Request: chat not found', text: 'Daily Digest' },
    }))
    render(<DigestCenter />)
    fireEvent.click(await screen.findByRole('button', { name: 'Send daily now' }))
    expect(await screen.findByText(/Send failed: Bad Request: chat not found/)).toBeInTheDocument()
    expect(screen.queryByText('Digest sent.')).toBeNull()
  })

  it('opens a past digest from history', async () => {
    mockApi(base({
      'GET /api/digest/history': [{ id: 7, kind: 'daily', trigger: 'scheduled', status: 'failed', attempts: 2, error: 'boom', created_at: '2026-09-21T12:00:00Z' }],
      'GET /api/digest/history/7': { id: 7, text: 'Old digest body' },
    }))
    render(<DigestCenter />)
    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(screen.getByText('attempt 2')).toBeInTheDocument()
    fireEvent.click(screen.getByText('boom'))
    await waitFor(() => expect(screen.getByTestId('digest-output')).toHaveTextContent('Old digest body'))
  })

  it('warns when no Anthropic key is configured', async () => {
    mockApi(base({ 'GET /api/digest/status': { ...STATUS, ai_available: false } }))
    render(<DigestCenter />)
    expect(await screen.findByText(/No ANTHROPIC_API_KEY is set/)).toBeInTheDocument()
  })

  it('shows an error state when the backend is unreachable', async () => {
    global.fetch = vi.fn(async () => { throw new Error('Failed to fetch') })
    render(<DigestCenter />)
    expect(await screen.findByText(/Couldn't load digest settings: Failed to fetch/)).toBeInTheDocument()
  })
})
