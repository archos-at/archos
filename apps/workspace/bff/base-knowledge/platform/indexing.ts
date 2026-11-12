/**
 * Indexing on publish (ADR-0165): each platform text a stable publish releases
 * is queued for the base corpus by its own BFF job (`platform_text_index`, a
 * Hatchet `bff-job`), and its run records what the corpus answered. Honest by
 * construction: a run is `queued` only when the corpus accepted the file, and
 * `failed` with the corpus's reason otherwise; `indexed` is read from the
 * corpus's own status, never assumed. The index status joins the two.
 *
 * The job indexes the bytes that were reviewed, or nothing: before it marks a
 * file with a country it compares the corpus's current sha256 with the one the
 * released revision keeps. Other bytes, or a revision that keeps no hash, fail
 * the run, and the file stays read by nobody.
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
import {
  getKnowledgeBaseStatus,
  reingestKnowledgeBaseDocuments,
  updateKnowledgeBaseDisplayTitle,
  withdrawCorpusFile,
  type CorpusFileMark,
} from '@/lib/knowledge/service'
import { releasedTextTitle } from './text-title'
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

interface ReleasedText {
  mark: CorpusFileMark
  sha256: string | null
  /** The name the records give the text: the work's designation (or its title) and the edition's label. */
  title: string | null
}

/**
 * What a run indexes: the country and edition of the copy (its revision's edition, its record's country), the bytes the
 * revision names, and the title its edition and work give it.
 */
async function releasedTextOf(revisionId: string): Promise<ReleasedText | null> {
  const rows = await withPlatformAccess(REASON, () =>
    getDb().execute<{
      edition_id: string | null
      country_id: string | null
      sha256: string | null
      label: string | null
      designation: string | null
      work_title: string | null
    }>(sql`
      SELECT m.edition_id, r.country_id, m.sha256, e.label, w.identifiers ->> 'designation' AS designation, w.title AS work_title
      FROM knowledge_manifestation_revisions m
      JOIN knowledge_records r ON r.id = m.record_id
      LEFT JOIN knowledge_records er ON er.id = m.edition_id AND er.organization_id IS NULL
      LEFT JOIN knowledge_edition_revisions e ON e.revision_id = er.head_revision_id
      LEFT JOIN knowledge_records wr ON wr.id = e.work_id AND wr.organization_id IS NULL
      LEFT JOIN knowledge_work_revisions w ON w.revision_id = wr.head_revision_id
      WHERE m.revision_id = ${revisionId} AND r.organization_id IS NULL`),
  )
  const row = rows[0]
  if (!row) return null
  return {
    mark: { countryId: row.country_id, editionId: row.edition_id },
    sha256: row.sha256,
    title: releasedTextTitle(row.designation, row.work_title, row.label),
  }
}

const REATTACH = 'attach the text again in a new change request for this manifestation'

type HeldFile = Awaited<ReturnType<typeof getKnowledgeBaseStatus>>['files'][number]

/** The corpus's entry for the file and why it is not the one the released revision names (null when it is). Throws when the corpus does not answer. */
async function heldBytes(corpusFile: string, reviewed: string | null | undefined): Promise<{ held: HeldFile | null; refusal: string | null }> {
  if (!reviewed) return { held: null, refusal: `the released revision keeps no hash of ${corpusFile}, so the reviewed bytes cannot be told from others; ${REATTACH}` }
  const held = (await getKnowledgeBaseStatus()).files.find((file) => file.fileName === corpusFile && file.state !== 'removed') ?? null
  if (!held) return { held, refusal: `the base corpus no longer holds ${corpusFile}; ${REATTACH}` }
  if (held.currentSha256 !== reviewed) {
    return {
      held,
      refusal: `the base corpus keeps other bytes as ${corpusFile} than the ones that were reviewed (sha256 ${reviewed.slice(0, 12)}…); nothing was indexed; ${REATTACH}`,
    }
  }
  return { held, refusal: null }
}

/**
 * Give a released text the title its records name, unless a person already set one. A text's file is named
 * `<manifestationKey>-<12 hex>.pdf`, which no title guess reads, so without this every citation of it shows that
 * name. A failure is logged and the run goes on: the title is a label, the chunks are what answer.
 */
async function stampTitle(held: HeldFile, title: string | null): Promise<void> {
  if (!title || held.displayTitle) return
  try {
    await updateKnowledgeBaseDisplayTitle(held.fileName, title)
  } catch (error) {
    console.error('[base-knowledge] the title of a released text was not set', { corpusFile: held.fileName, error })
  }
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
    const released = await releasedTextOf(run.revisionId)
    // The reviewed bytes are the published bytes: other bytes are never marked with the country.
    const { held, refusal } = await heldBytes(run.corpusFile, released?.sha256)
    if (refusal || !held) {
      await markRun(run.id, 'failed', refusal ?? `the base corpus no longer holds ${run.corpusFile}; ${REATTACH}`)
      return
    }
    // Before the re-ingest: it keeps a stored title, so the chunks it writes carry this one.
    await stampTitle(held, released?.title ?? null)
    const result = await reingestKnowledgeBaseDocuments([run.corpusFile], released ? { [run.corpusFile]: released.mark } : {})
    if (result.unknown.includes(run.corpusFile) || !result.queued.includes(run.corpusFile)) {
      await markRun(run.id, 'failed', `the base corpus no longer holds ${run.corpusFile}; ${REATTACH}`)
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

/**
 * A base-corpus file a rollback left unreleased (ADR-0173): its chunks and corpus row are marked
 * `released: false`, which every base-corpus read filters out (`vector_store.scope.corpus_country_condition`);
 * only a re-release, whose indexing job marks it released, reads it again.
 */
export const platformTextDeindexPayloadSchema = z.object({ corpusFile: z.string().min(1).max(260) })
export type PlatformTextDeindexPayload = z.infer<typeof platformTextDeindexPayloadSchema>

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

/** The job's step: unless a release names the file again, withdraw it. Throws to be retried. */
export async function runPlatformTextDeindex(_organizationId: string, payload: PlatformTextDeindexPayload): Promise<void> {
  const [still] = await withPlatformAccess(REASON, () =>
    getDb().execute<{ n: number }>(sql`
      SELECT 1 AS n FROM knowledge_records r JOIN knowledge_manifestation_revisions h ON h.revision_id = r.head_revision_id
      WHERE r.organization_id IS NULL AND h.corpus_file = ${payload.corpusFile} LIMIT 1`),
  )
  if (still) return
  await withdrawCorpusFile(payload.corpusFile)
}
