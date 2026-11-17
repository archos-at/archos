/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectedRow = vi.hoisted(() => ({ current: null as unknown }))
const updateSpy = vi.hoisted(() => vi.fn())
const transactionSpy = vi.hoisted(() => vi.fn())
const lockSpy = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            for: async (mode: string) => {
              lockSpy(mode)
              return selectedRow.current ? [selectedRow.current] : []
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSpy(values)
        return { where: () => ({ returning: async () => [{ id: 'm1', ...values }] }) }
      },
    }),
  }
  return {
    getDb: () => ({
      transaction: <T,>(fn: (t: typeof tx) => Promise<T>) => {
        transactionSpy()
        return fn(tx)
      },
    }),
  }
})

import { mergeMessageMetadata } from './repository'

const DECIDED_AT = '2026-07-28T09:00:00.000Z'

describe('mergeMessageMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectedRow.current = null
  })

  it('returns null when the message is not in that conversation', async () => {
    expect(await mergeMessageMetadata('conv_1', 'm1', { cardInteractions: {} })).toBeNull()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('reads and writes in one transaction, holding the row lock across the merge', async () => {
    selectedRow.current = { id: 'm1', metadata: { cardInteractions: { a: 1 } } }

    await mergeMessageMetadata('conv_1', 'm1', { cardInteractions: { b: 2 } }, ['cardInteractions'])

    expect(transactionSpy).toHaveBeenCalledTimes(1)
    expect(lockSpy).toHaveBeenCalledWith('update')
  })

  it('preserves the metadata keys it is not patching', async () => {
    selectedRow.current = {
      id: 'm1',
      metadata: { messageType: 'agent_response', cards: [{ type: 'memory_proposal' }] },
    }

    await mergeMessageMetadata('conv_1', 'm1', {
      cardInteractions: { 'memory_proposal-0': { decision: 'savedOrg', decidedAt: DECIDED_AT } },
    })

    expect(updateSpy.mock.calls[0][0].metadata).toEqual({
      messageType: 'agent_response',
      cards: [{ type: 'memory_proposal' }],
      cardInteractions: { 'memory_proposal-0': { decision: 'savedOrg', decidedAt: DECIDED_AT } },
    })
  })

  it('replaces a listed key wholesale when it is NOT deep-merged', async () => {
    selectedRow.current = { id: 'm1', metadata: { cardInteractions: { a: 1 } } }

    await mergeMessageMetadata('conv_1', 'm1', { cardInteractions: { b: 2 } })

    expect(updateSpy.mock.calls[0][0].metadata.cardInteractions).toEqual({ b: 2 })
  })

  it('deep-merges a listed key entry-by-entry, keeping decisions the writer never saw', async () => {
    selectedRow.current = {
      id: 'm1',
      metadata: {
        cardInteractions: { 'memory_proposal-0': { decision: 'savedOrg', decidedAt: DECIDED_AT } },
      },
    }

    await mergeMessageMetadata(
      'conv_1',
      'm1',
      {
        cardInteractions: {
          'project_profile_patch-1': { decision: 'rejected', decidedAt: DECIDED_AT },
        },
      },
      ['cardInteractions'],
    )

    expect(updateSpy.mock.calls[0][0].metadata.cardInteractions).toEqual({
      'memory_proposal-0': { decision: 'savedOrg', decidedAt: DECIDED_AT },
      'project_profile_patch-1': { decision: 'rejected', decidedAt: DECIDED_AT },
    })
  })

  it('lets the newer write win for the SAME card key', async () => {
    selectedRow.current = {
      id: 'm1',
      metadata: { cardInteractions: { 'memory_proposal-0': { decision: 'dismissed', decidedAt: DECIDED_AT } } },
    }

    await mergeMessageMetadata(
      'conv_1',
      'm1',
      { cardInteractions: { 'memory_proposal-0': { decision: 'savedOrg', decidedAt: DECIDED_AT } } },
      ['cardInteractions'],
    )

    expect(updateSpy.mock.calls[0][0].metadata.cardInteractions).toEqual({
      'memory_proposal-0': { decision: 'savedOrg', decidedAt: DECIDED_AT },
    })
  })

  it('tolerates a null metadata column', async () => {
    selectedRow.current = { id: 'm1', metadata: null }

    await mergeMessageMetadata('conv_1', 'm1', { cardInteractions: { a: 1 } }, ['cardInteractions'])

    expect(updateSpy.mock.calls[0][0].metadata).toEqual({ cardInteractions: { a: 1 } })
  })

  it('strips NUL bytes before the write: jsonb rejects U+0000 (#581)', async () => {
    selectedRow.current = {
      id: 'm1',
      metadata: { cards: [{ type: 'summary', content: 'a\u0000extract' }] },
    }

    await mergeMessageMetadata('conv_1', 'm1', {
      cardInteractions: { 'memory_proposal-0': { decision: 'savedOrg', decidedAt: DECIDED_AT } },
    })

    expect(updateSpy.mock.calls[0][0].metadata).toEqual({
      cards: [{ type: 'summary', content: 'aextract' }],
      cardInteractions: { 'memory_proposal-0': { decision: 'savedOrg', decidedAt: DECIDED_AT } },
    })
  })
})
