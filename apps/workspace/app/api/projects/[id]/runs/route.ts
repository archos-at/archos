import { commissionRunSchema } from '@/lib/runs/commission-wire'
import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { NotFoundError } from '@/lib/api/errors'
import {
  FEATURE_FLAGS,
  requireFeature,
  requireSkillsEnabled,
  requireTaskAutomationEnabled,
} from '@/lib/authz/feature-flags'
import { findConversationInOrg } from '@/lib/conversations/repository'
import { requireResourceAccess } from '@/lib/sharing/access'
import { commissionResearchRun } from '@/lib/tasks/delegation'
import { listTaskRunViews } from '@/lib/tasks/service'
import { taskRunListQuerySchema } from '@/lib/tasks/task-wire'
import { getLocale } from '@/i18n/server'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const query = parseQuery(request, taskRunListQuerySchema)
    const gated = query.taskId
      ? requireSkillsEnabled(session)
      : (requireSkillsEnabled(session) ?? requireTaskAutomationEnabled(session))
    if (gated) return gated
    return listTaskRunViews(session, params.id, query)
  },
  {
    authz: {
      enforcedBy: 'listTaskRunViews -> listTaskRuns (requireProjectAccess project:view)',
    },
  }
)

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const gated = requireFeature(session, FEATURE_FLAGS.deepResearch)
    if (gated) return gated
    const input = await parseJsonBody(request, commissionRunSchema)
    await requireResourceAccess(session, 'conversation', input.conversationId, 'collaborator')
    const conversation = await findConversationInOrg(input.conversationId, session.organizationId)
    if (conversation?.projectId !== params.id) throw new NotFoundError()
    const run = await commissionResearchRun(session, {
      projectId: params.id,
      conversationId: input.conversationId,
      question: input.question,
      context: input.context ?? null,
      documents: input.documents ?? null,
      locale: await getLocale(),
    })
    return {
      runId: run.runId,
      runMessageId: run.runMessageId,
      conversationId: run.conversationId,
      status: run.status,
    }
  },
  {
    status: 201,
    authz: {
      enforcedBy:
        'requireFeature deepResearch; requireResourceAccess conversation collaborator; commissionResearchRun (requireProjectAccess COMMISSION_PERMISSIONS, refuses a confined conversation)',
    },
  }
)
