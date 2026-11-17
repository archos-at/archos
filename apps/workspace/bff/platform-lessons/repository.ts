import 'server-only'
import { isUniqueViolation } from '@/lib/db/errors'
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { platformLessonEvents, platformLessonReports, platformLessons, type NewPlatformLessonEvent, type PlatformLesson, type PlatformLessonEvent, type PlatformLessonReport } from '@/lib/db/schema/platform-lessons'
import { normalizeContentGerman } from '@/lib/knowledge/consolidation'
import { toVectorLiteral } from '@/lib/knowledge/embeddings'
import { executeRows } from '@/lib/db/execute-rows'
import { OUTSIDE_RESTRICTED_USE } from '@/lib/feedback/repository'
import { VOTED_TURN_JOINS } from '@/lib/feedback/turn-join'
import { OUTSIDE_LICENSED_TEXT } from './licensed-text'

export const LESSON_LIST_LIMIT = 200
export const LESSON_EVENT_LIST_LIMIT = 200
export const LESSON_REPORT_LIST_LIMIT = 200

export const SWEEP_WINDOW_DAYS = 30

export interface UnprocessedDownvote {
  feedbackId: string
  organizationId: string
  reason: string | null
  comment: string | null
  question: string | null
  answer: string | null
  createdAt: Date
}

export async function listUnprocessedDownvotes(limit: number): Promise<UnprocessedDownvote[]> {
  const db = getDb()
  const result = await db.execute(sql`
    select
      f.id          as feedback_id,
      f.organization_id,
      f.reason,
      f.comment,
      f.created_at,
      m.content     as answer,
      q.content     as question
    from answer_feedback f
    left join platform_lesson_reports r on r.feedback_id = f.id
    ${VOTED_TURN_JOINS}
    where f.verdict = 'down'
      and r.id is null
      and ${OUTSIDE_RESTRICTED_USE} and ${OUTSIDE_LICENSED_TEXT}
      and f.created_at >= now() - make_interval(days => ${SWEEP_WINDOW_DAYS})
    order by f.created_at asc
    limit ${limit}
  `)

  const rows = executeRows(result)
  return rows.map((row) => ({
    feedbackId: String(row.feedback_id),
    organizationId: String(row.organization_id),
    reason: (row.reason as string | null) ?? null,
    comment: (row.comment as string | null) ?? null,
    question: (row.question as string | null) ?? null,
    answer: (row.answer as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
  }))
}

export async function listLessons(): Promise<PlatformLesson[]> {
  const db = getDb()
  return db
    .select()
    .from(platformLessons)
    .orderBy(desc(platformLessons.lastReportedAt))
    .limit(LESSON_LIST_LIMIT)
}

export async function getLesson(lessonId: string): Promise<PlatformLesson | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(platformLessons)
    .where(eq(platformLessons.id, lessonId))
    .limit(1)
  return row ?? null
}

export async function listLiveLessons(limit: number): Promise<PlatformLesson[]> {
  const db = getDb()
  return db
    .select()
    .from(platformLessons)
    .where(ne(platformLessons.status, 'retired'))
    .orderBy(desc(platformLessons.reportCount), desc(platformLessons.lastReportedAt))
    .limit(limit)
}

export async function listActiveLessonsForDigest(limit: number): Promise<PlatformLesson[]> {
  const db = getDb()
  return db
    .select()
    .from(platformLessons)
    .where(eq(platformLessons.status, 'active'))
    .orderBy(
      desc(platformLessons.orgCount),
      desc(platformLessons.reportCount),
      desc(platformLessons.lastReportedAt)
    )
    .limit(limit)
}

export const LESSON_SEMANTIC_MATCH_THRESHOLD = 0.85

export async function listSemanticLessonCandidates(
  vector: number[],
  fingerprint: string,
  limit: number
): Promise<PlatformLesson[]> {
  const db = getDb()
  const result = await db.execute(sql`
    with scored as (
      select l.*, cosine_similarity(l.embedding, ${toVectorLiteral(vector)}::real[]) as similarity
      from platform_lessons l
      where l.status <> 'retired'
        and l.embedding_model = ${fingerprint}
    )
    select * from scored
    where similarity >= ${LESSON_SEMANTIC_MATCH_THRESHOLD}
    order by similarity desc
    limit ${limit}
  `)
  const rows = executeRows(result)
  return rows.map(
    (row) =>
      ({
        id: String(row.id),
        content: String(row.content),
        category: row.category,
        status: row.status,
        reportCount: Number(row.report_count),
      }) as PlatformLesson
  )
}

export async function setLessonEmbedding(
  lessonId: string,
  vector: number[],
  fingerprint: string
): Promise<void> {
  await getDb()
    .update(platformLessons)
    .set({ embedding: vector, embeddingModel: fingerprint, embeddedAt: new Date() })
    .where(eq(platformLessons.id, lessonId))
}

export async function listLessonsMissingEmbedding(
  fingerprint: string,
  limit: number
): Promise<PlatformLesson[]> {
  const db = getDb()
  return db
    .select()
    .from(platformLessons)
    .where(
      and(
        ne(platformLessons.status, 'retired'),
        or(
          isNull(platformLessons.embedding),
          ne(platformLessons.embeddingModel, fingerprint)
        )
      )
    )
    .orderBy(asc(platformLessons.createdAt))
    .limit(limit)
}

export async function recomputeLessonVoteCounters(): Promise<void> {
  await getDb().execute(sql`
    update platform_lessons l
    set helpful_votes = counts.up,
        harmful_votes = counts.down
    from (
      select
        l2.id,
        count(*) filter (where f.verdict = 'up')   as up,
        count(*) filter (where f.verdict = 'down') as down
      from platform_lessons l2
      left join answer_feedback f
        on f.created_at >= l2.activated_at
       and (l2.retired_at is null or f.created_at <= l2.retired_at)
       and coalesce(f.lessons_holdout, false) = false
      where l2.status = 'active' and l2.activated_at is not null
      group by l2.id
    ) counts
    where l.id = counts.id
      and (l.helpful_votes is distinct from counts.up
        or l.harmful_votes is distinct from counts.down)
  `)
}

export async function findLiveLessonByContent(content: string): Promise<PlatformLesson | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(platformLessons)
    .where(
      and(
        ne(platformLessons.status, 'retired'),
        sql`btrim(regexp_replace(lower(${platformLessons.content}), '[^a-z0-9äöüß]+', ' ', 'g')) = ${normalizeContentGerman(content)}`
      )
    )
    .limit(1)
  return row ?? null
}

export async function listLessonEvents(lessonId: string): Promise<PlatformLessonEvent[]> {
  const db = getDb()
  return db
    .select()
    .from(platformLessonEvents)
    .where(eq(platformLessonEvents.lessonId, lessonId))
    .orderBy(asc(platformLessonEvents.createdAt))
    .limit(LESSON_EVENT_LIST_LIMIT)
}

export async function listLessonReports(lessonId: string): Promise<PlatformLessonReport[]> {
  const db = getDb()
  return db
    .select()
    .from(platformLessonReports)
    .where(eq(platformLessonReports.lessonId, lessonId))
    .orderBy(desc(platformLessonReports.createdAt))
    .limit(LESSON_REPORT_LIST_LIMIT)
}

interface ReportProvenance {
  feedbackId: string
  orgHash: string
  reason: string | null
  canonicalSummary: string | null
}

export async function createLessonFromReport(values: {
  embedding?: { vector: number[]; fingerprint: string } | null
  content: string
  category: PlatformLesson['category']
  status: PlatformLesson['status']
  heldReason: string | null
  activatedBy: string | null
  report: ReportProvenance
  actor: string
}): Promise<PlatformLesson | null> {
  const db = getDb()
  try {
    return await db.transaction(async (tx) => {
      const now = new Date()
      const [lesson] = await tx
        .insert(platformLessons)
        .values({
          content: values.content,
          category: values.category,
          status: values.status,
          heldReason: values.heldReason,
          ...(values.embedding
            ? {
                embedding: values.embedding.vector,
                embeddingModel: values.embedding.fingerprint,
                embeddedAt: now,
              }
            : {}),
          activatedAt: values.status === 'active' ? now : null,
          activatedBy: values.status === 'active' ? values.activatedBy : null,
        })
        .returning()
      await tx.insert(platformLessonReports).values({
        feedbackId: values.report.feedbackId,
        lessonId: lesson.id,
        outcome: 'created',
        orgHash: values.report.orgHash,
        reason: values.report.reason,
        canonicalSummary: values.report.canonicalSummary,
      })
      const events: NewPlatformLessonEvent[] = [
        {
          lessonId: lesson.id,
          action: 'created',
          actor: values.actor,
          detail: { category: values.category, feedbackId: values.report.feedbackId },
        },
      ]
      if (values.status === 'active') {
        events.push({
          lessonId: lesson.id,
          action: 'activated',
          actor: values.actor,
          detail: { automatic: true },
        })
      }
      await tx.insert(platformLessonEvents).values(events)
      return lesson
    })
  } catch (err) {
    if (isUniqueViolation(err)) return null
    throw err
  }
}

export async function linkReportToLesson(
  lessonId: string,
  report: ReportProvenance,
  actor: string
): Promise<boolean> {
  const db = getDb()
  try {
    await db.transaction(async (tx) => {
      await tx.insert(platformLessonReports).values({
        feedbackId: report.feedbackId,
        lessonId,
        outcome: 'linked',
        orgHash: report.orgHash,
        reason: report.reason,
        canonicalSummary: report.canonicalSummary,
      })
      await tx
        .update(platformLessons)
        .set({
          reportCount: sql`(select count(*)::int from ${platformLessonReports} where ${platformLessonReports.lessonId} = ${lessonId} and ${platformLessonReports.outcome} <> 'skipped')`,
          orgCount: sql`(select count(distinct ${platformLessonReports.orgHash})::int from ${platformLessonReports} where ${platformLessonReports.lessonId} = ${lessonId} and ${platformLessonReports.outcome} <> 'skipped')`,
          lastReportedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(platformLessons.id, lessonId))
      await tx.insert(platformLessonEvents).values({
        lessonId,
        action: 'report_linked',
        actor,
        detail: { feedbackId: report.feedbackId },
      })
    })
    return true
  } catch (err) {
    if (isUniqueViolation(err)) return false
    throw err
  }
}

export async function reopenSkippedReport(feedbackId: string): Promise<boolean> {
  const cleared = await getDb()
    .delete(platformLessonReports)
    .where(
      and(
        eq(platformLessonReports.feedbackId, feedbackId),
        eq(platformLessonReports.outcome, 'skipped')
      )
    )
    .returning({ id: platformLessonReports.id })
  return cleared.length > 0
}

export async function recordSkippedReport(values: {
  feedbackId: string
  orgHash: string
  reason: string | null
  skipReason: string
  canonicalSummary: string | null
}): Promise<void> {
  const db = getDb()
  try {
    await db.insert(platformLessonReports).values({
      feedbackId: values.feedbackId,
      lessonId: null,
      outcome: 'skipped',
      skipReason: values.skipReason,
      orgHash: values.orgHash,
      reason: values.reason,
      canonicalSummary: values.canonicalSummary,
    })
  } catch (err) {
    if (isUniqueViolation(err)) return
    throw err
  }
}

export async function updateLessonWithEvent(
  lessonId: string,
  patch: Partial<
    Pick<
      PlatformLesson,
      | 'status'
      | 'content'
      | 'heldReason'
      | 'activatedAt'
      | 'activatedBy'
      | 'retiredAt'
      | 'retiredBy'
      | 'retiredReason'
      | 'rootCauseStatus'
      | 'rootCauseNote'
    >
  >,
  event: Omit<NewPlatformLessonEvent, 'lessonId'>
): Promise<PlatformLesson | null> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(platformLessons)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(platformLessons.id, lessonId))
      .returning()
    if (!row) return null
    await tx.insert(platformLessonEvents).values({ ...event, lessonId })
    return row
  })
}

export async function expireStaleCandidates(
  maxAgeDays: number,
  maxCandidates: number,
  actor: string
): Promise<string[]> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: platformLessons.id, lastReportedAt: platformLessons.lastReportedAt })
      .from(platformLessons)
      .where(eq(platformLessons.status, 'candidate'))
      .orderBy(desc(platformLessons.reportCount), desc(platformLessons.lastReportedAt))
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    const expired = new Set<string>()
    for (const candidate of candidates.slice(maxCandidates)) expired.add(candidate.id)
    for (const candidate of candidates) {
      if (candidate.lastReportedAt.getTime() < cutoff) expired.add(candidate.id)
    }
    const ids = [...expired]
    if (ids.length === 0) return []
    const now = new Date()
    await tx
      .update(platformLessons)
      .set({
        status: 'retired',
        retiredAt: now,
        retiredBy: actor,
        retiredReason: 'candidate_expired',
        updatedAt: now,
      })
      .where(inArray(platformLessons.id, ids))
    await tx.insert(platformLessonEvents).values(
      ids.map((id) => ({
        lessonId: id,
        action: 'retired' as const,
        actor,
        detail: { reason: 'candidate_expired' },
      }))
    )
    return ids
  })
}

export async function countLessonsByStatus(): Promise<Record<string, number>> {
  const db = getDb()
  const rows = await db
    .select({ status: platformLessons.status, count: sql<string>`count(*)` })
    .from(platformLessons)
    .groupBy(platformLessons.status)
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]))
}

export async function flagIneffectiveActiveLessons(
  minRecurrences: number,
  actor: string
): Promise<string[]> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      select l.id, count(r.id) as recurrences
      from platform_lessons l
      join platform_lesson_reports r
        on r.lesson_id = l.id
       and r.outcome = 'linked'
       and r.created_at > l.activated_at
      where l.status = 'active'
        and l.activated_at is not null
        and not exists (
          select 1 from platform_lesson_events e
          where e.lesson_id = l.id
            and e.action = 'flagged_ineffective'
            and e.created_at > l.activated_at
        )
      group by l.id
      having count(r.id) >= ${minRecurrences}
    `)
    const raw = executeRows(result)
    const rows = raw.map((row) => ({
      id: String(row.id),
      recurrences: Number(row.recurrences),
    }))
    if (rows.length === 0) return []
    await tx.insert(platformLessonEvents).values(
      rows.map((row) => ({
        lessonId: row.id,
        action: 'flagged_ineffective' as const,
        actor,
        detail: { recurrences: row.recurrences },
      }))
    )
    return rows.map((row) => row.id)
  })
}

export async function retireQuietAddressedLessons(
  quietDays: number,
  actor: string
): Promise<string[]> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      with addressed as (
        select l.id, max(e.created_at) as addressed_at
        from platform_lessons l
        join platform_lesson_events e
          on e.lesson_id = l.id
         and e.action = 'root_cause_updated'
         and e.detail->>'rootCauseStatus' = 'addressed'
        where l.status = 'active'
          and l.root_cause_status = 'addressed'
        group by l.id
      )
      select a.id
      from addressed a
      where a.addressed_at <= now() - make_interval(days => ${quietDays})
        and not exists (
          select 1 from platform_lesson_reports r
          where r.lesson_id = a.id
            and r.outcome = 'linked'
            and r.created_at > a.addressed_at
        )
    `)
    const raw = executeRows(result)
    const ids = raw.map((row) => String(row.id))
    if (ids.length === 0) return []
    const now = new Date()
    await tx
      .update(platformLessons)
      .set({
        status: 'retired',
        retiredAt: now,
        retiredBy: actor,
        retiredReason: 'root_cause_addressed_quiet',
        updatedAt: now,
      })
      .where(inArray(platformLessons.id, ids))
    await tx.insert(platformLessonEvents).values(
      ids.map((id) => ({
        lessonId: id,
        action: 'retired' as const,
        actor,
        detail: { reason: 'root_cause_addressed_quiet', automatic: true, quietDays },
      }))
    )
    return ids
  })
}
