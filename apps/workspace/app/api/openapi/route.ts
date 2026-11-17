import { configuredAppOrigin } from '@/lib/app-origin'
import { apiRoute } from '@/lib/api/handler'
import { AGENT_OPERATIONS } from '@/lib/agent-api/catalog'
import { buildOpenApiDocument, documentedOperations } from '@/lib/agent-api/openapi'
import { isPlatformStaff } from '@/lib/authz/platform'

export const GET = apiRoute(
  async ({ request, session }) =>
    buildOpenApiDocument(documentedOperations(AGENT_OPERATIONS, { platformStaff: await isPlatformStaff(session) }), {
      serverUrl: configuredAppOrigin() ?? new URL(request.url).origin,
    }),
  { authz: { sessionOnly: true, why: 'describes the shape of the API only, no tenant data' } },
)
