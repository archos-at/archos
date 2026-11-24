/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/s3', () => ({
  presignForBackend: vi.fn(async () => 'https://object-store.internal/presigned'),
  buildThumbnailStorageKey: () => null,
}))
vi.mock('@/lib/storage/bucket', () => ({ resolveDocumentBucket: () => 'bucket' }))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('@/lib/upload-screening/service', () => ({ ingestScreeningFor: vi.fn(async () => null) }))
vi.mock('@/lib/cross-project/project-facts-mirror', () => ({ projectFactsForIngest: vi.fn(async () => null) }))
vi.mock('@/lib/analytics/ingest-events', () => ({ announceIngestStarted: vi.fn() }))
vi.mock('@/lib/base-knowledge/text-guard', () => ({ copyMarkForIngest: vi.fn(async () => null), licenceMarkFields: vi.fn() }))
vi.mock('@/lib/budgets/ingest-allowance', () => ({ ingestAllowanceSpent: vi.fn(async () => false) }))
vi.mock('./repository', () => ({
  findDocumentInOrg: vi.fn(async () => null),
  markDocumentIngestFailed: vi.fn(),
  setDocumentIngestJob: vi.fn(async () => true),
}))

import * as agentHost from '@/lib/agent-host-contract.generated'
import {
  mailOriginIngestFactsSchema,
  mailThreadIngestFactsSchema,
} from '@/lib/mail-thread/ingest-facts'
import { SENDER_TRUSTS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { MAIL_THREAD_LOCALES } from '@/lib/mail-thread/mail-thread-vocabulary'
import { dispatchIngest, type DispatchIngestExtras } from './ingest-dispatch'

const MAIL_THREAD = mailThreadIngestFactsSchema.parse({
  latest_sent_at: '2026-05-04T06:30:00Z',
  message_count: 3,
  locale: 'de',
})
const MAIL_ORIGIN = mailOriginIngestFactsSchema.parse({
  sent_at: '2026-05-04T06:30:00Z',
  sender_trust: 'external_verified',
  locale: 'de',
})

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response(JSON.stringify({ job_id: 'job-1' }), { status: 202 }))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const sentBody = async (extras: DispatchIngestExtras): Promise<Record<string, unknown>> => {
  await dispatchIngest('doc-1', 'proj_abc', 'org/org-1/doc-1/brief.pdf', 'org-1', null, null, extras)
  return JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>
}

const keyOf = (body: Record<string, unknown>, record: object): string => {
  const keys = Object.keys(body).filter((key) => JSON.stringify(body[key]) === JSON.stringify(record))
  expect(keys, 'the record is sent under exactly one key').toHaveLength(1)
  return keys[0]!
}

const declaredFields = (key: string): string[] =>
  [...((agentHost.INGEST_STRICT_RECORDS as Record<string, readonly string[]>)[key] ?? [])].sort()

describe('ingest mail contract', () => {
  it('sends each record under the key IngestRequest declares for it', async () => {
    const threadKey = keyOf(await sentBody({ mailThread: MAIL_THREAD }), MAIL_THREAD)
    fetchSpy.mockClear()
    const originKey = keyOf(await sentBody({ mailOrigin: MAIL_ORIGIN }), MAIL_ORIGIN)

    expect(declaredFields(threadKey)).toEqual(Object.keys(mailThreadIngestFactsSchema.shape).sort())
    expect(declaredFields(originKey)).toEqual(Object.keys(mailOriginIngestFactsSchema.shape).sort())
  })

  it('writes exactly the fields each forbid-extra model declares', () => {
    expect(Object.keys(mailThreadIngestFactsSchema.shape).sort()).toEqual(
      [...agentHost.INGEST_STRICT_RECORDS.mail_thread].sort()
    )
    expect(Object.keys(mailOriginIngestFactsSchema.shape).sort()).toEqual(
      [...agentHost.INGEST_STRICT_RECORDS.mail_origin].sort()
    )
  })

  it('names the trusts and locales the backend accepts, and no other', () => {
    expect([...SENDER_TRUSTS].sort()).toEqual([...agentHost.SENDER_TRUSTS].sort())
    expect([...MAIL_THREAD_LOCALES].sort()).toEqual([...agentHost.MAIL_LOCALES].sort())
  })

  it('never sends both records on one document, which the backend refuses', async () => {
    const body = await sentBody({ mailThread: MAIL_THREAD, mailOrigin: MAIL_ORIGIN })
    expect(body).toHaveProperty('mail_thread', MAIL_THREAD)
    expect(body).not.toHaveProperty('mail_origin')
  })
})
