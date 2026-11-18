export const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000

export interface ResumableSession {
  id: string
  updatedAt: Date | string | number
  messages: readonly unknown[]
}

const timeOf = (value: Date | string | number): number => {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
}

export function resumableSessionId(
  sessions: readonly ResumableSession[],
  now: number = Date.now(),
  windowMs: number = RESUME_WINDOW_MS
): string | null {
  let newest: ResumableSession | null = null
  let newestAt = Number.NEGATIVE_INFINITY
  for (const session of sessions) {
    const at = timeOf(session.updatedAt)
    if (at > newestAt) {
      newestAt = at
      newest = session
    }
  }
  if (!newest || newest.messages.length === 0) return null

  const age = Math.max(0, now - newestAt)
  return age <= windowMs ? newest.id : null
}
