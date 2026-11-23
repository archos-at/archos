import 'server-only'
import type { NewLlmUsageEvent } from '@/lib/db/schema/budgets'
import { UNBILLED_USAGE_ACTIVITIES } from '@/lib/db/schema/budgets'
import { getEffectivePricingOrBootFloor, priceUsage } from '@/lib/pricing/service'
import * as repository from './repository'

export type UsageEventInput = Omit<NewLlmUsageEvent, 'priceUsd' | 'credits' | 'pricingVersionId'>

export async function recordUsageEvents(events: UsageEventInput[]): Promise<number> {
  if (events.length === 0) return 0
  const pricing = await getEffectivePricingOrBootFloor()
  return repository.insertUsageEventsWithRollups(
    events.map((event) => {
      const priced =
        event.activity && UNBILLED_USAGE_ACTIVITIES.has(event.activity)
          ? { priceUsd: 0, credits: 0 }
          : priceUsage(Number.parseFloat(String(event.costUsd ?? '0')) || 0, event.isByok ?? null, pricing)
      return {
        ...event,
        priceUsd: priced.priceUsd.toFixed(8),
        credits: priced.credits.toFixed(6),
        pricingVersionId: pricing.versionId,
      }
    }),
  )
}
