import { describe, test, expect } from 'vitest'
import { sameNodeData } from './build-graph'

describe('sameNodeData: a rebuilt node that draws the same keeps its object', () => {
  test('equal by value, however freshly built', () => {
    const build = () => ({
      cards: [{ id: 'a', hits: 2 }],
      order: new Map([['a', 0]]),
      folded: new Set([1]),
      label: 'Quellen',
      onToggle: () => {},
    })
    expect(sameNodeData(build(), build())).toBe(true)
  })

  test('any change a node would draw is a change', () => {
    const base = { cards: [{ id: 'a', hits: 2 }], order: new Map([['a', 0]]), label: 'Quellen' }
    expect(sameNodeData(base, { ...base, cards: [{ id: 'a', hits: 3 }] })).toBe(false)
    expect(sameNodeData(base, { ...base, order: new Map([['a', 1]]) })).toBe(false)
    expect(sameNodeData(base, { ...base, label: 'Treffer' })).toBe(false)
    expect(sameNodeData(base, { ...base, extra: true })).toBe(false)
    expect(sameNodeData({ at: new Date(1) }, { at: new Date(2) })).toBe(false)
  })
})
