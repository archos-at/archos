import 'server-only'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { requireProjectAccess } from '@/lib/authz/projects'
import { BadRequestError } from '@/lib/api/errors'
import { requirePlatformPermission } from '@/lib/authz/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import { ANSWER_FEEDBACK_REASONS, ANSWER_FEEDBACK_VERDICTS, type AnswerFeedback } from '@/lib/db/schema/answer-feedback'
import type { AnswerFeedbackView, UpsertAnswerFeedbackInput } from './types'
import {
  deleteAnswerFeedbackForUser,
  getAnswerFeedbackForUser,
  getAnswerTraceId,
  isRestrictedUseVote,
  getFeedbackHealth,
  getPersistedAnswerConversationId,
  listAnswerFeedbackForConversation,
  upsertAnswerFeedback,
  type FeedbackHealth,
  type FeedbackOrgRollup,
  type FeedbackTurn,
} from './repository'
import type { FeedbackQuery } from './filters'
import { getOrganizationDisplayNames } from '@/lib/organizations/display-names'
import { langfuseProjectUrl, langfuseTraceUrl, langfuseUiConfig } from '@/lib/langfuse/config'
import {
  deleteFeedbackScore,
  feedbackScoringEnabled,
  upsertFeedbackScore,
} from '@/lib/langfuse/feedback-score'
import { getFeedbackDigest, type FeedbackDigestOptions, type FeedbackDigestResult } from './digest'
import { resolveLessonsHoldout } from '@/lib/platform-lessons/holdout'
import { reopenReportForRedistillation } from '@/lib/platform-lessons/service'
import { implicateMemoryFromFeedback } from '@/lib/projects/memory-service'
import { memoryClearance } from '@/lib/projects/service'
import { maskChatText } from '@/lib/upload-screening/service'

export async function submitAnswerFeedback(
  session: AuthorizedSession,
  input: UpsertAnswerFeedbackInput
): Promise<AnswerFeedbackView> {
  if (!ANSWER_FEEDBACK_VERDICTS.includes(input.verdict)) {
    throw new BadRequestError('Unknown verdict.')
  }
  if (input.reason != null && !ANSWER_FEEDBACK_REASONS.includes(input.reason)) {
    throw new BadRequestError('Unknown feedback reason.')
  }
  if (input.verdict === 'up' && input.reason != null) {
    throw new BadRequestError('A reason is only valid with a down verdict.')
  }
  if (input.verdict === 'up' && (input.comment || input.expectedAnswer)) {
    throw new BadRequestError('A comment is only valid with a down verdict.')
  }

  if (input.projectId) {
    await requireProjectAccess(session, input.projectId, 'project:view')
  }

  const conversationId =
    (await getPersistedAnswerConversationId(input.messageId, session.organizationId)) ??
    input.conversationId ??
    null

  const lessonsHoldout = await resolveLessonsHoldout(conversationId)

  const prior = await getAnswerFeedbackForUser(session.userId, input.messageId)

  const comment =
    input.verdict === 'down' && input.comment
      ? (await maskChatText(session.organizationId, input.comment)).text
      : null
  const expectedAnswer =
    input.verdict === 'down' && input.expectedAnswer
      ? (await maskChatText(session.organizationId, input.expectedAnswer)).text
      : null

  const row = await upsertAnswerFeedback({
    lessonsHoldout,
    organizationId: session.organizationId,
    userId: session.userId,
    messageId: input.messageId,
    verdict: input.verdict,
    reason: input.verdict === 'down' ? (input.reason ?? null) : null,
    comment,
    expectedAnswer,
    conversationId,
    projectId: input.projectId ?? null,
  })
  if (row.verdict === 'down') {
    void reopenReportForRedistillation(row.id)
  }

  if (row.verdict === 'down' && row.comment && row.comment !== prior?.comment) {
    void implicateFeedbackMemory(session, row.projectId ?? null, row.comment)
  }

  const traceLookup = getAnswerTraceId(row.messageId, session.organizationId)
  void scoreVoteInLangfuse(session.organizationId, row, prior?.verdict ?? null, traceLookup)
  const traceId = await traceLookup.catch(() => null)
  return { ...toView(row), traceId }
}

async function implicateFeedbackMemory(
  session: AuthorizedSession,
  projectId: string | null,
  comment: string
): Promise<void> {
  try {
    const { cleared } = projectId ? await memoryClearance(session, projectId) : { cleared: [] }
    await implicateMemoryFromFeedback({
      organizationId: session.organizationId,
      projectId,
      comment,
      readableFolderIds: cleared,
    })
  } catch (error) {
    console.warn('[feedback] Memory implication skipped (non-fatal):', error)
  }
}

async function scoreVoteInLangfuse(
  organizationId: string,
  row: AnswerFeedback,
  previousVerdict: AnswerFeedback['verdict'] | null,
  traceLookup: Promise<string | null>
): Promise<void> {
  if (!feedbackScoringEnabled()) return
  try {
    const traceId = await traceLookup
    if (!traceId) return
    const withWords = !(await isRestrictedUseVote(row.id, organizationId))
    await upsertFeedbackScore({
      feedbackId: row.id,
      traceId,
      verdict: row.verdict,
      reason: row.reason ?? null,
      comment: withWords ? (row.comment ?? null) : null,
      expectedAnswer: withWords ? (row.expectedAnswer ?? null) : null,
      previousVerdict,
    })
  } catch (error) {
    console.warn('[Feedback] Langfuse score failed (non-fatal):', error)
  }
}

export async function retractAnswerFeedback(
  session: AuthorizedSession,
  messageId: string
): Promise<void> {
  const deletedId = await deleteAnswerFeedbackForUser(
    session.userId,
    messageId,
    session.organizationId
  )
  if (deletedId) void deleteFeedbackScore(deletedId)
}

export async function getOwnConversationFeedback(
  session: AuthorizedSession,
  conversationId: string
): Promise<AnswerFeedbackView[]> {
  const rows = await listAnswerFeedbackForConversation(
    session.userId,
    conversationId,
    session.organizationId
  )
  return rows.map(toView)
}

function toView(row: AnswerFeedback): AnswerFeedbackView {
  return {
    messageId: row.messageId,
    verdict: row.verdict,
    reason: row.reason ?? null,
    comment: row.comment ?? null,
    expectedAnswer: row.expectedAnswer ?? null,
  }
}

export interface FeedbackOrgRollupView extends FeedbackOrgRollup {
  organizationName: string | null
}

export interface FeedbackTurnView extends FeedbackTurn {
  organizationName: string | null
  langfuseTraceUrl: string | null
}

export interface AnswerFeedbackHealthView extends Omit<FeedbackHealth, 'organizations' | 'turns'> {
  organizations: FeedbackOrgRollupView[]
  turns: FeedbackTurnView[]
  langfuse: { projectUrl: string } | null
}

export async function getAnswerFeedbackHealth(
  session: UserSession | null,
  query: FeedbackQuery
): Promise<AnswerFeedbackHealthView> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.organizationsView)
  const health = await withPlatformAccess('answer feedback: cross-organization quality view', () =>
    getFeedbackHealth(query)
  )
  const names = await getOrganizationDisplayNames([
    ...health.organizations.map((org) => org.organizationId),
    ...health.turns.map((turn) => turn.organizationId),
  ])
  const nameOf = (organizationId: string): string | null => names.get(organizationId) ?? null
  const ui = langfuseUiConfig()
  const projectUrl = langfuseProjectUrl(ui)
  return {
    ...health,
    organizations: health.organizations.map((org) => ({
      ...org,
      organizationName: nameOf(org.organizationId),
    })),
    turns: health.turns.map((turn) => ({
      ...turn,
      organizationName: nameOf(turn.organizationId),
      langfuseTraceUrl: langfuseTraceUrl(turn.traceId, ui),
    })),
    langfuse: projectUrl ? { projectUrl } : null,
  }
}

export async function getAnswerFeedbackDigest(
  session: UserSession | null,
  query: FeedbackQuery,
  options: FeedbackDigestOptions = {}
): Promise<FeedbackDigestResult> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.organizationsView)
  return withPlatformAccess('answer feedback digest: cross-organization quality view', async () => {
    const health = await getFeedbackHealth(query, { turnLimit: 0 })
    return getFeedbackDigest(health, query, options)
  })
}
