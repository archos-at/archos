import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { NotFoundError } from '@/lib/api/errors'
import { getDb } from '@/lib/db'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
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

const NOT_ENQUEUED = 'the indexing job was not enqueued'

const MAX_RUNS = 500

export const platformTextIndexPayloadSchema = z.object({ runId: z.uuid() })
export type PlatformTextIndexPayload = z.infer<typeof platformTextIndexPayloadSchema>

async function markRun(runId: string, state: 'queued' | 'failed', failure: string | null): Promise<void> {
  await withPlatformAccess(REASON, () =>
    getDb().update(knowledgeIndexRuns).set({ state, failure, updatedAt: new Date() }).where(eq(knowledgeIndexRuns.id, runId)),
  )
}

function failureText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? error.cause.message : error.cause ? String(error.cause) : null
  return cause ? `${error.message} (${cause})` : error.message
}

export async function enqueueIndexRuns(
  platformOrganizationId: string | null,
  runIds: readonly string[],
): Promise<{ enqueued: number; failed: number }> {
  let failed = 0
  for (const runId of runIds) {
    try {
      if (!platformOrganizationId) throw new Error('the platform organization is not known')
      await withTenant({ organizationId: platformOrganizationId }, () =>
        enqueueJob({
          kind: 'platform_text_index',
          organizationId: platformOrganizationId,
          payload: { runId },
          priority: BFF_JOB_PRIORITY.bulk,
        }),
      )
    } catch (error) {
      failed += 1
      await markRun(runId, 'failed', `${NOT_ENQUEUED}: ${failureText(error)}`)
    }
  }
  return { enqueued: runIds.length - failed, failed }
}

export async function resumeIndexRuns(
  platformOrganizationId: string | null,
  changeRequestId: string,
): Promise<{ enqueued: number; failed: number }> {
  const runIds = await withPlatformAccess(REASON, async () => {
    const db = getDb()
    await db
      .update(knowledgeIndexRuns)
      .set({ state: 'requested', failure: null, updatedAt: new Date() })
      .where(and(eq(knowledgeIndexRuns.changeRequestId, changeRequestId), eq(knowledgeIndexRuns.state, 'failed'), sql`${knowledgeIndexRuns.failure} LIKE ${`${NOT_ENQUEUED}%`}`))
    const rows = await db
      .select({ id: knowledgeIndexRuns.id })
      .from(knowledgeIndexRuns)
      .where(and(eq(knowledgeIndexRuns.changeRequestId, changeRequestId), eq(knowledgeIndexRuns.state, 'requested')))
    return rows.map((row) => row.id)
  })
  return runIds.length === 0 ? { enqueued: 0, failed: 0 } : enqueueIndexRuns(platformOrganizationId, runIds)
}

interface ReleasedText {
  mark: CorpusFileMark
  sha256: string | null
  title: string | null
}

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

async function stampTitle(held: HeldFile, title: string | null): Promise<boolean> {
  if (!title || held.displayTitle) return true
  try {
    await updateKnowledgeBaseDisplayTitle(held.fileName, title)
    return true
  } catch (error) {
    if (error instanceof NotFoundError) return false
    console.error('[base-knowledge] the title of a released text was not set', { corpusFile: held.fileName, error })
    return true
  }
}

async function recordHandOff(runId: string): Promise<void> {
  await withPlatformAccess(REASON, () =>
    getDb().update(knowledgeIndexRuns).set({ handedAt: new Date(), updatedAt: new Date() }).where(eq(knowledgeIndexRuns.id, runId)),
  )
}

function indexedAfterTheHandOff(run: { handedAt: Date | null }, held: HeldFile, released: ReleasedText | null): boolean {
  return run.handedAt !== null && released !== null && held.state === 'ingested' && held.countryId === released.mark.countryId
}

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
    const released = await releasedTextOf(run.revisionId)
    const { held, refusal } = await heldBytes(run.corpusFile, released?.sha256)
    if (refusal || !held) {
      await markRun(run.id, 'failed', refusal ?? `the base corpus no longer holds ${run.corpusFile}; ${REATTACH}`)
      return
    }
    const titled = await stampTitle(held, released?.title ?? null)
    if (titled && indexedAfterTheHandOff(run, held, released)) {
      await markRun(run.id, 'queued', null)
      return
    }
    const result = await reingestKnowledgeBaseDocuments([run.corpusFile], released ? { [run.corpusFile]: released.mark } : {})
    if (result.unknown.includes(run.corpusFile) || !result.queued.includes(run.corpusFile)) {
      await markRun(run.id, 'failed', `the base corpus no longer holds ${run.corpusFile}; ${REATTACH}`)
      return
    }
    if (!titled) {
      await recordHandOff(run.id)
      if (!attempt.last) throw new Error(`the base corpus has no row for ${run.corpusFile} to title yet`)
      console.error('[base-knowledge] a released text was indexed without its title', { corpusFile: run.corpusFile })
    }
    await markRun(run.id, 'queued', null)
  } catch (error) {
    if (!attempt.last) throw error
    await markRun(run.id, 'failed', `the base corpus did not accept the file: ${error instanceof Error ? error.message : String(error)}`)
  }
}

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

export const platformTextDeindexPayloadSchema = z.object({ corpusFile: z.string().min(1).max(260) })
export type PlatformTextDeindexPayload = z.infer<typeof platformTextDeindexPayloadSchema>

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

export async function runPlatformTextDeindex(_organizationId: string, payload: PlatformTextDeindexPayload): Promise<void> {
  const [still] = await withPlatformAccess(REASON, () =>
    getDb().execute<{ n: number }>(sql`
      SELECT 1 AS n FROM knowledge_records r JOIN knowledge_manifestation_revisions h ON h.revision_id = r.head_revision_id
      WHERE r.organization_id IS NULL AND h.corpus_file = ${payload.corpusFile} LIMIT 1`),
  )
  if (still) return
  await withdrawCorpusFile(payload.corpusFile)
}
