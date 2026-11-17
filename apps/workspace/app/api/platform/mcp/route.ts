import { mcpDoorMethodNotAllowed, mcpDoorPost } from '@/lib/agent-api/mcp-door-route'

export const dynamic = 'force-dynamic'

export const POST = mcpDoorPost('platform', 'platform-mcp')

export const GET = mcpDoorMethodNotAllowed
export const DELETE = mcpDoorMethodNotAllowed
