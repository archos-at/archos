/**
 * The office's wall clock, for the one sweep that runs at a set local time: the
 * Frist reminder, at 06:45 in Vienna, before the office's day starts.
 *
 * Hatchet crons are UTC, and 06:45 in Vienna is 05:45 UTC in winter and 04:45
 * UTC in summer, so no single UTC cron stays on 06:45 across a daylight-saving
 * change. The task therefore runs at minute 45 of every hour, and this says
 * which of those 24 runs is the office's 06:45. Vienna's offset is a whole
 * hour, so minute 45 UTC is minute 45 there too, and exactly one run a day
 * passes: 06:00 to 06:59 exists on every day of the year (the clocks change at
 * 02:00 and 03:00).
 */

export const OFFICE_TIME_ZONE = 'Europe/Vienna'
export const FRIST_REMINDER_HOUR = 6

/** The hour of `date` on the office's clock, 0 to 23. */
export function officeHourOf(date: Date): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: OFFICE_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(date)
  return Number(hour)
}

/** True for the one hourly run a day that is the office's Frist reminder. */
export function isFristReminderHour(now: Date): boolean {
  return officeHourOf(now) === FRIST_REMINDER_HOUR
}
