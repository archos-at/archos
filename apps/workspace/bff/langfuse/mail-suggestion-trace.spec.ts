/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const api = vi.hoisted(() => ({ batch: vi.fn() }))
vi.mock('@langfuse/client', () => ({
  LangfuseClient: class {
    api = { ingestion: { batch: api.batch } }
  },
}))

import {
  MAIL_SUGGESTION_EVENT_NAME,
  mailSuggestionBatch,
  recordMailSuggestionOutcome,
  type MailSuggestionTraceRecord,
} from './mail-suggestion-trace'

const TRACE = 'abcdef0123456789abcdef0123456789'

const record = (patch: Partial<MailSuggestionTraceRecord> = {}): MailSuggestionTraceRecord => ({
  traceId: TRACE,
  mailId: 'mail-1',
  status: 'failed',
  reason: 'llm_response_malformed',
  asked: 0,
  stored: 0,
  willRetry: true,
  at: new Date('2026-11-19T09:00:00.000Z'),
  ...patch,
})

beforeEach(() => {
  vi.clearAllMocks()
  api.batch.mockResolvedValue({})
  vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-1')
  vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-1')
  vi.stubEnv('LANGFUSE_HOST', 'http://langfuse-web:3000')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('mailSuggestionBatch', () => {
  it('puts a failure on the generation’s trace as an ERROR event, with the mail id to search by', () => {
    const [event] = mailSuggestionBatch(record(), 'event-1').batch
    expect(event).toMatchObject({
      type: 'event-create',
      id: 'event-1',
      body: {
        traceId: TRACE,
        name: MAIL_SUGGESTION_EVENT_NAME,
        level: 'ERROR',
        statusMessage: 'llm_response_malformed',
        metadata: { mail_id: 'mail-1', status: 'failed', reason: 'llm_response_malformed', will_retry: true },
      },
    })
  })

  it('records a suggestion at the default level, with how many parts were asked about and kept', () => {
    const [event] = mailSuggestionBatch(record({ status: 'suggested', reason: null, asked: 3, stored: 2, willRetry: false }), 'event-2').batch
    expect(event.body).toMatchObject({ level: 'DEFAULT', metadata: { status: 'suggested', reason: '', asked: 3, stored: 2 } })
    expect(event.body).not.toHaveProperty('statusMessage')
  })
})

describe('recordMailSuggestionOutcome', () => {
  it('sends one batch, and never throws when Langfuse fails', async () => {
    await recordMailSuggestionOutcome(record())
    expect(api.batch).toHaveBeenCalledTimes(1)
    api.batch.mockRejectedValueOnce(new Error('down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(recordMailSuggestionOutcome(record())).resolves.toBeUndefined()
  })

  it('sends nothing without Langfuse configured', async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', '')
    await recordMailSuggestionOutcome(record())
    expect(api.batch).not.toHaveBeenCalled()
  })
})
