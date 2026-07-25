import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IndexHeatmap from './IndexHeatmap'

// Mock ChartModal so it doesn't need chart library in jsdom
vi.mock('./ChartModal', () => ({ default: ({ symbol, onClose }) => (
  <div data-testid="chart-modal">
    <span>{symbol}</span>
    <button onClick={onClose}>Close</button>
  </div>
)}))

const mockData = [
  { symbol: 'AAPL', name: 'Apple Inc.',    sector: 'Technology', indexWeight: 7.0, actualWeight: 7.2,
    marketCap: 3e12, price: 200.0, '1d': 1.5, '5d': 3.0, '1m': 5.0, '3m': 8.0, '6m': 12.0, '1y': 20.0, 'ytd': 15.0,
    wtContribution: 0.108 },
  { symbol: 'MSFT', name: 'Microsoft',     sector: 'Technology', indexWeight: 6.5, actualWeight: 6.8,
    marketCap: 2.8e12, price: 420.0, '1d': -0.5, '5d': 1.0, '1m': 2.0, '3m': 4.0, '6m': 8.0, '1y': 15.0, 'ytd': 10.0,
    wtContribution: -0.034 },
  { symbol: 'NVDA', name: 'NVIDIA',        sector: 'Technology', indexWeight: 5.0, actualWeight: 5.5,
    marketCap: 2.4e12, price: 130.0, '1d': 2.0, '5d': 5.0, '1m': 8.0, '3m': 15.0, '6m': 25.0, '1y': 50.0, 'ytd': 40.0,
    wtContribution: 0.110 },
]

function setupFetch(data = mockData) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setupFetch()
})

describe('IndexHeatmap', () => {
  it('shows loading skeleton on mount', () => {
    render(<IndexHeatmap />)
    // While loading, pulse placeholders should show
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('renders tile symbols after data loads', async () => {
    render(<IndexHeatmap />)
    await waitFor(() => expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0))
    expect(screen.getAllByText('MSFT').length).toBeGreaterThan(0)
    expect(screen.getAllByText('NVDA').length).toBeGreaterThan(0)
  })

  it('shows weight percentage on each tile', async () => {
    render(<IndexHeatmap />)
    await waitFor(() => screen.getByText('AAPL'))
    expect(screen.getByText('7.20%')).toBeInTheDocument()
  })

  it('shows 1D return on tile', async () => {
    render(<IndexHeatmap />)
    await waitFor(() => screen.getByText('AAPL'))
    expect(screen.getByText('+1.50%')).toBeInTheDocument()
  })

  it('shows index 1D return in summary bar', async () => {
    render(<IndexHeatmap />)
    await waitFor(() => screen.getByText('Index 1D Return'))
  })

  it('shows Top Contributor card', async () => {
    render(<IndexHeatmap />)
    await waitFor(() => screen.getByText('Top Contributor'))
  })

  it('shows Top Drag card', async () => {
    render(<IndexHeatmap />)
    await waitFor(() => screen.getByText('Top Drag'))
  })

  it('quick-select buttons render for predefined indices', async () => {
    render(<IndexHeatmap />)
    expect(screen.getByText('DIA')).toBeInTheDocument()
    expect(screen.getByText('QQQ')).toBeInTheDocument()
    expect(screen.getByText('SPY')).toBeInTheDocument()
    expect(screen.getByText('ARKK')).toBeInTheDocument()
  })

  it('switching to table view shows column headers', async () => {
    render(<IndexHeatmap />)
    await waitFor(() => screen.getAllByText('AAPL'))
    fireEvent.click(screen.getByText('≡ Table'))
    await waitFor(() => expect(screen.getByText('Symbol')).toBeInTheDocument())
    expect(screen.getByText('Wt %')).toBeInTheDocument()
  })

  it('clicking a tile opens chart modal', async () => {
    render(<IndexHeatmap />)
    await waitFor(() => screen.getByText('AAPL'))
    fireEvent.click(screen.getAllByText('AAPL')[0])
    await waitFor(() => expect(screen.getByTestId('chart-modal')).toBeInTheDocument())
  })

  it('closing chart modal removes it', async () => {
    render(<IndexHeatmap />)
    await waitFor(() => screen.getByText('AAPL'))
    fireEvent.click(screen.getAllByText('AAPL')[0])
    await waitFor(() => screen.getByTestId('chart-modal'))
    fireEvent.click(screen.getByText('Close'))
    expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
  })

  it('shows error message when fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    render(<IndexHeatmap />)
    await waitFor(() => expect(screen.getByText(/HTTP 500/i)).toBeInTheDocument())
  })

  it('search box renders', async () => {
    render(<IndexHeatmap />)
    expect(screen.getByPlaceholderText(/Search ETF/i)).toBeInTheDocument()
  })

  it('search input triggers fetch to search-etf endpoint', async () => {
    const user = userEvent.setup()
    // First call = constituents, subsequent calls = search
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => mockData })
      .mockResolvedValue({ ok: true, json: async () => [] })

    render(<IndexHeatmap />)
    await waitFor(() => screen.getByText('AAPL'))
    const input = screen.getByPlaceholderText(/Search ETF/i)
    await user.type(input, 'XLK')

    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => c[0])
      expect(calls.some(url => url.includes('search-etf'))).toBe(true)
    })
  })

  it('live weights indicator shown when actualWeight is present', async () => {
    render(<IndexHeatmap />)
    await waitFor(() => screen.getByText('AAPL'))
    expect(screen.getByText(/Live weights/i)).toBeInTheDocument()
  })

  it('shows constituent count', async () => {
    render(<IndexHeatmap />)
    await waitFor(() => screen.getByText(/3 constituents/i))
  })
})
