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

export async function recordCitationEvents(events: NewCitationEvent[]): Promise<number> {
  return repository.insertCitationEvents(events)
}

export const CITATION_DEFECT_KINDS = CITATION_EVENT_KINDS.filter(
  (kind) => kind !== CITATION_BASELINE_KIND && kind !== CITATION_PRECISION_KIND
) as readonly Exclude<CitationEventKind, 'turn_verified' | 'retrieval_precision'>[]

export function citationScopeFilter(scope: QualityScope): repository.CitationScopeFilter {
  return { ...scopeBounds(scope), organizationIds: scope.organizationIds, projectIds: scope.projectIds }
}

export interface CitationKindTotal {
  kind: CitationEventKind
  turns: number
  items: number
  share: number
}

export interface CitationDailyPoint {
  day: string
  turns: number
  defectTurns: number
  byKind: Record<string, number>
}

export interface CitationReasonTotal {
  kind: CitationEventKind
  reason: string
  occurrences: number
  share: number
}

export interface CitationOrganizationTotal {
  organizationId: string | null
  name: string | null
  turns: number
  defectTurns: number
  errorTurns: number
  defectRate: number
}

export interface CitationDefectSample {
  id: string
  createdAt: string
  kind: CitationEventKind
  severity: CitationEventSeverity
  agent: CitationEventAgent
  count: number
  reasons: Record<string, number> | null
  organizationId: string | null
  conversationId: string | null
  turnId: string
}

export interface CitationFinding {
  id: CitationFindingId
  severity: 'error' | 'warn' | 'info'
  subject: { type: 'organization' | 'tool'; label: string } | null
  metrics: Record<string, number>
}

export type CitationFindingId =
  | 'retrieval_unavailable'
  | 'answers_ungrounded'
  | 'citations_invented'
  | 'quotes_fabricated'
  | 'citation_format_unparsed'
  | 'duplicates_only'
  | 'organization_outlier'
  | 'sources_missing'
  | 'sources_unretrievable'
  | 'all_clear'

const THRESHOLDS = {
  ungroundedShare: 0.01,
  quotesShare: 0.02,
  fallbackShare: 0.05,
  removedShare: 0.05,
  inventedReasonShare: 0.4,
  duplicateReasonShare: 0.5,
  outlierMinTurns: 20,
  outlierRateMultiple: 2,
} as const

const SEVERITY_RANK: Record<CitationFinding['severity'], number> = { error: 0, warn: 1, info: 2 }

export function findOrganizationOutlier<
  T extends Pick<CitationOrganizationTotal, 'organizationId' | 'turns' | 'defectRate'>,
>(organizations: T[], platformRate: number): T | undefined {
  if (platformRate <= 0) return undefined
  return organizations.find(
    (org) =>
      org.organizationId !== null &&
      org.turns >= THRESHOLDS.outlierMinTurns &&
      org.defectRate >= platformRate * THRESHOLDS.outlierRateMultiple
  )
}

export function buildFindings(input: {
  turns: number
  defectTurns: number
  byKind: CitationKindTotal[]
  reasons: CitationReasonTotal[]
  organizations: CitationOrganizationTotal[]
  unavailableTools: repository.UnavailableToolRow[]
  unavailableToolCount?: number
  missingSources?: MissingSourceCandidate[]
  missingSourceTurns?: { held: number; addable: number }
}): CitationFinding[] {
  const { turns, defectTurns, byKind, reasons, organizations, unavailableTools } = input
  const missingSources = input.missingSources ?? []
  if (turns === 0) return []

  const kindTurns = (kind: CitationEventKind): number =>
    byKind.find((row) => row.kind === kind)?.turns ?? 0
  const kindItems = (kind: CitationEventKind): number =>
    byKind.find((row) => row.kind === kind)?.items ?? 0
  const reasonShare = (...keys: string[]): number =>
    reasons
      .filter((row) => row.kind === 'citations_removed' && keys.includes(row.reason))
      .reduce((sum, row) => sum + row.share, 0)

  const findings: CitationFinding[] = []

  const unheld = missingSources.filter((candidate) => candidate.present === false)
  const addable = unheld.filter((candidate) => isAddable(candidate))
  const heldButUnretrieved = missingSources.filter((candidate) => candidate.present === true)
  const boundedTurns = (candidates: MissingSourceCandidate[], exact: number | undefined): number =>
    exact ??
    Math.min(
      defectTurns,
      candidates.reduce((sum, candidate) => sum + candidate.turns, 0)
    )

  const emptyTurns = kindTurns('registry_empty')
  if (emptyTurns > 0) {
    findings.push({
      id: 'retrieval_unavailable',
      severity: 'error',
      subject: unavailableTools[0] ? { type: 'tool', label: unavailableTools[0].tool } : null,
      metrics: { turns: emptyTurns, tools: input.unavailableToolCount ?? unavailableTools.length },
    })
  }

  const ungroundedTurns = kindTurns('answer_ungrounded')
  if (ungroundedTurns / turns >= THRESHOLDS.ungroundedShare) {
    findings.push({
      id: 'answers_ungrounded',
      severity: 'error',
      subject: null,
      metrics: { turns: ungroundedTurns, share: ungroundedTurns / turns },
    })
  }

  const removedTurns = kindTurns('citations_removed')
  const inventedShare = reasonShare('url_not_in_registry', 'citation_key_not_in_registry')
  const inventionUnexplained =
    missingSources.length === 0 || missingSources.some((candidate) => candidate.present !== true)
  if (
    removedTurns / turns >= THRESHOLDS.removedShare &&
    inventedShare >= THRESHOLDS.inventedReasonShare &&
    inventionUnexplained
  ) {
    findings.push({
      id: 'citations_invented',
      severity: 'warn',
      subject: null,
      metrics: {
        turns: removedTurns,
        citations: kindItems('citations_removed'),
        share: inventedShare,
        unheld: unheld.length,
      },
    })
  }

  const quoteTurns = kindTurns('quote_unverified')
  if (quoteTurns / turns >= THRESHOLDS.quotesShare) {
    findings.push({
      id: 'quotes_fabricated',
      severity: 'warn',
      subject: null,
      metrics: {
        turns: quoteTurns,
        quotes: kindItems('quote_unverified'),
        share: quoteTurns / turns,
      },
    })
  }

  const fallbackTurns = kindTurns('citation_fallback')
  if (fallbackTurns / turns >= THRESHOLDS.fallbackShare) {
    findings.push({
      id: 'citation_format_unparsed',
      severity: 'warn',
      subject: null,
      metrics: { turns: fallbackTurns, share: fallbackTurns / turns },
    })
  }

  const platformRate = defectTurns / turns
  const outlier = findOrganizationOutlier(organizations, platformRate)
  if (outlier) {
    findings.push({
      id: 'organization_outlier',
      severity: 'warn',
      subject: { type: 'organization', label: outlier.name ?? outlier.organizationId! },
      metrics: {
        share: outlier.defectRate,
        platformShare: platformRate,
        turns: outlier.defectTurns,
      },
    })
  }

  if (addable.length > 0) {
    findings.push({
      id: 'sources_missing',
      severity: 'warn',
      subject: { type: 'tool', label: addable[0].fileName ?? addable[0].target },
      metrics: {
        sources: addable.length,
        turns: boundedTurns(addable, input.missingSourceTurns?.addable),
        automatic: addable.filter((candidate) => candidate.action === 'add_to_norm_catalog').length,
      },
    })
  }

  if (heldButUnretrieved.length > 0) {
    findings.push({
      id: 'sources_unretrievable',
      severity: 'warn',
      subject: {
        type: 'tool',
        label: heldButUnretrieved[0].fileName ?? heldButUnretrieved[0].target,
      },
      metrics: {
        sources: heldButUnretrieved.length,
        turns: boundedTurns(heldButUnretrieved, input.missingSourceTurns?.held),
      },
    })
  }

  if (defectTurns > 0 && reasonShare('duplicate') >= THRESHOLDS.duplicateReasonShare) {
    findings.push({
      id: 'duplicates_only',
      severity: 'info',
      subject: null,
      metrics: { share: reasonShare('duplicate') },
    })
  }

  if (findings.length === 0) {
    return [
      {
        id: 'all_clear',
        severity: 'info',
        subject: null,
        metrics: { turns, share: 1 - platformRate },
      },
    ]
  }

  return findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (b.metrics.turns ?? 0) - (a.metrics.turns ?? 0)
  )
}

const isAddable = (candidate: MissingSourceCandidate): boolean =>
  candidate.action === 'add_to_norm_catalog' || candidate.action === 'upload_to_base_knowledge'

const MISSING_SOURCES_SHOWN = 25
const ORGANIZATIONS_SHOWN = 50

export interface CitationHealthSnapshot {
  scope: QualityScope
  windowDays: number
  totals: {
    turns: number
    defectTurns: number
    cleanTurns: number
    cleanRate: number
    citationsRemoved: number
    unverifiedQuotes: number
    ungroundedAnswers: number
    emptyRegistries: number
  }
  findings: CitationFinding[]
  byKind: CitationKindTotal[]
  dailyTrend: CitationDailyPoint[]
  reasons: CitationReasonTotal[]
  sourceMix: repository.SourceMixRow[]
  unavailableTools: repository.UnavailableToolRow[]
  missingSources: MissingSourceCandidate[]
  missingSourcesTotal: number
  inventoryKnown: boolean
  organizations: CitationOrganizationTotal[]
  organizationsTotal: number
  recent: CitationDefectSample[]
}

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

export interface CitationExportTurn {
  turnId: string
  conversationId: string | null
  organizationId: string | null
  organization: string | null
  agent: CitationEventAgent
  jobId: string | null
  occurredAt: string
  sourceCount: number | null
  citedCount: number | null
  retrievedSources: string[]
  citedSources: string[]
  precision: {
    retrievedCount: number | null
    citedCount: number | null
    uncitedCount: number | null
    uncitedSources: string[]
  } | null
  problems: {
    kind: CitationEventKind
    severity: CitationEventSeverity
    count: number
    reasons: Record<string, number> | null
    failedSources: { target: string; reason: string }[]
    unavailableTools: string[]
  }[]
}

export interface CitationExportBundle {
  schema: 'grid.citation-health.export/v1'
  generatedAt: string
  scope: QualityScope
  windowDays: number
  windowStart: string
  windowEnd: string
  truncated: boolean
  glossary: Record<string, string>
  summary: CitationHealthSnapshot['totals'] & { findings: CitationFinding[] }
  turns: CitationExportTurn[]
}

const EXPORT_GLOSSARY: Record<string, string> = {
  scope:
    'The filter the export was taken in: UTC days from..to inclusive (windowStart <= occurredAt < windowEnd), and, when non-empty, only those organizationIds and projectIds. A project filter keeps only turns whose conversation belongs to one of those projects; turns with no recorded conversation are left out of it.',
  citations_removed:
    'Citation verification removed one or more citations the model wrote. problems[].reasons counts the removed citations by reason (see reason.*); problems[].failedSources lists each cited target and its reason.',
  quote_unverified:
    'A passage the answer put in quotation marks could not be found (fuzzy match) in any retrieved passage. citedSources lists the documents the answer cited; the quoted wording itself is deliberately not recorded.',
  answer_ungrounded:
    'Sources were retrieved but no citation survived verification, so the answer shipped with a visible "without source citation" gap. retrievedSources shows what the model had available; failedSources shows what it cited instead.',
  registry_empty:
    'The turn captured no source at all: retrieval returned nothing. problems[].unavailableTools names the tools reported unavailable.',
  citation_fallback:
    'Nothing the model cited survived verification, but exactly one retrieved source existed and was attached automatically. Usually a citation-format mismatch rather than a wrong answer.',
  confidence_capped:
    "The deterministic overconfidence guard lowered the answer's self-reported confidence. problems[].reasons holds exactly one confidence reason (see confidence.*).",
  precision:
    'Not a defect. turns[].precision is the retrieval_precision observation: retrievedCount unique sources retrieval returned, citedCount of them the answer cited, uncitedCount it ignored, and uncitedSources naming those (at most 10). null when the turn recorded none.',
  'reason.url_not_in_registry':
    'Removal: the cited URL was not among the sources retrieved on that turn. Means "not retrieved", not "unknown to the platform".',
  'reason.citation_key_not_in_registry':
    'Removal: the cited document key (file name, page) was not among the sources retrieved on that turn.',
  'reason.unverifiable':
    'Removal: the source line named no URL or document key the verifier could check.',
  'reason.digest_line_not_citable':
    "Removal: the line cited the conversation's read index (a digest line), not a retrieved passage.",
  'reason.duplicate': 'Removal: the citation repeated one already present in the same answer.',
  'confidence.ungrounded': 'Capped to low: no verified citation, and nothing was measured.',
  'confidence.quote_unverified': 'Capped to low: a quoted span matched no retrieved passage.',
  'confidence.law_unsettled':
    "Confidence capped to medium: the answer cites building law the turn's knowledge records do not settle (no curated coverage at the site).",
  'confidence.open_point': 'Capped by the answer: an open point it names (medium) or its own lower level.',
  'confidence.normative_claim_uncited':
    'Confidence capped: the answer was grounded in a measurement but also made a legal claim without a verified citation.',
  'confidence.measurement_only':
    'Confidence reduced from high to medium: grounded in a measurement only and purely descriptive.',
  'confidence.citation_fallback':
    'Confidence capped: the only grounding is the single source attached automatically by the citation fallback.',
}

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

function toExportTurn(
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
