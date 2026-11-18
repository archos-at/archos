import 'server-only'
import { and, asc, desc, eq, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import { CROSS_PROJECT_MAX_PERMIT_REQUIREMENTS, CROSS_PROJECT_MAX_PERMITS } from '@/lib/cross-project/types'
import { getDb } from '@/lib/db'
import { documentVisibleTo, internalRead, SCREENED_ONLY } from '@/lib/documents/visibility'
import { documents } from '@/lib/db/schema/documents'
import { permitRecords, permitRequirements, type PermitRecordKind, type PermitRequirementKind } from '@/lib/db/schema/permit-records'
import { projects } from '@/lib/db/schema/projects'
import { contentTokens, jaccardSimilarity, normalizeContentGerman } from '@/lib/knowledge/consolidation'
import { cosineSimilaritySql, embedNote, type EmbeddedNote } from '@/lib/knowledge/embeddings'
import { fuseHybridRelevance } from '@/lib/knowledge/recall-scoring'
import { NAMESPACED_AGENT_PRODUCER } from '../documents/agent-namespace'
import type { LiveFolderAccess } from './live-access'

export const PERMIT_MAX_RECORDS = CROSS_PROJECT_MAX_PERMITS

export const PERMIT_MAX_REQUIREMENTS_PER_RECORD = CROSS_PROJECT_MAX_PERMIT_REQUIREMENTS

const PERMIT_CANDIDATES = 300
const PERMIT_CANDIDATES_TOKENS_ONLY = 3000

export interface PermitRequirementInput {
  kind: PermitRequirementKind
  content: string
  evidence: string | null
  legalBasis: string | null
  page: number | null
  embedding: EmbeddedNote | null
}

export interface PermitRecordInput {
  organizationId: string
  projectId: string
  documentId: string
  collectionName: string
  fileName: string
  restrictedFolderIds: string[] | null
  model: string
  kind: PermitRecordKind
  authority: string | null
  municipality: string | null
  federalState: string | null
  issuedOn: string | null
  reference: string | null
  requirements: readonly PermitRequirementInput[]
}

export interface PermitScope {
  projectId: string
  access: LiveFolderAccess
}

export function servedFrom(visibleFolderIds: readonly string[] | null): SQL {
  if (visibleFolderIds === null) return sql`true`
  if (visibleFolderIds.length === 0) return isNull(documents.folderId)
  return or(isNull(documents.folderId), inArray(documents.folderId, [...visibleFolderIds])) as SQL
}

export interface FoundPermitRequirement {
  kind: PermitRequirementKind
  content: string
  evidence: string | null
  legalBasis: string | null
  page: number | null
}

export interface FoundPermitRecord {
  projectId: string
  collectionName: string
  fileName: string
  kind: PermitRecordKind
  authority: string | null
  municipality: string | null
  federalState: string | null
  issuedOn: string | null
  reference: string | null
  requirements: FoundPermitRequirement[]
  restrictedFolderIds: string[] | null
}

export interface PermitDocument {
  documentId: string
  projectId: string
  projectCollection: string
  fileName: string
}

export interface PermitDocumentRef {
  collectionName: string
  documentId?: string
  fileName: string
}

export async function findPermitDocument(organizationId: string, ref: PermitDocumentRef): Promise<PermitDocument | null> {
  const [row] = await getDb()
    .select({
      documentId: documents.id,
      projectId: documents.projectId,
      projectCollection: projects.collectionName,
      fileName: documents.filename,
    })
    .from(documents)
    .innerJoin(projects, and(eq(projects.id, documents.projectId), eq(projects.organizationId, documents.organizationId)))
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.collectionName, ref.collectionName),
        ref.documentId
          ? eq(documents.id, ref.documentId)
          : and(
              eq(documents.filename, ref.fileName),
              or(eq(documents.authoredBy, 'user'), eq(documents.authoredByProducer, NAMESPACED_AGENT_PRODUCER))
            ),
        sql`NOT EXISTS (SELECT 1 FROM project_folders f WHERE f.id = ${documents.folderId} AND f.deleted_at IS NOT NULL)`,
        documentVisibleTo(internalRead('ingest'))
      )
    )
    .limit(1)
  if (!row?.projectId) return null
  return { ...row, projectId: row.projectId }
}

export async function replacePermitRecord(input: PermitRecordInput): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx
      .delete(permitRecords)
      .where(and(eq(permitRecords.organizationId, input.organizationId), eq(permitRecords.documentId, input.documentId)))
    const [record] = await tx
      .insert(permitRecords)
      .values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        documentId: input.documentId,
        collectionName: input.collectionName,
        fileName: input.fileName,
        restrictedFolderIds: input.restrictedFolderIds,
        kind: input.kind,
        authority: input.authority,
        municipality: input.municipality,
        federalState: input.federalState,
        issuedOn: input.issuedOn,
        reference: input.reference,
        model: input.model,
      })
      .returning({ id: permitRecords.id })
    if (input.requirements.length === 0) return
    await tx.insert(permitRequirements).values(
      input.requirements.map((requirement, position) => ({
        organizationId: input.organizationId,
        recordId: record.id,
        projectId: input.projectId,
        restrictedFolderIds: input.restrictedFolderIds,
        position,
        kind: requirement.kind,
        content: requirement.content,
        evidence: requirement.evidence,
        legalBasis: requirement.legalBasis,
        page: requirement.page,
        embedding: requirement.embedding?.vector ?? null,
        embeddingModel: requirement.embedding?.fingerprint ?? null,
      }))
    )
  })
}

export async function deletePermitRecord(organizationId: string, documentId: string): Promise<void> {
  await getDb()
    .delete(permitRecords)
    .where(and(eq(permitRecords.organizationId, organizationId), eq(permitRecords.documentId, documentId)))
}

const documentServesItsRecord = and(
  eq(documents.organizationId, permitRecords.organizationId),
  eq(documents.projectId, permitRecords.projectId),
  documentVisibleTo(SCREENED_ONLY),
  eq(documents.lifecycle, 'active'),
  sql`NOT EXISTS (SELECT 1 FROM project_folders f WHERE f.id = ${documents.folderId} AND f.deleted_at IS NOT NULL)`
)

export async function searchPermitRequirements(
  organizationId: string,
  scopes: readonly PermitScope[],
  question: string,
  { maxRecords = PERMIT_MAX_RECORDS, maxPerRecord = PERMIT_MAX_REQUIREMENTS_PER_RECORD } = {}
): Promise<FoundPermitRecord[]> {
  if (scopes.length === 0 || !question.trim()) return []
  const embedded = await embedNote(question, { timeoutMs: 1500 })
  const relevance = embedded
    ? cosineSimilaritySql(permitRequirements.embedding, embedded.vector)
    : sql<number | null>`null::double precision`
  const visible = or(
    ...scopes.map((scope) =>
      and(eq(permitRequirements.projectId, scope.projectId), servedFrom(scope.access.visibleFolderIds))
    )
  )
  const rows = await getDb()
    .select({
      recordId: permitRequirements.recordId,
      projectId: permitRequirements.projectId,
      position: permitRequirements.position,
      kind: permitRequirements.kind,
      content: permitRequirements.content,
      evidence: permitRequirements.evidence,
      legalBasis: permitRequirements.legalBasis,
      page: permitRequirements.page,
      embeddingModel: permitRequirements.embeddingModel,
      relevance,
      collectionName: documents.collectionName,
      fileName: documents.filename,
      folderId: documents.folderId,
      recordKind: permitRecords.kind,
      authority: permitRecords.authority,
      municipality: permitRecords.municipality,
      federalState: permitRecords.federalState,
      issuedOn: permitRecords.issuedOn,
      reference: permitRecords.reference,
    })
    .from(permitRequirements)
    .innerJoin(permitRecords, eq(permitRecords.id, permitRequirements.recordId))
    .innerJoin(documents, eq(documents.id, permitRecords.documentId))
    .where(and(eq(permitRequirements.organizationId, organizationId), visible, documentServesItsRecord))
    .orderBy(...(embedded ? [sql`${relevance} desc nulls last`] : []), desc(permitRequirements.createdAt))
    .limit(embedded ? PERMIT_CANDIDATES : PERMIT_CANDIDATES_TOKENS_ONLY)

  const dense = rows.map((row) =>
    embedded && row.embeddingModel === embedded.fingerprint && row.relevance !== null ? Number(row.relevance) : null
  )
  const asked = contentTokens(question, normalizeContentGerman)
  const lexical = rows.map((row) =>
    jaccardSimilarity(
      asked,
      contentTokens([row.content, row.evidence, row.authority, row.municipality].filter(Boolean).join(' '), normalizeContentGerman)
    )
  )
  const fused = fuseHybridRelevance(dense, lexical)

  const matched = rows
    .map((row, index) => ({ row, score: fused[index] }))
    .filter((entry): entry is { row: (typeof rows)[number]; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)

  const byRecord = new Map<string, typeof matched>()
  for (const entry of matched) {
    const entries = byRecord.get(entry.row.recordId)
    if (entries) entries.push(entry)
    else byRecord.set(entry.row.recordId, [entry])
  }

  const accessOf = new Map(scopes.map((scope) => [scope.projectId, scope.access]))
  return [...byRecord.values()].slice(0, maxRecords).map((entries) => {
    const { row } = entries[0]
    return {
      projectId: String(row.projectId),
      collectionName: row.collectionName,
      fileName: row.fileName,
      kind: row.recordKind,
      authority: row.authority,
      municipality: row.municipality,
      federalState: row.federalState,
      issuedOn: row.issuedOn === null ? null : String(row.issuedOn),
      reference: row.reference,
      restrictedFolderIds: accessOf.get(String(row.projectId))?.restrictionOf(row.folderId) ?? null,
      requirements: entries.slice(0, maxPerRecord).map(({ row: requirement }) => ({
        kind: requirement.kind,
        content: requirement.content,
        evidence: requirement.evidence,
        legalBasis: requirement.legalBasis,
        page: requirement.page === null ? null : Number(requirement.page),
      })),
    }
  })
}

export interface ListedPermitRecord {
  id: string
  fileName: string
  kind: PermitRecordKind
  authority: string | null
  issuedOn: string | null
  requirements: FoundPermitRequirement[]
}

export async function listPermitRecordsForProject(
  organizationId: string,
  projectId: string,
  visibleFolderIds: readonly string[] | null,
  { maxRecords, maxPerRecord }: { maxRecords: number; maxPerRecord: number }
): Promise<ListedPermitRecord[]> {
  const db = getDb()
  const records = await db
    .select({
      id: permitRecords.id,
      fileName: documents.filename,
      kind: permitRecords.kind,
      authority: permitRecords.authority,
      issuedOn: permitRecords.issuedOn,
    })
    .from(permitRecords)
    .innerJoin(documents, eq(documents.id, permitRecords.documentId))
    .where(
      and(
        eq(permitRecords.organizationId, organizationId),
        eq(permitRecords.projectId, projectId),
        servedFrom(visibleFolderIds),
        documentServesItsRecord
      )
    )
    .orderBy(desc(permitRecords.issuedOn), desc(permitRecords.createdAt))
    .limit(maxRecords)
  if (records.length === 0) return []

  const ranked = db.$with('ranked_requirements').as(
    db
      .select({
        recordId: permitRequirements.recordId,
        position: permitRequirements.position,
        kind: permitRequirements.kind,
        content: permitRequirements.content,
        evidence: permitRequirements.evidence,
        legalBasis: permitRequirements.legalBasis,
        page: permitRequirements.page,
        rank: sql<number>`row_number() over (partition by ${permitRequirements.recordId} order by ${permitRequirements.position})`.as(
          'rank'
        ),
      })
      .from(permitRequirements)
      .where(
        and(
          eq(permitRequirements.organizationId, organizationId),
          inArray(
            permitRequirements.recordId,
            records.map((record) => record.id)
          )
        )
      )
  )
  const rows = await db
    .with(ranked)
    .select()
    .from(ranked)
    .where(lte(ranked.rank, maxPerRecord))
    .orderBy(asc(ranked.position))

  const byRecord = new Map<string, FoundPermitRequirement[]>()
  for (const row of rows) {
    const requirement: FoundPermitRequirement = {
      kind: row.kind,
      content: row.content,
      evidence: row.evidence,
      legalBasis: row.legalBasis,
      page: row.page === null ? null : Number(row.page),
    }
    byRecord.set(row.recordId, [...(byRecord.get(row.recordId) ?? []), requirement])
  }
  return records.map((record) => ({
    id: record.id,
    fileName: record.fileName,
    kind: record.kind,
    authority: record.authority,
    issuedOn: record.issuedOn === null ? null : String(record.issuedOn),
    requirements: byRecord.get(record.id) ?? [],
  }))
}
