import { createHash } from 'node:crypto'
import type { NewDocumentSearchFacetsRow, SearchFacetChange, SearchFacetFact, SearchFacetParty } from '@/lib/db/schema/document-search'
import type { DocumentMetadata } from '@/lib/documents/reconcile-status'
import { squashDrawingNumber } from '@/lib/documents/findings'

export interface FacetSubject {
  documentId: string
  organizationId: string
  superseded: boolean
}

export const SEARCH_TEXT_MAX = 20_000

const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5' }

const collapse = (value: string): string => value.normalize('NFC').split(/\s+/).filter(Boolean).join(' ')

export function referenceToken(kind: string, key: string): string {
  return `${kind}:${key}`.normalize('NFC').toLowerCase()
}

export function foldFactValue(key: string, value: string): string {
  let text = collapse(value).toLowerCase().replace(/,/g, '.')
  if (key === 'building_class') {
    const words = text.split(' ')
    const last = words.at(-1) ?? text
    text = ROMAN[last] ?? (text.replace(/\D/g, '') || text)
  }
  return text
}

export function factToken(key: string, value: string): string {
  return `${key}=${foldFactValue(key, value)}`
}

export function factNumber(key: string, value: string): number | null {
  const match = /^-?\d+(\.\d+)?/.exec(foldFactValue(key, value))
  if (!match) return null
  const number = Number(match[0])
  return Number.isFinite(number) ? number : null
}

function documentDateOf(metadata: DocumentMetadata): string | null {
  const dates = metadata.dossier?.dates ?? []
  return (
    dates.find((date) => date.kind === 'issued')?.date ??
    dates.find((date) => date.kind === 'plan_date')?.date ??
    metadata.revisionFacts?.revisionDate ??
    null
  )
}

function capturedAtOf(raw: string | undefined): Date | null {
  if (!raw) return null
  const iso = raw.replace(/^(\d{4}):(\d{2}):(\d{2})[ T]/, '$1-$2-$3T')
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

export function hasReading(metadata: DocumentMetadata | null | undefined): metadata is DocumentMetadata {
  if (!metadata) return false
  return Boolean(
    metadata.summary ||
      metadata.dossier ||
      metadata.revisionFacts ||
      metadata.capture ||
      (metadata.tags && metadata.tags.length > 0) ||
      metadata.coverage
  )
}

function searchTextOf(row: Omit<NewDocumentSearchFacetsRow, 'searchText' | 'fingerprint'>, revisionTitle: string | undefined): string {
  const parts = [
    row.title,
    revisionTitle,
    row.summary,
    ...(row.parties ?? []).map((party) => party.name),
    row.address,
    row.municipality,
    row.planNumber,
    ...Object.values(row.referenceLabels ?? {}),
    ...(row.topics ?? []),
  ]
  return collapse(parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' · ')).slice(
    0,
    SEARCH_TEXT_MAX
  )
}

function fingerprintOf(row: Omit<NewDocumentSearchFacetsRow, 'fingerprint'>): string {
  const { syncedAt: _synced, ...said } = row
  return createHash('sha256').update(JSON.stringify(said)).digest('hex').slice(0, 32)
}

export function toSearchFacets(
  subject: FacetSubject,
  metadata: DocumentMetadata | null | undefined
): NewDocumentSearchFacetsRow | null {
  if (!hasReading(metadata)) return null
  const dossier = metadata.dossier ?? null
  const revision = metadata.revisionFacts ?? null
  const parties: SearchFacetParty[] = (dossier?.parties ?? []).map((party) => ({ role: party.role, name: party.name }))
  const facts: SearchFacetFact[] = (dossier?.facts ?? []).map((fact) => ({
    key: fact.key,
    value: fact.value,
    unit: fact.unit,
    page: fact.page,
  }))
  const factNumbers: Record<string, number> = {}
  for (const fact of facts) {
    const number = factNumber(fact.key, fact.value)
    if (number !== null && !(fact.key in factNumbers)) factNumbers[fact.key] = number
  }
  const references = metadata.docReferences ?? []
  const referenceLabels: Record<string, string> = {}
  for (const reference of references) {
    const token = referenceToken(reference.kind, reference.key)
    if (!(token in referenceLabels)) referenceLabels[token] = reference.label
  }
  const changedFacts: SearchFacetChange[] = (dossier?.changes ?? []).map((change) => ({
    key: change.key,
    before: change.before,
    after: change.after,
    page: change.page,
  }))
  const capture = metadata.capture ?? null
  const base = {
    documentId: subject.documentId,
    organizationId: subject.organizationId,
    documentType: dossier?.documentType ?? null,
    tags: [...new Set(metadata.tags ?? [])],
    topics: [...new Set(metadata.topics ?? [])],
    title: dossier?.title ?? revision?.title ?? null,
    summary: dossier?.summary ?? metadata.summary ?? null,
    parties,
    partyRoles: [...new Set(parties.map((party) => party.role))],
    address: dossier?.place?.address ?? null,
    municipality: dossier?.place?.municipality ?? null,
    federalState: dossier?.place?.state ?? null,
    facts,
    factTokens: [...new Set(facts.map((fact) => factToken(fact.key, fact.value)))],
    factNumbers,
    referenceTokens: Object.keys(referenceLabels),
    referenceLabels,
    planNumber: revision?.documentNumber ?? null,
    planNumberKey: revision?.documentNumber ? squashDrawingNumber(revision.documentNumber) : null,
    planIndex: revision?.revision ?? null,
    planDate: revision?.revisionDate ?? null,
    scale: revision?.scale ?? null,
    documentDate: documentDateOf(metadata),
    capturedAt: capturedAtOf(capture?.capturedAt),
    camera: capture?.camera ?? null,
    pageCount: metadata.pageCount ?? metadata.coverage?.pages ?? null,
    pagesNotRead: metadata.coverage ? metadata.coverage.notRead : null,
    superseded: subject.superseded,
    changedFacts,
    changedFactKeys: changedFacts.map((change) => change.key),
  } satisfies Omit<NewDocumentSearchFacetsRow, 'searchText' | 'fingerprint'>
  const withText = { ...base, searchText: searchTextOf(base, revision?.title) }
  return { ...withText, fingerprint: fingerprintOf(withText) }
}
