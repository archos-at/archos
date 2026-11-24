import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentVersions, type DocumentVersion, type NewDocumentVersion } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import { lockStorageQuota, readStorageUsage } from '@/lib/storage/repository'
import type { DocumentVersionState } from '../lifecycle-vocabulary'
import { LostCompareAndSwap } from './state-swap'
import type { Transaction } from './transaction'

export type VersionStorageColumns = Pick<
  DocumentVersion,
  'storageKey' | 'storageBucket' | 'contentType' | 'fileSize' | 'contentHash'
>

export interface ExpectedVersionContent {
  state: DocumentVersionState
  storageKey: string
  contentHash: string | null
}

export interface SwapVersionContentInput {
  versionId: string
  documentId: string
  organizationId: string
  expected: ExpectedVersionContent
  patch: Partial<Omit<NewDocumentVersion, 'id' | 'organizationId' | 'documentId'>> &
    VersionStorageColumns
  mirrorsItem: boolean
  quotaBytes: number | null
}

export type SwapVersionContentOutcome =
  | {
      ok: true
      version: DocumentVersion
      previousKeyOrphaned: boolean
    }
  | { ok: false; reason: 'conflict' }
  | { ok: false; reason: 'quota'; usedBytes: number }

class OverQuota extends Error {
  constructor(readonly usedBytes: number) {
    super('storage quota exceeded')
    this.name = 'OverQuota'
  }
}

export async function swapVersionContent(
  input: SwapVersionContentInput,
): Promise<SwapVersionContentOutcome> {
  const db = getDb()
  const { versionId, documentId, organizationId, expected, patch, quotaBytes } = input
  try {
    return await db.transaction(async (tx) => {
      await lockStorageQuota(tx, organizationId)
      const usedBefore = quotaBytes === null ? 0 : await readStorageUsage(tx, organizationId)

      const [version] = await tx
        .update(documentVersions)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(documentVersions.id, versionId),
            eq(documentVersions.documentId, documentId),
            eq(documentVersions.organizationId, organizationId),
            eq(documentVersions.state, expected.state),
            eq(documentVersions.storageKey, expected.storageKey),
            expected.contentHash === null
              ? isNull(documentVersions.contentHash)
              : eq(documentVersions.contentHash, expected.contentHash),
          ),
        )
        .returning()
      if (!version) throw new LostCompareAndSwap()

      if (input.mirrorsItem) {
        await tx
          .update(documents)
          .set({
            storageKey: version.storageKey,
            storageBucket: version.storageBucket,
            contentType: version.contentType,
            fileSize: version.fileSize,
            contentHash: version.contentHash,
            updatedAt: new Date(),
          })
          .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
      }

      if (quotaBytes !== null) {
        const usedAfter = await readStorageUsage(tx, organizationId)
        if (usedAfter > quotaBytes && usedAfter > usedBefore) throw new OverQuota(usedBefore)
      }

      const previousKeyOrphaned = await keyIsUnnamed(
        tx,
        documentId,
        organizationId,
        expected.storageKey,
      )
      return { ok: true as const, version, previousKeyOrphaned }
    })
  } catch (error) {
    if (error instanceof LostCompareAndSwap) return { ok: false, reason: 'conflict' }
    if (error instanceof OverQuota) {
      return { ok: false, reason: 'quota', usedBytes: error.usedBytes }
    }
    throw error
  }
}

async function keyIsUnnamed(
  tx: Transaction,
  documentId: string,
  organizationId: string,
  storageKey: string,
): Promise<boolean> {
  const rows = await tx.execute<{ named: boolean | string }>(sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM document_versions v
        WHERE v.document_id = ${documentId}
          AND v.organization_id = ${organizationId}
          AND v.storage_key = ${storageKey}
      )
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = ${documentId}
          AND d.organization_id = ${organizationId}
          AND d.storage_key = ${storageKey}
      )
    ) AS named
  `)
  const named = Array.from(rows)[0]?.named
  return !(named === true || named === 't')
}
