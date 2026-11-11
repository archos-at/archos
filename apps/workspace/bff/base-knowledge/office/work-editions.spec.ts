/**
 * Which of an office's editions of one standard is in force on a day: the
 * platform's own rule (`newestInForce`) over the office's editions, an edition
 * starting on its in-force date or else its issue date.
 */

import { describe, expect, it } from 'vitest'
import type { StoredEntry } from '../store/repository'
import { editionOnDay, editionsByWork, editionsOf, workDesignation } from './work-editions'

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
  })

  it('lists every edition of the work, newest first, the one in force today marked', () => {
    const works = editionsByWork([OLD, NEW])
    expect(editionsOf(OLD, works, '2026-11-11')).toEqual([
      { id: 'e2023', editionLabel: '2023-02-01', startsOn: '2023-02-01', status: 'confirmed', inForceToday: true },
      { id: 'e2017', editionLabel: '2017-04-01', startsOn: '2017-04-01', status: 'confirmed', inForceToday: false },
    ])
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
