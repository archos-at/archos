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

describe('a superseded edition', () => {
  it('asks for no check: the newer edition is what a check would find', async () => {
    const { needs } = await import('./listing')
    const entry = {
      id: 'e2005',
      status: 'confirmed',
      textUse: 'used',
      freshness: { overdue: true },
      editions: [
        { id: 'e2023', startsOn: '2023-02-01', inForceToday: true },
        { id: 'e2005', startsOn: '2005-03-01', inForceToday: false },
      ],
    } as unknown as Parameters<typeof needs>[0]
    expect(needs(entry, 'check_due')).toBe(false)
    // Positive control: the same entry alone is due.
    expect(needs({ ...entry, editions: [{ id: 'e2005', startsOn: '2005-03-01', inForceToday: true }] } as typeof entry, 'check_due')).toBe(true)
  })

  it('is not an edition still to come: a confirmed future edition without a check is due', async () => {
    const { needs, isSuperseded } = await import('./listing')
    const upcoming = {
      id: 'e2027',
      status: 'confirmed',
      textUse: 'used',
      freshness: { overdue: true },
      editions: [
        { id: 'e2023', startsOn: '2023-02-01', inForceToday: true },
        { id: 'e2027', startsOn: '2027-01-01', inForceToday: false },
      ],
    } as unknown as Parameters<typeof needs>[0]
    expect(isSuperseded(upcoming)).toBe(false)
    expect(needs(upcoming, 'check_due')).toBe(true)
  })
})
