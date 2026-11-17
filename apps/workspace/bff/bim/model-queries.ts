import 'server-only'
import { and, desc, eq, isNull, notInArray, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'
import { bimModels } from '@/lib/db/schema/bim'
import { documents } from '@/lib/db/schema/documents'
import type { BimModelStatus, BimModelSummary } from './types'

export interface BimModelHeader {
  id: string
  documentId: string
  projectId: string | null
  filename: string
  displayName: string | null
  status: BimModelStatus
  schemaVersion: string | null
  elementCount: number
  errorMessage: string | null
  summary: BimModelSummary | null
  searchKeysIndexed: boolean
  updatedAt: Date
}

const MODEL_COLUMNS = {
  id: bimModels.id,
  documentId: bimModels.documentId,
  projectId: bimModels.projectId,
  filename: documents.filename,
  displayName: documents.displayName,
  status: bimModels.status,
  schemaVersion: bimModels.schemaVersion,
  elementCount: bimModels.elementCount,
  errorMessage: bimModels.errorMessage,
  summary: bimModels.summary,
  searchKeysIndexed: bimModels.searchKeysIndexed,
  updatedAt: bimModels.updatedAt,
} as const

export async function findBimModelById(
  modelId: string,
  organizationId: string,
  reader: DocumentReader
): Promise<BimModelHeader | null> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select(MODEL_COLUMNS)
      .from(bimModels)
      .innerJoin(documents, eq(documents.id, bimModels.documentId))
      .where(and(eq(bimModels.id, modelId), eq(bimModels.organizationId, organizationId), documentVisibleTo(reader)))
      .limit(1)
  )
  return rows[0] ?? null
}

export async function findBimModelByDocument(
  documentId: string,
  organizationId: string,
  reader: DocumentReader
): Promise<BimModelHeader | null> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select(MODEL_COLUMNS)
      .from(bimModels)
      .innerJoin(documents, eq(documents.id, bimModels.documentId))
      .where(
        and(eq(bimModels.documentId, documentId), eq(bimModels.organizationId, organizationId), documentVisibleTo(reader))
      )
      .limit(1)
  )
  return rows[0] ?? null
}

export async function listBimModels(
  organizationId: string,
  options: {
    projectId?: string | null
    includeOfficeShelf?: boolean
    limit?: number
    hiddenFolderIds?: readonly string[]
    reader: DocumentReader
  }
): Promise<BimModelHeader[]> {
  const db = getDb()
  const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? 50)), 200)
  const officeShelfScope = eq(documents.scope, 'office_shelf')
  const scope =
    options.projectId === undefined
      ? undefined
      : options.includeOfficeShelf
        ? sql`(${bimModels.projectId} = ${options.projectId} OR ${officeShelfScope})`
        : options.projectId === null
          ? officeShelfScope
          : eq(bimModels.projectId, options.projectId)
  const hidden = options.hiddenFolderIds ?? []
  const outsideHiddenFolders =
    hidden.length > 0 ? or(isNull(documents.folderId), notInArray(documents.folderId, [...hidden])) : undefined

  return withTenant({ organizationId }, () =>
    db
      .select(MODEL_COLUMNS)
      .from(bimModels)
      .innerJoin(documents, eq(documents.id, bimModels.documentId))
      .where(
        and(
          eq(bimModels.organizationId, organizationId),
          scope,
          outsideHiddenFolders,
          documentVisibleTo(options.reader)
        )
      )
      .orderBy(desc(bimModels.updatedAt))
      .limit(limit)
  )
}
