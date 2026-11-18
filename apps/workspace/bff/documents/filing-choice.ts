import { FILING_CHOICE_METADATA_KEY } from './filing-choice-key'
import type { Document } from '@/lib/db/schema/documents'
import {
  mailOriginIngestFactsSchema,
  mailThreadIngestFactsSchema,
  type MailOriginIngestFacts,
  type MailThreadIngestFacts,
} from '@/lib/mail-thread/ingest-facts'
import { documentTypeOf, type DocumentTypeTag } from './tag-vocabulary'

const DOCUMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export { FILING_CHOICE_METADATA_KEY } from './filing-choice-key'

export interface FilingChoice {
  documentType: DocumentTypeTag | null
  revisionOfId: string | null
  mailThread?: MailThreadIngestFacts
  mailOrigin?: MailOriginIngestFacts
}

export function filingChoiceRecord(choice: Partial<{ [K in keyof FilingChoice]: FilingChoice[K] | null }>): Record<string, unknown> | null {
  const record: Record<string, unknown> = {}
  if (choice.documentType) record.documentType = choice.documentType
  if (choice.revisionOfId) record.revisionOfId = choice.revisionOfId
  if (choice.mailThread) record.mailThread = choice.mailThread
  if (choice.mailOrigin) record.mailOrigin = choice.mailOrigin
  return Object.keys(record).length > 0 ? record : null
}

export function storedFilingChoice(row: Pick<Document, 'metadata' | 'contentHash'>): FilingChoice | null {
  const metadata = asRecord(row.metadata)
  const stored = asRecord(metadata?.[FILING_CHOICE_METADATA_KEY])
  if (!metadata || !stored) return null
  if (!row.contentHash || metadata.ingestContentHash !== row.contentHash) return null
  const documentType = typeof stored.documentType === 'string' ? (documentTypeOf([stored.documentType]) ?? null) : null
  const revisionOfId =
    typeof stored.revisionOfId === 'string' && DOCUMENT_ID.test(stored.revisionOfId) ? stored.revisionOfId : null
  const mailThread = mailThreadIngestFactsSchema.safeParse(stored.mailThread)
  const mailOrigin = mailOriginIngestFactsSchema.safeParse(stored.mailOrigin)
  const mail = {
    ...(mailThread.success ? { mailThread: mailThread.data } : {}),
    ...(mailOrigin.success && !mailThread.success ? { mailOrigin: mailOrigin.data } : {}),
  }
  return documentType || revisionOfId || Object.keys(mail).length > 0 ? { documentType, revisionOfId, ...mail } : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
