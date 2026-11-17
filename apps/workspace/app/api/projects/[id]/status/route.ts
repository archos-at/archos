import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { setProjectStatus } from '@/lib/projects/service'
import { dateToMonth } from '@/lib/projects/month'
import { closingOf, isProjectClosed } from '@/lib/projects/project-status'
import { projectStatusSchema } from '@/lib/projects/project-wire'

export const PUT = apiRoute<{ id: string }>(
  async ({ session, params, request }) => {
    const change = await parseJsonBody(request, projectStatusSchema)
    const project = await setProjectStatus(session, params.id, change, request)
    return {
      id: project.id,
      status: project.status,
      pausedAt: project.pausedAt?.toISOString() ?? null,
      closedAt: project.closedAt?.toISOString() ?? null,
      closedBy: project.closedBy,
      closedOutcome: isProjectClosed(project) ? project.closedOutcome : null,
      endedOn: dateToMonth(closingOf(project)),
    }
  },
  { authz: { enforcedBy: 'setProjectStatus (requireProjectAccess project:manage, evenWhenClosed)' } }
)
