import { formatAbsoluteTime } from '@/lib/format'

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly'

export const SCHEDULE_FREQUENCIES: readonly ScheduleFrequency[] = [
  'hourly',
  'daily',
  'weekly',
  'monthly',
]

export interface CronParts {
  frequency: ScheduleFrequency
  minute: number
  hour: number
  weekdays: number[]
  monthDay: number
}

export const DEFAULT_CRON_PARTS: CronParts = {
  frequency: 'weekly',
  minute: 0,
  hour: 6,
  weekdays: [1],
  monthDay: 1,
}

export function buildCron(parts: CronParts): string {
  const minute = clamp(parts.minute, 0, 59)
  const hour = clamp(parts.hour, 0, 23)
  switch (parts.frequency) {
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly':
      return `${minute} ${hour} * * ${normalizeWeekdays(parts.weekdays).join(',')}`
    case 'monthly':
      return `${minute} ${hour} ${clamp(parts.monthDay, 1, 28)} * *`
  }
}

export function parseCronParts(cron: string | null | undefined): CronParts | null {
  if (!cron) return null
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields
  if (monthField !== '*') return null

  const minute = numberField(minuteField, 0, 59)
  if (minute === null) return null

  if (hourField === '*') {
    return dayField === '*' && weekdayField === '*'
      ? { ...DEFAULT_CRON_PARTS, frequency: 'hourly', minute }
      : null
  }

  const hour = numberField(hourField, 0, 23)
  if (hour === null) return null

  if (dayField === '*' && weekdayField === '*') {
    return { ...DEFAULT_CRON_PARTS, frequency: 'daily', minute, hour }
  }
  if (dayField === '*') {
    const weekdays = weekdayListField(weekdayField)
    return weekdays === null
      ? null
      : { ...DEFAULT_CRON_PARTS, frequency: 'weekly', minute, hour, weekdays }
  }
  if (weekdayField === '*') {
    const monthDay = numberField(dayField, 1, 28)
    return monthDay === null
      ? null
      : { ...DEFAULT_CRON_PARTS, frequency: 'monthly', minute, hour, monthDay }
  }
  return null
}

export function isPlausibleCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return false
  return fields.every((field) => /^[0-9*/,\-]+$/.test(field))
}

export function partsToTimeValue(parts: CronParts): string {
  return `${pad(clamp(parts.hour, 0, 23))}:${pad(clamp(parts.minute, 0, 59))}`
}

export function timeValueToParts(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function supportedTimezones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  if (typeof supported === 'function') {
    try {
      return supported('timeZone')
    } catch {
      /* fall through */
    }
  }
  return ['UTC', 'Europe/Vienna', 'Europe/Berlin', 'Europe/London', 'America/New_York']
}

export function weekdayName(weekday: number, locale: string, width: 'long' | 'short' = 'long'): string {
  const reference = new Date(Date.UTC(2024, 0, 7 + clamp(weekday, 0, 6)))
  return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' }).format(reference)
}

export function formatTimeOfDay(hour: number, minute: number, locale: string): string {
  const reference = new Date(Date.UTC(2024, 0, 1, clamp(hour, 0, 23), clamp(minute, 0, 59)))
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(reference)
}

type Translate = (key: string, values?: Record<string, string | number>) => string

export function scheduleSummary(
  t: Translate,
  cron: string | null,
  timezone: string,
  locale: string,
  options: { withTimezone?: boolean } = {},
): string {
  if (!cron) return t('list.manualOnly')
  const parts = parseCronParts(cron)
  const summary = parts ? describeParts(t, parts, locale) : t('schedule.summaryCustom', { cron })
  return options.withTimezone === false
    ? summary
    : t('schedule.inTimezone', { summary, timezone })
}

export function whenSummary(
  t: Translate,
  job: { scheduleCron: string | null; dueAt: string | null; scheduleTimezone: string },
  locale: string,
  options: { withTimezone?: boolean } = {},
): string {
  if (!job.scheduleCron && job.dueAt) {
    const at = formatAbsoluteTime(job.dueAt, locale)
    const summary = t('list.onceOn', { time: at })
    return options.withTimezone === false
      ? summary
      : t('schedule.inTimezone', { summary, timezone: job.scheduleTimezone })
  }
  return scheduleSummary(t, job.scheduleCron, job.scheduleTimezone, locale, options)
}

function describeParts(t: Translate, parts: CronParts, locale: string): string {
  const time = formatTimeOfDay(parts.hour, parts.minute, locale)
  switch (parts.frequency) {
    case 'hourly':
      return t('schedule.summaryHourly', { minute: pad(parts.minute) })
    case 'daily':
      return t('schedule.summaryDaily', { time })
    case 'weekly': {
      const days = normalizeWeekdays(parts.weekdays)
      if (days.length === 7) return t('schedule.summaryDaily', { time })
      if (isWeekdays(days)) return t('schedule.summaryWeekdays', { time })
      return t('schedule.summaryWeekly', {
        weekday: days.map((day) => weekdayName(day, locale, days.length > 2 ? 'short' : 'long')).join(', '),
        time,
      })
    }
    case 'monthly':
      return t('schedule.summaryMonthly', { day: parts.monthDay, time })
  }
}

function weekdayListField(field: string): number[] | null {
  const parts = field.split(',')
  const days: number[] = []
  for (const part of parts) {
    const value = numberField(part, 0, 6)
    if (value === null) return null
    if (!days.includes(value)) days.push(value)
  }
  return days.length > 0 ? days.sort((a, b) => a - b) : null
}

export function normalizeWeekdays(weekdays: readonly number[]): number[] {
  const days = [...new Set(weekdays.map((day) => clamp(day, 0, 6)))].sort((a, b) => a - b)
  return days.length > 0 ? days : [1]
}

function isWeekdays(days: readonly number[]): boolean {
  return days.length === 5 && days.every((day) => day >= 1 && day <= 5)
}

function numberField(field: string, min: number, max: number): number | null {
  if (!/^\d{1,2}$/.test(field)) return null
  const value = Number(field)
  return value >= min && value <= max ? value : null
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export const CADENCES = ['once', 'recurring', 'manual'] as const
export type Cadence = (typeof CADENCES)[number]

export function cadenceOf(job: { scheduleCron: string | null; dueAt: string | null }): Cadence {
  if (job.scheduleCron) return 'recurring'
  if (job.dueAt) return 'once'
  return 'manual'
}

export function toDateTimeLocal(instant: Date): string {
  if (Number.isNaN(instant.getTime())) return ''
  const date = `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`
  return `${date}T${pad(instant.getHours())}:${pad(instant.getMinutes())}`
}

export function defaultDueAt(now: Date = new Date()): Date {
  const due = new Date(now)
  due.setDate(due.getDate() + 1)
  due.setHours(9, 0, 0, 0)
  return due
}

export function toggleDay(weekdays: readonly number[], weekday: number): number[] {
  if (!weekdays.includes(weekday)) return [...weekdays, weekday].sort((a, b) => a - b)
  if (weekdays.length === 1) return [...weekdays]
  return weekdays.filter((day) => day !== weekday)
}
