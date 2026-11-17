import { z } from 'zod'
import { COST_SOURCES, USAGE_ACTIVITIES } from '@/lib/db/schema/budgets'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { recordUsageEvents } from '@/lib/budgets/service'
import { announceBudgetThresholds } from '@/lib/budgets/budget-events'

const usageEventSchema = z.object({
  model: z.string().max(200).nullable().optional(),
  requestedModel: z.string().max(200).nullable().optional(),
  generationId: z.string().max(120).nullable().optional(),
  promptTokens: z.number().int().min(0).default(0),
  completionTokens: z.number().int().min(0).default(0),
  totalTokens: z.number().int().min(0).default(0),
  cachedTokens: z.number().int().min(0).default(0),
  cacheWriteTokens: z.number().int().min(0).default(0),
  reasoningTokens: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).finite().default(0),
  costSource: z.enum(COST_SOURCES).default('missing'),
  isByok: z.boolean().nullable().optional(),
  role: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .nullable()
    .optional(),
  audioSeconds: z.number().min(0).max(3600).finite().nullable().optional(),
})

const usageBatchSchema = z.object({
  organizationId: z.string().min(1).max(120).nullable(),
  userId: z.string().max(120).nullable().optional(),
  projectId: z.string().max(120).nullable().optional(),
  conversationId: z.string().max(255).nullable().optional(),
  jobId: z.string().max(255).nullable().optional(),
  messageId: z.string().max(128).nullable().optional(),
  activity: z.enum(USAGE_ACTIVITIES).nullable().optional(),
  events: z.array(usageEventSchema).min(1).max(100),
})

export const POST = internalApiRoute(
  'Internal Usage',
  async ({ request }) => {
    const batch = await parseJsonBody(request, usageBatchSchema)

    if (!batch.organizationId) {
      return { recorded: 0, skipped: batch.events.length }
    }

    const recorded = await withTenant({ organizationId: batch.organizationId }, () =>
      recordUsageEvents(
      batch.events.map((event) => ({
        organizationId: batch.organizationId as string,
        userId: batch.userId ?? null,
        projectId: batch.projectId ?? null,
        conversationId: batch.conversationId ?? null,
        jobId: batch.jobId ?? null,
        messageId: batch.messageId ?? null,
        activity: batch.activity ?? null,
        agentGroup: event.role ?? null,
        requestedModel: event.requestedModel ?? null,
        model: event.model ?? null,
        generationId: event.generationId ?? null,
        promptTokens: event.promptTokens,
        completionTokens: event.completionTokens,
        totalTokens: event.totalTokens,
        cachedTokens: event.cachedTokens,
        cacheWriteTokens: event.cacheWriteTokens,
        reasoningTokens: event.reasoningTokens,
        costUsd: event.costUsd.toFixed(8),
        costSource: event.costSource,
        isByok: event.isByok ?? null,
        audioSeconds: event.audioSeconds == null ? null : event.audioSeconds.toFixed(2),
      }))
      )
    )
    void announceBudgetThresholds({
      organizationId: batch.organizationId,
      userId: batch.userId ?? null,
      projectId: batch.projectId ?? null,
    })
    return { recorded }
  },
  { status: 202, tenancy: { fromPayload: 'body.organizationId' } }
)
