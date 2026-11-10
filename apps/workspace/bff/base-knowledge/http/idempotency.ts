/**
 * `Idempotency-Key` for the office's base-knowledge writes (ADR-0158, the
 * IETF httpapi draft's header; S10 extends it to every door operation). A
 * client that repeats a write with the same key and the same body gets the first
 * answer again instead of a second effect or a 409; the same key with another
 * body is refused (422), because the key was meant for the first request.
 *
 * Kept 24 hours in the shared cache, keyed by organization, operation and key.
 * The cache fails open: when it is down a repeat runs again, and the domain's
 * own guards (one entry per document, confirm once) answer it as they would
 * without a key. Two concurrent first attempts both run, for the same reason.
 */

import 'server-only'
import { createHash } from 'node:crypto'
import { BadRequestError, UnprocessableError } from '@/lib/api/errors'
import { getCached } from '@/lib/cache'

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'

/** How long a key answers for: a day, as the draft and the large APIs use. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/** A key is 1 to 255 visible ASCII characters (an RFC 8941 string's alphabet, without the quotes). */
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/

interface Stored<T> {
  fingerprint: string
  result: T
}

const fingerprintOf = (body: unknown): string => createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex')

/** The request's key, or null without one; a malformed key is refused. */
export function idempotencyKeyOf(request: Request): string | null {
  const raw = request.headers.get(IDEMPOTENCY_HEADER)
  if (raw === null) return null
  const key = raw.trim().replace(/^"(.*)"$/, '$1')
  if (!KEY_PATTERN.test(key)) throw new BadRequestError(`${IDEMPOTENCY_HEADER} must be 1 to 255 visible ASCII characters.`)
  return key
}

/** Run a write once per key: the first answer is kept and repeated for the same key and body. */
export async function onceForKey<T>(
  input: { request: Request; organizationId: string; operation: string; body: unknown },
  run: () => Promise<T>,
): Promise<T> {
  const key = idempotencyKeyOf(input.request)
  if (key === null) return run()
  const fingerprint = fingerprintOf(input.body)
  const stored = await getCached<Stored<T>>(
    `base-knowledge:idempotency:${input.organizationId}:${input.operation}:${key}`,
    IDEMPOTENCY_TTL_MS,
    async () => ({ fingerprint, result: await run() }),
  )
  if (stored.fingerprint !== fingerprint) {
    throw new UnprocessableError(`This ${IDEMPOTENCY_HEADER} was used for a different request; use a new key.`)
  }
  return stored.result
}
