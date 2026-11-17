import 'server-only'
import { createHash } from 'node:crypto'
import { BadRequestError, UnprocessableError } from '@/lib/api/errors'
import { getCached, invalidateCachedPrefix } from '@/lib/cache'

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/

interface Stored<T> {
  fingerprint: string
  result: T
}

const fingerprintOf = (body: unknown): string => createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex')

export function idempotencyKeyOf(request: Request): string | null {
  const raw = request.headers.get(IDEMPOTENCY_HEADER)
  if (raw === null) return null
  const key = raw.trim().replace(/^"(.*)"$/, '$1')
  if (!KEY_PATTERN.test(key)) throw new BadRequestError(`${IDEMPOTENCY_HEADER} must be 1 to 255 visible ASCII characters.`)
  return key
}

const subjectPrefix = (organizationId: string, subject: string): string =>
  `base-knowledge:idempotency:${organizationId}:${subject}:`

export async function onceForKey<T>(
  input: { request: Request; organizationId: string; subject: string; operation: string; body: unknown },
  run: () => Promise<T>,
): Promise<T> {
  const key = idempotencyKeyOf(input.request)
  if (key === null) return run()
  const fingerprint = fingerprintOf(input.body)
  const stored = await getCached<Stored<T>>(
    `${subjectPrefix(input.organizationId, input.subject)}${input.operation}:${key}`,
    IDEMPOTENCY_TTL_MS,
    async () => ({ fingerprint, result: await run() }),
  )
  if (stored.fingerprint !== fingerprint) {
    throw new UnprocessableError(`This ${IDEMPOTENCY_HEADER} was used for a different request; use a new key.`)
  }
  return stored.result
}

export async function forgetKeysFor(organizationId: string, subjects: readonly string[]): Promise<boolean> {
  const dropped = await Promise.all(subjects.map((subject) => invalidateCachedPrefix(subjectPrefix(organizationId, subject))))
  return dropped.every(Boolean)
}
