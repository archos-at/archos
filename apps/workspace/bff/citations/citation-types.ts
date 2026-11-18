import type { CitationEventAgent, CitationEventKind, CitationEventSeverity } from '@/lib/db/schema/citation-events'
import type { QualityScope } from '@/lib/quality/scope'
import type { MissingSourceCandidate } from './missing-sources'
import type * as repository from './repository'

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
