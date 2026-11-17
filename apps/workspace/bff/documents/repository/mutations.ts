import 'server-only'
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { documents } from '@/lib/db/schema/documents'
import { FILING_CHOICE_METADATA_KEY } from '../filing-choice-key'
import { statusesAccepting, type DocumentReadingEvent } from '../reading-lifecycle'
import { sameDispatch } from './reconcile'

export async function deleteProjectDocument(
  documentId: string,
  organizationId: string,
  projectId: string,
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .delete(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          eq(documents.projectId, projectId),
        ),
      ),
  )
}

export async function setDocumentDisplayName(
  documentId: string,
  organizationId: string,
  displayName: string | null,
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({ displayName, updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId))),
  )
}

export const statusAccepts = (event: DocumentReadingEvent): SQL => inArray(documents.status, statusesAccepting(event))

export interface DispatchStart {
  ingestJobId: string | null
  storageKey: string | null
}

export const unchangedSinceDispatch = (start: DispatchStart): SQL | undefined =>
  and(
    sameDispatch(start.ingestJobId),
    start.storageKey === null ? isNull(documents.storageKey) : eq(documents.storageKey, start.storageKey),
  )

export async function setDocumentIngestJob(
  documentId: string,
  organizationId: string,
  ingestJobId: string,
  filingChoice: Record<string, unknown> | null = null,
  start?: DispatchStart,
): Promise<boolean> {
  const db = getDb()
  const moved = await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({
        status: 'pending',
        metadata: sql`jsonb_strip_nulls(jsonb_build_object('ingestJobId', ${ingestJobId}::text, 'ingestContentHash', ${documents.contentHash}, ${FILING_CHOICE_METADATA_KEY}::text, ${filingChoice === null ? null : JSON.stringify(filingChoice)}::jsonb))`,
        ingestFailureCategory: null,
        ingestRetryable: null,
        ingestAttempts: sql`coalesce(${documents.ingestAttempts}, 0) + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          statusAccepts('dispatch'),
          start ? unchangedSinceDispatch(start) : undefined,
        ),
      )
      .returning({ id: documents.id }),
  )
  return moved.length > 0
}

export async function markDocumentNotIndexed(documentId: string, organizationId: string): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({ status: 'stored', updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId), statusAccepts('unindex'))),
  )
}

export const PLACEMENT_REINGEST_MARKER = 'placementReingest'

export async function markDocumentProcessing(
  documentId: string,
  organizationId: string,
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({
        status: 'processing',
        errorMessage: null,
        metadata: sql`coalesce(${documents.metadata}, '{}'::jsonb) - 'ingestJobId' - 'bffJobId' - ${PLACEMENT_REINGEST_MARKER}::text`,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId), statusAccepts('process'))),
  )
}

export async function setDocumentBackgroundJob(
  documentId: string,
  organizationId: string,
  jobId: string,
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({ metadata: sql`coalesce(${documents.metadata}, '{}'::jsonb) || ${JSON.stringify({ bffJobId: jobId })}::text::jsonb` })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          eq(documents.status, 'processing'),
        ),
      ),
  )
}
