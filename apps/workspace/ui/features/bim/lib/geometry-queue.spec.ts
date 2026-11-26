import { describe, expect, it } from 'vitest'
import { runExclusive } from './geometry-queue'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('runExclusive', () => {
  it('starts the second build only after the first finished', async () => {
    const order: string[] = []
    const first = deferred()
    const a = runExclusive(new AbortController().signal, async () => {
      order.push('a start')
      await first.promise
      order.push('a end')
    })
    const b = runExclusive(new AbortController().signal, async () => {
      order.push('b start')
    })
    await settle()
    expect(order).toEqual(['a start'])
    first.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(['a start', 'a end', 'b start'])
  })

  it('lets a view that left while waiting drop out without blocking the next', async () => {
    const first = deferred()
    const a = runExclusive(new AbortController().signal, () => first.promise)
    const leaving = new AbortController()
    const b = runExclusive(leaving.signal, async () => 'never')
    const c = runExclusive(new AbortController().signal, async () => 'c ran')
    leaving.abort()
    await expect(b).rejects.toMatchObject({ name: 'AbortError' })
    first.resolve()
    await a
    await expect(c).resolves.toBe('c ran')
  })

  it('frees the queue when a build throws', async () => {
    await expect(
      runExclusive(new AbortController().signal, async () => {
        throw new Error('kernel crashed')
      })
    ).rejects.toThrow('kernel crashed')
    await expect(runExclusive(new AbortController().signal, async () => 1)).resolves.toBe(1)
  })
})
