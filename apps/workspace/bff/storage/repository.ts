import 'server-only'
import { and, eq, ne, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { documentVersions } from '@/lib/db/schema/document-versions'
import { documents, DOCUMENT_SCOPES, type DocumentScope, type NewDocument } from '@/lib/db/schema/documents'
import { mapDocumentInsertError, ReplacedDocumentGoneError } from '@/lib/documents/unique-conflicts'

export interface StorageScopeUsage {
  bytes: number
  documents: number
}

export type StorageUsageByScope = Record<DocumentScope | 'total', StorageScopeUsage>

const emptyScope = (): StorageScopeUsage => ({ bytes: 0, documents: 0 })

function isDocumentScope(value: string): value is DocumentScope {
  return (DOCUMENT_SCOPES as readonly string[]).includes(value)
}

export async function aggregateStorageUsage(
  organizationId: string
): Promise<StorageUsageByScope> {
  const db = getDb()

  const [rows, overhead] = await Promise.all([
    db
      .select({
        scope: documents.scope,
        bytes: sql<string>`coalesce(sum(${documents.fileSize}), 0)::bigint`,
        documents: sql<string>`count(*)::bigint`,
      })
      .from(documents)
      .where(eq(documents.organizationId, organizationId))
      .groupBy(documents.scope),
    versionOverheadByScope(organizationId),
  ])

  const usage = Object.fromEntries(
    [...DOCUMENT_SCOPES, 'total' as const].map((scope) => [scope, emptyScope()]),
  ) as StorageUsageByScope

  for (const row of rows) {
    const bytes = (Number(row.bytes) || 0) + (overhead.get(row.scope) ?? 0)
    const count = Number(row.documents) || 0
    usage.total = {
      bytes: usage.total.bytes + bytes,
      documents: usage.total.documents + count,
    }
    if (!isDocumentScope(row.scope)) continue
    usage[row.scope] = { bytes, documents: count }
  }

  return usage
}

export async function sumStorageBytes(organizationId: string): Promise<number> {
  const [items, versions] = await Promise.all([
    sumItemBytes(organizationId),
    versionOverheadBytes(organizationId),
  ])
  return items + versions
}

async function sumItemBytes(organizationId: string): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ bytes: sql<string>`coalesce(sum(${documents.fileSize}), 0)::bigint` })
    .from(documents)
    .where(eq(documents.organizationId, organizationId))
  return Number(row?.bytes) || 0
}

export async function versionOverheadByScope(
  organizationId: string,
): Promise<Map<string, number>> {
  const db = getDb()
  const rows = await db
    .select({
      scope: documents.scope,
      bytes: sql<string>`coalesce(sum(${documentVersions.fileSize}), 0)::bigint`,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(documentVersions.organizationId, organizationId),
        ne(documentVersions.storageKey, documents.storageKey),
      ),
    )
    .groupBy(documents.scope)
  return new Map(rows.map((row) => [row.scope, Number(row.bytes) || 0]))
}

export async function versionOverheadBytes(organizationId: string): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ bytes: sql<string>`coalesce(sum(${documentVersions.fileSize}), 0)::bigint` })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(documentVersions.organizationId, organizationId),
        ne(documentVersions.storageKey, documents.storageKey),
      ),
    )
  return Number(row?.bytes) || 0
}

export async function aggregateStorageUsageByOrganization(): Promise<
  Map<string, StorageScopeUsage>
> {
  const db = getDb()

  const rows = await withPlatformAccess(
    'platform storage: stored bytes for every organization',
    () =>
      db
        .select({
          organizationId: documents.organizationId,
          bytes: sql<string>`coalesce(sum(${documents.fileSize}), 0)::bigint`,
          documents: sql<string>`count(*)::bigint`,
        })
        .from(documents)
        .groupBy(documents.organizationId),
  )

  return new Map(
    rows.map((row) => [
      row.organizationId,
      { bytes: Number(row.bytes) || 0, documents: Number(row.documents) || 0 },
    ]),
  )
}

function versionOverheadSql(organizationId: string) {
  return sql<string>`(
    SELECT coalesce(sum(v.file_size), 0)::bigint
    FROM document_versions v
    JOIN documents d ON d.id = v.document_id
    WHERE v.organization_id = ${organizationId}
      AND v.storage_key <> d.storage_key
  )`
}

export type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

export async function lockStorageQuota(tx: DbTransaction, organizationId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`storage_quota:${organizationId}`}, 0))`,
  )
}

export async function readStorageUsage(tx: DbTransaction, organizationId: string): Promise<number> {
  const [row] = await tx
    .select({
      bytes: sql<string>`coalesce(sum(${documents.fileSize}), 0)::bigint`,
      versionBytes: versionOverheadSql(organizationId),
    })
    .from(documents)
    .where(eq(documents.organizationId, organizationId))
  return (Number(row?.bytes) || 0) + (Number(row?.versionBytes) || 0)
}

export async function replaceDocumentWithinQuota(
  organizationId: string,
  documentId: string,
  next: {
    storageKey: string
    storageBucket: string | null
    fileSize: number
    contentType: string | null
    contentHash: string | null
    folderId: string | null
    createdBy: string
    uploadBatchId?: string | null
  },
  quotaBytes: number | null,
): Promise<{ ok: true } | { ok: false; usedBytes: number }> {
  const db = getDb()

  return db.transaction(async (tx) => {
    await lockStorageQuota(tx, organizationId)

    if (quotaBytes !== null) {
      const usedBytes = await readStorageUsage(tx, organizationId)
      if (usedBytes + next.fileSize > quotaBytes) {
        return { ok: false as const, usedBytes }
      }
    }

    const updated = await tx
      .update(documents)
      .set({
        storageKey: next.storageKey,
        storageBucket: next.storageBucket,
        fileSize: next.fileSize,
        contentType: next.contentType,
        contentHash: next.contentHash,
        folderId: next.folderId,
        createdBy: next.createdBy,
        status: 'uploaded',
        errorMessage: null,
        screeningOutcome: null,
        screenedHash: null,
        uploadBatchId: next.uploadBatchId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)))
      .returning({ id: documents.id })
    if (updated.length === 0) throw new ReplacedDocumentGoneError(documentId)
    return { ok: true as const }
  })
}

export async function insertDocumentWithinQuota(
  values: NewDocument,
  quotaBytes: number | null,
): Promise<{ ok: true } | { ok: false; usedBytes: number }> {
  const db = getDb()
  const incoming = values.fileSize ?? 0

  return db.transaction(async (tx) => {
    await lockStorageQuota(tx, values.organizationId)

    if (quotaBytes !== null) {
      const usedBytes = await readStorageUsage(tx, values.organizationId)
      if (usedBytes + incoming > quotaBytes) {
        return { ok: false as const, usedBytes }
      }
    }

    await tx.insert(documents).values(values)
    return { ok: true as const }
  }).catch((error: unknown) => {
    throw mapDocumentInsertError(error, values.filename)
  })
}
