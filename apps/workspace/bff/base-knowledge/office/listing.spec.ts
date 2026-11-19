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

describe('the Stand of an entry', () => {
  const confirmed = {
    id: 'e1',
    status: 'confirmed',
    textUse: 'used',
    freshness: { overdue: true },
    directory: null,
    editions: [{ id: 'e1', startsOn: '2017-04-15', inForceToday: true }],
  } as unknown as Parameters<typeof import('./listing').standOf>[0]
  const inForce = { editionLabel: '2023-02-01', startsOn: '2023-02-01' }

  it('comes from the platform’s editions for a work it lists, and asks no check for it', async () => {
    const { needs, standOf } = await import('./listing')
    const newer = { ...confirmed, directory: { inForce, held: false } }
    expect(standOf(newer)).toBe('newer_edition')
    expect(needs(newer, 'newer_edition')).toBe(true)
    expect(needs(newer, 'check_due')).toBe(false)
    expect(standOf({ ...confirmed, directory: { inForce, held: true } })).toBe('current')
  })

  it('comes from the manual check for a work the platform does not list', async () => {
    const { standOf } = await import('./listing')
    expect(standOf(confirmed)).toBe('check_due')
    expect(standOf({ ...confirmed, freshness: { ...confirmed.freshness, overdue: false } })).toBe('checked')
    expect(standOf({ ...confirmed, status: 'proposed', directory: { inForce, held: false } })).toBe('proposed')
  })

  it('counts and ranks a newer edition between a proposal and a due check', async () => {
    const { byAttention, countEntries } = await import('./listing')
    const named = (id: string, rest: object) => ({ ...confirmed, id, values: { designation: id, title: id }, ...rest }) as typeof confirmed
    const entries = [
      named('a-current', { directory: { inForce, held: true } }),
      named('b-due', {}),
      named('c-newer', { directory: { inForce, held: false } }),
      named('d-proposed', { status: 'proposed' }),
    ]
    expect([...entries].sort(byAttention).map((entry) => entry.id)).toEqual(['d-proposed', 'c-newer', 'b-due', 'a-current'])
    expect(countEntries(entries)).toMatchObject({ all: 4, proposed: 1, newerEdition: 1, checkDue: 1 })
  })
})
