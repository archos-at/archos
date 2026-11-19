import { describe, expect, it } from 'vitest'
import type { DirectoryWork } from '../platform'
import type { StoredEntry } from '../store/repository'
import { bindingOnDay, directoryEditionOnDay, isSameEdition } from './binding-edition'

function held(editionId: string, editionLabel: string, values: Partial<StoredEntry['values']> = {}, rest: Partial<StoredEntry> = {}): StoredEntry {
  return {
    workId: 'work_1',
    editionId,
    copyId: `copy_${editionId}`,
    documentId: `doc_${editionId}`,
    workStandsAlone: true,
    confirmed: true,
    provenance: {},
    terms: {},
    lastCheck: null,
    createdAt: new Date('2026-01-01'),
    values: {
      kind: 'technical_standard',
      title: 'Barrierefreies Bauen',
      designation: 'ÖNORM B 1600',
      editionLabel,
      issuedOn: editionLabel,
      inForceFrom: null,
      inForceTo: null,
      territoryIds: [],
      issuer: null,
      addressees: [],
      licenceClass: 'public_open',
      ...values,
    },
    ...rest,
  }
}

const DIRECTORY: DirectoryWork = {
  designation: 'ÖNORM B 1600',
  title: 'Barrierefreies Bauen',
  editions: [
    { label: '2017-04-15', issuedOn: '2017-04-15', inForceFrom: '2017-04-15', inForceTo: '2023-02-01' },
    { label: '2023-02-01', issuedOn: '2023-02-01', inForceFrom: '2023-02-01', inForceTo: null },
  ],
}

const OLD = held('e2017', '2017-04-15')
const NEW = held('e2023', '2023-02-01')

describe('the edition the norm directory lists as in force on a day', () => {
  it('is the one whose interval holds the day', () => {
    expect(directoryEditionOnDay(DIRECTORY, '2024-03-01')?.label).toBe('2023-02-01')
    expect(directoryEditionOnDay(DIRECTORY, '2020-06-01')?.label).toBe('2017-04-15')
  })

  it('is none when the directory states no in-force dates', () => {
    const undated: DirectoryWork = { ...DIRECTORY, editions: DIRECTORY.editions.map((edition) => ({ ...edition, inForceFrom: null, inForceTo: null })) }
    expect(directoryEditionOnDay(undated, '2024-03-01')).toBeNull()
  })
})

describe('whether the office holds the binding edition', () => {
  it('says the binding edition is missing when the office holds only an older one', () => {
    const verdict = bindingOnDay([OLD], DIRECTORY, '2024-03-01')
    expect(verdict).toEqual({ status: 'missing', binding: DIRECTORY.editions[1], held: [OLD] })
  })

  it('says it is missing when the office holds only a newer one than bound that day', () => {
    expect(bindingOnDay([NEW], DIRECTORY, '2020-06-01')).toMatchObject({ status: 'missing', binding: { label: '2017-04-15' } })
  })

  it('answers from the office edition the directory names, even where the office’s own dates would choose another', () => {
    const undatedNew = held('e2023', '2023-02-01', { issuedOn: null })
    expect(bindingOnDay([OLD, undatedNew], DIRECTORY, '2024-03-01')).toEqual({ status: 'held', entry: undatedNew })
  })

  it('counts a proposal as not held', () => {
    expect(bindingOnDay([OLD, { ...NEW, confirmed: false }], DIRECTORY, '2024-03-01')).toMatchObject({ status: 'missing', held: [OLD] })
  })

  it('knows nothing when the directory does not list the work or dates its editions', () => {
    expect(bindingOnDay([OLD], undefined, '2024-03-01')).toEqual({ status: 'unknown' })
    expect(bindingOnDay([OLD], { ...DIRECTORY, editions: [] }, '2024-03-01')).toEqual({ status: 'unknown' })
  })
})

describe('one edition, two spellings', () => {
  it('matches a label that carries the day, or the same day on either side', () => {
    const edition = DIRECTORY.editions[1]!
    expect(isSameEdition(held('x', 'Ausgabe 2023-02-01', { issuedOn: null }), edition)).toBe(true)
    expect(isSameEdition(held('x', 'Feb. 2023', { issuedOn: null, inForceFrom: '2023-02-01' }), edition)).toBe(true)
    expect(isSameEdition(held('x', '2023-02-01'), { ...edition, label: '2023 edition', issuedOn: null })).toBe(true)
    expect(isSameEdition(held('x', '2017-04-15'), edition)).toBe(false)
  })
})
