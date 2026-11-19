import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoredEntry } from '../store/repository'
import { editionOnDay, editionsByWork, editionsForDay, editionsOf } from './work-editions'
import { workDesignation } from './work-designation'

const licenceStep = vi.hoisted(() => ({ ask: false }))
vi.mock('@/lib/base-knowledge/wire/licence-step', () => ({
  get ASK_FOR_LICENCE() {
    return licenceStep.ask
  },
}))

afterEach(() => {
  licenceStep.ask = false
})

function edition(editionId: string, issuedOn: string | null, rest: Partial<StoredEntry> = {}, values: Partial<StoredEntry['values']> = {}): StoredEntry {
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
      editionLabel: issuedOn ?? 'undated',
      issuedOn,
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

const OLD = edition('e2017', '2017-04-01')
const NEW = edition('e2023', '2023-02-01')

describe('the edition in force on a day', () => {
  it('is the newest that had started by then: a project filed in 2020 keeps the 2017 edition', () => {
    expect(editionOnDay([OLD, NEW], '2020-06-01')).toBe(OLD)
    expect(editionOnDay([OLD, NEW], '2026-11-11')).toBe(NEW)
  })

  it('starts on the in-force date where one is stated, not the issue date', () => {
    const later = edition('e2023', '2023-02-01', {}, { inForceFrom: '2024-01-01' })
    expect(editionOnDay([OLD, later], '2023-06-01')).toBe(OLD)
  })

  it('never puts a proposal in force', () => {
    expect(editionOnDay([OLD, { ...NEW, confirmed: false }], '2026-11-11')).toBe(OLD)
  })

  it('still answers with the office’s edition when none carries a date', () => {
    const undated = edition('e-undated', null)
    expect(editionOnDay([undated], '2026-11-11')).toBe(undated)
  })

  it('puts no dated edition in force before it starts or after it ends', () => {
    const future = edition('e2027', '2027-01-01')
    expect(editionOnDay([future], '2026-11-11')).toBeNull()
    const expired = edition('e2017', '2017-04-01', {}, { inForceTo: '2020-12-31' })
    expect(editionOnDay([expired], '2026-11-11')).toBeNull()
    const undated = edition('e-undated', null)
    expect(editionOnDay([future, undated], '2026-11-11')).toBe(undated)
    const endedUndated = edition('e-undated-ended', null, {}, { inForceTo: '2025-12-31' })
    expect(editionOnDay([endedUndated], '2026-11-11')).toBeNull()
  })

  it('lists every edition of the work, newest first, the one in force today marked', () => {
    const works = editionsByWork([OLD, NEW])
    expect(editionsOf(OLD, works, '2026-11-11')).toEqual([
      { id: 'e2023', editionLabel: '2023-02-01', startsOn: '2023-02-01', status: 'confirmed', inForceToday: true },
      { id: 'e2017', editionLabel: '2017-04-01', startsOn: '2017-04-01', status: 'confirmed', inForceToday: false },
    ])
  })
})

describe('the editions a turn carries, with the norm directory', () => {
  const directory = [
    {
      designation: 'ÖNORM B 1600:2023',
      title: 'Barrierefreies Bauen',
      editions: [
        { label: '2017-04-01', issuedOn: '2017-04-01', inForceFrom: '2017-04-01', inForceTo: '2023-02-01' },
        { label: '2023-02-01', issuedOn: '2023-02-01', inForceFrom: '2023-02-01', inForceTo: null },
      ],
    },
  ]
  const files = new Map([
    ['doc_e2017', { fileName: 'OENORM_B_1600_2017.pdf' }],
    ['doc_e2023', { fileName: 'OENORM_B_1600_2023.pdf' }],
  ])

  it('names the binding edition as missing and carries no other edition of that work', () => {
    const { stored, missing } = editionsForDay([OLD], directory, '2024-03-01', files)
    expect(stored).toEqual([])
    expect(missing).toEqual([
      { designation: 'ÖNORM B 1600', title: 'Barrierefreies Bauen', binding: '2023-02-01', held: [{ editionLabel: '2017-04-01', fileName: 'OENORM_B_1600_2017.pdf' }] },
    ])
  })

  it('carries the held edition the directory names, and nothing missing', () => {
    expect(editionsForDay([OLD, NEW], directory, '2024-03-01', files)).toEqual({ stored: [NEW], missing: [] })
    expect(editionsForDay([OLD, NEW], directory, '2020-06-01', files)).toEqual({ stored: [OLD], missing: [] })
  })

  it('falls back to the office’s own dates where the directory knows no edition', () => {
    expect(editionsForDay([OLD, NEW], [], '2020-06-01', files)).toEqual({ stored: [OLD], missing: [] })
  })

  it('keeps a licensed proposal, which is listed and never read, while the office is asked about licences', () => {
    licenceStep.ask = true
    const proposal = edition('e-proposal', '2023-02-01', { workId: 'work_2', confirmed: false }, { licenceClass: 'licensed', designation: 'ÖNORM B 5371' })
    expect(editionsForDay([proposal], directory, '2024-03-01', files).stored).toEqual([proposal])
  })

  it('keeps no proposal, licensed or not, while the office is not asked about licences', () => {
    const licensed = edition('e-proposal', '2023-02-01', { workId: 'work_2', confirmed: false }, { licenceClass: 'licensed', designation: 'ÖNORM B 5371' })
    const open = edition('e-open', '2023-02-01', { workId: 'work_3', confirmed: false }, { designation: 'ÖNORM B 5372' })
    expect(editionsForDay([licensed, open], directory, '2024-03-01', files).stored).toEqual([])
  })
})

describe('a work’s designation', () => {
  it('drops one edition’s date, as a standards body cites the edition', () => {
    expect(workDesignation('ÖNORM B 1600:2017')).toBe('ÖNORM B 1600')
    expect(workDesignation('EN 1991-1-1:2002-04')).toBe('EN 1991-1-1')
    expect(workDesignation('ÖNORM B 1600 : 2023-02-01')).toBe('ÖNORM B 1600')
    expect(workDesignation('OIB-Richtlinie 2')).toBe('OIB-Richtlinie 2')
    expect(workDesignation(null)).toBeNull()
  })
})
