import { DOCUMENT_TYPE_TAGS } from './tag-vocabulary'
import {
  profileDisagreements,
  PROFILE_COMPARED_KEYS,
  type ProfileComparedKey,
  type ProfileFacts,
} from './profile-contradictions'
import type {
  CoverageReason,
  DocumentReference,
  Dossier,
  DossierDocumentType,
  DossierFactKey,
  ReadingCoverage,
} from './dossier'

export interface FindingsDocument {
  id: string
  name: string
  filename: string
  superseded: boolean
  tags: readonly string[]
  dossier: Dossier | null
  references: readonly DocumentReference[]
  coverage: ReadingCoverage | null
  documentNumber: string | null
}

export interface FindingsRow {
  id: string
  filename: string
  displayName?: string | null
  tags?: readonly string[] | null
  dossier?: Dossier | null
  docReferences?: readonly DocumentReference[] | null
  coverage?: ReadingCoverage | null
  revisionFacts?: { documentNumber?: string } | null
  revision?: { supersededBy: unknown } | null
}

export function toFindingsDocument(row: FindingsRow): FindingsDocument {
  return {
    id: row.id,
    name: row.displayName ?? row.filename,
    filename: row.filename,
    superseded: Boolean(row.revision?.supersededBy),
    tags: row.tags ?? [],
    dossier: row.dossier ?? null,
    references: row.docReferences ?? [],
    coverage: row.coverage ?? null,
    documentNumber: row.revisionFacts?.documentNumber ?? null,
  }
}

export interface DocumentPointer {
  documentId: string
  name: string
}

export interface FindingSource extends DocumentPointer {
  pages: number[]
  value?: string
  unit?: string | null
}

export const DOCUMENT_FINDING_KINDS = ['profile_contradiction', 'contradiction', 'missing_document', 'missing_plan', 'incomplete_read'] as const
export type DocumentFindingKind = (typeof DOCUMENT_FINDING_KINDS)[number]

export type DocumentFinding =
  | { kind: 'missing_document'; documentType: DossierDocumentType; label: string; sources: FindingSource[] }
  | { kind: 'missing_plan'; key: string; label: string; sources: FindingSource[] }
  | { kind: 'contradiction'; factKey: DossierFactKey; sources: FindingSource[] }
  | {
      kind: 'profile_contradiction'
      subject: ProfileComparedKey
      profileKey: string
      profileValue: string
      sources: FindingSource[]
    }
  | {
      kind: 'incomplete_read'
      pages: number
      notRead: number
      reasons: Partial<Record<CoverageReason, number>>
      sources: FindingSource[]
    }

export interface ResolvedReference {
  reference: DocumentReference
  resolution: 'resolved' | 'missing' | 'self' | 'external'
  targets: DocumentPointer[]
}

export interface IncomingReference {
  source: DocumentPointer
  reference: DocumentReference
}

type TagName = (typeof DOCUMENT_TYPE_TAGS)[number]

const TAG_DOCUMENT_TYPES: ReadonlyMap<TagName, readonly DossierDocumentType[]> = new Map<
  TagName,
  readonly DossierDocumentType[]
>([
  ['Bebauungsplan', ['zoning_plan']],
  ['Flächenwidmungsplan', ['zoning_plan']],
  ['Grundriss', ['submission_drawing']],
  ['Schnitt', ['submission_drawing']],
  ['Ansicht', ['submission_drawing']],
  ['Detail', ['construction_drawing']],
  ['Gutachten', ['expert_report']],
  ['Bescheid', ['permit']],
  ['Norm/Richtlinie', ['legal_text']],
  ['Vertrag', ['contract']],
  ['Foto', ['photo']],
])

const REPORT_BY_DISCIPLINE: ReadonlyMap<string, DossierDocumentType> = new Map([
  ['Brandschutz', 'fire_safety_concept'],
  ['Standsicherheit', 'structural_analysis'],
])

const ANSWERED_BY: Partial<Record<DossierDocumentType, readonly DossierDocumentType[]>> = {
  expert_report: ['soil_report', 'building_physics', 'fire_safety_concept', 'structural_analysis', 'energy_certificate'],
}

export function documentTypesOf(document: Pick<FindingsDocument, 'dossier' | 'tags'>): Set<DossierDocumentType> {
  const types = new Set<DossierDocumentType>()
  if (document.dossier?.documentType) types.add(document.dossier.documentType)
  for (const tag of document.tags) {
    for (const type of TAG_DOCUMENT_TYPES.get(tag as TagName) ?? []) types.add(type)
  }
  if (document.tags.includes('Gutachten')) {
    for (const tag of document.tags) {
      const report = REPORT_BY_DISCIPLINE.get(tag)
      if (report) types.add(report)
    }
  }
  return types
}

export function squashDrawingNumber(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/[\s\-_]+/g, '')
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
const DIGIT = /\p{N}/u
const NUMBER_SEPARATOR = /[\s\-_.]/

function matchAt(name: readonly string[], start: number, key: readonly string[]): number {
  let at = start
  for (let index = 0; index < key.length; index++) {
    if (index > 0) while (at < name.length && NUMBER_SEPARATOR.test(name[at]!)) at++
    if (name[at] !== key[index]) return -1
    at++
  }
  return at
}

function fileNameCarries(filename: string, squashedKey: string): boolean {
  if (squashedKey.length < 2) return false
  const name = [...filename.normalize('NFC').toLowerCase()]
  const key = [...squashedKey.toLowerCase()]
  for (let start = 0; start < name.length; start++) {
    if (start > 0 && LETTER_OR_DIGIT.test(name[start - 1]!)) continue
    const end = matchAt(name, start, key)
    if (end >= 0 && !(end < name.length && DIGIT.test(name[end]!))) return true
  }
  return false
}

function drawingKeys(reference: DocumentReference): string[] {
  const keys = [squashDrawingNumber(reference.key)]
  const sheet = reference.key.split('/').at(-1)
  if (sheet && sheet !== reference.key) keys.push(squashDrawingNumber(sheet))
  return keys.filter((key) => key.length > 0)
}

const pointer = (document: FindingsDocument): DocumentPointer => ({ documentId: document.id, name: document.name })

function targetsOf(reference: DocumentReference, documents: readonly FindingsDocument[]): FindingsDocument[] | null {
  if (reference.kind === 'norm' || reference.kind === 'law') return null
  if (reference.kind === 'document') {
    const wanted = new Set<string>([reference.key, ...(ANSWERED_BY[reference.key as DossierDocumentType] ?? [])])
    return documents.filter((document) => [...documentTypesOf(document)].some((type) => wanted.has(type)))
  }
  const keys = drawingKeys(reference)
  const byNumber = documents.filter(
    (document) => document.documentNumber !== null && keys.includes(squashDrawingNumber(document.documentNumber))
  )
  if (byNumber.length > 0) return byNumber
  return documents.filter((document) => keys.some((key) => fileNameCarries(document.filename, key)))
}

export function resolveReferences(
  document: FindingsDocument,
  documents: readonly FindingsDocument[]
): ResolvedReference[] {
  return document.references.map((reference) => {
    const found = targetsOf(reference, documents)
    if (found === null) return { reference, resolution: 'external', targets: [] }
    const others = found.filter((target) => target.id !== document.id)
    if (others.length > 0) return { reference, resolution: 'resolved', targets: others.map(pointer) }
    return { reference, resolution: found.length > 0 ? 'self' : 'missing', targets: [] }
  })
}

export function referencedBy(document: FindingsDocument, documents: readonly FindingsDocument[]): IncomingReference[] {
  const incoming: IncomingReference[] = []
  for (const source of documents) {
    if (source.id === document.id) continue
    for (const reference of source.references) {
      const found = targetsOf(reference, [document])
      if (found && found.length > 0) incoming.push({ source: pointer(source), reference })
    }
  }
  return incoming
}

export function normalizeFactValue(value: string): string {
  const text = value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(\d),(\d)/g, '$1.$2')
  return /^-?\d+(\.\d+)?$/.test(text) ? String(Number(text)) : text
}

const byName = (a: DocumentPointer, b: DocumentPointer): number => a.name.localeCompare(b.name, 'de')

function missingFindings(current: readonly FindingsDocument[], documents: readonly FindingsDocument[]): DocumentFinding[] {
  const missing = new Map<string, { reference: DocumentReference; sources: FindingSource[] }>()
  for (const document of current) {
    for (const reference of document.references) {
      if (reference.kind !== 'document' && reference.kind !== 'plan') continue
      const found = targetsOf(reference, documents)
      if (found === null || found.length > 0) continue
      const identity = `${reference.kind}\u0000${reference.kind === 'plan' ? drawingKeys(reference)[0] : reference.key}`
      const entry = missing.get(identity) ?? { reference, sources: [] }
      entry.sources.push({ ...pointer(document), pages: reference.pages })
      missing.set(identity, entry)
    }
  }
  return [...missing.values()].map(({ reference, sources }) =>
    reference.kind === 'document'
      ? {
          kind: 'missing_document' as const,
          documentType: reference.key as DossierDocumentType,
          label: reference.label,
          sources: sources.sort(byName),
        }
      : { kind: 'missing_plan' as const, key: reference.key, label: reference.label, sources: sources.sort(byName) }
  )
}

function contradictionFindings(current: readonly FindingsDocument[]): DocumentFinding[] {
  const byKey = new Map<DossierFactKey, Map<string, Map<string, FindingSource>>>()
  for (const document of current) {
    for (const fact of document.dossier?.facts ?? []) {
      const normalized = normalizeFactValue(fact.value)
      const perDocument = byKey.get(fact.key) ?? new Map<string, Map<string, FindingSource>>()
      const values = perDocument.get(document.id) ?? new Map<string, FindingSource>()
      const source = values.get(normalized) ?? { ...pointer(document), pages: [], value: fact.value, unit: fact.unit }
      if (fact.page !== null && !source.pages.includes(fact.page)) source.pages = [...source.pages, fact.page].sort((a, b) => a - b)
      values.set(normalized, source)
      perDocument.set(document.id, values)
      byKey.set(fact.key, perDocument)
    }
  }
  const findings: DocumentFinding[] = []
  for (const [factKey, perDocument] of byKey) {
    const sets = [...perDocument.values()].map((values) => new Set(values.keys()))
    const disagree = sets.some((a, i) => sets.slice(i + 1).some((b) => ![...a].some((value) => b.has(value))))
    if (!disagree) continue
    const sources = [...perDocument.values()].flatMap((values) => [...values.values()]).sort(byName)
    findings.push({ kind: 'contradiction', factKey, sources })
  }
  return findings
}

function profileFindings(current: readonly FindingsDocument[], profile: ProfileFacts | null): DocumentFinding[] {
  if (!profile?.facts) return []
  const byKey = new Map<ProfileComparedKey, { profileKey: string; profileValue: string; sources: FindingSource[] }>()
  for (const document of current) {
    for (const disagreement of profileDisagreements(document.dossier, profile)) {
      const entry = byKey.get(disagreement.profile.key) ?? {
        profileKey: disagreement.profile.profileKey,
        profileValue: disagreement.profile.display,
        sources: [],
      }
      for (const statement of disagreement.statements) {
        entry.sources.push({ ...pointer(document), pages: statement.pages, value: statement.value, unit: statement.unit })
      }
      byKey.set(disagreement.profile.key, entry)
    }
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => PROFILE_COMPARED_KEYS.indexOf(a) - PROFILE_COMPARED_KEYS.indexOf(b))
    .map(([subject, entry]) => ({
      kind: 'profile_contradiction' as const,
      subject,
      profileKey: entry.profileKey,
      profileValue: entry.profileValue,
      sources: entry.sources.sort(byName),
    }))
}

function incompleteReadFindings(current: readonly FindingsDocument[]): DocumentFinding[] {
  return current
    .filter((document) => (document.coverage?.notRead ?? 0) > 0)
    .sort(byNamePointer)
    .map((document) => {
      const coverage = document.coverage as ReadingCoverage
      return {
        kind: 'incomplete_read' as const,
        pages: coverage.pages,
        notRead: coverage.notRead,
        reasons: coverage.reasons,
        sources: [{ ...pointer(document), pages: [] }],
      }
    })
}

const byNamePointer = (a: FindingsDocument, b: FindingsDocument): number => a.name.localeCompare(b.name, 'de')

export function deriveDocumentFindings(
  documents: readonly FindingsDocument[],
  profile: ProfileFacts | null = null
): DocumentFinding[] {
  const current = documents.filter((document) => !document.superseded)
  const rank = (finding: DocumentFinding): number => DOCUMENT_FINDING_KINDS.indexOf(finding.kind)
  return [
    ...profileFindings(current, profile),
    ...contradictionFindings(current),
    ...missingFindings(current, documents),
    ...incompleteReadFindings(current),
  ].sort(
    (a, b) => rank(a) - rank(b)
  )
}

export function findingIdentity(finding: DocumentFinding): string {
  switch (finding.kind) {
    case 'profile_contradiction':
      return `${finding.kind}:${finding.subject}`
    case 'contradiction':
      return `${finding.kind}:${finding.factKey}`
    case 'missing_document':
      return `${finding.kind}:${finding.documentType}`
    case 'missing_plan':
      return `${finding.kind}:${squashDrawingNumber(finding.key)}`
    case 'incomplete_read':
      return `${finding.kind}:${finding.sources[0]?.documentId ?? ''}`
  }
}

export function findingConcerns(finding: DocumentFinding, documentId: string): boolean {
  return finding.sources.some((source) => source.documentId === documentId)
}
