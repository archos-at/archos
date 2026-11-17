/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backoffWithJitter, createRetryLadder } from './backoff'

describe('backoffWithJitter', () => {
  it('grows exponentially before jitter is applied', () => {
    const top = (attempt: number) =>
      backoffWithJitter(attempt, { baseMs: 1_000, maxMs: 30_000, random: () => 1 })

    expect(top(0)).toBe(1_000)
    expect(top(1)).toBe(2_000)
    expect(top(2)).toBe(4_000)
    expect(top(3)).toBe(8_000)
  })

  it('caps at maxMs', () => {
    const top = (attempt: number) =>
      backoffWithJitter(attempt, { baseMs: 1_000, maxMs: 30_000, random: () => 1 })

    expect(top(5)).toBe(30_000)
    expect(top(50)).toBe(30_000)
  })

  it('spreads each wave across the back half of its window', () => {
    const attempt = 2 // undithered window is 4000ms
    const earliest = backoffWithJitter(attempt, {
      baseMs: 1_000,
      maxMs: 30_000,
      random: () => 0,
    })
    const latest = backoffWithJitter(attempt, {
      baseMs: 1_000,
      maxMs: 30_000,
      random: () => 1,
    })

    expect(earliest).toBe(2_000)
    expect(latest).toBe(4_000)
  })

  it('desynchronises clients that were dropped at the same instant', () => {
    let seed = 0
    const clients = Array.from({ length: 50 }, () => {
      seed += 1 / 50
      return backoffWithJitter(3, {
        baseMs: 1_000,
        maxMs: 30_000,
        random: () => seed % 1,
      })
    })

    expect(new Set(clients).size).toBeGreaterThan(1)
    expect(Math.min(...clients)).toBeGreaterThanOrEqual(4_000)
    expect(Math.max(...clients)).toBeLessThanOrEqual(8_000)
  })

  it('never returns a negative or sub-window delay', () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const delay = backoffWithJitter(attempt, { baseMs: 1_000, maxMs: 30_000 })
      const window = Math.min(30_000, 1_000 * 2 ** attempt)
      expect(delay).toBeGreaterThanOrEqual(window / 2)
      expect(delay).toBeLessThanOrEqual(window)
    }
  })

  it('treats negative attempts as attempt 0', () => {
    expect(
      backoffWithJitter(-5, { baseMs: 1_000, maxMs: 30_000, random: () => 1 })
    ).toBe(1_000)
  })
})

describe('createRetryLadder', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('walks an explicit schedule and then refuses', () => {
    const ladder = createRetryLadder({ delaysMs: [100, 200] })
    const run = vi.fn()

    expect(ladder.schedule(run)).toBe(true)
    vi.advanceTimersByTime(100)
    expect(run).toHaveBeenCalledTimes(1)

    expect(ladder.schedule(run)).toBe(true)
    vi.advanceTimersByTime(200)
    expect(run).toHaveBeenCalledTimes(2)

    expect(ladder.spent).toBe(true)
    expect(ladder.schedule(run)).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('starts over on evidence that it works', () => {
    const ladder = createRetryLadder({ delaysMs: [100, 200] })
    const run = vi.fn()

    ladder.schedule(run)
    ladder.schedule(run)
    expect(ladder.spent).toBe(true)

    ladder.reset()

    expect(ladder.spent).toBe(false)
    expect(ladder.schedule(run)).toBe(true)
    vi.advanceTimersByTime(100)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('drops a pending retry on reset, so the rung it was on cannot still fire', () => {
    const ladder = createRetryLadder({ delaysMs: [100, 200] })
    const run = vi.fn()

    ladder.schedule(run)
    ladder.reset()
    vi.advanceTimersByTime(10_000)

    expect(run).not.toHaveBeenCalled()
  })

  it('cancels without forgiving — teardown is not vindication', () => {
    const ladder = createRetryLadder({ delaysMs: [100, 200] })
    const run = vi.fn()

    ladder.schedule(run)
    ladder.cancel()
    vi.advanceTimersByTime(10_000)
    expect(run).not.toHaveBeenCalled()

    ladder.schedule(run)
    vi.advanceTimersByTime(100)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps one retry in flight, however many failures arrive', () => {
    const ladder = createRetryLadder({ delaysMs: [100, 100, 100] })
    const run = vi.fn()

    ladder.schedule(run)
    ladder.schedule(run)
    vi.advanceTimersByTime(1_000)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('bounds an exponential ladder by its budget', () => {
    const ladder = createRetryLadder({
      baseMs: 1_000,
      maxMs: 10_000,
      budget: 2,
      random: () => 1,
    })
    const run = vi.fn()

    expect(ladder.schedule(run)).toBe(true)
    vi.advanceTimersByTime(1_000)
    expect(ladder.schedule(run)).toBe(true)
    vi.advanceTimersByTime(2_000)
    expect(run).toHaveBeenCalledTimes(2)

    expect(ladder.schedule(run)).toBe(false)
  })

  it('never gives up without a budget', () => {
    const ladder = createRetryLadder({ baseMs: 1_000, maxMs: 2_000, random: () => 1 })
    const run = vi.fn()

    for (let round = 0; round < 50; round += 1) {
      expect(ladder.schedule(run)).toBe(true)
      vi.advanceTimersByTime(2_000)
    }

    expect(run).toHaveBeenCalledTimes(50)
    expect(ladder.spent).toBe(false)
  })
})
