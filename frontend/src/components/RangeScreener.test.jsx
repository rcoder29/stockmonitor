import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RangeScreener from './RangeScreener'

// Mock ChartModal so it doesn't need the chart library / a real fetch in jsdom (same pattern as IndexHeatmap.test.jsx).
vi.mock('./ChartModal', () => ({ default: ({ symbol, onClose }) => (
  <div data-testid="chart-modal">
    <span>Chart for {symbol}</span>
    <button onClick={onClose}>Close</button>
  </div>
)}))

// series1y deliberately swings wider than the window's own low/high, so tests
// can confirm the sparkline's y-scale is the 1-year range, not the window.
const ROW_A = {
  symbol: 'AAA', name: 'Acme Corp', price: 43.72, windowDays: 60,
  high: 52.99, low: 42.50, widthPct: 24.7, positionPct: 11.6,
  rangeScore: 99.6, touchesLow: 11, touchesHigh: 8, signal: 'near_support',
  entry: 43.72, target: 52.99, stop: 41.71, riskReward: 4.62,
  series1y: [60.0, 55.0, 50.0, 38.0, 42.0, 48.0, 44.5, 43.72],
}
const ROW_B = {
  symbol: 'BBB', name: null, price: 100.0, windowDays: 60,
  high: 110.0, low: 90.0, widthPct: 22.2, positionPct: 50.0,
  rangeScore: 40.0, touchesLow: 3, touchesHigh: 3, signal: 'neutral',
  entry: null, target: null, stop: null, riskReward: null,
  series1y: [85.0, 120.0, 95.0, 105.0, 100.0],
}

function mockFetchOnce(body, ok = true) {
  global.fetch = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }))
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => { delete global.fetch })

describe('RangeScreener', () => {
  it('runs an initial scan on mount with the default filters', async () => {
    mockFetchOnce([ROW_A, ROW_B])
    render(<RangeScreener />)
    expect(await screen.findByText('AAA')).toBeInTheDocument()
    const url = global.fetch.mock.calls[0][0]
    expect(url).toContain('/api/screener/range-bound?')
    expect(url).toContain('window=60')
    expect(url).toContain('min_score=70')
    expect(url).not.toContain('symbols=')
  })

  it('shows price, range, score, touches, and signal badge for each row', async () => {
    mockFetchOnce([ROW_A])
    render(<RangeScreener />)
    await screen.findByText('AAA')
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getAllByText('$43.72')).toHaveLength(2)        // price cell + entry cell
    expect(screen.getByText('$42.50')).toBeInTheDocument()
    expect(screen.getAllByText('$52.99')).toHaveLength(2)         // range-high cell + target cell
    expect(screen.getByText('24.7%')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()          // rounded rangeScore
    expect(screen.getByText('11 / 8')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Near support' })).toBeInTheDocument()
    expect(screen.getByText('4.62x')).toBeInTheDocument()
  })

  it('renders a 1-year inline sparkline, wider than the window, coloured by signal', async () => {
    mockFetchOnce([ROW_A])
    render(<RangeScreener />)
    await screen.findByText('AAA')
    const svg = document.querySelector('svg[aria-label*="1-year"]')
    expect(svg).toBeInTheDocument()
    expect(svg.getAttribute('aria-label')).toContain('$42.50')
    expect(svg.getAttribute('aria-label')).toContain('$52.99')
    const poly = svg.querySelector('polyline')
    expect(poly.getAttribute('points').split(' ')).toHaveLength(ROW_A.series1y.length)
    expect(poly.getAttribute('stroke')).toBe('#34d399')   // near_support -> green
    // both the window's low and high are drawn as dashed reference lines, since both sit inside the wider 1y range
    expect(svg.querySelectorAll('line[stroke-dasharray]')).toHaveLength(2)
    // last point of the line matches the last (most recent) close
    const lastPoint = poly.getAttribute('points').split(' ').pop()
    expect(svg.querySelector('circle').getAttribute('cx')).toBe(lastPoint.split(',')[0])
  })

  it('colours the sparkline red for near-resistance and grey for neutral', async () => {
    const nearRes = { ...ROW_A, symbol: 'CCC', signal: 'near_resistance' }
    mockFetchOnce([nearRes, ROW_B])
    render(<RangeScreener />)
    await screen.findByText('CCC')
    const polylines = document.querySelectorAll('polyline')
    expect(polylines[0].getAttribute('stroke')).toBe('#f87171')   // near_resistance -> red
    expect(polylines[1].getAttribute('stroke')).toBe('#9ca3af')   // neutral -> grey
  })

  it('shows a dash instead of a sparkline when the series is missing or too short, but stays clickable', async () => {
    mockFetchOnce([{ ...ROW_A, series1y: [50] }])
    render(<RangeScreener />)
    await screen.findByText('AAA')
    expect(document.querySelector('svg')).toBeNull()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getByTitle('Click to open the full chart')).toBeInTheDocument()
  })

  it('opens the full chart modal when a sparkline is clicked, and closes it', async () => {
    mockFetchOnce([ROW_A, ROW_B])
    render(<RangeScreener />)
    await screen.findByText('AAA')
    expect(screen.queryByTestId('chart-modal')).toBeNull()

    const charts = screen.getAllByTitle('Click to open the full chart')
    fireEvent.click(charts[1])   // BBB's row (second)
    expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
    expect(screen.getByText('Chart for BBB')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Close'))
    expect(screen.queryByTestId('chart-modal')).toBeNull()
  })

  it('the Chart column header is not sortable', async () => {
    mockFetchOnce([ROW_A, ROW_B])
    render(<RangeScreener />)
    await screen.findByText('AAA')
    const chartHeader = screen.getByText('Chart')
    expect(chartHeader.closest('th').className).not.toContain('cursor-pointer')
    const before = screen.getAllByRole('row').slice(1).map(r => r.textContent.slice(0, 3))
    fireEvent.click(chartHeader)
    expect(screen.getAllByRole('row').slice(1).map(r => r.textContent.slice(0, 3))).toEqual(before)
  })

  it('renders — for a neutral row with no trade levels', async () => {
    mockFetchOnce([ROW_B])
    render(<RangeScreener />)
    await screen.findByText('BBB')
    expect(screen.getByRole('cell', { name: 'Mid-range' })).toBeInTheDocument()
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(3)   // entry, target, stop all empty
  })

  it('shows the empty-results message distinctly from the loading and error states', async () => {
    mockFetchOnce([])
    render(<RangeScreener />)
    expect(await screen.findByText(/No names matched these filters/)).toBeInTheDocument()
  })

  it('shows an error message when the request fails', async () => {
    mockFetchOnce({}, false)
    render(<RangeScreener />)
    expect(await screen.findByText(/Error: Request failed \(500\)/)).toBeInTheDocument()
  })

  it('re-runs with updated filter values, including width/touches/score/signal', async () => {
    mockFetchOnce([ROW_A])
    render(<RangeScreener />)
    await screen.findByText('AAA')

    mockFetchOnce([ROW_A])
    const numberInputs = screen.getAllByRole('spinbutton')
    // Field order in the DOM: minWidth, maxWidth, minTouches, minScore
    fireEvent.change(numberInputs[0], { target: { value: '15' } })
    fireEvent.change(numberInputs[3], { target: { value: '80' } })
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: '30' } })     // window
    fireEvent.change(selects[1], { target: { value: 'near_support' } })   // signal
    fireEvent.change(screen.getByPlaceholderText(/e.g. AAPL/), { target: { value: 'aapl, msft' } })

    fireEvent.click(screen.getByRole('button', { name: 'Run screen' }))
    // mockFetchOnce above replaced global.fetch with a fresh mock, so this is its first call.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const url = global.fetch.mock.calls[0][0]
    expect(url).toContain('window=30')
    expect(url).toContain('min_width=15')
    expect(url).toContain('min_score=80')
    expect(url).toContain('signal=near_support')
    expect(url).toContain('symbols=aapl%2C+msft')
  })

  it('sorts by a clicked column, toggling direction on a second click', async () => {
    mockFetchOnce([ROW_A, ROW_B])
    render(<RangeScreener />)
    await screen.findByText('AAA')

    const symbolCells = () => screen.getAllByRole('row').slice(1).map(r => r.textContent.slice(0, 3))
    expect(symbolCells()).toEqual(['AAA', 'BBB'])   // default: rangeScore desc (99.6 before 40)

    fireEvent.click(screen.getByText('Symbol'))
    expect(symbolCells()).toEqual(['AAA', 'BBB'])   // symbol asc

    fireEvent.click(screen.getByText('Symbol'))
    expect(symbolCells()).toEqual(['BBB', 'AAA'])   // symbol desc
  })

  it('shows the loading state while a scan is in flight', async () => {
    let resolveFetch
    global.fetch = vi.fn(() => new Promise(res => { resolveFetch = res }))
    render(<RangeScreener />)
    expect(await screen.findByText(/Scanning the universe/)).toBeInTheDocument()
    resolveFetch({ ok: true, status: 200, json: async () => [] })
    await waitFor(() => expect(screen.queryByText(/Scanning the universe/)).toBeNull())
  })
})
