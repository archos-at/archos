/**
 * The three writers of a model's extraction: `start`, `complete` and `fail` of
 * {@link BIM_MODEL_LIFECYCLE}. Nothing else writes `bim_models.status`.
 *
 * A model row is one per document and a re-ingest reuses it, so two
 * extractions of one document can be in flight at once: a new version's bytes
 * queue their own job while the job for the old bytes is still parsing, and a
 * job taken from a silent worker may still be running there. The row therefore
 * names the run it waits for (`run_id`, migration 0222). `start` writes a fresh
 * one and hands it to its caller; `complete` and `fail` match on it. A run that
 * was superseded while it worked matches nothing and changes nothing, which is
 * the same rule `saveBimRuleInputs` (`./repository.ts`) holds for the
 * projection.
 *
 * Repository rules as in `./repository.ts`: drizzle only, every statement
 * scoped on the organization.
 */

import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { bimElements, bimModels } from '@/lib/db/schema/bim'
import { buildSearchKeys, buildStoredRuleInputs } from './rule-inputs'
import { BIM_MODEL_LIFECYCLE, type BimElement, type BimModelSummary } from './types'

/** Rows per INSERT when writing an extraction result. */
const ELEMENT_INSERT_BATCH = 500

/** One extraction of one model: the row, and the run that may finish it. */
export interface BimModelRun {
  modelId: string
  runId: string
}

/** The row as long as it still waits for this run. */
function heldBy(run: BimModelRun, organizationId: string, event: 'complete' | 'fail') {
  return and(
    eq(bimModels.id, run.modelId),
    eq(bimModels.organizationId, organizationId),
    eq(bimModels.runId, run.runId),
    inArray(bimModels.status, [...BIM_MODEL_LIFECYCLE.sourcesOf(event)])
  )
}

/**
 * Create (or reset) the model row for a document, mark it `extracting` and
 * give it to a new run.
 *
 * Idempotent on `document_id`: a re-ingest reuses the row rather than leaving
 * two models for one file, and clears the previous error and summary so a
 * failed extraction cannot leave stale facts visible next to a fresh attempt.
 *
 * No status in the conflict clause: `start` is legal from every state
 * (`BIM_MODEL_LIFECYCLE.sourcesOf('start')` is all of them), including from an
 * extraction still running. The new run id is what takes the row from that
 * one.
 */
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

/**
 * Record that this run could not read the model. False when the row no longer
 * waits for it: a newer run has it, and its outcome is the model's.
 */
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

/**
 * Write an extraction result: flip the model to `ready` with its summary and
 * replace the element rows. False, with nothing written, when the row no
 * longer waits for this run.
 *
 * One transaction, because a model whose summary says "1 240 elements" while
 * the element table holds the previous extraction's rows is worse than either
 * state alone: every count the agent reports would be drawn from a model that
 * never existed.
 *
 * The model row is written FIRST. That update is the compare on the run, and
 * it takes the row's lock, so a `start` arriving while the elements are
 * replaced waits for this commit instead of interleaving with it. A run that
 * lost the row stops there, before it has deleted the newer run's elements.
 */
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
          // Computed here, inside the same transaction that writes the
          // elements, so the FIRST person to open the Prüfbuch gets the fast
          // path too. Extraction already holds every element in memory; the
          // projection is a map over them and costs nothing next to the parse
          // that produced them.
          // `truncatedAt` and NOT a hardcoded `false`. Extraction stops at
          // `BIM_ELEMENT_LIMIT`, and a projection that claims to cover a
          // building it only covers part of is the "Prüfbuch judged over part
          // of a building" failure, reintroduced on the fast path, where it
          // would be worse than before because the fast path is the one every
          // reader gets.
          ruleInputs: buildStoredRuleInputs(input.elements, input.summary.truncatedAt !== null),
          // Set in the SAME transaction that writes the elements below, so the
          // flag cannot claim an index the rows do not have. An older image
          // extracting a model during a rolling deploy never reaches this line
          // and leaves the flag false, which reads as "unnest only".
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
