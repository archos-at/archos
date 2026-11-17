const DEFAULT_SLOW_CALL_THRESHOLD_MS = 2000

function slowCallThresholdMs(): number {
  const raw = process.env.AUTHZ_SLOW_CALL_MS
  if (raw === undefined || raw === '') return DEFAULT_SLOW_CALL_THRESHOLD_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SLOW_CALL_THRESHOLD_MS
}

export async function timedWorkOSCall<T>(label: string, call: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    return await call()
  } finally {
    const durationMs = Date.now() - start
    const threshold = slowCallThresholdMs()
    if (threshold > 0 && durationMs >= threshold) {
      console.warn(`[WorkOS] slow call: ${label} took ${durationMs}ms (threshold ${threshold}ms)`)
    }
  }
}
