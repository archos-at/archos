import { describe, expect, it } from 'vitest'
import { subtreeOf } from './listing'

describe('subtreeOf', () => {
  it('takes every folder below, at any depth, and nothing beside', () => {
    const folders = [
      { id: 'root', parentId: null },
      { id: 'fire', parentId: 'root' },
      { id: 'fire-old', parentId: 'fire' },
      { id: 'sound', parentId: 'root' },
      { id: 'letters', parentId: null },
    ]
    expect([...subtreeOf('fire', folders)].sort()).toEqual(['fire', 'fire-old'])
    expect(subtreeOf('root', folders).has('letters')).toBe(false)
  })
})
