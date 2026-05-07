import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StockTable from './StockTable'

const mockQuote = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  price: 287.51,
  change: 5.11,
  changePercent: 1.81,
  dayHigh: 288.03,
  dayLow: 281.08,
  volume: 58_322_453,
  week52High: 288.62,
  week52Low: 193.25,
  marketCap: 4.22e12,
  peRatio: 34.77,
  forwardPE: 30.04,
  eps: 8.27,
  dividendYield: 0.0038,
  beta: 1.065,
  priceToBook: 47.93,
  revenue: 4.51e11,
  profitMargin: 0.272,
  roe: 1.41,
  debtToEquity: 79.55,
  error: null,
}

const baseProps = {
  watchlist: ['AAPL'],
  quotes: { AAPL: mockQuote },
  priceFlash: {},
  onRemove: vi.fn(),
}

beforeEach(() => vi.clearAllMocks())

describe('StockTable', () => {
  it('shows empty state when watchlist is empty', () => {
    render(<StockTable {...baseProps} watchlist={[]} quotes={{}} />)
    expect(screen.getByText(/Add a ticker above/)).toBeInTheDocument()
  })

  it('renders ticker symbol', () => {
    render(<StockTable {...baseProps} />)
    expect(screen.getByText('AAPL')).toBeInTheDocument()
  })

  it('renders company name', () => {
    render(<StockTable {...baseProps} />)
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument()
  })

  it('renders price', () => {
    render(<StockTable {...baseProps} />)
    expect(screen.getByText('$287.51')).toBeInTheDocument()
  })

  it('shows Loading… when quote not yet fetched', () => {
    render(<StockTable {...baseProps} quotes={{}} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows Error when quote has error field', () => {
    const errQuote = { symbol: 'BAD', error: 'delisted', price: null }
    render(<StockTable {...baseProps} watchlist={['BAD']} quotes={{ BAD: errQuote }} />)
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('clicking row expands fundamentals panel', async () => {
    const user = userEvent.setup()
    render(<StockTable {...baseProps} />)
    await user.click(screen.getByText('AAPL'))
    expect(screen.getByText('Fundamentals')).toBeInTheDocument()
  })

  it('clicking expanded row collapses it', async () => {
    const user = userEvent.setup()
    render(<StockTable {...baseProps} />)
    const row = screen.getByText('AAPL').closest('tr')
    await user.click(row)
    await user.click(row)
    expect(screen.queryByText('Fundamentals')).not.toBeInTheDocument()
  })

  it('does not show fundamentals for error quotes', async () => {
    const user = userEvent.setup()
    const errQuote = { symbol: 'BAD', error: 'delisted', price: null }
    render(<StockTable {...baseProps} watchlist={['BAD']} quotes={{ BAD: errQuote }} />)
    const row = screen.getByText('BAD').closest('tr')
    await user.click(row)
    expect(screen.queryByText('Fundamentals')).not.toBeInTheDocument()
  })

  it('calls onRemove with symbol when × clicked', async () => {
    const user = userEvent.setup()
    render(<StockTable {...baseProps} />)
    await user.click(screen.getByTitle('Remove'))
    expect(baseProps.onRemove).toHaveBeenCalledWith('AAPL')
  })

  it('remove button click does not toggle expand', async () => {
    const user = userEvent.setup()
    render(<StockTable {...baseProps} />)
    await user.click(screen.getByTitle('Remove'))
    expect(screen.queryByText('Fundamentals')).not.toBeInTheDocument()
  })

  it('applies emerald flash class when priceFlash is up', () => {
    render(<StockTable {...baseProps} priceFlash={{ AAPL: 'up' }} />)
    const rows = document.querySelectorAll('tbody tr')
    expect(rows[0].className).toMatch(/emerald/)
  })

  it('applies red flash class when priceFlash is down', () => {
    render(<StockTable {...baseProps} priceFlash={{ AAPL: 'down' }} />)
    const rows = document.querySelectorAll('tbody tr')
    expect(rows[0].className).toMatch(/red/)
  })

  it('renders multiple tickers in watchlist order', () => {
    const quotes = {
      AAPL: { ...mockQuote, symbol: 'AAPL' },
      MSFT: { ...mockQuote, symbol: 'MSFT', name: 'Microsoft' },
    }
    render(<StockTable {...baseProps} watchlist={['MSFT', 'AAPL']} quotes={quotes} />)
    const rows = document.querySelectorAll('tbody tr')
    expect(rows[0].textContent).toMatch(/MSFT/)
    expect(rows[1].textContent).toMatch(/AAPL/)
  })
})
