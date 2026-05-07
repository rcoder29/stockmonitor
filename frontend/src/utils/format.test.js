import { describe, it, expect } from 'vitest'
import { fmt } from './format'

describe('fmt.price', () => {
  it('returns — for null', () => expect(fmt.price(null)).toBe('—'))
  it('returns — for undefined', () => expect(fmt.price(undefined)).toBe('—'))
  it('formats positive', () => expect(fmt.price(150.5)).toBe('$150.50'))
  it('formats zero', () => expect(fmt.price(0)).toBe('$0.00'))
  it('formats integer', () => expect(fmt.price(200)).toBe('$200.00'))
})

describe('fmt.change', () => {
  it('returns — for null', () => expect(fmt.change(null)).toBe('—'))
  it('prefixes positive with +', () => expect(fmt.change(2.5)).toBe('+2.50'))
  it('prefixes negative with -', () => expect(fmt.change(-1.25)).toBe('-1.25'))
  it('formats zero as +', () => expect(fmt.change(0)).toBe('+0.00'))
})

describe('fmt.pct', () => {
  it('returns — for null', () => expect(fmt.pct(null)).toBe('—'))
  it('formats positive with % suffix', () => expect(fmt.pct(1.5)).toBe('+1.50%'))
  it('formats negative', () => expect(fmt.pct(-0.75)).toBe('-0.75%'))
  it('formats zero as +', () => expect(fmt.pct(0)).toBe('+0.00%'))
})

describe('fmt.num', () => {
  it('returns — for null', () => expect(fmt.num(null)).toBe('—'))
  it('defaults to 2 decimal places', () => expect(fmt.num(3.14159)).toBe('3.14'))
  it('respects custom dp', () => expect(fmt.num(3.14159, 4)).toBe('3.1416'))
})

describe('fmt.ratio', () => {
  it('returns — for null', () => expect(fmt.ratio(null)).toBe('—'))
  it('formats to 2dp', () => expect(fmt.ratio(25.678)).toBe('25.68'))
})

describe('fmt.abbrev (via volume / marketCap)', () => {
  it('returns — for null', () => expect(fmt.volume(null)).toBe('—'))
  it('formats thousands', () => expect(fmt.volume(5_000)).toBe('5.00K'))
  it('formats millions', () => expect(fmt.volume(3_500_000)).toBe('3.50M'))
  it('formats billions', () => expect(fmt.volume(2_100_000_000)).toBe('2.10B'))
  it('formats trillions', () => expect(fmt.marketCap(1_500_000_000_000)).toBe('$1.50T'))
  it('adds $ prefix for marketCap', () => expect(fmt.marketCap(5_000_000_000)).toBe('$5.00B'))
  it('handles negative values', () => expect(fmt.volume(-2_000_000)).toBe('-2.00M'))
  it('formats small numbers without suffix', () => expect(fmt.volume(999)).toBe('999'))
})
