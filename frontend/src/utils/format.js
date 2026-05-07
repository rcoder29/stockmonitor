const num = (v, dp = 2) => (v == null ? '—' : v.toFixed(dp))

const price = (v) => (v == null ? '—' : `$${v.toFixed(2)}`)

const change = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`)

const pct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`)

const ratio = (v) => (v == null ? '—' : v.toFixed(2))

const abbrev = (v, prefix = '') => {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e12) return `${prefix}${(v / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${prefix}${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${prefix}${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${prefix}${(v / 1e3).toFixed(2)}K`
  return `${prefix}${v.toFixed(0)}`
}

const volume = (v) => abbrev(v)
const marketCap = (v) => abbrev(v, '$')

export const fmt = { num, price, change, pct, ratio, volume, marketCap }
