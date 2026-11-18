import 'server-only'
import { CITATION_BASELINE_KIND, CITATION_EVENT_KINDS, CITATION_PRECISION_KIND, type CitationEvent, type CitationEventAgent, type CitationEventKind, type CitationEventSeverity, type NewCitationEvent } from '@/lib/db/schema/citation-events'
import { getOrganizationDisplayNames } from '@/lib/organizations/display-names'
import { getKnowledgeBaseStatus } from '@/lib/knowledge/service'
import { getNormRegistry } from '@/lib/norms/service'
import { rangeDays, scopeBounds, type QualityScope } from '@/lib/quality/scope'
import {
  buildMissingSourceCandidates,
  type MissingSourceCandidate,
  type PlatformInventory,
} from './missing-sources'
import * as repository from './repository'
import { buildFindings, findOrganizationOutlier, isAddable } from './citation-findings'
import { EXPORT_GLOSSARY } from './citation-export-glossary'
import { toExportTurn } from './citation-export-turns'
import type {
  CitationDailyPoint,
  CitationDefectSample,
  CitationExportBundle,
  CitationHealthSnapshot,
  CitationKindTotal,
  CitationOrganizationTotal,
  CitationReasonTotal,
} from './citation-types'

export type {
  CitationDailyPoint,
  CitationDefectSample,
  CitationExportBundle,
  CitationExportTurn,
  CitationFinding,
  CitationFindingId,
  CitationHealthSnapshot,
  CitationKindTotal,
  CitationOrganizationTotal,
  CitationReasonTotal,
} from './citation-types'
export { buildFindings, findOrganizationOutlier } from './citation-findings'

export async function recordCitationEvents(events: NewCitationEvent[]): Promise<number> {
  return repository.insertCitationEvents(events)
}

export const CITATION_DEFECT_KINDS = CITATION_EVENT_KINDS.filter(
  (kind) => kind !== CITATION_BASELINE_KIND && kind !== CITATION_PRECISION_KIND
) as readonly Exclude<CitationEventKind, 'turn_verified' | 'retrieval_precision'>[]

export function citationScopeFilter(scope: QualityScope): repository.CitationScopeFilter {
  return { ...scopeBounds(scope), organizationIds: scope.organizationIds, projectIds: scope.projectIds }
}

const MISSING_SOURCES_SHOWN = 25
const ORGANIZATIONS_SHOWN = 50

function toSample(event: CitationEvent): CitationDefectSample {
  return {
    id: event.id,
    createdAt: event.createdAt.toISOString(),
    kind: event.kind as CitationEventKind,
    severity: event.severity as CitationEventSeverity,
    agent: event.agent as CitationEventAgent,
    count: event.count,
    reasons: (event.reasons as Record<string, number> | null) ?? null,
    organizationId: event.organizationId,
    conversationId: event.conversationId,
    turnId: event.turnId,
  }
}

export async function getCitationExport(scope: QualityScope): Promise<CitationExportBundle> {
  const filter = citationScopeFilter(scope)

  const [rows, snapshot] = await Promise.all([
    repository.listEventsForExport(filter),
    getCitationHealth(scope),
  ])

  const capped = rows.length > repository.EXPORT_ROW_CAP
  const events = capped ? rows.slice(0, repository.EXPORT_ROW_CAP) : rows

  const byTurn = new Map<string, CitationEvent[]>()
  for (const event of events) {
    const list = byTurn.get(event.turnId)
    if (list) list.push(event)
    else byTurn.set(event.turnId, [event])
  }

  const names = await getOrganizationDisplayNames(events.map((event) => event.organizationId))
  const turns = [...byTurn].flatMap(
    ([turnId, turnEvents]) => toExportTurn(turnId, turnEvents, names) ?? []
  )

  return {
    schema: 'grid.citation-health.export/v1',
    generatedAt: new Date().toISOString(),
    scope,
    windowDays: snapshot.windowDays,
    windowStart: filter.start.toISOString(),
    windowEnd: filter.endExclusive.toISOString(),
    truncated: capped,
    glossary: EXPORT_GLOSSARY,
    summary: { ...snapshot.totals, findings: snapshot.findings },
    turns,
  }
}

async function platformInventory(): Promise<PlatformInventory> {
  const [corpus, norms] = await Promise.all([
    getKnowledgeBaseStatus().catch(() => null),
    getNormRegistry().catch(() => null),
  ])
  return {
    corpusFileNames: corpus
      ? corpus.files.map((file) => file.fileName).filter((name): name is string => Boolean(name))
      : null,
    catalogedDocumentNumbers: norms
      ? (norms.registry?.entries ?? [])
          .map((entry) => entry.document_number)
          .filter((value): value is string => Boolean(value))
      : null,
  }
}

function buildDailyTrend(
  kindRows: repository.DailyKindRow[],
  turnRows: repository.DailyTurnRow[],
  start: Date,
  days: number
): CitationDailyPoint[] {
  const kindsByDay = new Map<string, repository.DailyKindRow[]>()
  for (const row of kindRows) {
    if (row.kind === CITATION_BASELINE_KIND || row.kind === CITATION_PRECISION_KIND) continue
    const list = kindsByDay.get(row.day)
    if (list) list.push(row)
    else kindsByDay.set(row.day, [row])
  }
  const turnsByDay = new Map(turnRows.map((row) => [row.day, row]))

  const series: CitationDailyPoint[] = []
  const cursor = new Date(start)
  for (let index = 0; index < days; index += 1) {
    const day = cursor.toISOString().slice(0, 10)
    const byKind: Record<string, number> = {}
    for (const row of kindsByDay.get(day) ?? []) byKind[row.kind] = row.turns
    series.push({
      day,
      turns: turnsByDay.get(day)?.turns ?? 0,
      defectTurns: turnsByDay.get(day)?.defectTurns ?? 0,
      byKind,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return series
}

function toReasonTotals(
  reasonRows: repository.ReasonTotalRow[],
  itemsByKind: Map<CitationEventKind, number>
): CitationReasonTotal[] {
  const occurrencesByKind = new Map<CitationEventKind, number>()
  for (const row of reasonRows) {
    occurrencesByKind.set(row.kind, (occurrencesByKind.get(row.kind) ?? 0) + row.occurrences)
  }
  return reasonRows.map((row) => {
    const denominator = itemsByKind.get(row.kind) || occurrencesByKind.get(row.kind) || 0
    return { ...row, share: denominator > 0 ? Math.min(1, row.occurrences / denominator) : 0 }
  })
}

function toOrganizationTotals(
  rows: repository.OrganizationTotalRow[]
): CitationOrganizationTotal[] {
  return (
    rows
      .map((row) => ({
        organizationId: row.organizationId,
        name: null as string | null,
        turns: row.turns,
        defectTurns: row.defectTurns,
        errorTurns: row.errorTurns,
        defectRate: row.turns > 0 ? row.defectTurns / row.turns : 0,
      }))
      .sort((a, b) => b.defectTurns - a.defectTurns || b.defectRate - a.defectRate)
  )
}

async function countMissingSourceTurns(
  filter: repository.CitationScopeFilter,
  candidates: MissingSourceCandidate[]
): Promise<{ held: number; addable: number }> {
  const targets = (keep: (candidate: MissingSourceCandidate) => boolean): string[] =>
    candidates.filter(keep).map((candidate) => candidate.target)
  const [held, addable] = await Promise.all([
    repository.countTurnsForTargets(
      filter,
      targets((candidate) => candidate.present === true)
    ),
    repository.countTurnsForTargets(
      filter,
      targets((candidate) => candidate.present === false && isAddable(candidate))
    ),
  ])
  return { held, addable }
}

export async function getCitationHealth(scope: QualityScope): Promise<CitationHealthSnapshot> {
  const filter = citationScopeFilter(scope)
  const windowDays = rangeDays(scope.from, scope.to)

  const [
    kindRows,
    turns,
    defectTurns,
    dailyKindRows,
    dailyTurnRows,
    reasonRows,
    sourceMix,
    tools,
    orgs,
    recentRows,
    failedTargets,
    inventory,
  ] = await Promise.all([
    repository.aggregateByKind(filter),
    repository.countObservedTurns(filter),
    repository.countDefectiveTurns(filter),
    repository.aggregateDailyByKind(filter),
    repository.aggregateDailyTurns(filter),
    repository.aggregateReasons(filter),
    repository.aggregateDefectiveSourceMix(filter),
    repository.aggregateUnavailableTools(filter),
    repository.aggregateByOrganization(filter),
    repository.listRecentDefects(filter),
    repository.aggregateFailedTargets(filter),
    platformInventory(),
  ])

  const missingSources = buildMissingSourceCandidates(failedTargets.rows, inventory)
  const organizations = toOrganizationTotals(orgs.rows)
  const shownOrganizations = organizations.slice(0, ORGANIZATIONS_SHOWN)
  const outlier =
    turns > 0 ? findOrganizationOutlier(organizations, defectTurns / turns) : undefined
  const [missingSourceTurns, names] = await Promise.all([
    countMissingSourceTurns(filter, missingSources),
    getOrganizationDisplayNames(
      [...shownOrganizations, ...(outlier ? [outlier] : [])].map((org) => org.organizationId)
    ),
  ])
  for (const org of organizations)
    org.name = org.organizationId ? (names.get(org.organizationId) ?? null) : null

  const byKindMap = new Map(kindRows.map((row) => [row.kind, row]))
  const cleanTurns = Math.max(0, turns - defectTurns)
  const byKind: CitationKindTotal[] = CITATION_DEFECT_KINDS.map((kind) => {
    const row = byKindMap.get(kind)
    return {
      kind,
      turns: row?.turns ?? 0,
      items: row?.items ?? 0,
      share: turns > 0 ? (row?.turns ?? 0) / turns : 0,
    }
  })
    .filter((entry) => entry.turns > 0)
    .sort((a, b) => b.turns - a.turns)
  const reasons = toReasonTotals(reasonRows, new Map(kindRows.map((row) => [row.kind, row.items])))

  return {
    scope,
    windowDays,
    totals: {
      turns,
      defectTurns,
      cleanTurns,
      cleanRate: turns > 0 ? cleanTurns / turns : 1,
      citationsRemoved: byKindMap.get('citations_removed')?.items ?? 0,
      unverifiedQuotes: byKindMap.get('quote_unverified')?.items ?? 0,
      ungroundedAnswers: byKindMap.get('answer_ungrounded')?.turns ?? 0,
      emptyRegistries: byKindMap.get('registry_empty')?.turns ?? 0,
    },
    findings: buildFindings({
      turns,
      defectTurns,
      byKind,
      reasons,
      organizations,
      unavailableTools: tools.rows,
      unavailableToolCount: tools.total,
      missingSources,
      missingSourceTurns,
    }),
    byKind,
    dailyTrend: buildDailyTrend(dailyKindRows, dailyTurnRows, filter.start, windowDays),
    reasons,
    sourceMix,
    unavailableTools: tools.rows,
    missingSources: missingSources.slice(0, MISSING_SOURCES_SHOWN),
    missingSourcesTotal: failedTargets.total,
    inventoryKnown:
      inventory.corpusFileNames !== null && inventory.catalogedDocumentNumbers !== null,
    organizations: shownOrganizations,
    organizationsTotal: orgs.total,
    recent: recentRows.map(toSample),
  }
}
