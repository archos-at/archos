/**
 * The platform MCP gateway's admission check for a token of another
 * organization (ADR-0154, amendment of 2026-11-05;
 * `bff/agent-api/platform-admission.ts`). agentgateway calls it as external
 * authorization with the caller's `Authorization` header and the method of the
 * MCP request it is deciding, and names the roles it admits as `role`
 * parameters, so the list stays in one place (`ADMITTED_ROLES` in the deploy).
 * 2xx admits; anything else refuses.
 *
 * Guarded by its OWN secret, `PLATFORM_MCP_ADMISSION_TOKEN`, in the
 * `x-internal-token` header: only the gateway holds it, and a leak opens
 * this one yes-or-no about a person's own membership and nothing else.
 */

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

// The method is the MCP request's own: a streamable-HTTP session uses all three.
export const GET = internalApiRoute('platform-mcp-admission', admit, OPTIONS)
export const POST = internalApiRoute('platform-mcp-admission', admit, OPTIONS)
export const DELETE = internalApiRoute('platform-mcp-admission', admit, OPTIONS)
