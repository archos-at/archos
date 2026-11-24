import 'server-only'
import { ResourceRightsLostError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireResourceAccess } from '@/lib/sharing/access'
import { listAnswerIdsInOrder } from './repository'
import { restsOnWithheld, trailsAsSeenBy, type AnswerTrail } from './answer-trail'

export type ReaderCut =
  | { kind: 'all' }
  | { kind: 'until'; answerId: string; readable: AnswerTrail[] }
  | { kind: 'none' }

const MAX_ANSWERS = 500

export async function readerCut(session: AuthorizedSession, conversationId: string): Promise<ReaderCut> {
  const answers = await listAnswerIdsInOrder(conversationId, MAX_ANSWERS + 1)
  if (answers.length === 0 || answers.length > MAX_ANSWERS) return { kind: 'none' }
  const trails = new Map((await trailsAsSeenBy(session, conversationId)).map((trail) => [trail.messageId, trail]))
  const readable: AnswerTrail[] = []
  for (const answerId of answers) {
    const trail = trails.get(answerId)
    if (!trail) return { kind: 'none' }
    if (restsOnWithheld(trail)) return { kind: 'until', answerId, readable }
    readable.push(trail)
  }
  return { kind: 'none' }
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
  const trails = cut?.kind === 'until' ? cut.readable : await trailsAsSeenBy(session, conversationId)
  return pageOf(trails, page.limit ?? DEFAULT_PAGE, page.cursor)
}

const DEFAULT_PAGE = 50

function pageOf(trails: readonly AnswerTrail[], limit: number, cursor: string | undefined): AnswerTrailPage {
  const end = cursor === undefined ? trails.length : trails.findIndex((trail) => trail.messageId === cursor)
  if (end < 0) return { answers: [], nextCursor: null }
  const start = Math.max(0, end - limit)
  const answers = trails.slice(start, end)
  return { answers, nextCursor: start > 0 ? (answers[0]?.messageId ?? null) : null }
}
