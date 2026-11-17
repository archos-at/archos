import { describe, expect, it } from 'vitest'
import type { BaseKnowledgeEntry } from '../wire'
import { officeAnswerLabel } from './answer-label'
import { projectTerritory } from './authority'
import { AT_SUBDIVISIONS } from '@/lib/project-intake/at-setup.fixtures'

const ENTRY: BaseKnowledgeEntry = {
  id: 'work_1',
  editionId: 'edition_1',
  copyId: 'manifestation_1',
  documentId: 'doc_1',
  fileName: 'ÖNORM B 1600.pdf',
  status: 'confirmed',
  proposedBy: 'person',
  confirmedBy: 'user_1',
  confirmedByName: null,
  folderId: null,
  workId: 'work_1',
  editions: [],
  textUse: 'used',
  aiProcessingAttestedAt: '2026-11-01T00:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
  values: {
    kind: 'technical_standard',
    title: 'Barrierefreies Bauen',
    designation: 'ÖNORM B 1600:2017',
    editionLabel: '2017',
    issuedOn: null,
    inForceFrom: null,
    inForceTo: null,
    territoryIds: [],
    issuer: 'Austrian Standards',
    addressees: [],
    licenceClass: 'licensed',
  },
  freshness: {
    intervalDays: 365,
    lastCheck: { checkedAt: '2026-09-12T08:00:00.000Z', checkedBy: 'user_1', result: 'current', note: null },
    dueAt: '2027-09-12T08:00:00.000Z',
    overdue: false,
  },
}

describe('the data of an answer’s label on an office copy', () => {
  it('carries what "Norm, Büroexemplar Ausgabe 2017, zuletzt geprüft am 12.09.2026" is made of', () => {
    expect(officeAnswerLabel(ENTRY, projectTerritory({ federalState: 'vienna' }, AT_SUBDIVISIONS))).toEqual({
      editionId: 'edition_1',
      workId: 'work_1',
      documentId: 'doc_1',
      fileName: 'ÖNORM B 1600.pdf',
      kind: 'technical_standard',
      designation: 'ÖNORM B 1600:2017',
      title: 'Barrierefreies Bauen',
      editionLabel: '2017',
      holder: 'office',
      role: 'requirement_source',
      lastCheckedOn: '2026-09-12',
      checkOverdue: false,
      freshness: 'current',
      textUse: 'used',
      directive: null,
    })
  })

  it('says how current the check leaves it, in the platform’s words', () => {
    const territory = projectTerritory({}, AT_SUBDIVISIONS)
    const checked = (result: 'current' | 'newer_known' | 'withdrawn', overdue: boolean) => ({
      ...ENTRY,
      freshness: { ...ENTRY.freshness, overdue, lastCheck: { ...ENTRY.freshness.lastCheck!, result } },
    })
    expect(officeAnswerLabel(checked('current', true), territory).freshness).toBe('check_due')
    expect(officeAnswerLabel(checked('newer_known', true), territory).freshness).toBe('newer_known')
    expect(officeAnswerLabel(checked('withdrawn', true), territory).freshness).toBe('superseded')
  })

  it('makes a commentary interpretation and gives a directive its verdict for the project', () => {
    const commentary = { ...ENTRY, values: { ...ENTRY.values, kind: 'commentary' as const } }
    expect(officeAnswerLabel(commentary, projectTerritory({}, AT_SUBDIVISIONS)).role).toBe('interpretation')
    const directive = {
      ...ENTRY,
      values: { ...ENTRY.values, kind: 'authority_directive' as const, addressees: [{ name: 'MA 37', territoryId: 'AT-9' }] },
    }
    expect(officeAnswerLabel(directive, projectTerritory({ federalState: 'styria' }, AT_SUBDIVISIONS))).toMatchObject({
      role: 'authority_practice',
      directive: { verdict: 'does_not_apply', territoryId: 'AT-6' },
    })
  })
})
