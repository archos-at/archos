/**
 * Indexing on publish (ADR-0165): each platform text a stable publish releases
 * is queued for the base corpus by its own BFF job (`platform_text_index`, a
 * Hatchet `bff-job`), and its run records what the corpus answered. Honest by
 * construction: a run is `queued` only when the corpus accepted the file, and
 * `failed` with the corpus's reason otherwise; `indexed` is read from the
 * corpus's own status, never assumed. The index status joins the two.
 *
 * Re-ingest keeps the binding: the manifestation names its corpus file, so a
 * re-ingest of that file (the platform's knowledge page, `reingestKnowledgeBaseDocuments`)
 * rebuilds the chunks the published text is found by without a new revision.
 */

import 'server-only'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { knowledgeIndexRuns } from '@/lib/db/schema/knowledge-platform'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'
import { getKnowledgeBaseStatus, reingestKnowledgeBaseDocuments } from '@/lib/knowledge/service'
import type { IndexStatusView } from './wire'

const REASON = 'platform base knowledge: indexing runs'

/** The most runs one status read returns. */
const MAX_RUNS = 500

export const platformTextIndexPayloadSchema = z.object({ runId: z.uuid() })
export type PlatformTextIndexPayload = z.infer<typeof platformTextIndexPayloadSchema>

async function markRun(
  runId: string,
  state: 'queued' | 'failed',
  failure: string | null
): Promise<void> {
  await withPlatformAccess(REASON, () =>
    getDb()
      .update(knowledgeIndexRuns)
      .set({ state, failure, updatedAt: new Date() })
      .where(eq(knowledgeIndexRuns.id, runId))
  )
}

/**
 * Enqueue one job per run. A run whose job could not be enqueued is marked
 * failed with why, so the status never shows "requested" for work nobody will do.
 */
export async function enqueueIndexRuns(
  platformOrganizationId: string | null,
  runIds: readonly string[]
): Promise<{ enqueued: number; failed: number }> {
  let failed = 0
  for (const runId of runIds) {
    try {
      // The job belongs to the platform organization, whichever office the operator browses; it runs as the system.
      if (!platformOrganizationId) throw new Error('the platform organization is not known')
      await enqueueJob({
        kind: 'platform_text_index',
        organizationId: platformOrganizationId,
        payload: { runId },
        priority: BFF_JOB_PRIORITY.bulk,
      })
    } catch (error) {
      failed += 1
      await markRun(
        runId,
        'failed',
        `the indexing job was not enqueued: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  return { enqueued: runIds.length - failed, failed }
}

/** The job's step: hand the file to the corpus and record what it answered. Throws to be retried. */
export async function runPlatformTextIndex(
  _organizationId: string,
  payload: PlatformTextIndexPayload,
  attempt: { last: boolean }
): Promise<void> {
  const [run] = await withPlatformAccess(REASON, () =>
    getDb().select().from(knowledgeIndexRuns).where(eq(knowledgeIndexRuns.id, payload.runId))
  )
  if (!run || run.state !== 'requested') return
  try {
    const result = await reingestKnowledgeBaseDocuments([run.corpusFile])
    if (result.unknown.includes(run.corpusFile) || !result.queued.includes(run.corpusFile)) {
      await markRun(
        run.id,
        'failed',
        `the base corpus has no file ${run.corpusFile}; upload it, then publish again`
      )
      return
    }
    await markRun(run.id, 'queued', null)
  } catch (error) {
    if (!attempt.last) throw error
    await markRun(
      run.id,
      'failed',
      `the base corpus did not accept the file: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/** The runs of a request, each with the corpus's own word on whether its chunks exist. */
export async function readIndexStatus(changeRequestId: string): Promise<IndexStatusView> {
  const runs = await withPlatformAccess(REASON, () =>
    getDb()
      .select()
      .from(knowledgeIndexRuns)
      .where(eq(knowledgeIndexRuns.changeRequestId, changeRequestId))
      .orderBy(desc(knowledgeIndexRuns.requestedAt))
      .limit(MAX_RUNS)
  )
  const queued = runs.some((run) => run.state === 'queued')
  // Only a queued run can have become indexed; the corpus answers for it, or the run stays queued.
  const files = queued
    ? new Map(
        (await getKnowledgeBaseStatus().catch(() => ({ files: [] }))).files.map((file) => [
          file.fileName,
          file.state,
        ])
      )
    : new Map<string, string>()
  return {
    changeRequestId,
    texts: runs.map((run) => ({
      revisionId: run.revisionId,
      corpusFile: run.corpusFile,
      state:
        run.state === 'queued' && files.get(run.corpusFile) === 'ingested' ? 'indexed' : run.state,
      failure: run.failure,
    })),
  }
}
