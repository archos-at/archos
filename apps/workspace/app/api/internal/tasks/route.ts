import { ConflictError, ForbiddenError } from '@/lib/api/errors'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import {
  isDeepResearchEnabledForOrg,
  isTaskAutomationEnabledForOrg,
} from '@/lib/workos/feature-flags'
import {
  requireEnvelopeProject,
  requirePinnedSession,
  requireVerifiedContext,
} from '@/lib/api/internal-envelope'
import { withTenant } from '@/lib/db/tenant-context'
import { commissionResearchRun, delegateTask } from '@/lib/tasks/delegation'
import { internalTaskRequestSchema, parseTaskDue } from '@/lib/tasks/wire'

export const POST = internalApiRoute(
  'tasks',
  async ({ request }) => {
    const context = requireVerifiedContext(request)
    const body = await parseJsonBody(request, internalTaskRequestSchema)
    const session = await requirePinnedSession(context)
    requireEnvelopeProject(context, body.projectId)

    const allowed =
      body.op === 'research'
        ? await isDeepResearchEnabledForOrg(context.organizationId)
        : await isTaskAutomationEnabledForOrg(context.organizationId)
    if (!allowed) {
      throw new ForbiddenError(
        body.op === 'research'
          ? 'Deep research is not available in this workspace.'
          : 'Tasks and schedules are not available in this workspace. ' +
            'Answer the question directly in the conversation instead.',
      )
    }

    if (body.op === 'research') {
      if (!context.conversationId) {
        throw new ConflictError('A research run needs the thread it was asked in')
      }
      const conversationId = context.conversationId
      return withTenant({ organizationId: context.organizationId }, () =>
        commissionResearchRun(session, {
          projectId: body.projectId,
          conversationId,
          question: body.question,
          context: body.context ?? null,
          dataSources: body.dataSources ?? null,
          documents: body.documents ?? null,
        }),
      )
    }

    const dueAt = parseTaskDue(body.due)

    return withTenant({ organizationId: context.organizationId }, async () => {
      const result = await delegateTask(session, {
        projectId: body.projectId,
        kind: body.kind,
        goal: body.goal,
        dueAt,
        cadence: body.cadence
          ? { cron: body.cadence, timezone: body.cadenceTimezone }
          : null,
        conversationId: context.conversationId,
      })
      const { definition, run } = result
      return {
        taskId: definition.id,
        kind: body.kind,
        title: definition.title,
        status: run ? run.status : 'scheduled',
        conversationId: run?.conversationId ?? null,
        dueAt: definition.dueAt ? definition.dueAt.toISOString() : null,
        scheduled: run === null,
        nextRunAt: definition.nextRunAt ? definition.nextRunAt.toISOString() : null,
      }
    })
  },
  {
    tenancy: {
      fromPayload:
        'the verified X-Grid-Request-Context envelope (organizationId), never the request body',
    },
    status: 201,
  },
)
