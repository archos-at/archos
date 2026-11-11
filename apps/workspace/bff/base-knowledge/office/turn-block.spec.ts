import { describe, expect, it } from 'vitest'
import type { BaseKnowledgeEntry } from '../wire'
import { projectTerritory } from './authority'
import { BASE_KNOWLEDGE_HEADER, MAX_TURN_ENTRIES, renderBaseKnowledgeBlock } from './turn-block'
import { AT_SUBDIVISIONS } from '@/lib/project-intake/at-setup.fixtures'

function entry(overrides: Partial<BaseKnowledgeEntry['values']> = {}, rest: Partial<BaseKnowledgeEntry> = {}): BaseKnowledgeEntry {
  return {
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
    edition: null,
    textUse: 'used',
    aiProcessingAttestedAt: '2026-11-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
    values: {
      kind: 'technical_standard',
      title: 'Barrierefreies Bauen',
      designation: 'ÖNORM B 1600:2017',
      editionLabel: '2017-04-01',
      issuedOn: '2017-04-01',
      inForceFrom: null,
      inForceTo: null,
      territoryIds: [],
      issuer: 'Austrian Standards',
      addressees: [],
      licenceClass: 'licensed',
      ...overrides,
    },
    freshness: {
      intervalDays: 365,
      lastCheck: { checkedAt: '2026-10-02T09:00:00.000Z', checkedBy: 'user_1', result: 'current', note: null },
      dueAt: '2027-10-02T09:00:00.000Z',
      overdue: false,
    },
    ...rest,
  }
}

const VIENNA = projectTerritory({ federalState: 'vienna' }, AT_SUBDIVISIONS)
const GRAZ = projectTerritory({ federalState: 'styria' }, AT_SUBDIVISIONS)
const UNKNOWN = projectTerritory({}, AT_SUBDIVISIONS)

describe('the base knowledge a turn carries', () => {
  it('names the standard, its edition, its file and its last check', () => {
    const block = renderBaseKnowledgeBlock([entry()], VIENNA)
    expect(block?.split('\n')[0]).toBe(BASE_KNOWLEDGE_HEADER)
    expect(block).toContain('ÖNORM B 1600:2017 „Barrierefreies Bauen“: technical standard, edition 2017-04-01')
    expect(block).toContain('file „ÖNORM B 1600.pdf“')
    expect(block).toContain('licensed copy')
    expect(block).toContain('last checked 2026-10-02 (current)')
    expect(block).not.toContain('OVERDUE')
  })

  it('says an overdue check must be named in the answer', () => {
    const stale = entry({}, { freshness: { ...entry().freshness, overdue: true } })
    expect(renderBaseKnowledgeBlock([stale], VIENNA)).toContain('check OVERDUE (due every 365 days), say so')
    const never = entry({}, { freshness: { intervalDays: 365, lastCheck: null, dueAt: null, overdue: true } })
    expect(renderBaseKnowledgeBlock([never], VIENNA)).toContain('never checked; overdue')
  })

  it('marks a commentary as interpretation only', () => {
    const block = renderBaseKnowledgeBlock([entry({ kind: 'commentary', designation: null, title: 'BO Wien Kommentar' })], VIENNA)
    expect(block).toContain('„BO Wien Kommentar“: commentary')
    expect(block).toContain('role: interpretation only')
  })

  it('applies an MA 37 directive in Vienna, not in Graz, and says when the authority is unknown', () => {
    const directive = entry({
      kind: 'authority_directive',
      designation: null,
      title: 'Weisung Dachgeschossausbau',
      addressees: [{ name: 'MA 37', territoryId: 'AT-9' }],
      licenceClass: 'public_open',
    })
    expect(renderBaseKnowledgeBlock([directive], VIENNA)).toContain('applies to this project')
    expect(renderBaseKnowledgeBlock([directive], VIENNA)).toContain('not verified')
    expect(renderBaseKnowledgeBlock([directive], GRAZ)).toContain('does NOT apply to this project (project in AT-6)')
    expect(renderBaseKnowledgeBlock([directive], UNKNOWN)).toContain('authority unknown for this project')
  })

  it('names an unattested licensed copy by its file as held, listed only and not read (A7, ADR-0164)', () => {
    const block = renderBaseKnowledgeBlock([entry({}, { textUse: 'metadata_only', aiProcessingAttestedAt: null })], VIENNA)
    const line = block?.split('\n').find((text) => text.includes('ÖNORM B 1600:2017')) ?? ''
    expect(line).toContain('file „ÖNORM B 1600.pdf“')
    expect(line).toContain('LISTED ONLY, NOT READ')
    expect(line).not.toContain('licensed copy;')
  })

  it('names a licensed copy still a proposal the same way, so the answer can say the office holds it', () => {
    const block = renderBaseKnowledgeBlock([entry({}, { status: 'proposed', textUse: 'metadata_only', aiProcessingAttestedAt: null })], VIENNA)
    expect(block).toContain('ÖNORM B 1600:2017 „Barrierefreies Bauen“: technical standard, edition 2017-04-01; file „ÖNORM B 1600.pdf“; licensed copy, not yet confirmed; LISTED ONLY, NOT READ')
  })

  it('carries no other proposal, and nothing when there is nothing', () => {
    expect(renderBaseKnowledgeBlock([entry({ licenceClass: 'public_open' }, { status: 'proposed' })], VIENNA)).toBeNull()
    expect(renderBaseKnowledgeBlock([], VIENNA)).toBeNull()
  })

  it('is bounded, and says how many it left out', () => {
    const many = Array.from({ length: MAX_TURN_ENTRIES + 3 }, (_, index) => entry({ title: `Norm ${index}` }))
    const lines = renderBaseKnowledgeBlock(many, VIENNA)?.split('\n') ?? []
    expect(lines).toHaveLength(MAX_TURN_ENTRIES + 2)
    expect(lines.at(-1)).toBe('- … and 3 more not listed here.')
  })
})
