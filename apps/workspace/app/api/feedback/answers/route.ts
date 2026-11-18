import { after } from 'next/server'
import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import {
  getOwnConversationFeedback,
  retractAnswerFeedback,
  submitAnswerFeedback,
} from '@/lib/feedback/service'
import { kickLessonDistillation } from '@/lib/platform-lessons/service'
import {
  conversationFeedbackQuerySchema,
  retractAnswerFeedbackQuerySchema,
  upsertAnswerFeedbackSchema,
} from '@/lib/feedback/types'

export const GET = apiRoute(
  async ({ session, request }) => {
    const { conversationId } = parseQuery(request, conversationFeedbackQuerySchema)
    return { feedback: await getOwnConversationFeedback(session, conversationId) }
  },
  { authz: { enforcedBy: 'getOwnConversationFeedback (keyed to session.userId)' } }
)

export const POST = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, upsertAnswerFeedbackSchema)
    const view = await submitAnswerFeedback(session, input)
    if (input.verdict === 'down') {
      try {
        after(() => kickLessonDistillation())
      } catch {
        // report is not lost — it stays unprocessed for the next sweep.
      }
    }
    return view
  },
  { authz: { enforcedBy: 'submitAnswerFeedback (requireProjectAccess project:view)' } }
)

export const DELETE = apiRoute(
  async ({ session, request }) => {
    const { messageId } = parseQuery(request, retractAnswerFeedbackQuerySchema)
    await retractAnswerFeedback(session, messageId)
    return null // 204 — retraction is idempotent
  },
  { authz: { enforcedBy: 'retractAnswerFeedback (keyed to session.userId)' } }
)
