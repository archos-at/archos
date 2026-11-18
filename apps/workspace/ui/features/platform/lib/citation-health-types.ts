import type { QualityScope } from '@/lib/quality/scope'

export const DEFECT_KINDS = [
  'answer_ungrounded',
  'citations_removed',
  'quote_unverified',
  'registry_empty',
  'citation_fallback',
  'confidence_capped',
] as const
type DefectKind = (typeof DEFECT_KINDS)[number]

export type Severity = 'ok' | 'info' | 'warn' | 'error'

interface KindTotalDto {
  kind: DefectKind
  turns: number
  items: number
  share: number
}

interface DailyPointDto {
  day: string
  turns: number
  defectTurns: number
  byKind: Record<string, number>
}

interface ReasonDto {
  kind: DefectKind
  reason: string
  occurrences: number
  share: number
}

interface SourceMixDto {
  dimension: 'origin' | 'lane' | 'tool'
  label: string
  turns: number
}

export interface OrganizationDto {
  organizationId: string | null
  name: string | null
  turns: number
  defectTurns: number
  errorTurns: number
  defectRate: number
}

export interface DefectSampleDto {
  id: string
  createdAt: string
  kind: DefectKind
  severity: Severity
  agent: 'shallow' | 'deep'
  count: number
  reasons: Record<string, number> | null
  organizationId: string | null
  conversationId: string | null
  turnId: string
}

export type FindingId =
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

export type FindingSeverity = 'error' | 'warn' | 'info'

export interface FindingDto {
  id: FindingId
  severity: FindingSeverity
  subject: { type: 'organization' | 'tool'; label: string } | null
  metrics: Record<string, number>
}

export type MissingSourceAction =
  | 'add_to_norm_catalog'
  | 'upload_to_base_knowledge'
  | 'investigate_retrieval'
  | 'inventory_unknown'
  | 'none'

export interface MissingSourceDto {
  target: string
  kind: 'document' | 'ris' | 'web'
  reason: string
  turns: number
  organizations: number
  lastSeenAt: string
  present: boolean | null
  action: MissingSourceAction
  fileName: string | null
  documentNumber: string | null
}

export interface SnapshotDto {
  scope?: QualityScope
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
  findings: FindingDto[]
  byKind: KindTotalDto[]
  dailyTrend: DailyPointDto[]
  reasons: ReasonDto[]
  sourceMix: SourceMixDto[]
  unavailableTools: { tool: string; turns: number }[]
  missingSources: MissingSourceDto[]
  inventoryKnown?: boolean
  missingSourcesTotal?: number
  organizations: OrganizationDto[]
  organizationsTotal?: number
  recent: DefectSampleDto[]
}

export interface FindingCopy {
  title: string
  meaning: string
  action: string
}
