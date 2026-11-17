const formatters = new Map<string, Intl.DateTimeFormat>()

const formatterFor = (locale: string | undefined): Intl.DateTimeFormat => {
  const key = locale ?? ''
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
    formatters.set(key, formatter)
  }
  return formatter
}

export const formatTime = (date: Date | string, locale?: string): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  return formatterFor(locale).format(dateObj)
}
