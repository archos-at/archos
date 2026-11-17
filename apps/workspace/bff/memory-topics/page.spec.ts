/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { pageOfTopic } from './page'

describe('pageOfTopic', () => {
  const items = [
    { id: 'a', topic: 'Brandschutz' },
    { id: 'b', topic: null },
    { id: 'c', topic: 'Stellplätze' },
    { id: 'd', topic: 'Brandschutz' },
    { id: 'e', topic: 'Brandschutz' },
  ]

  it('keeps the items of one topic in the order given, whatever the case of the name', () => {
    const page = pageOfTopic(items, 'BRANDSCHUTZ', { limit: 10, offset: 0 })
    expect(page.items.map((item) => item.id)).toEqual(['a', 'd', 'e'])
    expect(page.nextCursor).toBeNull()
  })

  it('reads the empty value as the items with no topic', () => {
    expect(pageOfTopic(items, '', { limit: 10, offset: 0 }).items.map((item) => item.id)).toEqual(['b'])
  })

  it('pages the filtered list, not the whole one, and says where the next page starts', () => {
    const first = pageOfTopic(items, 'Brandschutz', { limit: 2, offset: 0 })
    expect(first.items.map((item) => item.id)).toEqual(['a', 'd'])
    expect(first.nextCursor).toBe('2')
    const second = pageOfTopic(items, 'Brandschutz', { limit: 2, offset: 2 })
    expect(second.items.map((item) => item.id)).toEqual(['e'])
    expect(second.nextCursor).toBeNull()
  })

  it('selects nothing for a topic no visible item holds', () => {
    expect(pageOfTopic(items, 'Bauherr', { limit: 10, offset: 0 })).toEqual({ items: [], nextCursor: null })
  })
})
