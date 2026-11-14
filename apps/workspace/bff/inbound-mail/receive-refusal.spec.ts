/**
 * @vitest-environment node
 */
/**
 * A refusal says where it failed and why. In 2026-11 every delivery to one
 * office was refused `unavailable` for two days, and nothing a person could
 * read named the step or the error: the bucket check's error was swallowed into
 * a bare 503 and the log line printed no class for an `ApiError`. These hold
 * the webhook to naming the stage and the cause chain (classes and codes, never
 * a message) in the log line and in PostHog's `inbound_mail_refused`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))
vi.mock('@/lib/limits/enforce', () => ({ enforceLimit: vi.fn(async () => undefined) }))
vi.mock('@/lib/workos/feature-flags', () => ({ enabledFlagsForOrganization: vi.fn(async () => ['inbound-mail']) }))
vi.mock('@/lib/authz/feature-flags', () => ({
  FEATURE_FLAGS: { inboundMail: 'inbound-mail' },
  isFeatureEnabled: ({ featureFlags }: { featureFlags: string[] }, flag: string) => featureFlags.includes(flag),
}))
vi.mock('@/lib/db/tenant-context', () => ({
  withPlatformAccess: vi.fn(async (_why: string, run: () => unknown) => run()),
  withTenant: vi.fn(async (_scope: unknown, run: () => unknown) => run()),
}))
vi.mock('./repository', () => ({
  completeReception: vi.fn(),
  findActiveAddressByToken: vi.fn(async () => ({ organizationId: 'org_1', projectId: 'project-1', addressId: 'addr-1' })),
  findMailIdByDeliveryKey: vi.fn(),
  forgetReceptionObject: vi.fn(),
  insertReception: vi.fn(),
  stagedBytes: vi.fn(async () => ({ address: 0, organization: 0 })),
}))
vi.mock('./staging', () => ({ eraseStagedObjects: vi.fn(), putRawMessage: vi.fn(), stagingBucketFor: vi.fn() }))

import { captureServer } from '@/lib/analytics/posthog-server'
import { ServiceUnavailableError } from '@/lib/api/errors'
import type { VerifiedSignature } from '@/lib/internal-auth'
import { BucketOwnershipError } from '@/lib/storage/bucket'
import { enabledFlagsForOrganization } from '@/lib/workos/feature-flags'
import { DELIVERY_STAGES, describeError, receiveInboundMail } from './receive'
import { ENVELOPE_FROM_HEADER, ENVELOPE_TO_HEADER } from './contract'
import { stagingBucketFor } from './staging'

const signature = { keyId: 'worker-1', contentLength: 10, contentDigest: 'sha-256=:x:' } as unknown as VerifiedSignature

function delivery(): Request {
  return new Request('https://app.example.org/api/internal/signed/inbound-mail', {
    method: 'POST',
    headers: {
      [ENVELOPE_TO_HEADER]: 'project+haus.abcdefghijkl@inbox.example.org',
      [ENVELOPE_FROM_HEADER]: 'a@example.com',
    },
    body: 'x'.repeat(10),
  })
}

function refusal(): Record<string, unknown> {
  const call = vi.mocked(captureServer).mock.calls.find(([event]) => event.event === 'inbound_mail_refused')
  return (call?.[0].properties ?? {}) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INBOUND_MAIL_DOMAIN', 'inbox.example.org')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('a refused delivery', () => {
  it('names the bucket step and the ownership refusal behind the 503', async () => {
    const cause = new BucketOwnershipError('unclaimed_objects', 'Bucket "bucket-x" already holds objects …')
    const wrapped = new ServiceUnavailableError('Object storage is unavailable', { reason: 'storage-unavailable' })
    wrapped.cause = cause
    vi.mocked(stagingBucketFor).mockRejectedValue(wrapped)

    const response = await receiveInboundMail({ request: delivery(), signature })

    expect(response.status).toBe(503)
    expect(refusal()).toEqual({
      reason: 'unavailable',
      stage: 'bucket',
      error: 'ServiceUnavailableError:SERVICE_UNAVAILABLE < BucketOwnershipError:unclaimed_objects',
    })
    const line = vi.mocked(console.error).mock.calls.flat().join(' ')
    expect(line).toContain('stage=bucket')
    expect(line).toContain('BucketOwnershipError:unclaimed_objects')
    // Never the message: it names organizations.
    expect(line).not.toContain('bucket-x')
  })

  it('names the feature step when the office’s settings cannot be read', async () => {
    vi.mocked(enabledFlagsForOrganization).mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'ECONNRESET' }))

    await receiveInboundMail({ request: delivery(), signature })

    expect(refusal()).toMatchObject({ reason: 'unavailable', stage: 'feature', error: 'InboundMailRetryError:SERVICE_UNAVAILABLE < Error:ECONNRESET' })
  })
})

describe('describeError', () => {
  it('follows causes and keeps an object store’s code and status, never a message', () => {
    const s3 = Object.assign(new Error('Access Denied for org secret'), {
      name: 'AccessDenied',
      Code: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    })
    const outer = new Error('outer', { cause: s3 })
    expect(describeError(outer)).toBe('Error < AccessDenied:AccessDenied:http403')
    expect(describeError(outer)).not.toContain('secret')
  })

  it('stops at four causes', () => {
    let error: Error = new Error('0')
    for (let i = 0; i < 6; i += 1) error = new Error(String(i), { cause: error })
    expect(describeError(error).split(' < ')).toHaveLength(4)
  })

  it('lists the stages in the order a delivery passes them', () => {
    expect(DELIVERY_STAGES[0]).toBe('envelope')
    expect(DELIVERY_STAGES.at(-1)).toBe('complete')
  })
})
