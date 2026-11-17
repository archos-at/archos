import 'server-only'
import { randomUUID } from 'node:crypto'
import { ConflictError, ForbiddenError, isAuthzRefusal, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { configuredAppOrigin } from '@/lib/app-origin'
import { isAgentAskEnabled } from '@/lib/authz/feature-flags'
import { requireProjectAccess } from '@/lib/authz/projects'
import {
  deleteConversationInOrg,
  findConversationInOrg,
  findMessageInConversation,
  insertConversation,
  insertMessages,
} from '@/lib/conversations/repository'
import type { AgentAskRow } from '@/lib/db/schema/piloti-asks'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { isUuid } from '@/lib/ids'
import { memberReader } from '@/lib/documents/visibility'
import {
  cancelHeadlessTurn,
  chatSocketUrl,
  runHeadlessTurn,
  type HeadlessCancelOutcome,
  type HeadlessUserMessage,
} from '@/lib/turns/headless-turn'
import { HEADLESS_MODE_HEADERS } from '@/lib/turns/headless-mode'
import type { TurnOutcomeRequest } from '@/lib/turns/outcome-types'
import { askAnswerMessageId } from '@/lib/turns/answer-ids'
import { resolveTurnContext, TurnBudgetExhaustedError } from '@/lib/turns/turn-context'
import { turnContextHeaders } from '@/lib/turns/turn-headers.js'
import { projectValuesFor } from '@/lib/conversations/messages-for-agent'
import { answerEvidence } from './answer-evidence'
import { citationStylesFor } from '@/lib/citations/style'
import { answerTextForAgent } from './answer-text'
import {
  ASK_WAIT_SECONDS,
  DEFAULT_ASK_MAX_SECONDS,
  isTerminalAskState,
  type AskView,
  type CreateAskRequest,
} from './ask-wire'
import {
  deleteAskQuestion,
  endAsk,
  findAsk,
  findAskById,
  findAsksOpenBefore,
  hasAskedInConversation,
  insertAsk,
  listAskDocuments,
  markAskWorking,
  OPEN_ASKS_PAGE,
  type AskEnd,
} from './repository'
import { PRODUCT_NAME } from '@/lib/brand'

export const ASK_REQUIRES = ['user_message.trigger', 'user_message.if_idle'] as const

const POLL_MS = 750
const POLL_AFTER_SECONDS = 10
const MAX_TITLE = 120
const CANCEL_WAIT_MS = 5_000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export { askAnswerMessageId }

const newConversationId = (): string => `s_${randomUUID().replace(/-/g, '_')}`

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

function requireEnabled(session: AuthorizedSession): void {
  if (isAgentAskEnabled(session)) return
  throw new ForbiddenError('Asking ' + PRODUCT_NAME + ' from another agent is not enabled for this organization (agent-requests).', {
    reason: 'piloti-ask-off',
  })
}

async function threadFor(
  session: AuthorizedSession,
  input: CreateAskRequest,
): Promise<{ conversationId: string; projectId: string | null; created: boolean }> {
  if (input.conversationId) {
    const conversation = await findConversationInOrg(input.conversationId, session.organizationId)
    const continues =
      conversation !== null &&
      conversation.createdBy === session.userId &&
      !conversation.deletedAt &&
      (await hasAskedInConversation(session.organizationId, conversation.id, session.userId))
    if (!conversation || !continues) throw new NotFoundError('No ask of yours started that conversation.')
    if (input.projectId && input.projectId !== conversation.projectId) {
      throw new ConflictError('That conversation belongs to another project. Omit projectId to continue it.', {
        reason: 'piloti-ask-project-mismatch',
      })
    }
    if (conversation.projectId) await requireProjectAccess(session, conversation.projectId, CHAT_PERMISSIONS)
    return { conversationId: conversation.id, projectId: conversation.projectId ?? null, created: false }
  }
  if (input.projectId) await requireProjectAccess(session, input.projectId, CHAT_PERMISSIONS)
  const conversationId = newConversationId()
  await insertConversation({
    id: conversationId,
    organizationId: session.organizationId,
    createdBy: session.userId,
    title: clip(input.question, MAX_TITLE),
    projectId: input.projectId ?? null,
  })
  return { conversationId, projectId: input.projectId ?? null, created: true }
}

export function askMessage(input: {
  askId: string
  conversationId: string
  question: string
  authorName: string | null
}): HeadlessUserMessage {
  return {
    type: 'user_message',
    conversation_id: input.conversationId,
    message_id: input.askId,
    text: input.question,
    author_name: input.authorName,
    trigger: { kind: 'agent_consult', event_id: input.askId, annotation_id: null },
    if_idle: true,
  }
}

type SocketTarget = { url: string; secret: string } | { unavailable: string }

function socketTarget(conversationId: string): SocketTarget {
  const secret = process.env.INTERNAL_API_TOKEN
  if (!secret) return { unavailable: 'this deployment cannot sign a turn (INTERNAL_API_TOKEN)' }
  try {
    return { url: chatSocketUrl(conversationId), secret }
  } catch {
    return { unavailable: 'this deployment has no chat service configured (BACKEND_CHAT_URL)' }
  }
}

export function askMaxSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = Number.parseInt(env.AGENT_ASK_MAX_SECONDS ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ASK_MAX_SECONDS
}

async function startTurn(
  session: AuthorizedSession,
  ask: AgentAskRow,
  projectId: string | null,
  question: string,
): Promise<AskEnd | 'ended' | null> {
  let context: Awaited<ReturnType<typeof resolveTurnContext>>
  try {
    context = await resolveTurnContext(session, {
      projectId: projectId ?? undefined,
      conversationId: ask.conversationId,
    })
  } catch (error) {
    if (error instanceof TurnBudgetExhaustedError) return { state: 'rejected', reason: `budget: ${error.message}` }
    if (isAuthzRefusal(error)) return { state: 'rejected', reason: 'You may no longer chat in this project.' }
    throw error
  }
  const target = socketTarget(ask.conversationId)
  if ('unavailable' in target) return { state: 'failed', reason: `${PRODUCT_NAME} could not be reached: ${target.unavailable}` }
  const now = await findAsk(ask.organizationId, ask.id)
  if (!now || isTerminalAskState(now.state)) return 'ended'
  const outcome = await runHeadlessTurn({
    url: target.url,
    conversationId: ask.conversationId,
    projectId: context.projectId,
    headers: {
      ...turnContextHeaders(context, { issuedAt: Date.now(), secret: target.secret }),
      ...HEADLESS_MODE_HEADERS,
    },
    message: askMessage({ askId: ask.id, conversationId: ask.conversationId, question, authorName: session.name }),
    requires: ASK_REQUIRES,
  })
  switch (outcome.kind) {
    case 'started':
    case 'duplicate':
      return null
    case 'busy':
      return {
        state: 'rejected',
        reason:
          PRODUCT_NAME + ' is still answering in this conversation, and an ask never interrupts a running turn. ' +
          'Read the earlier ask with agent-ask-get until it ends, then ask again; ' +
          'or ask in a new conversation by leaving out conversationId.',
      }
    case 'refused':
      return { state: 'rejected', reason: outcome.reason }
    case 'rejected':
      return { state: 'failed', reason: `rejected: ${outcome.code}${outcome.message ? ` (${outcome.message})` : ''}` }
    case 'unavailable':
      return { state: 'failed', reason: `${PRODUCT_NAME} could not be reached: ${outcome.reason}` }
  }
}

async function waitForEnd(row: AgentAskRow, deadline: number): Promise<AgentAskRow> {
  let current = row
  while (!isTerminalAskState(current.state) && Date.now() < deadline) {
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())))
    current = (await findAsk(current.organizationId, current.id)) ?? current
  }
  return current
}

export function lostAskEnd(maxSeconds: number = askMaxSeconds()): AskEnd {
  const minutes = Math.round(maxSeconds / 60)
  return { state: 'failed', reason: `${PRODUCT_NAME} did not report the end of its turn within ${minutes} minutes. Ask again.` }
}

async function expireIfLost(row: AgentAskRow, now = Date.now()): Promise<AgentAskRow> {
  if (isTerminalAskState(row.state)) return row
  const maxSeconds = askMaxSeconds()
  if (now - new Date(row.createdAt).getTime() < maxSeconds * 1_000) return row
  return (
    (await endAsk(row.organizationId, row.id, lostAskEnd(maxSeconds))) ??
    (await findAsk(row.organizationId, row.id)) ??
    row
  )
}

export const LOST_ASKS_PER_SWEEP = OPEN_ASKS_PAGE

// Same rule as a read: on dev, 2026-11-12, six asks read `working` an hour after a pod restart lost their notices.
export async function endLostAsks(now: Date = new Date()): Promise<number> {
  const maxSeconds = askMaxSeconds()
  const lost = await findAsksOpenBefore(new Date(now.getTime() - maxSeconds * 1_000), LOST_ASKS_PER_SWEEP)
  let ended = 0
  for (const ask of lost) {
    if (await endAsk(ask.organizationId, ask.id, lostAskEnd(maxSeconds))) ended += 1
  }
  return ended
}

async function viewOf(session: AuthorizedSession, row: AgentAskRow): Promise<AskView> {
  const conversation = await findConversationInOrg(row.conversationId, row.organizationId)
  const question = await findMessageInConversation(row.conversationId, row.id)
  let answer: AskView['answer'] = null
  if (row.state === 'completed') {
    const messageId = askAnswerMessageId(row.conversationId, row.id)
    const message = await findMessageInConversation(row.conversationId, messageId)
    if (message) {
      const evidence = answerEvidence(message, {
        conversationId: row.conversationId,
        projectId: conversation?.projectId ?? null,
        origin: configuredAppOrigin(),
        styles: (await citationStylesFor(row.organizationId)) ?? undefined,
      })
      const projectValue = await projectValuesFor(message.content, conversation?.projectId ?? null, row.organizationId)
      answer = { messageId, text: answerTextForAgent(message.content, { projectValue }), ...evidence }
    }
  }
  return {
    ...baseView(row, conversation?.projectId ?? null, question?.content ?? null),
    answer,
    documents: await listAskDocuments(row, memberReader(session.userId)),
  }
}

function baseView(row: AgentAskRow, projectId: string | null, question: string | null): AskView {
  const terminal = isTerminalAskState(row.state)
  return {
    id: row.id,
    conversationId: row.conversationId,
    projectId,
    state: row.state,
    question,
    reason: row.reason,
    answer: null,
    documents: [],
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    endedAt: row.endedAt ? new Date(row.endedAt).toISOString() : null,
    pollAfterSeconds: terminal ? null : POLL_AFTER_SECONDS,
  }
}

async function endUnstarted(
  session: AuthorizedSession,
  ask: AgentAskRow,
  thread: { projectId: string | null; created: boolean },
  question: string,
  end: AskEnd,
): Promise<AskView> {
  const ended = (await endAsk(session.organizationId, ask.id, end)) ?? (await findAsk(session.organizationId, ask.id)) ?? ask
  if (thread.created) await deleteConversationInOrg(ask.conversationId, session.organizationId)
  else await deleteAskQuestion(session.organizationId, ask.conversationId, ask.id)
  return { ...baseView(ended, thread.projectId, question), pollAfterSeconds: null }
}

export async function askAgent(
  session: AuthorizedSession,
  input: CreateAskRequest,
  options: { waitMs?: number; beforeTurn?: (ask: { id: string; conversationId: string }) => Promise<void> } = {},
): Promise<AskView> {
  requireEnabled(session)
  const deadline = Date.now() + (options.waitMs ?? (input.waitSeconds ?? ASK_WAIT_SECONDS) * 1_000)
  const thread = await threadFor(session, input)
  const { conversationId, projectId } = thread
  const id = randomUUID()
  const ask = await insertAsk({ id, organizationId: session.organizationId, conversationId, requestedBy: session.userId })
  await insertMessages([
    {
      id,
      conversationId,
      role: 'user',
      authorUserId: session.userId,
      content: input.question,
      metadata: { messageType: 'user', agentConsult: { askId: id } },
    },
  ])

  let started: Awaited<ReturnType<typeof startTurn>>
  try {
    await options.beforeTurn?.({ id, conversationId })
    started = await startTurn(session, ask, projectId, input.question)
  } catch (error) {
    console.error('[piloti-ask] the turn could not be started:', error)
    started = { state: 'failed', reason: PRODUCT_NAME + ' could not start the turn.' }
  }
  if (started !== null && started !== 'ended') return endUnstarted(session, ask, thread, input.question, started)
  if (started === null && !(await markAskWorking(session.organizationId, id))) {
    const now = await findAsk(session.organizationId, id)
    if (now?.state === 'canceled') await stopTurn(now)
  }
  const current = (await findAsk(session.organizationId, id)) ?? ask
  return viewOf(session, await waitForEnd(current, deadline))
}

async function requireOwnAsk(session: AuthorizedSession, id: string): Promise<AgentAskRow> {
  if (!isUuid(id)) throw new NotFoundError('Ask not found')
  const row = await findAsk(session.organizationId, id)
  if (!row || row.requestedBy !== session.userId) throw new NotFoundError('Ask not found')
  return expireIfLost(row)
}

export async function getAsk(session: AuthorizedSession, id: string, waitSeconds = 0): Promise<AskView> {
  const row = await requireOwnAsk(session, id)
  const waited = waitSeconds > 0 ? await waitForEnd(row, Date.now() + Math.min(waitSeconds, ASK_WAIT_SECONDS) * 1_000) : row
  return viewOf(session, waited)
}

async function stopTurn(row: AgentAskRow): Promise<HeadlessCancelOutcome> {
  const target = socketTarget(row.conversationId)
  if ('unavailable' in target) return { kind: 'unavailable', reason: target.unavailable }
  return cancelHeadlessTurn({
    url: target.url,
    conversationId: row.conversationId,
    turnId: row.id,
    headers: {
      ...turnContextHeaders(
        { organizationId: row.organizationId, userId: row.requestedBy, conversationId: row.conversationId },
        { issuedAt: Date.now(), secret: target.secret },
      ),
      ...HEADLESS_MODE_HEADERS,
    },
  })
}

export async function cancelAsk(session: AuthorizedSession, id: string): Promise<AskView> {
  const row = await requireOwnAsk(session, id)
  if (isTerminalAskState(row.state)) {
    throw new ConflictError(`The ask has already ended (${row.state}).`, { reason: 'piloti-ask-ended' })
  }
  if (row.state === 'submitted') await endAsk(row.organizationId, row.id, { state: 'canceled' })
  const outcome = await stopTurn(row)
  if (outcome.kind === 'not_running') await endAsk(row.organizationId, row.id, { state: 'canceled' })
  const refused = outcome.kind === 'unavailable' || outcome.kind === 'rejected'
  if (refused && row.state !== 'submitted') {
    const why = outcome.kind === 'rejected' ? outcome.code : outcome.reason
    throw new ConflictError(`The ask could not be stopped: ${why}`, { reason: 'agent-ask-cancel-failed' })
  }
  const current = (await findAsk(row.organizationId, row.id)) ?? row
  let settled = await waitForEnd(current, Date.now() + CANCEL_WAIT_MS)
  if (!isTerminalAskState(settled.state)) {
    settled = (await endAsk(row.organizationId, row.id, { state: 'canceled' })) ?? (await findAsk(row.organizationId, row.id)) ?? settled
  }
  return viewOf(session, settled)
}

export function askEndOf(request: Pick<TurnOutcomeRequest, 'outcome' | 'reason'>): AskEnd {
  switch (request.outcome) {
    case 'answered':
    case 'handed_off':
      return { state: 'completed' }
    case 'stopped':
      return { state: 'canceled' }
    case 'refused':
      return { state: 'rejected', reason: request.reason?.trim() || 'refused' }
    case 'failed':
      return { state: 'failed', reason: request.reason?.trim() || 'the turn ended without an answer' }
  }
}

export async function recordAskOutcome(request: TurnOutcomeRequest): Promise<boolean> {
  const ask = await withPlatformAccess(
    'turn outcome: the chat socket names a turn by id, before any organization is known',
    () => findAskById(request.turnId),
  )
  if (!ask || isTerminalAskState(ask.state) || ask.conversationId !== request.conversationId) return false
  return (await endAsk(ask.organizationId, ask.id, askEndOf(request))) !== null
}
