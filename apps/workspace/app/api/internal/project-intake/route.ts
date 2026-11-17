import { UnprocessableError } from '@/lib/api/errors'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { requirePinnedSession, requireVerifiedContext } from '@/lib/api/internal-envelope'
import { withTenant } from '@/lib/db/tenant-context'
import {
  finishIntakeReading,
  intakeNeeds,
  recordIntakeValues,
  reportIntakeProgress,
  withdrawIntakeValues,
} from '@/lib/project-intake/service'
import { internalIntakeRequestSchema, type InternalIntakeResponse } from '@/lib/project-intake/types'

export const POST = internalApiRoute(
  'project-intake',
  async ({ request }): Promise<InternalIntakeResponse> => {
    const context = requireVerifiedContext(request)
    const body = await parseJsonBody(request, internalIntakeRequestSchema)
    const projectId = context.projectId
    if (!projectId) {
      throw new UnprocessableError('This reading is not in a project.', { reason: 'no-project' })
    }
    const session = await requirePinnedSession(context)
    return withTenant({ organizationId: context.organizationId }, async (): Promise<InternalIntakeResponse> => {
      switch (body.op) {
        case 'needs':
          return intakeNeeds(session, projectId, body.jobId)
        case 'record':
          return recordIntakeValues(session, projectId, body.jobId, body.values)
        case 'withdraw':
          return withdrawIntakeValues(session, projectId, body.jobId, body.keys)
        case 'progress':
          return reportIntakeProgress(session, projectId, body.jobId, body.filesOpened)
        case 'finish':
          return finishIntakeReading(session, projectId, body.jobId, {
            summary: body.summary,
            documentsRead: body.documentsRead,
            traceId: body.traceId,
          })
      }
    })
  },
  { tenancy: { fromPayload: 'the signed request-context envelope' } }
)
