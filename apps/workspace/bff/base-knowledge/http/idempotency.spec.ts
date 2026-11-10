/**
 * `Idempotency-Key` on the office's base-knowledge writes (ADR-0158): a repeat
 * with the same key and body answers what the first did and runs nothing; the
 * same key with another body is refused; no key runs every time.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { BadRequestError, UnprocessableError } from '@/lib/api/errors'
import { setCacheStore } from '@/lib/cache'
import { MapCacheStore } from '@/test-utils/cache-store'
import { IDEMPOTENCY_HEADER, forgetKeysFor, onceForKey } from './idempotency'

const request = (key?: string) =>
  new Request('http://localhost/api/base-knowledge', {
    method: 'POST',
    headers: key === undefined ? {} : { [IDEMPOTENCY_HEADER]: key },
  })

const call = (key: string | undefined, body: unknown, run: () => Promise<unknown>, organizationId = 'org-1') =>
  onceForKey({ request: request(key), organizationId, subject: 'doc-1', operation: 'base-knowledge-propose', body }, run)

beforeEach(() => setCacheStore(new MapCacheStore()))

describe('a write with an Idempotency-Key', () => {
  it('runs once for one key and body, and answers the repeat with the first answer', async () => {
    const run = vi.fn().mockResolvedValueOnce({ id: 'work_1' }).mockResolvedValueOnce({ id: 'work_2' })
    expect(await call('key-1', { documentId: 'doc-1' }, run)).toEqual({ id: 'work_1' })
    expect(await call('key-1', { documentId: 'doc-1' }, run)).toEqual({ id: 'work_1' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('refuses the same key with another body', async () => {
    await call('key-1', { documentId: 'doc-1' }, async () => ({ id: 'work_1' }))
    await expect(call('key-1', { documentId: 'doc-2' }, async () => ({ id: 'work_2' }))).rejects.toBeInstanceOf(UnprocessableError)
  })

  it('keeps one office’s key apart from another’s', async () => {
    const run = vi.fn(async () => ({ id: 'work' }))
    await call('key-1', { documentId: 'doc-1' }, run, 'org-1')
    await call('key-1', { documentId: 'doc-1' }, run, 'org-2')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('remembers no refusal: a failed first attempt can be retried with the same key', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce({ id: 'work_1' })
    await expect(call('key-1', { documentId: 'doc-1' }, run)).rejects.toThrow('db down')
    expect(await call('key-1', { documentId: 'doc-1' }, run)).toEqual({ id: 'work_1' })
  })

  it('forgets what it kept about a removed document, so a repeat runs again', async () => {
    const run = vi.fn().mockResolvedValueOnce({ id: 'work_1' }).mockResolvedValueOnce({ id: 'work_2' })
    await call('key-1', { documentId: 'doc-1' }, run)
    await forgetKeysFor('org-1', ['work_1', 'doc-1'])
    expect(await call('key-1', { documentId: 'doc-1' }, run)).toEqual({ id: 'work_2' })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('runs every time without a key, and refuses a malformed one', async () => {
    const run = vi.fn(async () => ({ id: 'work' }))
    await call(undefined, {}, run)
    await call(undefined, {}, run)
    expect(run).toHaveBeenCalledTimes(2)
    await expect(call('has space', {}, run)).rejects.toBeInstanceOf(BadRequestError)
    await expect(call('x'.repeat(256), {}, run)).rejects.toBeInstanceOf(BadRequestError)
  })
})
