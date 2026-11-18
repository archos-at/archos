import 'server-only'

import { createHash } from 'node:crypto'
import type { AuthorizedSession } from '@/lib/auth/types'
import { CacheUnavailableError, getCachedOrRefuse } from '@/lib/cache'
import type { OperationInput, OperationResult } from './dispatch'
import type { AgentOperation } from './operation'

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'

export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/

export const DOOR_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

export const IDEMPOTENCY_KEY_DESCRIPTION =
  'Every write takes a top-level `idempotencyKey` (sent as Idempotency-Key): a fresh value (a UUID) per intended ' +
  'write. Repeating the call with the same key and input answers the first result and changes nothing; the same key ' +
  'with other input is refused (422).'

export const IDEMPOTENCY_KEY_SCHEMA = { type: 'string' } as const

interface Kept {
  fingerprint: string
  result: OperationResult
}

const fingerprintOf = (input: OperationInput): string =>
  createHash('sha256')
    .update(JSON.stringify({ params: input.params ?? null, query: input.query ?? null, body: input.body ?? null }))
    .digest('hex')

const DETERMINISTIC_REFUSALS: ReadonlySet<number> = new Set([400, 404, 422])
export const keptStatus = (status: number): boolean => (status >= 200 && status < 300) || DETERMINISTIC_REFUSALS.has(status)

function refusal(status: number, code: string, detail: string): OperationResult {
  return { status, ok: false, body: { error: detail, code } }
}

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
      (value) => keptStatus(value.result.status),
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
