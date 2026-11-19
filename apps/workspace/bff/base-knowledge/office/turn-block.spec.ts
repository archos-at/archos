import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaseKnowledgeEntry } from '../wire'
import { projectTerritory } from './authority'
import {
  BASE_KNOWLEDGE_HEADER,
  BINDING_EDITION_RULE,
  MAX_HELD_NAMED,
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
    directory: null,
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

  const MISSING = {
    designation: 'ÖNORM B 1600',
    title: 'Barrierefreies Bauen',
    binding: '2023-02-01',
    held: [{ editionLabel: '2017-04-15', fileName: 'OENORM_B_1600_2017.pdf' }],
  }
  const ON_FILING_DAY = { day: '2024-03-01', basis: 'reference_day' as const }

  it('says the edition in force on the reference day is not held, names it, and forbids the other edition', () => {
    const block = renderBaseKnowledgeBlock([], VIENNA, [], [], { day: ON_FILING_DAY, missing: [MISSING] }) ?? ''
    const lines = block.split('\n')
    expect(lines[1]).toContain("Editions are those in force on 2024-03-01, the project's reference day")
    expect(lines[2]).toBe(BINDING_EDITION_RULE)
    expect(lines[2]).toContain('Do not answer from, quote or paraphrase')
    expect(lines[2]).toContain('offer that the office uploads that edition to the Büroablage')
    expect(lines[3]).toBe(
      '- ÖNORM B 1600: BINDING EDITION NOT HELD; in force on 2024-03-01: edition 2023-02-01; the office holds only 2017-04-15 (file „OENORM_B_1600_2017.pdf“), not in force that day; title „Barrierefreies Bauen“'
    )
  })

  it('says which day it took when the project has none, or there is no project', () => {
    const today = (basis: 'no_reference_day' | 'no_project') =>
      renderBaseKnowledgeBlock([entry()], VIENNA, [], [], { day: { day: '2026-11-19', basis }, missing: [] })?.split('\n')[1]
    expect(today('no_reference_day')).toBe(
      "Editions are those in force today, 2026-11-19, because the project records no reference day; when an answer rests on one, say that you took today's date and why."
    )
    expect(today('no_project')).toContain('because this conversation belongs to no project')
  })

  it('states no day and no rule when it carries no edition', () => {
    const block = renderBaseKnowledgeBlock([], VIENNA, [{ designation: 'ÖNORM B 5371', title: 'Treppen', editionLabel: '2021', hasText: false }], [], { day: ON_FILING_DAY, missing: [] })
    expect(block).not.toContain('Editions are those in force')
    expect(block).not.toContain(BINDING_EDITION_RULE)
  })

  it('bounds the missing editions with the rest, and the held copies it names on each', () => {
    const many = Array.from({ length: MAX_TURN_ENTRIES + 2 }, (_, index) => ({ ...MISSING, designation: `ÖNORM B ${index}` }))
    const lines = renderBaseKnowledgeBlock([entry()], VIENNA, [], [], { day: ON_FILING_DAY, missing: many })?.split('\n') ?? []
    expect(lines).toHaveLength(MAX_TURN_ENTRIES + 4)
    expect(lines.at(-1)).toBe('- … and 3 more not listed here.')
    const copies = Array.from({ length: MAX_HELD_NAMED + 2 }, (_, index) => ({ editionLabel: `200${index}`, fileName: `f${index}.pdf` }))
    const line = renderBaseKnowledgeBlock([], VIENNA, [], [], { day: ON_FILING_DAY, missing: [{ ...MISSING, held: copies }] })?.split('\n')[3] ?? ''
    expect(line).toContain('2002 (file „f2.pdf“) and 2 more')
    expect(line).not.toContain('f3.pdf')
    const long = renderBaseKnowledgeBlock([], VIENNA, [], [], { day: ON_FILING_DAY, missing: [{ ...MISSING, title: 'x'.repeat(500) }] })?.split('\n')[3] ?? ''
    expect(long).toHaveLength(MAX_TURN_LINE_CHARS)
    expect(long).toContain('BINDING EDITION NOT HELD; in force on 2024-03-01: edition 2023-02-01')
  })

  it('fits the agent’s bound at its longest, and still says how many it left out', () => {
    const long = Array.from({ length: MAX_TURN_ENTRIES + 3 }, (_, index) => entry({ title: `${index} ${'x'.repeat(500)}` }))
    const missing = Array.from({ length: 2 }, (_, index) => ({ ...MISSING, title: `${index} ${'y'.repeat(500)}` }))
    const block = renderBaseKnowledgeBlock(long, VIENNA, [], [], { day: ON_FILING_DAY, missing }) ?? ''
    expect(block.length).toBeLessThanOrEqual(MAX_TURN_BLOCK_CHARS)
    const lines = block.split('\n')
    const shown = lines.filter((text) => text.startsWith('- ') && !text.startsWith('- …')).length
    expect(lines.at(-1)).toBe(`- … and ${long.length + missing.length - shown} more not listed here.`)
    expect(lines.slice(3, 5).every((text) => text.includes('BINDING EDITION NOT HELD'))).toBe(true)
  })

  it('is bounded, and says how many it left out', () => {
    const many = Array.from({ length: MAX_TURN_ENTRIES + 3 }, (_, index) => entry({ title: `Norm ${index}` }))
    const lines = renderBaseKnowledgeBlock(many, VIENNA)?.split('\n') ?? []
    expect(lines).toHaveLength(MAX_TURN_ENTRIES + 2)
    expect(lines.at(-1)).toBe('- … and 3 more not listed here.')
  })
})
