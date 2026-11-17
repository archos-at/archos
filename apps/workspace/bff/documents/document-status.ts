export const DOCUMENT_STATUSES = [
  'uploaded',
  'pending',
  'processing',
  'completed',
  'failed',
  'quarantined',
  'stored',
  'cancelled',
] as const

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

const COLUMN_STATUSES: ReadonlySet<string> = new Set(DOCUMENT_STATUSES)

export function isDocumentStatus(value: string | null | undefined): value is DocumentStatus {
  return value != null && COLUMN_STATUSES.has(value)
}

export function columnStatuses(values: Iterable<string>): DocumentStatus[] {
  return [...values].filter(isDocumentStatus)
}

export type DocumentStatusVariant = 'success' | 'info' | 'destructive' | 'secondary' | 'warning'

export type DocumentStatusPhase = 'in-flight' | 'terminal'

export interface DocumentStatusFacts {
  readonly variant: DocumentStatusVariant
  readonly phase: DocumentStatusPhase
}

export const DOCUMENT_STATUS_FACTS = {
  completed: { variant: 'success', phase: 'terminal' },
  ready: { variant: 'success', phase: 'terminal' },
  ingested: { variant: 'success', phase: 'terminal' },
  success: { variant: 'success', phase: 'terminal' },
  processed: { variant: 'success', phase: 'terminal' },

  pending: { variant: 'info', phase: 'in-flight' },
  processing: { variant: 'info', phase: 'in-flight' },
  uploading: { variant: 'info', phase: 'in-flight' },
  ingesting: { variant: 'info', phase: 'in-flight' },

  failed: { variant: 'destructive', phase: 'terminal' },
  error: { variant: 'destructive', phase: 'terminal' },

  stored: { variant: 'secondary', phase: 'terminal' },
  uploaded: { variant: 'secondary', phase: 'terminal' },
  cancelled: { variant: 'secondary', phase: 'terminal' },

  quarantined: { variant: 'warning', phase: 'terminal' },
} as const satisfies Record<string, DocumentStatusFacts>

export type KnownDocumentStatus = keyof typeof DOCUMENT_STATUS_FACTS

const FACTS_BY_STATUS: ReadonlyMap<string, DocumentStatusFacts> = new Map(
  Object.entries(DOCUMENT_STATUS_FACTS),
)

export const KNOWN_DOCUMENT_STATUSES: readonly KnownDocumentStatus[] = Object.keys(
  DOCUMENT_STATUS_FACTS,
) as KnownDocumentStatus[]

export function documentStatusFacts(status: string | null | undefined): DocumentStatusFacts | null {
  return FACTS_BY_STATUS.get((status ?? '').toLowerCase()) ?? null
}

export function isKnownDocumentStatus(status: string | null | undefined): status is KnownDocumentStatus {
  return documentStatusFacts(status) !== null
}

export const IN_FLIGHT_DOCUMENT_STATUSES: ReadonlySet<string> = new Set(
  KNOWN_DOCUMENT_STATUSES.filter((status) => DOCUMENT_STATUS_FACTS[status].phase === 'in-flight'),
)

export type DocumentReadFamily = 'readable' | 'reading' | 'failed' | 'held' | 'unindexed'

export const DOCUMENT_READ_FAMILIES: readonly DocumentReadFamily[] = ['readable', 'reading', 'failed', 'held', 'unindexed']

const READ_FAMILY_BY_VARIANT: Record<DocumentStatusVariant, DocumentReadFamily> = {
  success: 'readable',
  info: 'reading',
  destructive: 'failed',
  warning: 'held',
  secondary: 'unindexed',
}

export function documentReadFamily(status: string | null | undefined): DocumentReadFamily {
  const facts = documentStatusFacts(status)
  return facts ? READ_FAMILY_BY_VARIANT[facts.variant] : 'reading'
}

export function declaredStatusesIn(family: DocumentReadFamily): string[] {
  return KNOWN_DOCUMENT_STATUSES.filter(
    (status) => READ_FAMILY_BY_VARIANT[DOCUMENT_STATUS_FACTS[status].variant] === family,
  )
}
