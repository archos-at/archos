import 'server-only'

import { type AuthInfo, originValidationResponse } from '@modelcontextprotocol/server'
import { errorResponse } from '@/lib/api/handler'
import { tenantSlotRoute } from '@/lib/db/tenant-context'
import { MCP_REQUEST_LIMIT, enforceLimit, memberSubject } from '@/lib/limits'
import { principalOrRefusal } from './door-principal'
import { allowedOriginHostnames } from './mcp-config'
import { createAgentDoorHandler, resolveMode } from './mcp-server'
import { type AgentDoor, doorOfPrincipal } from './policy'

async function isBatch(request: Request): Promise<boolean> {
  try {
    return (await request.clone().text()).trimStart().startsWith('[')
  } catch {
    return false
  }
}

const batchRefused = (): Response =>
  Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message: 'Batch requests are not supported: send one JSON-RPC message per POST.',
      },
    },
    { status: 400 },
  )

export function mcpDoorPost(door: AgentDoor, label: string) {
  const handler = createAgentDoorHandler((error) => console.error(`[${label}]`, error.message))
  return tenantSlotRoute(async (request: Request): Promise<Response> => {
    const rejected = originValidationResponse(request, allowedOriginHostnames())
    if (rejected) return rejected

    if (await isBatch(request)) return batchRefused()

    const principal = await principalOrRefusal(request, label)
    if (principal instanceof Response) return principal
    if (doorOfPrincipal(principal) !== door) {
      return Response.json({ error: 'This credential is for another door.', code: 'FORBIDDEN' }, { status: 403 })
    }

    try {
      await enforceLimit(MCP_REQUEST_LIMIT, memberSubject(principal.session))
    } catch (error) {
      return errorResponse(error, request)
    }

    const authInfo: AuthInfo = {
      token: '',
      clientId: principal.clientId ?? 'piloti',
      scopes: principal.scopes,
      extra: { principal, mode: resolveMode(request) },
    }
    return handler.fetch(request, { authInfo })
  })
}

export const mcpDoorMethodNotAllowed = (): Response =>
  new Response('Method not allowed.', { status: 405, headers: { Allow: 'POST' } })
