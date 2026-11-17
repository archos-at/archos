import { parseQuery } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { platformKnowledgeSchemas } from '@/lib/base-knowledge/platform/onboarding'
import { schemaQuerySchema } from '@/lib/base-knowledge/platform/wire'

export const GET = platformApiRoute(
  async ({ session, request }) => asProblem(async () => platformKnowledgeSchemas(session, parseQuery(request, schemaQuerySchema).type)),
  { permission: PLATFORM_PERMISSIONS.settingsView },
)
