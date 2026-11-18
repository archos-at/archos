import { z } from 'zod'
import {
  DOSSIER_DOCUMENT_TYPES,
  DOSSIER_FACT_KEYS,
  type DossierDocumentType,
  type DossierFactKey,
} from '@/lib/documents/dossier'
import {
  deriveDocumentFindings,
  DOCUMENT_FINDING_KINDS,
  documentTypesOf,
  findingIdentity,
  resolveReferences,
  type DocumentFinding,
  type FindingsDocument,
} from '@/lib/documents/findings'
import type { ProfileFacts } from '@/lib/documents/profile-contradictions'

export const UPLOAD_REPORT_LIMITS = { types: 8, facts: 6, findings: 5 } as const

const count = z.number().int().min(0).max(100_000)

const uploadReportFindingSchema = z.object({
  kind: z.enum(DOCUMENT_FINDING_KINDS),
  key: z.string().min(1).max(120),
  label: z.string().max(120).nullable(),
  documents: count,
})

export const uploadReportSchema = z.object({
  projectId: z.string().min(1).max(64),
  documents: count,
  read: count,
  byType: z
    .array(z.object({ type: z.enum(DOSSIER_DOCUMENT_TYPES), count }))
    .max(UPLOAD_REPORT_LIMITS.types),
  facts: count,
  factSamples: z
    .array(
      z.object({ key: z.enum(DOSSIER_FACT_KEYS), value: z.string().max(120), unit: z.string().max(24).nullable() })
    )
    .max(UPLOAD_REPORT_LIMITS.facts),
  newFindings: count,
  findings: z.array(uploadReportFindingSchema).max(UPLOAD_REPORT_LIMITS.findings),
  resolvedFindings: count,
  unresolvedReferences: count,
  pagesNotRead: count,
  documentsNotFullyRead: count,
})

export type UploadReport = z.infer<typeof uploadReportSchema>
export type UploadReportFinding = z.infer<typeof uploadReportFindingSchema>

export type UploadReportSummary = Omit<UploadReport, 'projectId'>

export function parseUploadReport(value: unknown): UploadReport | null {
  const parsed = uploadReportSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function countedType(document: FindingsDocument): DossierDocumentType | null {
  if (document.dossier?.documentType) return document.dossier.documentType
  const [first] = [...documentTypesOf(document)].sort(
    (a, b) => DOSSIER_DOCUMENT_TYPES.indexOf(a) - DOSSIER_DOCUMENT_TYPES.indexOf(b)
  )
  return first ?? null
}

function typeCounts(documents: readonly FindingsDocument[]): UploadReport['byType'] {
  const counts = new Map<DossierDocumentType, number>()
  for (const document of documents) {
    const type = countedType(document)
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || DOSSIER_DOCUMENT_TYPES.indexOf(a) - DOSSIER_DOCUMENT_TYPES.indexOf(b))
    .slice(0, UPLOAD_REPORT_LIMITS.types)
    .map(([type, total]) => ({ type, count: total }))
}

function factSamples(documents: readonly FindingsDocument[]): UploadReport['factSamples'] {
  const first = new Map<DossierFactKey, UploadReport['factSamples'][number]>()
  for (const document of documents) {
    for (const fact of document.dossier?.facts ?? []) {
      if (!first.has(fact.key)) first.set(fact.key, { key: fact.key, value: fact.value, unit: fact.unit })
    }
  }
  return [...first.values()]
    .sort((a, b) => DOSSIER_FACT_KEYS.indexOf(a.key) - DOSSIER_FACT_KEYS.indexOf(b.key))
    .slice(0, UPLOAD_REPORT_LIMITS.facts)
}

function reportFinding(finding: DocumentFinding): UploadReportFinding | null {
  const documents = new Set(finding.sources.map((source) => source.documentId)).size
  switch (finding.kind) {
    case 'profile_contradiction':
      return { kind: finding.kind, key: finding.subject, label: null, documents }
    case 'contradiction':
      return { kind: finding.kind, key: finding.factKey, label: null, documents }
    case 'missing_document':
      return { kind: finding.kind, key: finding.documentType, label: null, documents }
    case 'missing_plan':
      return { kind: finding.kind, key: finding.key, label: finding.label, documents }
    case 'incomplete_read':
      return null
  }
}

function unresolvedReferenceCount(batch: readonly FindingsDocument[], project: readonly FindingsDocument[]): number {
  const missing = new Set<string>()
  for (const document of batch) {
    for (const resolved of resolveReferences(document, project)) {
      if (resolved.resolution === 'missing') missing.add(`${resolved.reference.kind}\u0000${resolved.reference.key}`)
    }
  }
  return missing.size
}

export function uploadReport(
  batchDocuments: readonly FindingsDocument[],
  projectDocuments: readonly FindingsDocument[],
  profile: ProfileFacts | null = null
): UploadReportSummary {
  const batchIds = new Set(batchDocuments.map((document) => document.id))
  const before = projectDocuments.filter((document) => !batchIds.has(document.id))
  const after = [...before, ...batchDocuments]
  const findingsBefore = deriveDocumentFindings(before, profile)
  const findingsAfter = deriveDocumentFindings(after, profile)
  const identitiesBefore = new Set(findingsBefore.map(findingIdentity))
  const identitiesAfter = new Set(findingsAfter.map(findingIdentity))
  const added = findingsAfter
    .filter((finding) => !identitiesBefore.has(findingIdentity(finding)))
    .map(reportFinding)
    .filter((finding): finding is UploadReportFinding => finding !== null)
  const resolved = findingsBefore.filter(
    (finding) => finding.kind !== 'incomplete_read' && !identitiesAfter.has(findingIdentity(finding))
  )
  const current = batchDocuments.filter((document) => !document.superseded)
  const partlyRead = current.filter((document) => (document.coverage?.notRead ?? 0) > 0)
  return {
    documents: batchDocuments.length,
    read: batchDocuments.filter((document) => document.dossier !== null || document.coverage !== null).length,
    byType: typeCounts(batchDocuments),
    facts: current.reduce((sum, document) => sum + (document.dossier?.facts.length ?? 0), 0),
    factSamples: factSamples(current),
    newFindings: added.length,
    findings: added.slice(0, UPLOAD_REPORT_LIMITS.findings),
    resolvedFindings: resolved.length,
    unresolvedReferences: unresolvedReferenceCount(current, after),
    pagesNotRead: partlyRead.reduce((sum, document) => sum + (document.coverage?.notRead ?? 0), 0),
    documentsNotFullyRead: partlyRead.length,
  }
}

export function reportSaysSomething(report: UploadReportSummary): boolean {
  return report.read > 0
}
