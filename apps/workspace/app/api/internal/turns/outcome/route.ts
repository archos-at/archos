import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { recordTurnOutcome } from '@/lib/turns/outcome'
import { turnOutcomeRequestSchema } from '@/lib/turns/outcome-types'

export const POST = internalApiRoute(
  'Turn Outcome',
  async ({ request }) => recordTurnOutcome(await parseJsonBody(request, turnOutcomeRequestSchema)),
  { tenancy: { fromPayload: 'the wake named by body.turnId, whose organization the service reads from the wake' } }
)
