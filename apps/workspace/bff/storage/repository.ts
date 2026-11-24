import 'server-only'
import { and, eq, ne, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { MissingTenantContextError, getTenantContext, withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
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

interface ScopeTotal {
  scope: string
  bytes: number
  documents: number
  versionBytes: number
}

const STORAGE_BY_SCOPE = sql`SELECT scope, bytes, documents, version_bytes FROM organization_storage_by_scope()`

function scopeTotals(rows: Iterable<Record<string, unknown>>): ScopeTotal[] {
  return [...rows].map((row) => ({
    scope: String(row.scope),
    bytes: Number(row.bytes) || 0,
    documents: Number(row.documents) || 0,
    versionBytes: Number(row.version_bytes) || 0,
  }))
}

async function storageByScope(organizationId: string): Promise<ScopeTotal[]> {
  return withTenant({ organizationId }, async () => scopeTotals(await getDb().execute(STORAGE_BY_SCOPE)))
}

export async function aggregateStorageUsage(
  organizationId: string
): Promise<StorageUsageByScope> {
  const usage = Object.fromEntries(
    [...DOCUMENT_SCOPES, 'total' as const].map((scope) => [scope, emptyScope()]),
  ) as StorageUsageByScope

  for (const row of await storageByScope(organizationId)) {
    const bytes = row.bytes + row.versionBytes
    usage.total = {
      bytes: usage.total.bytes + bytes,
      documents: usage.total.documents + row.documents,
    }
    if (!isDocumentScope(row.scope)) continue
    usage[row.scope] = { bytes, documents: row.documents }
  }

  return usage
}

const totalBytes = (rows: ScopeTotal[]): number => rows.reduce((sum, row) => sum + row.bytes + row.versionBytes, 0)

export async function sumStorageBytes(organizationId: string): Promise<number> {
  return totalBytes(await storageByScope(organizationId))
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

export type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

export async function lockStorageQuota(tx: DbTransaction, organizationId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`storage_quota:${organizationId}`}, 0))`,
  )
}

export async function readStorageUsage(tx: DbTransaction, organizationId: string): Promise<number> {
  const current = getTenantContext()
  if (current?.kind !== 'tenant' || current.organizationId !== organizationId) throw new MissingTenantContextError()
  return totalBytes(scopeTotals(await tx.execute(STORAGE_BY_SCOPE)))
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
