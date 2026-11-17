export function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function decimalsOf(value: number): number {
  const text = String(value)
  if (text.includes('e')) return 0
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

export function decimal(value: number, minDigits: number): string {
  return value.toFixed(Math.max(minDigits, decimalsOf(value))).replace('.', ',')
}

export function measure(
  value: number,
  satisfies: (candidate: number) => boolean,
  digits = 2,
  maxDigits = 5
): string {
  const truth = satisfies(value)
  for (let d = digits; d < maxDigits; d += 1) {
    if (satisfies(round(value, d)) === truth) return decimal(round(value, d), digits)
  }
  return decimal(round(value, maxDigits), digits)
}
