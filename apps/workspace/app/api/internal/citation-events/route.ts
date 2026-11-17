import { z } from 'zod'
import { CITATION_EVENT_AGENTS, CITATION_EVENT_KINDS, CITATION_EVENT_SEVERITIES } from '@/lib/db/schema/citation-events'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withOptionalTenant } from '@/lib/db/tenant-context'
import { recordCitationEvents } from '@/lib/citations/service'

const eventSchema = z.object({
  kind: z.enum(CITATION_EVENT_KINDS),
  severity: z.enum(CITATION_EVENT_SEVERITIES),
  count: z.number().int().min(1).max(10_000).default(1),
  reasons: z.record(z.string().max(120), z.number().int().min(0).max(10_000)).nullable().optional(),
  detail: z.record(z.string().max(120), z.unknown()).nullable().optional(),
})

const batchSchema = z.object({
  organizationId: z.string().min(1).max(120).nullable().optional(),
  conversationId: z.string().max(255).nullable().optional(),
  turnId: z.string().min(1).max(64),
  jobId: z.string().max(255).nullable().optional(),
  agent: z.enum(CITATION_EVENT_AGENTS),
  events: z.array(eventSchema).min(1).max(50),
})

export const POST = internalApiRoute(
  'Internal Citation Events',
  async ({ request }) => {
    const batch = await parseJsonBody(request, batchSchema)

    const recorded = await withOptionalTenant(
      batch.organizationId,
      'citation telemetry from a turn with no organization selected belongs to no tenant',
      () => recordCitationEvents(
      batch.events.map((event) => ({
        organizationId: batch.organizationId ?? null,
        conversationId: batch.conversationId ?? null,
        turnId: batch.turnId,
        jobId: batch.jobId ?? null,
        agent: batch.agent,
        kind: event.kind,
        severity: event.severity,
        count: event.count,
        reasons: event.reasons ?? null,
        detail: (event.detail as Record<string, unknown> | null) ?? null,
      }))
      )
    )
    return { recorded }
  },
  { status: 202, tenancy: { fromPayload: 'body.organizationId (nullable)' } }
)
