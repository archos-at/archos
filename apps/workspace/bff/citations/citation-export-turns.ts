import { CITATION_BASELINE_KIND, CITATION_PRECISION_KIND, type CitationEvent, type CitationEventAgent, type CitationEventKind, type CitationEventSeverity } from '@/lib/db/schema/citation-events'
import type { CitationExportTurn } from './citation-types'

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null)

function asPrecision(detail: Record<string, unknown> | null): CitationExportTurn['precision'] {
  if (!detail) return null
  return {
    retrievedCount: asNumber(detail.retrieved_count),
    citedCount: asNumber(detail.cited_count),
    uncitedCount: asNumber(detail.uncited_count),
    uncitedSources: asStringArray(detail.uncited_sources),
  }
}

function asFailedSources(value: unknown): { target: string; reason: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const { target, reason } = item as { target?: unknown; reason?: unknown }
    if (typeof target !== 'string') return []
    return [{ target, reason: typeof reason === 'string' ? reason : 'unverifiable' }]
  })
}

const detailOf = (event: CitationEvent | undefined): Record<string, unknown> | null =>
  (event?.detail as Record<string, unknown> | null | undefined) ?? null

export function toExportTurn(
  turnId: string,
  turnEvents: CitationEvent[],
  names: Map<string, string>
): CitationExportTurn | null {
  const problems = turnEvents.filter(
    (event) => event.kind !== CITATION_BASELINE_KIND && event.kind !== CITATION_PRECISION_KIND
  )
  if (problems.length === 0) return null

  const head = turnEvents.find((event) => event.kind === CITATION_BASELINE_KIND) ?? problems[0]

  const retrieved = new Set<string>()
  const cited = new Set<string>()
  for (const event of turnEvents) {
    for (const label of asStringArray(detailOf(event)?.retrieved_sources)) retrieved.add(label)
    for (const label of asStringArray(detailOf(event)?.cited_sources)) cited.add(label)
  }

  return {
    turnId,
    conversationId: head.conversationId,
    organizationId: head.organizationId,
    organization: head.organizationId ? (names.get(head.organizationId) ?? null) : null,
    agent: head.agent as CitationEventAgent,
    jobId: head.jobId,
    occurredAt: head.createdAt.toISOString(),
    sourceCount: asNumber(detailOf(head)?.source_count),
    citedCount: asNumber(detailOf(head)?.cited_count),
    retrievedSources: [...retrieved],
    citedSources: [...cited],
    precision: asPrecision(
      detailOf(turnEvents.find((event) => event.kind === CITATION_PRECISION_KIND))
    ),
    problems: problems.map((event) => ({
      kind: event.kind as CitationEventKind,
      severity: event.severity as CitationEventSeverity,
      count: event.count,
      reasons: (event.reasons as Record<string, number> | null) ?? null,
      failedSources: asFailedSources(detailOf(event)?.targets),
      unavailableTools: asStringArray(detailOf(event)?.unavailable_tools),
    })),
  }
}
