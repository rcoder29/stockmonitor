import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import FundamentalsPanel from './FundamentalsPanel'

const fullQuote = {
  peRatio: 34.77,
  forwardPE: 30.04,
  eps: 8.27,
  dividendYield: 0.0038,
  beta: 1.065,
  priceToBook: 47.93,
  revenue: 451_442_016_256,
  profitMargin: 0.27152,
  roe: 1.4147,
  debtToEquity: 79.548,
}

describe('FundamentalsPanel', () => {
  it('renders all 10 metric labels', () => {
    render(<FundamentalsPanel quote={fullQuote} />)
    expect(screen.getByText('P/E (TTM)')).toBeInTheDocument()
    expect(screen.getByText('P/E (Fwd)')).toBeInTheDocument()
    expect(screen.getByText('EPS (TTM)')).toBeInTheDocument()
    expect(screen.getByText('Div Yield')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('P/B Ratio')).toBeInTheDocument()
    expect(screen.getByText('Revenue (TTM)')).toBeInTheDocument()
    expect(screen.getByText('Profit Margin')).toBeInTheDocument()
    expect(screen.getByText('ROE')).toBeInTheDocument()
    expect(screen.getByText('Debt / Equity')).toBeInTheDocument()
  })

  it('formats EPS with $ prefix', () => {
    render(<FundamentalsPanel quote={fullQuote} />)
    expect(screen.getByText('$8.27')).toBeInTheDocument()
  })

  it('formats dividend yield as percentage', () => {
    render(<FundamentalsPanel quote={fullQuote} />)
    expect(screen.getByText('0.38%')).toBeInTheDocument()
  })

  it('formats profit margin as percentage', () => {
    render(<FundamentalsPanel quote={fullQuote} />)
    expect(screen.getByText('27.2%')).toBeInTheDocument()
  })

  it('formats ROE as percentage', () => {
    render(<FundamentalsPanel quote={fullQuote} />)
    expect(screen.getByText('141.5%')).toBeInTheDocument()
  })

  it('shows — for null metric values', () => {
    render(<FundamentalsPanel quote={{ ...fullQuote, peRatio: null, eps: null }} />)
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  it('handles all-null quote without crashing', () => {
    const empty = Object.fromEntries(Object.keys(fullQuote).map((k) => [k, null]))
    expect(() => render(<FundamentalsPanel quote={empty} />)).not.toThrow()
  })
})
