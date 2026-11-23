import 'server-only'

import type { LangfuseClient } from '@langfuse/client'
import { langfuseApiConfig } from './config'
import { clientFor, environment } from './tool-call-trace'

export const MAIL_SUGGESTION_EVENT_NAME = 'inbound-mail-suggestion'

export interface MailSuggestionTraceRecord {
  traceId: string
  mailId: string
  status: 'suggested' | 'failed'
  reason: string | null
  asked: number
  stored: number
  willRetry: boolean
  at: Date
}

type IngestionBatch = Parameters<LangfuseClient['api']['ingestion']['batch']>[0]

export function mailSuggestionBatch(record: MailSuggestionTraceRecord, eventId: string): IngestionBatch {
  const timestamp = record.at.toISOString()
  const env = environment()
  return {
    batch: [
      {
        type: 'event-create',
        id: eventId,
        timestamp,
        body: {
          traceId: record.traceId,
          name: MAIL_SUGGESTION_EVENT_NAME,
          startTime: timestamp,
          level: record.status === 'failed' ? 'ERROR' : 'DEFAULT',
          ...(record.reason ? { statusMessage: record.reason } : {}),
          metadata: {
            mail_id: record.mailId,
            status: record.status,
            reason: record.reason ?? '',
            asked: record.asked,
            stored: record.stored,
            will_retry: record.willRetry,
          },
          ...(env ? { environment: env } : {}),
        },
      },
    ],
  }
}

export async function recordMailSuggestionOutcome(record: MailSuggestionTraceRecord): Promise<void> {
  const config = langfuseApiConfig()
  if (!config) return
  try {
    await clientFor(config).api.ingestion.batch(mailSuggestionBatch(record, crypto.randomUUID()), { timeoutInSeconds: 5, maxRetries: 1 })
  } catch (error) {
    console.warn(`[Langfuse] inbound-mail suggestion outcome failed for mail ${record.mailId} (non-fatal):`, error)
  }
}
