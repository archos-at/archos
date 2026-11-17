export const CLAUSE_JOIN = '\u00A0· '

export const formatEur = (value: number, locale?: string): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(value)

export const formatUsd = (
  value: number,
  locale?: string,
  options: { maximumFractionDigits?: number } = {}
): string => {
  const maximumFractionDigits = Math.max(2, options.maximumFractionDigits ?? 2)
  const format = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits,
  })
  const smallest = 10 ** -maximumFractionDigits
  if (value > 0 && value < smallest) return `< ${format.format(smallest)}`
  return format.format(value)
}

export const formatCount = (value: number, locale?: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0
  )

export const formatDate = (isoDate: string, locale?: string): string => {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return isoDate
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

export const formatDayRange = (from: string, to: string, locale?: string): string => {
  const start = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${from} – ${to}`
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatRange(start, end)
}

export const formatTokens = (value: number, locale?: string): string => {
  const safe = Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat(locale, {
    notation: Math.abs(safe) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(safe) >= 1000 ? 1 : 0,
  }).format(safe)
}

export const formatCredits = (value: number, locale?: string): string => {
  const safe = Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(safe) < 10 ? 1 : 0,
  }).format(safe)
}

export const formatBytes = (bytes: number | null | undefined, locale?: string): string => {
  const safe = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  const units: Array<{ unit: string; scale: number }> = [
    { unit: 'byte', scale: 1 },
    { unit: 'kilobyte', scale: 1e3 },
    { unit: 'megabyte', scale: 1e6 },
    { unit: 'gigabyte', scale: 1e9 },
    { unit: 'terabyte', scale: 1e12 },
  ]

  let chosen = units[0]
  for (const candidate of units) {
    if (safe >= candidate.scale) chosen = candidate
  }

  const value = safe / chosen.scale
  const fractionDigits = chosen.scale >= 1e6 && value < 1000 ? 1 : 0

  if (chosen.scale === 1) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} B`
  }

  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: chosen.unit,
    unitDisplay: 'short',
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export const formatByteProgress = (done: number, total: number, locale?: string): { done: string; total: string } => {
  const whole = formatBytes(total, locale)
  const scale = [1e12, 1e9, 1e6, 1e3].find((step) => total >= step) ?? 1
  const digits = scale >= 1e6 ? 1 : 0
  const number = (bytes: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.max(0, bytes) / scale)
  const unit = whole.replace(/^[\d\s.,\u00a0\u202f]+/u, '')
  return { done: number(done), total: `${number(total)}\u00a0${unit}` }
}

export const formatRelativeTime = (
  isoDate: string,
  locale?: string,
  now: number = Date.now(),
  style: Intl.RelativeTimeFormatStyle = 'long'
): string => {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return isoDate

  const diffMs = date.getTime() - now
  const diffSeconds = Math.round(diffMs / 1000)
  const absSeconds = Math.abs(diffSeconds)

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style })
  const numericRtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style })

  const thresholds: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [2592000, 'day'],
    [31536000, 'month'],
    [Infinity, 'year'],
  ]

  const divisors: Record<string, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000,
    quarter: 7776000,
  }

  for (const [limit, unit] of thresholds) {
    if (absSeconds < limit) {
      const divisor = divisors[unit]
      const value = Math.trunc(diffSeconds / divisor)
      if (unit === 'month' || unit === 'year') return numericRtf.format(value, unit)
      return rtf.format(value, unit)
    }
  }

  return rtf.format(Math.round(diffSeconds / divisors.year), 'year')
}

export const formatTimeOfDay = (isoDate: string, locale?: string): string => {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return isoDate

  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(date)
}

export const formatCalendarDate = (isoDate: string, locale?: string): string => {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return isoDate

  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

export const formatCalendarDay = (day: string, locale?: string): string => {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

export const formatAbsoluteTime = (isoDate: string, locale?: string, timeZone?: string): string => {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return isoDate

  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date)
}

export const formatDurationShort = (seconds: number, locale?: string): string => {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const unit: Intl.NumberFormatOptions['unit'] =
    safe < 60 ? 'second' : safe < 3600 ? 'minute' : 'hour'

  const value =
    unit === 'second'
      ? Math.max(5, Math.ceil(safe / 5) * 5)
      : unit === 'minute'
        ? Math.ceil(safe / 60)
        : safe / 3600

  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    minimumFractionDigits: 0,
    maximumFractionDigits: unit === 'hour' ? 1 : 0,
  }).format(value)
}

export const formatDurationElapsed = (seconds: number, locale?: string): string => {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const unit: Intl.NumberFormatOptions['unit'] =
    safe < 60 ? 'second' : safe < 3600 ? 'minute' : 'hour'
  const value =
    unit === 'second' ? Math.round(safe) : unit === 'minute' ? Math.round(safe / 60) : safe / 3600

  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    minimumFractionDigits: 0,
    maximumFractionDigits: unit === 'hour' ? 1 : 0,
  }).format(value)
}

export const formatTransferRate = (bytesPerSecond: number, locale?: string): string =>
  `${formatBytes(bytesPerSecond, locale)}/s`

export const localCalendarDay = (date: Date = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const OFFICE_TIME_ZONE = 'Europe/Vienna'

export const calendarDayIn = (timeZone: string, date: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(date)

export const addCalendarDays = (day: string, days: number): string => {
  const at = new Date(`${day}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}
