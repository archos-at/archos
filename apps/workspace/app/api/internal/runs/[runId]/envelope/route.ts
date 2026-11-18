import { NextResponse } from 'next/server'
import { BadRequestError } from '@/lib/api/errors'
import { internalApiRoute } from '@/lib/api/handler'
import { RUN_ENVELOPE_REFUSAL_STATUS, renewRunEnvelope } from '@/lib/runs/run-envelope'
import { runEnvelopeRequestSchema, type RunEnvelopeError } from '@/lib/runs/run-envelope-types'

type Params = { runId: string }

const NO_STORE = { 'cache-control': 'no-store' }

async function requireEmptyBody(request: Request): Promise<void> {
  const text = await request.text()
  if (!text.trim()) return
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BadRequestError('Invalid JSON body')
  }
  if (!runEnvelopeRequestSchema.safeParse(raw).success) {
    throw new BadRequestError('The request carries nothing: the run id is the path')
  }
}

export const POST = internalApiRoute<Params>(
  'Run Envelope',
  async ({ request, params }) => {
    await requireEmptyBody(request)
    const outcome = await renewRunEnvelope(params.runId)
    if (outcome.ok) return NextResponse.json(outcome.envelope, { headers: NO_STORE })
    const body: RunEnvelopeError = { error: outcome.refusal, message: outcome.message }
    return NextResponse.json(body, { status: RUN_ENVELOPE_REFUSAL_STATUS[outcome.refusal], headers: NO_STORE })
  },
  {
    tenancy: {
      fromPayload:
        'the task_runs row named by params.runId — resolved under platform access, then entered as that run’s organization and requester. The body names nothing',
    },
  },
)
