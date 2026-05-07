import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Header from './Header'

const baseProps = {
  loading: false,
  error: null,
  lastUpdated: null,
  refreshInterval: 30,
  setRefreshInterval: vi.fn(),
  countdown: 28,
  onRefresh: vi.fn(),
  onAddTicker: vi.fn(),
}

beforeEach(() => vi.clearAllMocks())

describe('Header', () => {
  it('renders brand name', () => {
    render(<Header {...baseProps} />)
    expect(screen.getByText('STOCK MONITOR')).toBeInTheDocument()
  })

  it('calls onAddTicker with uppercased symbol on submit', async () => {
    const user = userEvent.setup()
    render(<Header {...baseProps} />)
    await user.type(screen.getByPlaceholderText('TICKER'), 'aapl')
    await user.click(screen.getByText('+ Add'))
    expect(baseProps.onAddTicker).toHaveBeenCalledWith('AAPL')
  })

  it('clears input after add', async () => {
    const user = userEvent.setup()
    render(<Header {...baseProps} />)
    const input = screen.getByPlaceholderText('TICKER')
    await user.type(input, 'MSFT')
    await user.click(screen.getByText('+ Add'))
    expect(input).toHaveValue('')
  })

  it('does not call onAddTicker for empty input', async () => {
    const user = userEvent.setup()
    render(<Header {...baseProps} />)
    await user.click(screen.getByText('+ Add'))
    expect(baseProps.onAddTicker).not.toHaveBeenCalled()
  })

  it('calls setRefreshInterval when interval button clicked', async () => {
    const user = userEvent.setup()
    render(<Header {...baseProps} />)
    await user.click(screen.getByText('5s'))
    expect(baseProps.setRefreshInterval).toHaveBeenCalledWith(5)
  })

  it('highlights the active refresh interval', () => {
    render(<Header {...baseProps} refreshInterval={60} />)
    const btn = screen.getByText('1m')
    expect(btn.className).toMatch(/emerald/)
  })

  it('calls onRefresh when refresh button clicked', async () => {
    const user = userEvent.setup()
    render(<Header {...baseProps} />)
    await user.click(screen.getByText('↻'))
    expect(baseProps.onRefresh).toHaveBeenCalled()
  })

  it('disables refresh button while loading', () => {
    render(<Header {...baseProps} loading={true} />)
    expect(screen.getByText('↻')).toBeDisabled()
  })

  it('shows fetching indicator while loading', () => {
    render(<Header {...baseProps} loading={true} />)
    expect(screen.getByText('● Fetching…')).toBeInTheDocument()
  })

  it('shows error message when error prop set', () => {
    render(<Header {...baseProps} error="Server error 500" />)
    expect(screen.getByText('⚠ Server error 500')).toBeInTheDocument()
  })

  it('shows Not yet loaded when no lastUpdated', () => {
    render(<Header {...baseProps} lastUpdated={null} />)
    expect(screen.getByText('Not yet loaded')).toBeInTheDocument()
  })

  it('shows updated time and countdown when lastUpdated set', () => {
    const ts = new Date('2026-05-06T10:30:00')
    render(<Header {...baseProps} lastUpdated={ts} countdown={28} />)
    expect(screen.getByText(/next in 28s/)).toBeInTheDocument()
  })
})
