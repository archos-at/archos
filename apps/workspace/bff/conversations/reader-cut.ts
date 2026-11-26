import 'server-only'
import { ResourceRightsLostError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { AnswerContext } from '@/lib/db/schema/answer-contexts'
import { requireResourceAccess } from '@/lib/sharing/access'
import { answerReadsOf, trailsAsSeenBy, type AnswerTrail } from './answer-trail'
import { listMessageRolesInOrder } from './repository'
import { unreadableSourcesOf, type UnreadableSources } from './restricted-use'

export type ReaderCut = { kind: 'until'; messageId: string; readableAnswers: ReadonlySet<string> } | { kind: 'none' }

const MAX_MESSAGES = 5000
const NONE: ReaderCut = { kind: 'none' }

export async function readerCut(session: AuthorizedSession, conversationId: string): Promise<ReaderCut> {
  const [order, reads, closed] = await Promise.all([
    listMessageRolesInOrder(conversationId, MAX_MESSAGES + 1),
    answerReadsOf(session, conversationId),
    unreadableSourcesOf(session, conversationId),
  ])
  if (order.length > MAX_MESSAGES) return NONE
  const recordOf = new Map(reads.map((read) => [read.messageId, read]))
  const readableAnswers = new Set<string>()
  let lastReadable = -1
  for (const [index, message] of order.entries()) {
    if (message.role !== 'assistant') continue
    const record = recordOf.get(message.id)
    if (!record) return NONE
    if (restsOnClosed(record, closed)) {
      const later = order.slice(index).flatMap((rest) => recordOf.get(rest.id) ?? [])
      if (lastReadable < 0 || !namesEveryClosed(later, closed)) return NONE
      return { kind: 'until', messageId: order[lastReadable + 1].id, readableAnswers }
    }
    readableAnswers.add(message.id)
    lastReadable = index
  }
  return NONE
}

const restsOnClosed = (record: AnswerContext, closed: UnreadableSources): boolean =>
  record.readFolders.some((folderId) => closed.folders.has(folderId)) ||
  record.readProjects.some((projectId) => closed.projects.has(projectId))

function namesEveryClosed(records: readonly AnswerContext[], closed: UnreadableSources): boolean {
  const folders = new Set(records.flatMap((record) => record.readFolders))
  const projects = new Set(records.flatMap((record) => record.readProjects))
  return [...closed.folders].every((id) => folders.has(id)) && [...closed.projects].every((id) => projects.has(id))
}

export interface AnswerTrailPage {
  answers: AnswerTrail[]
  nextCursor: string | null
}

export async function readableAnswerTrails(
  session: AuthorizedSession,
  conversationId: string,
  page: { limit?: number; cursor?: string } = {},
): Promise<AnswerTrailPage> {
  const access = await requireResourceAccess(session, 'conversation', conversationId, 'viewer', { allowLocked: true })
  const cut = access.contentLocked ? await readerCut(session, conversationId) : null
  if (cut?.kind === 'none') throw new ResourceRightsLostError('conversation')
  const trails = await trailsAsSeenBy(session, conversationId)
  const readable = cut ? trails.filter((trail) => cut.readableAnswers.has(trail.messageId)) : trails
  return pageOf(readable, page.limit ?? DEFAULT_PAGE, page.cursor)
}

const DEFAULT_PAGE = 50

function pageOf(trails: readonly AnswerTrail[], limit: number, cursor: string | undefined): AnswerTrailPage {
  const end = cursor === undefined ? trails.length : trails.findIndex((trail) => trail.messageId === cursor)
  if (end < 0) return { answers: [], nextCursor: null }
  const start = Math.max(0, end - limit)
  const answers = trails.slice(start, end)
  return { answers, nextCursor: start > 0 ? (answers[0]?.messageId ?? null) : null }
}
