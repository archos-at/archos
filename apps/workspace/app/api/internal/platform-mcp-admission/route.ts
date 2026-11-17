import { ApiError, BadRequestError, ForbiddenError, UnauthorizedError } from '@/lib/api/errors'
import { internalApiRoute } from '@/lib/api/handler'
import { platformGatewayAdmission } from '@/lib/agent-api/platform-admission'

export const dynamic = 'force-dynamic'

const OPTIONS = {
  tenancy: { crossTenant: 'one person’s membership of the platform organization, read from WorkOS — no tenant rows' },
  tokenEnv: 'PLATFORM_MCP_ADMISSION_TOKEN',
} as const

async function admit({ request }: { request: Request }): Promise<{ admitted: true }> {
  const roles = new URL(request.url).searchParams.getAll('role').filter(Boolean)
  if (roles.length === 0) throw new BadRequestError('Name at least one admitted role (role=…).')
  const admission = await platformGatewayAdmission(request.headers.get('authorization'), roles)
  if (admission.admitted) return { admitted: true }
  if (admission.status === 401) throw new UnauthorizedError(admission.reason)
  if (admission.status === 403) throw new ForbiddenError(admission.reason)
  throw new ApiError(503, 'UNAVAILABLE', admission.reason)
}

export const GET = internalApiRoute('platform-mcp-admission', admit, OPTIONS)
export const POST = internalApiRoute('platform-mcp-admission', admit, OPTIONS)
export const DELETE = internalApiRoute('platform-mcp-admission', admit, OPTIONS)
