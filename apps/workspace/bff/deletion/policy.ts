const DAY_MS = 24 * 60 * 60 * 1000

const MAX_GRACE_DAYS = 23
const DEFAULT_GRACE_DAYS = 7
const DEFAULT_FOLDER_GRACE_DAYS = 14

function graceDays(raw: string | undefined, fallback: number): number {
  const days = Number(raw)
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(days) || days < 0) return fallback
  return Math.min(days, MAX_GRACE_DAYS)
}

export function projectGraceDays(): number {
  return graceDays(process.env.PROJECT_PURGE_GRACE_DAYS, DEFAULT_GRACE_DAYS)
}

export function folderGraceDays(): number {
  return graceDays(process.env.FOLDER_PURGE_GRACE_DAYS, DEFAULT_FOLDER_GRACE_DAYS)
}

export function computePurgeAfter(requestedAt: Date, graceDays: number): Date {
  return new Date(requestedAt.getTime() + graceDays * DAY_MS)
}
