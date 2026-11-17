import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { bimElements, bimModels } from '@/lib/db/schema/bim'
import { buildSearchKeys, buildStoredRuleInputs } from './rule-inputs'
import { BIM_MODEL_LIFECYCLE, type BimElement, type BimModelSummary } from './types'

const ELEMENT_INSERT_BATCH = 500

export interface BimModelRun {
  modelId: string
  runId: string
}

function heldBy(run: BimModelRun, organizationId: string, event: 'complete' | 'fail') {
  return and(
    eq(bimModels.id, run.modelId),
    eq(bimModels.organizationId, organizationId),
    eq(bimModels.runId, run.runId),
    inArray(bimModels.status, [...BIM_MODEL_LIFECYCLE.sourcesOf(event)])
  )
}

export async function startBimModel(input: {
  organizationId: string
  projectId: string | null
  documentId: string
}): Promise<BimModelRun> {
  const db = getDb()
  const runId = randomUUID()
  const rows = await withTenant({ organizationId: input.organizationId }, () =>
    db
      .insert(bimModels)
      .values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        documentId: input.documentId,
        status: 'extracting',
        runId,
      })
      .onConflictDoUpdate({
        target: bimModels.documentId,
        set: {
          status: 'extracting',
          runId,
          errorMessage: null,
          summary: null,
          schemaVersion: null,
          elementCount: 0,
          extractedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: bimModels.id })
  )
  return { modelId: rows[0].id, runId }
}

export async function failBimModel(run: BimModelRun, organizationId: string, errorMessage: string): Promise<boolean> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .update(bimModels)
      .set({ status: 'failed', errorMessage: errorMessage.slice(0, 2000), updatedAt: new Date() })
      .where(heldBy(run, organizationId, 'fail'))
      .returning({ id: bimModels.id })
  )
  return rows.length > 0
}

export async function completeBimModel(input: {
  run: BimModelRun
  organizationId: string
  summary: BimModelSummary
  elements: readonly BimElement[]
  indexStorageKey: string | null
  indexStorageBucket: string | null
}): Promise<boolean> {
  const db = getDb()
  const { modelId } = input.run
  return withTenant({ organizationId: input.organizationId }, () =>
    db.transaction(async (tx) => {
      const held = await tx
        .update(bimModels)
        .set({
          status: 'ready',
          schemaVersion: input.summary.schema,
          summary: input.summary,
          elementCount: input.elements.length,
          ruleInputs: buildStoredRuleInputs(input.elements, input.summary.truncatedAt !== null),
          searchKeysIndexed: true,
          indexStorageKey: input.indexStorageKey,
          indexStorageBucket: input.indexStorageBucket,
          errorMessage: null,
          extractedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(heldBy(input.run, input.organizationId, 'complete'))
        .returning({ id: bimModels.id })
      if (held.length === 0) return false

      await tx.delete(bimElements).where(eq(bimElements.modelId, modelId))

      for (let offset = 0; offset < input.elements.length; offset += ELEMENT_INSERT_BATCH) {
        const batch = input.elements.slice(offset, offset + ELEMENT_INSERT_BATCH)
        await tx.insert(bimElements).values(
          batch.map((element) => ({
            modelId,
            globalId: element.globalId,
            expressId: element.expressId,
            ifcType: element.ifcType,
            name: element.name,
            predefinedType: element.predefinedType,
            objectType: element.objectType,
            tag: element.tag,
            typeName: element.typeName,
            storeyGlobalId: element.storeyGlobalId,
            storeyName: element.storeyName,
            containerKind: element.containerKind,
            containerName: element.containerName,
            materials: element.materials,
            searchKeys: buildSearchKeys(element),
            classifications: element.classifications,
            properties: element.properties,
            quantities: element.quantities,
          }))
        )
      }
      return true
    })
  )
}
