import { protectedResourceMetadataResponse } from '@/lib/agent-api/mcp-config'

export const dynamic = 'force-dynamic'

export const GET = (request: Request): Response => protectedResourceMetadataResponse('mcp', request)
