import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import {
  createConversationSchema,
  deleteOwnConversationsQuerySchema,
  listConversationsQuerySchema,
} from '@/lib/conversations/conversation-wire'
import { createConversation, deleteOwnConversations, listConversations } from '@/lib/conversations/service'

export const GET = apiRoute(
  async ({ session, request }) =>
    listConversations(session, parseQuery(request, listConversationsQuerySchema)),
  {
    authz: {
      enforcedBy: 'listConversations (requireProjectAccess project:view + resource access)',
    },
  }
)

export const POST = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, createConversationSchema)
    return createConversation(session, input)
  },
  { status: 201, authz: { enforcedBy: 'createConversation (requireProjectAccess project:view)' } }
)

export const DELETE = apiRoute(
  async ({ session, request }) => {
    const { projectId } = parseQuery(request, deleteOwnConversationsQuerySchema)
    return deleteOwnConversations(session, { projectId: projectId ?? null })
  },
  {
    authz: {
      enforcedBy:
        'deleteOwnConversations (only rows the caller created; requireProjectAccess project:view for a project)',
    },
  }
)
