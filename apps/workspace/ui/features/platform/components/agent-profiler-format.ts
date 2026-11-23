export function formatSpanDuration(ms: number, locale: string): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
  const format = (
    value: number,
    unit: 'millisecond' | 'second' | 'minute',
    digits: number
  ): string =>
    new Intl.NumberFormat(locale, {
      style: 'unit',
      unit,
      unitDisplay: 'short',
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(value)
  if (safe < 1000) return format(Math.round(safe), 'millisecond', 0)
  if (safe < 60_000) return format(safe / 1000, 'second', safe < 10_000 ? 2 : 1)
  return format(safe / 60_000, 'minute', 1)
}
