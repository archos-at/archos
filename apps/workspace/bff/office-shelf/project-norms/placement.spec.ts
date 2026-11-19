/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { offerable, placementFor, recognizedNorms, workKey, type HeldEdition, type HeldWorks, type NormCandidateRow } from './placement'
import { placeProjectNormsBodySchema } from './wire'

function held(designation: string, editionLabel: string, contentHash: string | null, editionId = `edition_${editionLabel}`, at = '2026-01-01'): HeldEdition {
  return {
    entry: {
      editionId,
      documentId: `doc_${editionId}`,
      createdAt: new Date(at),
      values: {
        kind: 'technical_standard',
        title: designation,
        designation,
        editionLabel,
        issuedOn: null,
        inForceFrom: null,
        inForceTo: null,
        territoryIds: [],
        issuer: null,
        addressees: [],
        licenceClass: 'public_open',
      },
    },
    contentHash,
  }
}

function works(...editions: HeldEdition[]): HeldWorks {
  const map = new Map<string, HeldEdition[]>()
  for (const edition of editions) {
    const key = workKey(edition.entry.values.designation)!
    map.set(key, [...(map.get(key) ?? []), edition])
  }
  return map
}

function row(extra: Partial<NormCandidateRow> & { filename: string }): NormCandidateRow {
  return {
    id: extra.filename,
    displayName: null,
    folderId: 'folder_normen',
    status: 'completed',
    authoredBy: 'user',
    screeningOutcome: 'clean',
    contentHash: 'h',
    screenedHash: 'h',
    ...extra,
  }
}

describe('where a project norm lands in the office shelf', () => {
  it('reads a work the same with or without its edition year and spacing', () => {
    expect(workKey('ÖNORM B 1600:2017')).toBe(workKey('ÖNORM  B 1600'))
    expect(workKey(null)).toBeNull()
  })

  it('is new when the office shelf holds no edition of its work', () => {
    expect(placementFor({ designation: 'ÖNORM B 1600:2023', editionLabel: '2023-02-01', contentHash: 'x' }, works(held('ÖNORM B 2320', '2017', 'y')))).toEqual({ kind: 'new' })
    expect(placementFor({ designation: null, editionLabel: '2020', contentHash: 'x' }, works(held('ÖNORM B 2320', '2017', 'y')))).toEqual({ kind: 'new' })
  })

  it('is a new edition of the newest held edition when the work is held in another edition', () => {
    const older = held('ÖNORM B 1600:2012', '2012-01-01', 'a', 'edition_old', '2025-01-01')
    const newer = held('ÖNORM B 1600:2017', '2017-04-15', 'b', 'edition_new', '2026-01-01')
    const placed = placementFor({ designation: 'ÖNORM B 1600:2023', editionLabel: '2023-02-01', contentHash: 'c' }, works(older, newer))
    expect(placed).toEqual({ kind: 'edition', of: newer })
  })

  it('is a duplicate when the same edition is held, by its label or by its bytes', () => {
    const copy = held('ÖNORM B 1600:2017', '2017-04-15', 'b')
    expect(placementFor({ designation: 'ÖNORM B 1600', editionLabel: '2017-04-15', contentHash: 'other' }, works(copy))).toEqual({ kind: 'duplicate', of: copy })
    expect(placementFor({ designation: 'ÖNORM B 1600', editionLabel: 'unbekannt', contentHash: 'b' }, works(copy))).toEqual({ kind: 'duplicate', of: copy })
  })

  it('does not call two unknown editions the same', () => {
    const unknown = held('ÖNORM B 1600', 'unbekannt', 'a')
    expect(placementFor({ designation: 'ÖNORM B 1600', editionLabel: 'unbekannt', contentHash: 'b' }, works(unknown)).kind).toBe('edition')
  })
})

describe('which project norms the agent offers for the office shelf', () => {
  const rows = [
    row({ filename: 'OENORM_B_1600_2017.pdf' }),
    row({ filename: 'Weisung_MA37_Stellplaetze.pdf' }),
    row({ filename: 'Grundriss_EG.pdf' }),
    row({ filename: 'OENORM_B_2320.pdf', status: 'processing' }),
    row({ filename: 'OENORM_B_3691.pdf', screeningOutcome: 'quarantined', status: 'quarantined' }),
  ]

  it('takes the settled files that read as a norm, and nothing else', () => {
    expect(recognizedNorms(rows).map((norm) => norm.fileName)).toEqual(['OENORM_B_1600_2017.pdf', 'Weisung_MA37_Stellplaetze.pdf'])
  })

  it('leaves out a norm kept here, one already suggested, and one whose work the office shelf holds', () => {
    const norms = recognizedNorms(rows)
    const none = { kept: new Set<string>(), suggested: new Set<string>(), works: new Map() }
    expect(offerable(norms, none)).toHaveLength(2)
    expect(offerable(norms, { ...none, kept: new Set(['OENORM_B_1600_2017.pdf']) }).map((norm) => norm.documentId)).toEqual(['Weisung_MA37_Stellplaetze.pdf'])
    expect(offerable(norms, { ...none, suggested: new Set(['Weisung_MA37_Stellplaetze.pdf']) }).map((norm) => norm.documentId)).toEqual(['OENORM_B_1600_2017.pdf'])
    expect(offerable(norms, { ...none, works: works(held('ÖNORM B 1600:2012', '2012', 'z')) }).map((norm) => norm.documentId)).toEqual(['Weisung_MA37_Stellplaetze.pdf'])
  })
})

describe('the placement request', () => {
  const document = { documentId: '7f6f1a50-1b0e-4c7a-9d7e-2a8f3c1d4e5f' }

  it('makes the wider visibility explicit for both office destinations', () => {
    expect(placeProjectNormsBodySchema.safeParse({ destination: 'office_shelf', documents: [document] }).success).toBe(false)
    expect(placeProjectNormsBodySchema.safeParse({ destination: 'suggest', documents: [document] }).success).toBe(false)
    expect(placeProjectNormsBodySchema.safeParse({ destination: 'office_shelf', documents: [document], visibility: 'office' }).success).toBe(true)
    expect(placeProjectNormsBodySchema.safeParse({ destination: 'project', documents: [document] }).success).toBe(true)
  })
})
