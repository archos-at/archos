import { captureServer } from '@/lib/analytics/posthog-server'
import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { requireCollaborationEnabled } from '@/lib/authz/feature-flags'
import { changeResourceRole, escalateToOwner, grantResourceAccess } from '@/lib/sharing/service'
import { requireShareableType } from '@/lib/sharing/registry'
import { confirmedByThePerson, grantPostSchema, roleChangeSchema } from '@/lib/sharing/sharing-wire'
import { currentActingSession } from '@/lib/agent-api/acting-session'

type Params = { resourceType: string; resourceId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const gated = requireCollaborationEnabled(session)
    if (gated) return gated
    const resourceType = requireShareableType(params.resourceType)
    const body = await parseJsonBody(request, grantPostSchema)

    if ('escalate' in body) {
      return escalateToOwner(session, resourceType, params.resourceId, request)
    }
    const confirmPersonalContent = confirmedByThePerson(body.confirmPersonalContent, currentActingSession() !== undefined)
    const sharing = await grantResourceAccess(session, resourceType, params.resourceId, { ...body, confirmPersonalContent }, request)
    captureServer({
      event: 'resource_shared',
      distinctId: session.userId,
      organizationId: session.organizationId,
      properties: { resource_type: resourceType, audience_kind: 'person', role: body.role },
    })
    return sharing
  },
  { status: 201, authz: { enforcedBy: 'grantResourceAccess (requireResourceAccess owner)' } }
)

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const gated = requireCollaborationEnabled(session)
    if (gated) return gated
    const body = await parseJsonBody(request, roleChangeSchema)
    return changeResourceRole(
      session,
      requireShareableType(params.resourceType),
      params.resourceId,
      body,
      request
    )
  },
  { authz: { enforcedBy: 'changeResourceRole (requireResourceAccess owner)' } }
)
