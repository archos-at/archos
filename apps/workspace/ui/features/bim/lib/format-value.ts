export function formatPropertyValue(
  value: string | number | boolean | null,
  locale: string
): string {
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein'
  if (typeof value === 'number') return (Math.round(value * 1000) / 1000).toLocaleString(locale)
  return value
}

export function formatMeasure(value: number | null, unit: string, locale: string): string {
  if (value === null) return '—'
  const rounded = Math.round(value * 100) / 100
  return `${rounded.toLocaleString(locale)} ${unit}`
}

export function formatMetresIn(metres: number, locale: string): string {
  return metres.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatDownloadProgress(
  loadedBytes: number,
  totalBytes: number,
  locale: string,
  of: (loaded: string, total: string) => string
): string {
  const megabytes = (bytes: number): string =>
    (bytes / 1_000_000).toLocaleString(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: bytes < 10_000_000 ? 1 : 0,
    })
  if (totalBytes <= 0) return `${megabytes(loadedBytes)} MB`
  return of(megabytes(loadedBytes), `${megabytes(totalBytes)} MB`)
}
