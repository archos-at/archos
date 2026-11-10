/**
 * @vitest-environment node
 *
 * `Idempotency-Key` on every door write (ADR-0170): one effect per key and
 * input, the same key with other input refused, a read untouched, a server
 * error not kept, and a cache that cannot be read failing CLOSED.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { type CacheStore, setCacheStore } from '@/lib/cache'
import type { AuthorizedSession } from '@/lib/auth/types'
import { oncePerKey } from './door-idempotency'
import type { OperationResult } from './dispatch'
import type { AgentOperation } from './operation'

const op = { name: 'platform-knowledge-change-request-create' } as AgentOperation
const session = { userId: 'user_1', organizationId: 'org_platform' } as AuthorizedSession

function memory(): CacheStore {
  const entries = new Map<string, string>()
  return {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => void entries.set(key, value),
    delete: async (key) => void entries.delete(key),
    deletePrefix: async () => undefined,
  }
}

const created = (id: string): OperationResult => ({ status: 201, ok: true, body: { id } })

afterEach(() => setCacheStore(memory()))

describe('oncePerKey', () => {
  it('runs a keyed write once and answers the repeat with the first result, marked replayed', async () => {
    setCacheStore(memory())
    const run = vi.fn(async () => created(`cr_${run.mock.calls.length}`))
    const input = { body: { title: 'Wien' }, idempotencyKey: 'k-1' }
    const first = await oncePerKey(op, input, session, false, run)
    const again = await oncePerKey(op, input, session, false, run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(again).toEqual({ ...first, replayed: true })
  })

  it('refuses the same key with other input (422), and runs nothing', async () => {
    setCacheStore(memory())
    const run = vi.fn(async () => created('cr_1'))
    await oncePerKey(op, { body: { title: 'Wien' }, idempotencyKey: 'k-1' }, session, false, run)
    const reused = await oncePerKey(op, { body: { title: 'Graz' }, idempotencyKey: 'k-1' }, session, false, run)
    expect(reused).toMatchObject({ status: 422, ok: false, body: { code: 'IDEMPOTENCY_KEY_REUSED' } })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keys by person: another person’s same key is their own (positive control)', async () => {
    setCacheStore(memory())
    const run = vi.fn(async () => created('cr'))
    await oncePerKey(op, { body: {}, idempotencyKey: 'k' }, session, false, run)
    await oncePerKey(op, { body: {}, idempotencyKey: 'k' }, { ...session, userId: 'user_2' }, false, run)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('runs a read and a call without a key every time, and does not keep a server error', async () => {
    setCacheStore(memory())
    const run = vi.fn(async () => ({ status: 503, ok: false, body: {} }))
    await oncePerKey(op, { idempotencyKey: 'k' }, session, true, run)
    await oncePerKey(op, {}, session, false, run)
    await oncePerKey(op, { idempotencyKey: 'k5' }, session, false, run)
    await oncePerKey(op, { idempotencyKey: 'k5' }, session, false, run)
    expect(run).toHaveBeenCalledTimes(4)
  })

  it('fails closed when the cache cannot be read: a keyed write is not run (503)', async () => {
    setCacheStore({ ...memory(), get: async () => Promise.reject(new Error('dragonfly down')) })
    const run = vi.fn(async () => created('cr'))
    const answer = await oncePerKey(op, { idempotencyKey: 'k' }, session, false, run)
    expect(answer).toMatchObject({ status: 503, body: { code: 'IDEMPOTENCY_UNAVAILABLE' } })
    expect(run).not.toHaveBeenCalled()
  })
})
