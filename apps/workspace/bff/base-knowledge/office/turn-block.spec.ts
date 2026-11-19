import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaseKnowledgeEntry } from '../wire'
import { projectTerritory } from './authority'
import {
  BASE_KNOWLEDGE_HEADER,
  BINDING_EDITION_RULE,
  OTHER_EDITION_BINDING,
  MAX_TURN_BLOCK_CHARS,
  MAX_TURN_ENTRIES,
  MAX_TURN_LINE_CHARS,
  renderBaseKnowledgeBlock,
  UNATTESTED_RULE,
} from './turn-block'
import { AT_SUBDIVISIONS } from '@/lib/project-intake/at-setup.fixtures'

const licenceStep = vi.hoisted(() => ({ ask: true }))
vi.mock('@/lib/base-knowledge/wire/licence-step', () => ({
  get ASK_FOR_LICENCE() {
    return licenceStep.ask
  },
}))

beforeEach(() => {
  licenceStep.ask = true
})

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
    workId: 'work_1',
    editions: [],
    binding: null,
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

describe('the base knowledge a turn carries while the office is not asked about licences', () => {
  beforeEach(() => {
    licenceStep.ask = false
  })

  it('says nothing about a licence, of the header or of a licensed copy', () => {
    const block = renderBaseKnowledgeBlock([entry()], VIENNA) ?? ''
    expect(block.split('\n')[0]).toBe(BASE_KNOWLEDGE_HEADER)
    expect(block).toContain('ÖNORM B 1600:2017 „Barrierefreies Bauen“: technical standard, edition 2017-04-01')
    expect(block).not.toMatch(/licen[cs]e|LISTED ONLY|attest/i)
  })

  it('carries no proposal, licensed or not', () => {
    expect(renderBaseKnowledgeBlock([entry({}, { status: 'proposed', textUse: 'metadata_only', aiProcessingAttestedAt: null })], VIENNA)).toBeNull()
    expect(renderBaseKnowledgeBlock([entry({ licenceClass: 'public_open' }, { status: 'proposed' })], VIENNA)).toBeNull()
  })
})

describe('the base knowledge a turn carries', () => {
  it('names the standard, its edition, its file and its last check', () => {
    const block = renderBaseKnowledgeBlock([entry()], VIENNA)
    expect(block?.split('\n')[0]).toBe(`${BASE_KNOWLEDGE_HEADER} ${UNATTESTED_RULE}`)
    expect(block).toContain('ÖNORM B 1600:2017 „Barrierefreies Bauen“: technical standard, edition 2017-04-01')
    expect(block).toContain('file „ÖNORM B 1600.pdf“')
    expect(block).toContain('licensed copy')
    expect(block).toContain('last checked 2026-10-02 (current)')
    expect(block).not.toContain('OVERDUE')
  })

  it('never asks an answer to warn about a manual check, however long ago or never', () => {
    const stale = entry({}, { freshness: { ...entry().freshness, overdue: true } })
    const never = entry({}, { freshness: { intervalDays: 365, lastCheck: null, dueAt: null, overdue: true } })
    const block = renderBaseKnowledgeBlock([stale, never], VIENNA) ?? ''
    expect(block).toContain('last checked 2026-10-02 (current)')
    expect(block).not.toMatch(/overdue|never checked|say so in the answer|when it was last checked/i)
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

  const ON_FILING_DAY = { day: '2024-03-01', basis: 'reference_day' as const }
  const VIA = { designation: 'OIB-RL 4', editionLabel: '2023' }
  const older = (rest: Partial<BaseKnowledgeEntry> = {}) =>
    entry({ designation: 'ÖNORM B 1600:2017', editionLabel: '2017-04-15' }, {
      fileName: 'OENORM_B_1600_2017.pdf',
      binding: { editionLabel: '2023-02-01', startsOn: '2023-02-01', via: VIA, held: false, newer: true },
      ...rest,
    })

  it('answers from the office’s other edition, and says which edition binds that day and under what', () => {
    const block = renderBaseKnowledgeBlock([older()], VIENNA, [], [], { day: ON_FILING_DAY, bindingOn: '2024-03-01' }) ?? ''
    const lines = block.split('\n')
    expect(lines[1]).toContain("Editions are those in force on 2024-03-01, the project's reference day")
    expect(lines[2]).toBe(BINDING_EDITION_RULE)
    expect(lines[2]).toContain("You may answer from the office's copy")
    expect(lines[2]).not.toMatch(/do not answer|upload/i)
    expect(lines[3]).toBe(
      `- ÖNORM B 1600:2017: technical standard, edition 2017-04-15; ${OTHER_EDITION_BINDING} on 2024-03-01: edition 2023-02-01, made binding by OIB-RL 4 2023; role: requirement source where a law makes it binding; file „OENORM_B_1600_2017.pdf“; licensed copy; last checked 2026-10-02 (current); title „Barrierefreies Bauen“`,
    )
  })

  it('takes the edition the resolver holds binding as current, without asking for a check', () => {
    const current = entry({}, { binding: { editionLabel: '2017-04-01', startsOn: '2017-04-01', via: VIA, held: true, newer: false }, freshness: { ...entry().freshness, overdue: true } })
    const block = renderBaseKnowledgeBlock([current], VIENNA, [], [], { day: ON_FILING_DAY, bindingOn: '2024-03-01' }) ?? ''
    expect(block).toContain('the edition binding on 2024-03-01')
    expect(block).not.toContain('OVERDUE')
    expect(block).not.toContain(BINDING_EDITION_RULE)
  })

  it('says which day it took when the project has none, or there is no project', () => {
    const today = (basis: 'no_reference_day' | 'no_project') =>
      renderBaseKnowledgeBlock([entry()], VIENNA, [], [], { day: { day: '2026-11-19', basis }, bindingOn: '2026-11-19' })?.split('\n')[1]
    expect(today('no_reference_day')).toBe(
      "Editions are those in force today, 2026-11-19, because the project records no reference day; when an answer rests on one, say that you took today's date and why."
    )
    expect(today('no_project')).toContain('because this conversation belongs to no project')
  })

  it('states no day and no rule when it carries no edition, and nothing about a norm the office does not hold', () => {
    const block = renderBaseKnowledgeBlock([], VIENNA, [{ designation: 'OIB-RL 4', title: 'Nutzungssicherheit', editionLabel: '2023' }], [], { day: ON_FILING_DAY, bindingOn: '2024-03-01' })
    expect(block).not.toContain('Editions are those in force')
    expect(block).not.toContain(BINDING_EDITION_RULE)
    expect(block).toContain('- OIB-RL 4 „Nutzungssicherheit“: listed by the platform, edition 2023; the platform holds its text')
    expect(block).not.toMatch(/NO TEXT|kein Text/)
  })

  it('keeps the binding edition in a line cut at its bound', () => {
    const long = renderBaseKnowledgeBlock([older({ values: { ...older().values, title: 'x'.repeat(500) } })], VIENNA, [], [], { day: ON_FILING_DAY, bindingOn: '2024-03-01' })?.split('\n')[3] ?? ''
    expect(long).toHaveLength(MAX_TURN_LINE_CHARS)
    expect(long).toContain(`${OTHER_EDITION_BINDING} on 2024-03-01: edition 2023-02-01`)
  })

  it('fits the agent’s bound at its longest, and still says how many it left out', () => {
    const long = Array.from({ length: MAX_TURN_ENTRIES + 3 }, (_, index) => entry({ title: `${index} ${'x'.repeat(500)}` }))
    const block = renderBaseKnowledgeBlock(long, VIENNA, [], [], { day: ON_FILING_DAY, bindingOn: '2024-03-01' }) ?? ''
    expect(block.length).toBeLessThanOrEqual(MAX_TURN_BLOCK_CHARS)
    const lines = block.split('\n')
    const shown = lines.filter((text) => text.startsWith('- ') && !text.startsWith('- …')).length
    expect(lines.at(-1)).toBe(`- … and ${long.length - shown} more not listed here.`)
  })

  it('is bounded, and says how many it left out', () => {
    const many = Array.from({ length: MAX_TURN_ENTRIES + 3 }, (_, index) => entry({ title: `Norm ${index}` }))
    const lines = renderBaseKnowledgeBlock(many, VIENNA)?.split('\n') ?? []
    expect(lines).toHaveLength(MAX_TURN_ENTRIES + 2)
    expect(lines.at(-1)).toBe('- … and 3 more not listed here.')
  })
})
