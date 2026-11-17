import { agentCardResponse } from '@/lib/a2a/agent-card'

export const dynamic = 'force-dynamic'

export const GET = (): Response => agentCardResponse()
