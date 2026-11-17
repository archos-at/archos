import { CronExpressionParser } from 'cron-parser'
import { BadRequestError } from '@/lib/api/errors'

export const DEFAULT_MIN_INTERVAL_MINUTES = 15

export function minIntervalMinutesFromEnv(): number {
  const raw = Number.parseInt(process.env.SKILL_MIN_INTERVAL_MINUTES ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MIN_INTERVAL_MINUTES
}

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function isFiveFieldCron(expr: string): boolean {
  return expr.trim().split(/\s+/).length === 5
}

export function isValidCronExpression(expr: string, tz = 'UTC'): boolean {
  if (!isFiveFieldCron(expr)) return false
  try {
    CronExpressionParser.parse(expr, { tz: isValidTimezone(tz) ? tz : 'UTC' })
    return true
  } catch {
    return false
  }
}

export function nextOccurrence(expr: string, tz: string, after: Date): Date {
  const interval = CronExpressionParser.parse(expr, { tz, currentDate: after })
  let next = interval.next().toDate()
  while (next.getTime() <= after.getTime()) {
    next = interval.next().toDate()
  }
  return next
}

export function validateCron(
  expr: string,
  tz: string,
  minIntervalMinutes: number = minIntervalMinutesFromEnv()
): void {
  if (!isFiveFieldCron(expr)) {
    throw new BadRequestError(
      'Cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week).'
    )
  }
  if (!isValidTimezone(tz)) {
    throw new BadRequestError(`Unknown timezone: ${tz}`)
  }

  let interval: ReturnType<typeof CronExpressionParser.parse>
  try {
    interval = CronExpressionParser.parse(expr, { tz, currentDate: new Date() })
  } catch (err) {
    throw new BadRequestError(`Invalid cron expression: ${(err as Error).message}`)
  }

  const minMs = minIntervalMinutes * 60_000
  let prev = interval.next().toDate()
  for (let i = 0; i < 6; i += 1) {
    const current = interval.next().toDate()
    if (current.getTime() - prev.getTime() < minMs) {
      throw new BadRequestError(
        `Schedule fires more frequently than the minimum interval of ${minIntervalMinutes} minutes.`
      )
    }
    prev = current
  }
}

export const MAX_DUE_AT_AHEAD_MS = 2 * 365 * 24 * 60 * 60 * 1000

export function validateDueAt(dueAt: Date, now: Date = new Date()): void {
  if (Number.isNaN(dueAt.getTime())) {
    throw new BadRequestError('Due date is not a valid date and time.')
  }
  if (dueAt.getTime() <= now.getTime()) {
    throw new BadRequestError('A one-off task must be due in the future.')
  }
  if (dueAt.getTime() - now.getTime() > MAX_DUE_AT_AHEAD_MS) {
    throw new BadRequestError('A one-off task must be due within the next two years.')
  }
}
