import type { SourceSignal } from '@/lib/source-kinds'
import type { StoredThinkingStep, TraceLaneCard } from '@/lib/conversations/message-provenance'

const SIGNAL_ORDER: Record<SourceSignal, number> = {
  law: 0,
  project: 1,
  model: 2,
  office: 3,
  auto: 4,
}

export const deriveTraceLanes = (
  steps: readonly Pick<StoredThinkingStep, 'kind' | 'traceLanes'>[]
): TraceLaneCard[] => {
  const buckets = new Map<string, TraceLaneCard>()
  for (const step of steps) {
    if (step.kind !== 'sources') continue
    for (const card of step.traceLanes ?? []) {
      const existing = buckets.get(card.key)
      if (!existing) {
        buckets.set(card.key, { ...card, sources: [...card.sources] })
        continue
      }
      existing.hitCount += card.hitCount
      existing.sources.push(...card.sources)
    }
  }
  return Array.from(buckets.values()).sort(
    (a, b) =>
      SIGNAL_ORDER[a.signal] - SIGNAL_ORDER[b.signal] || a.label.localeCompare(b.label, 'de')
  )
}
