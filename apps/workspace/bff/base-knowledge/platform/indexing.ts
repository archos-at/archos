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
import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { knowledgeIndexRuns } from '@/lib/db/schema/knowledge-platform'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'
import { getKnowledgeBaseStatus, markCorpusFile, reingestKnowledgeBaseDocuments, type CorpusFileMark } from '@/lib/knowledge/service'
import type { IndexStatusView } from './wire'

const REASON = 'platform base knowledge: indexing runs'

/** The most runs one status read returns. */
const MAX_RUNS = 500

export const platformTextIndexPayloadSchema = z.object({ runId: z.uuid() })
export type PlatformTextIndexPayload = z.infer<typeof platformTextIndexPayloadSchema>

async function markRun(runId: string, state: 'queued' | 'failed', failure: string | null): Promise<void> {
  await withPlatformAccess(REASON, () =>
    getDb().update(knowledgeIndexRuns).set({ state, failure, updatedAt: new Date() }).where(eq(knowledgeIndexRuns.id, runId)),
  )
}

/**
 * Enqueue one job per run. A run whose job could not be enqueued is marked
 * failed with why, so the status never shows "requested" for work nobody will do.
 */
export async function enqueueIndexRuns(
  platformOrganizationId: string | null,
  runIds: readonly string[],
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
      await markRun(runId, 'failed', `the indexing job was not enqueued: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { enqueued: runIds.length - failed, failed }
}

/** The country and edition of the copy a run indexes: the manifestation revision's edition and its record's country. */
async function corpusMarkOf(revisionId: string): Promise<CorpusFileMark | null> {
  const rows = await withPlatformAccess(REASON, () =>
    getDb().execute<{ edition_id: string | null; country_id: string | null }>(sql`
      SELECT m.edition_id, r.country_id
      FROM knowledge_manifestation_revisions m JOIN knowledge_records r ON r.id = m.record_id
      WHERE m.revision_id = ${revisionId} AND r.organization_id IS NULL`),
  )
  const row = rows[0]
  return row ? { countryId: row.country_id, editionId: row.edition_id } : null
}

/** The job's step: hand the file to the corpus and record what it answered. Throws to be retried. */
export async function runPlatformTextIndex(
  _organizationId: string,
  payload: PlatformTextIndexPayload,
  attempt: { last: boolean },
): Promise<void> {
  const [run] = await withPlatformAccess(REASON, () =>
    getDb().select().from(knowledgeIndexRuns).where(eq(knowledgeIndexRuns.id, payload.runId)),
  )
  if (!run || run.state !== 'requested') return
  try {
    // The country and edition the text belongs to ride on every chunk (ADR-0173): the turn's gate filters by them.
    const mark = await corpusMarkOf(run.revisionId)
    const result = await reingestKnowledgeBaseDocuments([run.corpusFile], mark ? { [run.corpusFile]: mark } : {})
    if (result.unknown.includes(run.corpusFile) || !result.queued.includes(run.corpusFile)) {
      await markRun(run.id, 'failed', `the base corpus has no file ${run.corpusFile}; upload it, then publish again`)
      return
    }
    await markRun(run.id, 'queued', null)
  } catch (error) {
    if (!attempt.last) throw error
    await markRun(run.id, 'failed', `the base corpus did not accept the file: ${error instanceof Error ? error.message : String(error)}`)
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
      .limit(MAX_RUNS),
  )
  const queued = runs.some((run) => run.state === 'queued')
  // Only a queued run can have become indexed; the corpus answers for it, or the run stays queued.
  const files = queued
    ? new Map((await getKnowledgeBaseStatus().catch(() => ({ files: [] }))).files.map((file) => [file.fileName, file.state]))
    : new Map<string, string>()
  return {
    changeRequestId,
    texts: runs.map((run) => ({
      revisionId: run.revisionId,
      corpusFile: run.corpusFile,
      state: run.state === 'queued' && files.get(run.corpusFile) === 'ingested' ? 'indexed' : run.state,
      failure: run.failure,
    })),
  }
}

/** A base-corpus file a rollback left unreleased (ADR-0173): its chunks are marked so no office reads them. */
export const platformTextDeindexPayloadSchema = z.object({ corpusFile: z.string().min(1).max(260) })
export type PlatformTextDeindexPayload = z.infer<typeof platformTextDeindexPayloadSchema>

/**
 * The country no office is entitled to (ISO 3166-1 user-assigned `ZZ`): a chunk
 * marked with it is filtered out of every turn's base corpus (`base_corpus_country_filter`),
 * and kept, so a re-release re-indexes it with its country again.
 */
export const UNRELEASED_COUNTRY = 'ZZ'

/** Enqueue the de-index of each file a rollback left unreleased; a failure is logged, the rollback stands. */
export async function enqueueDeindex(platformOrganizationId: string | null, corpusFiles: readonly string[]): Promise<number> {
  let failed = 0
  for (const corpusFile of corpusFiles) {
    try {
      if (!platformOrganizationId) throw new Error('the platform organization is not known')
      await enqueueJob({ kind: 'platform_text_deindex', organizationId: platformOrganizationId, payload: { corpusFile }, priority: BFF_JOB_PRIORITY.bulk })
    } catch (error) {
      failed += 1
      console.error('[base-knowledge] the de-index of a rolled-back text was not enqueued', { corpusFile, error })
    }
  }
  return failed
}

/** The job's step: unless a release names the file again, mark its chunks for no country. Throws to be retried. */
export async function runPlatformTextDeindex(_organizationId: string, payload: PlatformTextDeindexPayload): Promise<void> {
  const [still] = await withPlatformAccess(REASON, () =>
    getDb().execute<{ n: number }>(sql`
      SELECT 1 AS n FROM knowledge_records r JOIN knowledge_manifestation_revisions h ON h.revision_id = r.head_revision_id
      WHERE r.organization_id IS NULL AND h.corpus_file = ${payload.corpusFile} LIMIT 1`),
  )
  if (still) return
  await markCorpusFile(payload.corpusFile, { countryId: UNRELEASED_COUNTRY, editionId: null })
}
