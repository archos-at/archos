import { LegacyJsonRpcTransportHandler } from '@a2a-js/sdk/compat/v0_3/server'
import { JsonRpcTransportHandler, ServerCallContext } from '@a2a-js/sdk/server'
import { originValidationResponse } from '@modelcontextprotocol/server'
import { buildAgentCard } from '@/lib/a2a/agent-card'
import {
  jsonRpcErrorResponse,
  jsonRpcResponse,
  PARSE_ERROR,
  AGENT_DOOR_REFUSAL,
  protocolVersionOf,
  VERSION_NOT_SUPPORTED,
} from '@/lib/a2a/http'
import { AgentA2ARequestHandler } from '@/lib/a2a/request-handler'
import { principalOrRefusal } from '@/lib/agent-api/door-principal'
import { allowedOriginHostnames } from '@/lib/agent-api/mcp-config'
import { errorResponse } from '@/lib/api/handler'
import { tenantSlotRoute } from '@/lib/db/tenant-context'
import { MCP_REQUEST_LIMIT, enforceLimit, memberSubject } from '@/lib/limits'
import { PRODUCT_NAME } from '@/lib/brand'

export const dynamic = 'force-dynamic'

export const POST = tenantSlotRoute(async (request: Request): Promise<Response> => {
  const rejected = originValidationResponse(request, allowedOriginHostnames())
  if (rejected) return rejected

  const card = buildAgentCard()
  if (!card) {
    return Response.json(
      { error: 'The agent door is not configured on this deployment (WORKOS_AUTHKIT_DOMAIN)' },
      { status: 503 },
    )
  }

  const principal = await principalOrRefusal(request, 'a2a')
  if (principal instanceof Response) return principal
  if (principal.actor !== 'external_agent') {
    return Response.json({ error: AGENT_DOOR_REFUSAL, code: 'FORBIDDEN' }, { status: 403 })
  }

  try {
    await enforceLimit(MCP_REQUEST_LIMIT, memberSubject(principal.session))
  } catch (error) {
    return errorResponse(error, request)
  }

  const version = protocolVersionOf(request)
  if (!version) return jsonRpcErrorResponse(VERSION_NOT_SUPPORTED, PRODUCT_NAME + ' speaks A2A 1.0 and 0.3.')

  let body: string
  try {
    body = await request.text()
  } catch {
    return jsonRpcErrorResponse(PARSE_ERROR, 'The request body could not be read.')
  }
  if (!isJson(body)) return jsonRpcErrorResponse(PARSE_ERROR, 'The request body is not JSON.')

  const handler = new AgentA2ARequestHandler(principal, card)
  const context = new ServerCallContext({ requestedVersion: version })
  const transport =
    version === '1.0' ? new JsonRpcTransportHandler(handler) : new LegacyJsonRpcTransportHandler(handler)
  return jsonRpcResponse(await transport.handle(body, context))
})

function isJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

const methodNotAllowed = (): Response =>
  new Response('Method not allowed.', { status: 405, headers: { Allow: 'POST' } })

export const GET = methodNotAllowed
export const DELETE = methodNotAllowed
