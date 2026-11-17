const DEFAULT_MAX_ATTEMPTS = 3

export function maxAttempts(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.BFF_JOBS_MAX_ATTEMPTS ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_ATTEMPTS
}

export function isLastAttempt(attempts: number, env: Record<string, string | undefined> = process.env): boolean {
  return attempts >= maxAttempts(env)
}
