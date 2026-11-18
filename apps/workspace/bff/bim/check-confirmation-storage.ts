import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'
import { bimCheckConfirmations, bimModels } from '@/lib/db/schema/bim'
import { documents } from '@/lib/db/schema/documents'

export interface BimStoredConfirmation {
  ruleId: string
  modelId: string
  confirmedBy: string
  note: string | null
  confirmedAt: Date
}

export async function listBimCheckConfirmations(
  organizationId: string,
  projectId: string,
  reader: DocumentReader
): Promise<BimStoredConfirmation[]> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({
        ruleId: bimCheckConfirmations.ruleId,
        modelId: bimCheckConfirmations.modelId,
        confirmedBy: bimCheckConfirmations.confirmedBy,
        note: bimCheckConfirmations.note,
        confirmedAt: bimCheckConfirmations.updatedAt,
      })
      .from(bimCheckConfirmations)
      .innerJoin(
        bimModels,
        and(eq(bimModels.id, bimCheckConfirmations.modelId), eq(bimModels.organizationId, organizationId))
      )
      .innerJoin(documents, eq(documents.id, bimModels.documentId))
      .where(
        and(
          eq(bimCheckConfirmations.organizationId, organizationId),
          eq(bimCheckConfirmations.projectId, projectId),
          documentVisibleTo(reader)
        )
      )
  )
  return rows
}

export async function upsertBimCheckConfirmation(input: {
  organizationId: string
  projectId: string
  ruleId: string
  modelId: string
  confirmedBy: string
  note: string | null
}): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId: input.organizationId }, () =>
    db
      .insert(bimCheckConfirmations)
      .values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        ruleId: input.ruleId,
        modelId: input.modelId,
        confirmedBy: input.confirmedBy,
        note: input.note,
      })
      .onConflictDoUpdate({
        target: [
          bimCheckConfirmations.organizationId,
          bimCheckConfirmations.projectId,
          bimCheckConfirmations.ruleId,
          bimCheckConfirmations.modelId,
        ],
        set: {
          confirmedBy: input.confirmedBy,
          note: input.note,
          updatedAt: new Date(),
        },
      })
  )
}

export async function deleteBimCheckConfirmation(input: {
  organizationId: string
  projectId: string
  ruleId: string
  modelIds: readonly string[]
}): Promise<void> {
  if (input.modelIds.length === 0) return
  const db = getDb()
  await withTenant({ organizationId: input.organizationId }, () =>
    db
      .delete(bimCheckConfirmations)
      .where(
        and(
          eq(bimCheckConfirmations.organizationId, input.organizationId),
          eq(bimCheckConfirmations.projectId, input.projectId),
          eq(bimCheckConfirmations.ruleId, input.ruleId),
          inArray(bimCheckConfirmations.modelId, [...input.modelIds])
        )
      )
  )
}
