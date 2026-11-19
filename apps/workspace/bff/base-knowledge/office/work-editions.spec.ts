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

describe('the editions a turn carries, with what the resolver names as binding', () => {
  const via = { designation: 'OIB-RL 4', editionLabel: '2023' }
  const binds = (editionLabel: string) => new Map([['önorm b 1600', [{ editionLabel, startsOn: editionLabel, via }]]])

  it('still carries the office’s own edition when another one binds, for the answer to name both', () => {
    expect(editionsForDay([OLD], binds('2023-02-01'), '2024-03-01')).toEqual([OLD])
  })

  it('carries the held edition the resolver names as binding, over the office’s own dates', () => {
    expect(editionsForDay([OLD, NEW], binds('2023-02-01'), '2020-06-01')).toEqual([NEW])
    expect(editionsForDay([OLD, NEW], binds('2017-04-01'), '2024-03-01')).toEqual([OLD])
  })

  it('falls back to the office’s own dates where the resolver names no edition', () => {
    expect(editionsForDay([OLD, NEW], new Map(), '2020-06-01')).toEqual([OLD])
  })

  it('keeps a licensed proposal, which is listed and never read, while the office is asked about licences', () => {
    licenceStep.ask = true
    const proposal = edition('e-proposal', '2023-02-01', { workId: 'work_2', confirmed: false }, { licenceClass: 'licensed', designation: 'ÖNORM B 5371' })
    expect(editionsForDay([proposal], binds('2023-02-01'), '2024-03-01')).toEqual([proposal])
  })

  it('keeps no proposal, licensed or not, while the office is not asked about licences', () => {
    const licensed = edition('e-proposal', '2023-02-01', { workId: 'work_2', confirmed: false }, { licenceClass: 'licensed', designation: 'ÖNORM B 5371' })
    const open = edition('e-open', '2023-02-01', { workId: 'work_3', confirmed: false }, { designation: 'ÖNORM B 5372' })
    expect(editionsForDay([licensed, open], binds('2023-02-01'), '2024-03-01')).toEqual([])
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
