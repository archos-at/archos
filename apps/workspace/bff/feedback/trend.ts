export interface FeedbackDayPoint {
  day: string
  up: number
  down: number
}

export interface FeedbackTrendDay {
  day: string
  total: number
  up: number
  rate: number | null
}

export function feedbackWindowStart(windowDays: number, now: Date = new Date()): Date {
  const days = Math.max(1, Math.floor(windowDays))
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)))
}

export const MIN_TREND_VOTES = 5

export function fillTrendWindow(
  points: readonly FeedbackDayPoint[],
  windowDays: number,
  minVotes: number = MIN_TREND_VOTES,
  now: Date = new Date(),
): FeedbackTrendDay[] {
  const byDay = new Map(points.map((p) => [p.day, p]))
  const out: FeedbackTrendDay[] = []
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const date = new Date(now)
    date.setUTCDate(date.getUTCDate() - i)
    const key = date.toISOString().slice(0, 10)
    const found = byDay.get(key)
    const up = found?.up ?? 0
    const total = found ? found.up + found.down : 0
    out.push({
      day: key,
      total,
      up,
      rate: total >= minVotes ? (up / total) * 100 : null,
    })
  }
  return out
}

function pooledRate(days: readonly FeedbackTrendDay[]): number | null {
  const total = days.reduce((sum, d) => sum + d.total, 0)
  if (total === 0) return null
  return (days.reduce((sum, d) => sum + d.up, 0) / total) * 100
}

export function feedbackTrendDelta(days: readonly FeedbackTrendDay[]): number | null {
  const readable = days.filter((d) => d.rate !== null)
  if (readable.length < 2) return null
  const third = Math.max(1, Math.floor(readable.length / 3))
  const early = pooledRate(readable.slice(0, third))
  const late = pooledRate(readable.slice(-third))
  return early === null || late === null ? null : late - early
}

export function feedbackTrendAverage(days: readonly FeedbackTrendDay[]): number {
  return pooledRate(days) ?? 0
}
