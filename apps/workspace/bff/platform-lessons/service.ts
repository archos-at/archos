import 'server-only'
import { createHash } from 'node:crypto'
import { requirePlatformPermission } from '@/lib/authz/platform'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { recordAuditEvent } from '@/lib/audit/service'
import type { UserSession } from '@/lib/auth/types'
import { NotFoundError } from '@/lib/api/errors'
import { getCached, invalidateCached } from '@/lib/cache'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import type { PlatformLesson, PlatformLessonEvent, PlatformLessonReport } from '@/lib/db/schema/platform-lessons'
import { formatBoundedDigestWithKept } from '@/lib/knowledge/digest-format'
import { redactPii } from '@/lib/text/redact-pii'
import { distillReport } from './distill-client'
import { embedNote, embedNotes, enrichForEmbedding } from '@/lib/knowledge/embeddings'
import {
  countLessonsByStatus,
  createLessonFromReport,
  expireStaleCandidates,
  flagIneffectiveActiveLessons,
  findLiveLessonByContent,
  getLesson,
  linkReportToLesson,
  listActiveLessonsForDigest,
  listLessonEvents,
  listLessonReports,
  listLessons,
  listLessonsMissingEmbedding,
  listLiveLessons,
  listSemanticLessonCandidates,
  listUnprocessedDownvotes,
  recomputeLessonVoteCounters,
  recordSkippedReport,
  reopenSkippedReport,
  retireQuietAddressedLessons,
  setLessonEmbedding,
  updateLessonWithEvent,
} from './repository'
import { activateLessonWithCapacity, evictActiveOverCapacity } from './capacity-repository'
import {
  MAX_DISTILL_ANSWER_CHARS,
  MAX_DISTILL_COMMENT_CHARS,
  MAX_DISTILL_QUESTION_CHARS,
  MAX_DISTILL_REGISTER_SIZE,
  toLessonView,
  type PlatformLessonView,
  type UpdateLessonInput,
} from './types'

export const MAX_ACTIVE_LESSONS = 20
export const DIGEST_MAX_CHARS = 1600

export const CANDIDATE_MAX_AGE_DAYS = 45
export const MAX_HELD_CANDIDATES = 40

export const LESSON_RECURRENCE_FLAG_THRESHOLD = 3
export const LESSON_ADDRESSED_QUIET_DAYS = 14

const KICK_SWEEP_LIMIT = 3
const KICK_BACKLOG_LIMIT = 12
const BACKLOG_WIDEN_THRESHOLD = 10
const MANUAL_SWEEP_LIMIT = 25

const MAX_ATTEMPTS_PER_PROCESS = 3
const ATTEMPT_MEMO_CAP = 512
const distillAttempts = new Map<string, number>()

let sweepInFlight: Promise<SweepResult> | null = null

export function resetLessonSweepStateForTests(): void {
  distillAttempts.clear()
  sweepInFlight = null
  fingerprintProbe = null
}

const DIGEST_CACHE_KEY = 'platformlessons:digest:v4'
const DIGEST_CACHE_TTL_MS = 5 * 60 * 1000

const SYSTEM_ACTOR = 'system:distiller'

function orgHash(organizationId: string): string {
  return createHash('sha256').update(organizationId).digest('hex')
}

function prepare(text: string | null, maxChars: number): string | null {
  if (!text) return null
  const flat = redactPii(text).replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > maxChars ? `${flat.slice(0, maxChars - 1)}…` : flat
}

const LESSON_BACKFILL_BATCH = 8

let fingerprintProbe: { fingerprint: string; at: number } | null = null
const FINGERPRINT_PROBE_TTL_MS = 10 * 60 * 1000

async function backfillLessonEmbeddings(): Promise<void> {
  if (!fingerprintProbe || Date.now() - fingerprintProbe.at > FINGERPRINT_PROBE_TTL_MS) {
    const probe = await embedNote('fingerprint probe')
    if (!probe) return
    fingerprintProbe = { fingerprint: probe.fingerprint, at: Date.now() }
  }
  const probe = fingerprintProbe
  const missing = await listLessonsMissingEmbedding(probe.fingerprint, LESSON_BACKFILL_BATCH)
  if (missing.length === 0) return
  const embedded = await embedNotes(
    missing.map((lesson) => enrichForEmbedding(lesson.content, [lesson.category]))
  )
  if (!embedded) return
  for (let index = 0; index < missing.length; index++) {
    await setLessonEmbedding(missing[index].id, embedded[index].vector, embedded[index].fingerprint)
  }
}

export interface SweepResult {
  processed: number
  created: number
  linked: number
  skipped: number
  deferred: number
}

async function sweep(limit: number): Promise<SweepResult> {
  const result: SweepResult = { processed: 0, created: 0, linked: 0, skipped: 0, deferred: 0 }

  await expireStaleCandidates(CANDIDATE_MAX_AGE_DAYS, MAX_HELD_CANDIDATES, SYSTEM_ACTOR)

  await recomputeLessonVoteCounters().catch((error: unknown) => {
    console.warn('[PlatformLessons] Vote counter refresh failed (non-fatal):', error)
  })

  await flagIneffectiveActiveLessons(LESSON_RECURRENCE_FLAG_THRESHOLD, SYSTEM_ACTOR).catch(
    (error: unknown) => {
      console.warn('[PlatformLessons] Ineffectiveness flagging failed (non-fatal):', error)
    }
  )
  await retireQuietAddressedLessons(LESSON_ADDRESSED_QUIET_DAYS, SYSTEM_ACTOR)
    .then(async (ids) => {
      if (ids.length > 0) await invalidateCached(DIGEST_CACHE_KEY)
    })
    .catch((error: unknown) => {
      console.warn('[PlatformLessons] Quiet-addressed retirement failed (non-fatal):', error)
    })

  await backfillLessonEmbeddings().catch((error: unknown) => {
    console.warn('[PlatformLessons] Embedding backfill failed (non-fatal):', error)
  })

  const fetched = await listUnprocessedDownvotes(Math.max(limit, KICK_BACKLOG_LIMIT) * 2)
  const eligible = fetched.filter(
    (report) => (distillAttempts.get(report.feedbackId) ?? 0) < MAX_ATTEMPTS_PER_PROCESS
  )
  const effectiveLimit =
    limit === KICK_SWEEP_LIMIT && eligible.length > BACKLOG_WIDEN_THRESHOLD
      ? KICK_BACKLOG_LIMIT
      : limit
  const pending = eligible.slice(0, effectiveLimit)

  for (const report of pending) {
    result.processed++
    const provenance = {
      feedbackId: report.feedbackId,
      orgHash: orgHash(report.organizationId),
      reason: report.reason,
    }

    const question = prepare(report.question, MAX_DISTILL_QUESTION_CHARS)
    const answer = prepare(report.answer, MAX_DISTILL_ANSWER_CHARS)
    const comment = prepare(report.comment, MAX_DISTILL_COMMENT_CHARS)

    if (!comment && !question && !answer && !report.reason) {
      await recordSkippedReport({ ...provenance, skipReason: 'no_signal', canonicalSummary: null })
      result.skipped++
      continue
    }

    const reportVector = await embedNote(
      enrichForEmbedding([comment, question].filter(Boolean).join(' '), [report.reason ?? 'other'])
    )
    const semantic = reportVector
      ? await listSemanticLessonCandidates(
          reportVector.vector,
          reportVector.fingerprint,
          MAX_DISTILL_REGISTER_SIZE
        )
      : []
    const popular = await listLiveLessons(
      semantic.length > 0 ? 10 : MAX_DISTILL_REGISTER_SIZE
    )
    const seen = new Set(semantic.map((lesson) => lesson.id))
    const register = [
      ...semantic,
      ...popular.filter((lesson) => !seen.has(lesson.id)),
    ].slice(0, MAX_DISTILL_REGISTER_SIZE)
    const outcome = await distillReport({
      question,
      answer,
      reason: report.reason,
      comment,
      existingLessons: register.map((lesson) => ({ id: lesson.id, content: lesson.content })),
    })

    if (outcome.error) {
      if (distillAttempts.size >= ATTEMPT_MEMO_CAP) distillAttempts.clear()
      distillAttempts.set(report.feedbackId, (distillAttempts.get(report.feedbackId) ?? 0) + 1)
      result.deferred++
      continue
    }

    const summary = { ...provenance, canonicalSummary: outcome.canonicalSummary }

    if (outcome.matchLessonId) {
      const linked = await linkReportToLesson(outcome.matchLessonId, summary, SYSTEM_ACTOR)
      if (linked) {
        result.linked++
        await invalidateCached(DIGEST_CACHE_KEY)
      }
      continue
    }

    if (!outcome.generalizable || !outcome.lesson) {
      await recordSkippedReport({
        ...summary,
        skipReason: outcome.generalizable ? 'no_lesson' : 'not_generalizable',
      })
      result.skipped++
      continue
    }

    const exact = await findLiveLessonByContent(outcome.lesson)
    if (exact) {
      const linked = await linkReportToLesson(exact.id, summary, SYSTEM_ACTOR)
      if (linked) result.linked++
      continue
    }

    const lessonVector = await embedNote(
      enrichForEmbedding(outcome.lesson, [outcome.category])
    )

    const created = await createLessonFromReport({
      embedding: lessonVector,
      content: outcome.lesson,
      category: outcome.category,
      status: outcome.auditPassed ? 'active' : 'candidate',
      heldReason: outcome.auditPassed ? null : 'audit_flagged',
      activatedBy: outcome.auditPassed ? SYSTEM_ACTOR : null,
      report: summary,
      actor: SYSTEM_ACTOR,
    })
    if (created) {
      result.created++
      if (created.status === 'active') {
        await evictActiveOverCapacity(MAX_ACTIVE_LESSONS, SYSTEM_ACTOR)
        await invalidateCached(DIGEST_CACHE_KEY)
      }
    }
  }

  return result
}

export async function kickLessonDistillation(): Promise<void> {
  if (sweepInFlight) return
  try {
    sweepInFlight = withPlatformAccess('platform lessons: distill new answer feedback', () =>
      sweep(KICK_SWEEP_LIMIT)
    )
    await sweepInFlight
  } catch (error) {
    console.error('[PlatformLessons] Distillation kick failed (non-fatal):', error)
  } finally {
    sweepInFlight = null
  }
}

export async function reopenReportForRedistillation(feedbackId: string): Promise<boolean> {
  try {
    return await withPlatformAccess('platform lessons: reopen a re-voted report', () =>
      reopenSkippedReport(feedbackId)
    )
  } catch (error) {
    console.warn('[PlatformLessons] Could not reopen a re-voted report (non-fatal):', error)
    return false
  }
}


export async function runScheduledLessonSweep(): Promise<SweepResult> {
  if (sweepInFlight) await sweepInFlight.catch(() => undefined)
  try {
    sweepInFlight = withPlatformAccess('platform lessons: scheduled sweep', () =>
      sweep(MANUAL_SWEEP_LIMIT)
    )
    return await sweepInFlight
  } finally {
    sweepInFlight = null
  }
}

export async function runLessonSweep(session: UserSession | null): Promise<SweepResult> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.settingsManage)
  if (sweepInFlight) await sweepInFlight.catch(() => undefined)
  try {
    sweepInFlight = withPlatformAccess('platform lessons: manual sweep', () =>
      sweep(MANUAL_SWEEP_LIMIT)
    )
    return await sweepInFlight
  } finally {
    sweepInFlight = null
  }
}

export interface PlatformLessonsInjection {
  digest: string | null
  lessonIds: string[]
}

export async function buildPlatformLessonsInjection(): Promise<PlatformLessonsInjection> {
  return getCached(DIGEST_CACHE_KEY, DIGEST_CACHE_TTL_MS, () =>
    withPlatformAccess('platform lessons: build injection digest', async () => {
      const lessons = await listActiveLessonsForDigest(MAX_ACTIVE_LESSONS)
      const { digest, kept } = formatBoundedDigestWithKept(
        'PLATFORM_LESSONS v1',
        lessons.map((lesson) => ({
          id: lesson.id,
          tags: [lesson.category, `${lesson.reportCount}x`],
          content: lesson.content,
        })),
        DIGEST_MAX_CHARS
      )
      return { digest, lessonIds: kept.map((lesson) => lesson.id) }
    })
  )
}

export interface LessonOverview {
  lessons: PlatformLessonView[]
  counts: Record<string, number>
}

export async function getLessonOverview(session: UserSession | null): Promise<LessonOverview> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.settingsView)
  return withPlatformAccess('platform lessons: dashboard list', async () => {
    const [lessons, counts] = await Promise.all([listLessons(), countLessonsByStatus()])
    return { lessons: lessons.map(toLessonView), counts }
  })
}

export interface LessonProvenance {
  lesson: PlatformLessonView
  events: {
    id: string
    action: PlatformLessonEvent['action']
    actor: string
    actorEmail: string | null
    detail: Record<string, string | number | boolean>
    createdAt: string
  }[]
  reports: {
    id: string
    feedbackId: string
    outcome: PlatformLessonReport['outcome']
    orgHash: string
    canonicalSummary: string | null
    reason: string | null
    createdAt: string
  }[]
}

export async function getLessonProvenance(
  session: UserSession | null,
  lessonId: string
): Promise<LessonProvenance> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.settingsView)
  return withPlatformAccess('platform lessons: audit trail', async () => {
    const lesson = await getLesson(lessonId)
    if (!lesson) throw new NotFoundError('Unknown lesson.')
    const [events, reports] = await Promise.all([
      listLessonEvents(lessonId),
      listLessonReports(lessonId),
    ])
    return {
      lesson: toLessonView(lesson),
      events: events.map((event) => ({
        id: event.id,
        action: event.action,
        actor: event.actor,
        actorEmail: event.actorEmail ?? null,
        detail: event.detail,
        createdAt: event.createdAt.toISOString(),
      })),
      reports: reports.map((report) => ({
        id: report.id,
        feedbackId: report.feedbackId,
        outcome: report.outcome,
        orgHash: report.orgHash,
        canonicalSummary: report.canonicalSummary ?? null,
        reason: report.reason ?? null,
        createdAt: report.createdAt.toISOString(),
      })),
    }
  })
}

export async function updateLesson(
  session: UserSession | null,
  lessonId: string,
  input: UpdateLessonInput,
  requestForAudit?: Request
): Promise<PlatformLessonView> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.settingsManage)
  const actor = session?.userId ?? 'unknown'
  const actorEmail = session?.email ?? null

  const updated = await withPlatformAccess('platform lessons: owner mutation', async () => {
    const existing = await getLesson(lessonId)
    if (!existing) throw new NotFoundError('Unknown lesson.')
    const now = new Date()
    let row: PlatformLesson | null = existing

    if (input.content !== undefined && input.content !== existing.content) {
      row = await updateLessonWithEvent(
        lessonId,
        { content: input.content },
        { action: 'edited', actor, actorEmail, detail: { previousContent: existing.content } }
      )
    }

    if (input.status === 'active' && existing.status !== 'active') {
      const activated = await activateLessonWithCapacity(
        lessonId,
        {
          status: 'active',
          heldReason: null,
          activatedAt: now,
          activatedBy: actor,
          retiredAt: null,
          retiredBy: null,
          retiredReason: null,
        },
        {
          action: existing.status === 'retired' ? 'reactivated' : 'activated',
          actor,
          actorEmail,
          detail: { automatic: false },
        },
        MAX_ACTIVE_LESSONS
      )
      row = activated?.row ?? null
    } else if (input.status === 'retired' && existing.status !== 'retired') {
      row = await updateLessonWithEvent(
        lessonId,
        {
          status: 'retired',
          retiredAt: now,
          retiredBy: actor,
          retiredReason: input.reason ?? null,
        },
        { action: 'retired', actor, actorEmail, detail: { reason: input.reason ?? '' } }
      )
    }

    if (
      input.rootCauseStatus !== undefined ||
      input.rootCauseNote !== undefined
    ) {
      row = await updateLessonWithEvent(
        lessonId,
        {
          ...(input.rootCauseStatus !== undefined ? { rootCauseStatus: input.rootCauseStatus } : {}),
          ...(input.rootCauseNote !== undefined ? { rootCauseNote: input.rootCauseNote } : {}),
        },
        {
          action: 'root_cause_updated',
          actor,
          actorEmail,
          detail: {
            rootCauseStatus: input.rootCauseStatus ?? existing.rootCauseStatus,
          },
        }
      )
    }

    if (!row) throw new NotFoundError('Unknown lesson.')
    return row
  })

  await invalidateCached(DIGEST_CACHE_KEY)

  const platformOrgId = await getPlatformOrganizationId()
  if (platformOrgId) {
    await recordAuditEvent({
      organizationId: platformOrgId,
      actor: { userId: actor, email: actorEmail ?? undefined },
      action: 'platform.lesson.updated',
      targetType: 'platform_lesson',
      targetId: lessonId,
      metadata: {
        status: input.status ?? '',
        contentChanged: input.content !== undefined,
        rootCauseStatus: input.rootCauseStatus ?? '',
        reason: input.reason ?? '',
      },
      request: requestForAudit,
    })
  } else {
    console.error(
      '[PlatformLessons] Lesson was changed without a WorkOS audit event: the platform organization did not resolve'
    )
  }

  return toLessonView(updated)
}
