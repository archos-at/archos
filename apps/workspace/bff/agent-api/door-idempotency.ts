import 'server-only'
/**
 * `Idempotency-Key` for every operation on the door (ADR-0170, the IETF
 * httpapi draft's header; ADR-0163 built it for the office's base-knowledge
 * routes). An agent that repeats a write with the same key and the same input
 * gets the first answer again instead of a second effect; the same key with
 * another input is refused (422), because the key was meant for the first call.
 *
 * Held here, around the route call, so it covers every operation whatever its
 * route does; the header is forwarded too, so a route with its own key handling
 * (`bff/base-knowledge/http/idempotency.ts`) sees the same key.
 *
 * Kept 24 hours in the shared cache per organization, person, operation and
 * key. Unlike the office routes' helper it fails CLOSED: when the cache cannot
 * be read, a call that carries a key is not run (503), because the caller asked
 * for at most one effect and nothing can promise it. A server error (5xx) is not
 * kept, so a retry with the same key runs again. Two concurrent first attempts
 * both run: the store has no claim-then-fill, and the domain's own guards (the
 * natural keys of a proposal, a draft's lock) answer the second.
 */

import { createHash } from 'node:crypto'
import type { AuthorizedSession } from '@/lib/auth/types'
import { CacheUnavailableError, getCachedOrRefuse } from '@/lib/cache'
import type { OperationInput, OperationResult } from './dispatch'
import type { AgentOperation } from './operation'

/** The header a route reads; the door sends the agent's `idempotencyKey` as it. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key'

/** A key is 1 to 255 visible ASCII characters (an RFC 8941 string's alphabet, without the quotes). */
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/

/** How long a key answers for: a day, as the draft and the large APIs use. */
export const DOOR_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/** What an agent reads about the key, once, in the server's instructions and the guides. */
export const IDEMPOTENCY_KEY_DESCRIPTION =
  'Every write takes a top-level `idempotencyKey` (sent as Idempotency-Key): a fresh value (a UUID) per intended ' +
  'write. Repeating the call with the same key and input answers the first result and changes nothing; the same key ' +
  'with other input is refused (422).'

/**
 * The key in a write's input schema: bare, because a description or bounds on
 * every write would weigh on every tool listing; the dispatcher checks it
 * (1 to 255 visible ASCII characters) and the instructions describe it.
 */
export const IDEMPOTENCY_KEY_SCHEMA = { type: 'string' } as const

interface Kept {
  fingerprint: string
  result: OperationResult
}

const fingerprintOf = (input: OperationInput): string =>
  createHash('sha256')
    .update(JSON.stringify({ params: input.params ?? null, query: input.query ?? null, body: input.body ?? null }))
    .digest('hex')

/** A refusal as the route would have answered it: an RFC 9457 problem the door renders. */
function refusal(status: number, code: string, detail: string): OperationResult {
  return { status, ok: false, body: { error: detail, code } }
}

/**
 * Run `run` at most once per key for this person and operation. Without a key,
 * or for a read, it simply runs.
 */
export async function oncePerKey(
  op: AgentOperation,
  input: OperationInput,
  session: AuthorizedSession,
  readOnly: boolean,
  run: () => Promise<OperationResult>,
): Promise<OperationResult & { replayed?: true }> {
  const key = input.idempotencyKey
  if (key === undefined || readOnly) return run()
  const fingerprint = fingerprintOf(input)
  const cacheKey = `agent-door:idempotency:${session.organizationId}:${session.userId}:${op.name}:${key}`
  let ran = false
  let kept: Kept
  try {
    kept = await getCachedOrRefuse<Kept>(
      cacheKey,
      DOOR_IDEMPOTENCY_TTL_MS,
      async () => {
        ran = true
        return { fingerprint, result: await run() }
      },
      (value) => value.result.status < 500,
    )
  } catch (error) {
    if (!(error instanceof CacheUnavailableError)) throw error
    console.warn(`[mcp] ${op.name}: idempotency store unavailable; the keyed call was not run`)
    return refusal(
      503,
      'IDEMPOTENCY_UNAVAILABLE',
      `${IDEMPOTENCY_HEADER} cannot be honoured right now, so nothing was run. Retry later with the same key.`,
    )
  }
  if (kept.fingerprint !== fingerprint) {
    return refusal(422, 'IDEMPOTENCY_KEY_REUSED', `This ${IDEMPOTENCY_HEADER} was used for a different input; use a new key.`)
  }
  return ran ? kept.result : { ...kept.result, replayed: true }
}
