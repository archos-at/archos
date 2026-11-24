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
import * as backend from '@/shared/vocabularies.generated'
import { dispatchIngest } from './ingest-dispatch'
import { DOCUMENT_TYPE_TAGS } from './tag-vocabulary'

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response(JSON.stringify({ job_id: 'job-1' }), { status: 202 }))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ingest document type contract', () => {
  it('sends the key IngestRequest declares', async () => {
    const documentType = DOCUMENT_TYPE_TAGS[6]
    await dispatchIngest('doc-1', 'proj_abc', 'org/org-1/doc-1/gutachten.pdf', 'org-1', null, null, { documentType })
    const body = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>

    const keys = Object.keys(body).filter((key) => body[key] === documentType)
    expect(keys).toHaveLength(1)
    expect(agentHost.INGEST_REQUEST_FIELDS).toContain(keys[0])
  })

  it('types the field with the vocabulary the backend accepts', () => {
    expect([...DOCUMENT_TYPE_TAGS]).toEqual([...backend.DOCUMENT_TYPE_TAGS])
  })
})
