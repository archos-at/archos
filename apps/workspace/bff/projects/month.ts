import { z } from 'zod'

export type Month = `${number}-${number}`

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isMonth(value: string): value is Month {
  return MONTH.test(value)
}

export const monthSchema = z.string().refine((value): value is Month => isMonth(value), 'A month, YYYY-MM.')

export function monthToDate(month: Month): string {
  return `${month}-01`
}

export function dateToMonth(date: string | Date | null | undefined): Month | null {
  if (!date) return null
  const iso = typeof date === 'string' ? date : date.toISOString()
  const month = iso.slice(0, 7)
  return isMonth(month) ? month : null
}

export function currentMonth(now: Date = new Date(), timeZone = 'Europe/Vienna'): Month {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value ?? String(now.getUTCFullYear())
  const month = parts.find((part) => part.type === 'month')?.value ?? String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}` as Month
}

export function isOrderedPeriod(from: Month | null, to: Month | null): boolean {
  return from === null || to === null || from <= to
}
