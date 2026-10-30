// Exact, non-negative decimal arithmetic in the caller's currency minor units.
// No currency, country, industry, permissions or current master lookups here.
export type DecimalInput = string | number | { toString(): string }
type Decimal = { n: bigint; scale: number }
const ten = (scale: number) => BigInt(10) ** BigInt(scale)
function decimal(value: DecimalInput): Decimal {
  const text = String(value).trim()
  const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (!match || text.length > 1000) throw new RangeError('Enter a finite non-negative decimal.')
  const exponent = Number(match[3] || 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) throw new RangeError('Decimal exponent is outside the supported range.')
  let n = BigInt(match[1] + (match[2] || '')), scale = (match[2]?.length || 0) - exponent
  if (scale < 0) { n *= ten(-scale); scale = 0 }
  if (scale > 400) throw new RangeError('Decimal precision is outside the supported range.')
  while (scale && n % BigInt(10) === BigInt(0)) { n /= BigInt(10); scale-- }
  return { n, scale }
}
function text({ n, scale }: Decimal): string {
  if (!scale) return String(n)
  const s = String(n).padStart(scale + 1, '0')
  return (s.slice(0, -scale) + '.' + s.slice(-scale)).replace(/\.?0+$/, '')
}
export const decimalText = (value: DecimalInput) => text(decimal(value))
export function isDirectoryRate(value: DecimalInput): boolean {
  try { const d = decimal(value); return d.scale <= 12 && d.n <= BigInt(100) * ten(d.scale) } catch { return false }
}
function minor(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Minor units must be a non-negative safe integer.')
  return BigInt(value)
}
function number(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(0)) throw new RangeError('Calculated amount exceeds the supported limit.')
  return Number(value)
}
const rounded = (n: bigint, d: bigint) => (n + d / BigInt(2)) / d
export function sumRates(values: readonly DecimalInput[]): string {
  const all = values.map(decimal), scale = all.reduce((max,d)=>Math.max(max,d.scale),0)
  return decimalText(text({ n: all.reduce((sum, d) => sum + d.n * ten(scale - d.scale), BigInt(0)), scale }))
}
export function percentageMinor(baseMinor: number, percent: DecimalInput): number {
  const d = decimal(percent)
  return number(rounded(minor(baseMinor) * d.n, BigInt(100) * ten(d.scale)))
}
export function inclusiveTaxMinor(grossMinor: number, rates: readonly DecimalInput[]): number {
  const d = decimal(sumRates(rates)), denominator = BigInt(100) * ten(d.scale), gross = minor(grossMinor)
  return number(gross - rounded(gross * denominator, denominator + d.n))
}
// Largest remainders; equal remainders retain input order. The allocated total
// is exact, including fractional component weights and very small percentages.
export function allocateMinor(totalMinor: number, weights: readonly DecimalInput[]): number[] {
  const total = minor(totalMinor), all = weights.map(decimal), scale = all.reduce((max,d)=>Math.max(max,d.scale),0)
  const integers = all.map(d => d.n * ten(scale - d.scale)), sum = integers.reduce((s, n) => s + n, BigInt(0))
  if (!sum) { if (total) throw new RangeError('Positive allocations require positive weights.'); return all.map(() => 0) }
  const shares = integers.map(n => total * n / sum), order = integers.map((n, i) => ({ i, remainder: total * n % sum })).sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1)
  let remainder = total - shares.reduce((s, n) => s + n, BigInt(0))
  for (const entry of order) { if (!remainder) break; shares[entry.i]++; remainder-- }
  return shares.map(number)
}
