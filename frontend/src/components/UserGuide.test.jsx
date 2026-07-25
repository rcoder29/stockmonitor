import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import UserGuide from './UserGuide'

describe('UserGuide', () => {
  it('renders the main heading', () => {
    render(<UserGuide />)
    expect(screen.getByText('Stock Monitor — User Guide')).toBeInTheDocument()
  })

  it('renders all 6 top-level nav group names in TOC', () => {
    render(<UserGuide />)
    // These appear in TOC and as section headings — use getAllByText
    expect(screen.getAllByText('Getting Started').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Markets').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Watchlist').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Portfolio').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Research').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Trading').length).toBeGreaterThan(0)
  })

  it('renders Changelog section', () => {
    render(<UserGuide />)
    expect(screen.getAllByText('Changelog').length).toBeGreaterThan(0)
  })

  it('Markets section covers correct items in nav table', () => {
    render(<UserGuide />)
    // Nav table row for Markets should mention these
    const content = document.body.textContent
    expect(content).toContain('Analyst Picks')
    expect(content).toContain('Index Heatmap')
    expect(content).toContain('Sector Rotation')
    expect(content).toContain('Sector Momentum')
  })

  it('Watchlist section mentions Smart Alerts', () => {
    render(<UserGuide />)
    expect(document.body.textContent).toContain('Smart Alerts')
  })

  it('search filters sections', () => {
    render(<UserGuide />)
    const input = screen.getByPlaceholderText('Search the guide…')
    fireEvent.change(input, { target: { value: 'heatmap' } })
    // Should show match count indicator
    expect(screen.getByText(/section.*match/i)).toBeInTheDocument()
  })

  it('search with no matches shows no results message', () => {
    render(<UserGuide />)
    const input = screen.getByPlaceholderText('Search the guide…')
    fireEvent.change(input, { target: { value: 'xyzzy_impossible_match' } })
    expect(screen.getByText(/No results for/i)).toBeInTheDocument()
  })

  it('changelog mentions navigation restructure', () => {
    render(<UserGuide />)
    expect(document.body.textContent).toContain('Navigation Restructure')
  })

  it('changelog mentions dynamic ETF search', () => {
    render(<UserGuide />)
    expect(document.body.textContent).toContain('Dynamic')
  })

  it('Index Heatmap section is documented', () => {
    render(<UserGuide />)
    expect(document.body.textContent).toContain('Index / ETF Heatmap')
  })

  it('Analyst Picks section is documented', () => {
    render(<UserGuide />)
    expect(document.body.textContent).toContain('Analyst Picks')
  })

  it('Sector Rotation docs appear in Markets section', () => {
    render(<UserGuide />)
    expect(document.body.textContent).toContain('Sector Rotation')
    expect(document.body.textContent).toContain('Sector Momentum')
  })

  it('Smart Alerts docs mention condition types', () => {
    render(<UserGuide />)
    expect(document.body.textContent).toContain('Volume Spike')
    expect(document.body.textContent).toContain('Golden Cross')
  })

  it('DCF section present under Research', () => {
    render(<UserGuide />)
    expect(document.body.textContent).toContain('DCF Valuation')
  })

  it('AI Chat section present', () => {
    render(<UserGuide />)
    expect(document.body.textContent).toContain('AI Chat')
  })
})
