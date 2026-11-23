import { describe, expect, it, vi } from 'vitest'
import { initialTurnView, type TurnView } from '@/lib/turns/turn-fold'
import type { TurnDriver } from './turn-driver'
import { createDriverPool, type PoolState } from './turn-driver-pool'

const setup = () => {
  const busy = new Set<string>()
  const made: TurnDriver[] = []
  const closed: string[] = []
  const pool = createDriverPool(
    (conversationId, projectId) => {
      const driver = {
        conversationId,
        projectId,
        connect: vi.fn(async () => {}),
        close: vi.fn(),
        busy: () => busy.has(conversationId),
        ask: vi.fn(),
        deliver: vi.fn(),
        cancel: vi.fn(),
        steer: vi.fn(() => true),
      } satisfies TurnDriver
      made.push(driver)
      return driver
    },
    (conversationId) => closed.push(conversationId)
  )
  return { pool, busy, made, closed }
}

const running = (turnId: string, conversationId: string): Record<string, TurnView> => ({
  [turnId]: initialTurnView(turnId, conversationId),
})

const state = (over: Partial<PoolState> = {}): PoolState => ({
  currentId: undefined,
  turns: {},
  known: () => true,
  projectIdOf: () => 'p1',
  ...over,
})

describe('the pool of turn drivers', () => {
  it('opens one driver per conversation and hands the same one back', () => {
    const { pool, made } = setup()
    const first = pool.ensure('a', 'p1')
    expect(first.connect).toHaveBeenCalledOnce()
    expect(pool.ensure('a', 'p1')).toBe(first)
    expect(pool.get('a')).toBe(first)
    expect(made).toHaveLength(1)
  })

  it('replaces a driver whose project changed', () => {
    const { pool } = setup()
    const first = pool.ensure('a', 'p1')
    const second = pool.ensure('a', 'p2')
    expect(first.close).toHaveBeenCalled()
    expect(second).not.toBe(first)
  })

  it('keeps the driver of a conversation the reader left while its turn is open, and closes it once it is not', () => {
    const { pool, busy, closed } = setup()
    const left = pool.ensure('a', 'p1')
    pool.ensure('b', 'p1')
    busy.add('a')

    pool.reconcile(state({ currentId: 'b', turns: running('t1', 'a') }))
    expect(left.close).not.toHaveBeenCalled()

    busy.delete('a')
    pool.reconcile(state({ currentId: 'b' }))
    expect(left.close).toHaveBeenCalledOnce()
    expect(closed).toEqual(['a'])
    expect(pool.get('a')).toBeUndefined()
  })

  it('never closes the open conversation’s driver for being idle', () => {
    const { pool } = setup()
    const open = pool.ensure('a', 'p1')
    pool.reconcile(state({ currentId: 'a' }))
    expect(open.close).not.toHaveBeenCalled()
  })

  it('opens a driver for a running turn that has none, in its conversation’s project', () => {
    const { pool, made } = setup()
    pool.reconcile(state({ currentId: 'b', turns: running('t1', 'a'), projectIdOf: () => 'p7' }))
    expect(made.map((driver) => [driver.conversationId, driver.projectId])).toEqual([['a', 'p7']])
  })

  it('stops the turns of a conversation that is gone, then closes its driver, and opens none for it', () => {
    const { pool, made } = setup()
    const gone = pool.ensure('a', 'p1')
    pool.reconcile(state({ currentId: 'b', previousTurns: running('t1', 'a'), known: (id) => id !== 'a' }))
    expect(gone.cancel).toHaveBeenCalledWith('t1')
    expect(gone.close).toHaveBeenCalled()

    pool.reconcile(state({ turns: running('t1', 'a'), known: (id) => id !== 'a' }))
    expect(made).toHaveLength(1)
  })

  it('closes every driver when the chat page goes', () => {
    const { pool, made } = setup()
    pool.ensure('a', 'p1')
    pool.ensure('b', 'p1')
    pool.closeAll()
    for (const driver of made) expect(driver.close).toHaveBeenCalled()
    expect(pool.get('a')).toBeUndefined()
  })
})
