import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { S3ServiceException } from '@aws-sdk/client-s3'

import {
  assertValidBucketName,
  BucketOwnershipError,
  bucketForWrite,
  ensureTenantBucket,
  ensureTenantBucketChecked,
  perOrgBucketsEnabled,
  resolveDocumentBucket,
  tenantBucketName,
  __resetBucketCache,
} from './bucket'

const ORG = 'org_01H8XYZABCDEFGHJKMNPQRSTV' // pragma: allowlist secret (a WorkOS org id, not a credential)

describe('tenantBucketName', () => {
  it('is deterministic', () => {
    expect(tenantBucketName(ORG)).toBe(tenantBucketName(ORG))
  })

  it('produces a legal S3 bucket name', () => {
    expect(() => assertValidBucketName(tenantBucketName(ORG))).not.toThrow()
  })

  it('keeps the organization recognisable in the name', () => {
    expect(tenantBucketName(ORG)).toContain('org-01h8xyz') // pragma: allowlist secret
  })

  it('ends in a 128-bit SHA-256 of the ORIGINAL id, not of the slug', () => {
    const expected = createHash('sha256').update(ORG).digest('hex').slice(0, 32)
    expect(expected).toHaveLength(32)
    expect(tenantBucketName(ORG).endsWith(expected)).toBe(true)
  })

  it.each([
    ['Org_1', 'org-1'],
    ['org.1', 'org_1'],
    ['ORG-1', 'org--1'],
    ['a_b', 'a-b'],
  ])('does not collide for ids that slug identically (%s vs %s)', (left, right) => {
    expect(tenantBucketName(left)).not.toBe(tenantBucketName(right))
  })

  it('stays inside 63 characters for a long organization id', () => {
    const long = `org_${'X'.repeat(120)}`
    const name = tenantBucketName(long)
    expect(name.length).toBeLessThanOrEqual(63)
    expect(() => assertValidBucketName(name)).not.toThrow()
  })

  it('still distinguishes two long ids that share a truncated prefix', () => {
    const a = `org_${'X'.repeat(120)}a`
    const b = `org_${'X'.repeat(120)}b`
    expect(tenantBucketName(a)).not.toBe(tenantBucketName(b))
  })

  it('produces a valid name for an id with no usable characters at all', () => {
    const name = tenantBucketName('___')
    expect(() => assertValidBucketName(name)).not.toThrow()
    expect(name).not.toContain('--')
  })

  it('never leaves a trailing hyphen where truncation cut the slug', () => {
    for (let n = 30; n < 60; n++) {
      const name = tenantBucketName(`org-${'a-'.repeat(n)}`)
      expect(() => assertValidBucketName(name)).not.toThrow()
    }
  })

  it('refuses an empty organization id rather than minting a shared bucket', () => {
    expect(() => tenantBucketName('')).toThrow(/non-empty/)
  })

  it('honours SEAWEED_TENANT_BUCKET_PREFIX', () => {
    vi.stubEnv('SEAWEED_TENANT_BUCKET_PREFIX', 'acme-t-')
    expect(tenantBucketName(ORG).startsWith('acme-t-')).toBe(true)
  })
})

describe('assertValidBucketName', () => {
  it.each([
    ['ab', /length/],
    [`${'a'.repeat(64)}`, /length/],
    ['Grid-Org-1', /lowercase/],
    ['-grid-org-1', /lowercase/],
    ['grid-org-1-', /lowercase/],
    ['grid..org', /consecutive dots/],
    ['10.0.0.1', /IP address/],
  ])('rejects %s', (name, message) => {
    expect(() => assertValidBucketName(name)).toThrow(message)
  })

  it('accepts a well-formed name', () => {
    expect(assertValidBucketName('grid-org-abc-0123456789ab')).toBe('grid-org-abc-0123456789ab')
  })
})

describe('bucket selection', () => {
  beforeEach(() => {
    __resetBucketCache()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('writes to the shared bucket when the feature is off', () => {
    vi.stubEnv('SEAWEED_PER_ORG_BUCKETS', 'false')
    expect(perOrgBucketsEnabled()).toBe(false)
    expect(bucketForWrite(ORG)).toBe('grid-documents')
  })

  it('writes to the organization bucket when the feature is on', () => {
    vi.stubEnv('SEAWEED_PER_ORG_BUCKETS', 'true')
    expect(bucketForWrite(ORG)).toBe(tenantBucketName(ORG))
  })

  it('resolves a NULL recorded bucket to the shared bucket even when the feature is on', () => {
    vi.stubEnv('SEAWEED_PER_ORG_BUCKETS', 'true')
    expect(resolveDocumentBucket(null)).toBe('grid-documents')
    expect(resolveDocumentBucket(undefined)).toBe('grid-documents')
  })

  it('resolves a recorded bucket to itself', () => {
    expect(resolveDocumentBucket('grid-org-whatever-0123456789ab')).toBe(
      'grid-org-whatever-0123456789ab',
    )
  })

})

describe('ensureTenantBucket', () => {
  const s3Error = (name: string, status: number): S3ServiceException =>
    new S3ServiceException({
      name,
      $fault: 'client',
      $metadata: { httpStatusCode: status },
      message: name,
    })

  const BUCKET = tenantBucketName(ORG)
  const CLAIM_PREFIX = '.grid-bucket-owner/'
  const claimKey = (org: string): string =>
    `${CLAIM_PREFIX}${createHash('sha256').update(org).digest('hex')}`

  function fakeS3(state: {
    bucketExists: boolean
    objects?: Map<string, string>
    createFails?: S3ServiceException
    headFails?: unknown
    onCommand?: (name: string) => Promise<void> | void
  }) {
    const objects = state.objects ?? new Map<string, string>()
    const calls: Array<{ command: string; input: Record<string, unknown> }> = []
    const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name
      const input = command.input
      calls.push({ command: name, input })
      const answer = ((): unknown => {
        switch (name) {
          case 'HeadBucketCommand':
            if (state.headFails) throw state.headFails
            if (!state.bucketExists) throw s3Error('NotFound', 404)
            return {}
          case 'CreateBucketCommand':
            if (state.createFails) throw state.createFails
            state.bucketExists = true
            return {}
          case 'GetObjectCommand': {
            const body = objects.get(String(input.Key))
            if (body === undefined) throw s3Error('NoSuchKey', 404)
            return { Body: { transformToString: async () => body } }
          }
          case 'ListObjectsV2Command': {
            const prefix = input.Prefix === undefined ? '' : String(input.Prefix)
            const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort()
            return { Contents: keys.slice(0, Number(input.MaxKeys ?? 1000)).map((Key) => ({ Key })) }
          }
          case 'PutObjectCommand':
            objects.set(String(input.Key), String(input.Body))
            return {}
          default:
            throw new Error(`unexpected command ${name}`)
        }
      })()
      await state.onCommand?.(name)
      return answer
    })
    return { send, calls, objects, state }
  }

  const names = (calls: Array<{ command: string }>): string[] => calls.map((c) => c.command)
  const owners = (objects: Map<string, string>): string[] =>
    [...objects.entries()].filter(([key]) => key.startsWith(CLAIM_PREFIX)).map(([, body]) => body)

  beforeEach(() => {
    __resetBucketCache()
    vi.stubEnv('SEAWEED_PER_ORG_BUCKETS', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does nothing at all when the feature is off — not even a HeadBucket', async () => {
    vi.stubEnv('SEAWEED_PER_ORG_BUCKETS', 'false')
    const s3 = fakeS3({ bucketExists: false })
    expect(await ensureTenantBucket({ send: s3.send } as never, ORG)).toBe('grid-documents')
    expect(s3.send).not.toHaveBeenCalled()
  })

  it('creates the bucket, claims it, and verifies the claim, in that order', async () => {
    const s3 = fakeS3({ bucketExists: false })
    expect(await ensureTenantBucket({ send: s3.send } as never, ORG)).toBe(BUCKET)

    expect(names(s3.calls)).toEqual([
      'HeadBucketCommand',
      'CreateBucketCommand',
      'PutObjectCommand',
      'ListObjectsV2Command',
    ])
    expect(owners(s3.objects)).toEqual([ORG])
  })

  it('accepts a bucket already claimed by this organization, and writes nothing', async () => {
    const s3 = fakeS3({
      bucketExists: true,
      objects: new Map([
        [claimKey(ORG), ORG],
        ['org/x/doc.pdf', 'x'],
      ]),
    })
    expect(await ensureTenantBucket({ send: s3.send } as never, ORG)).toBe(BUCKET)
    expect(names(s3.calls)).toEqual(['HeadBucketCommand', 'ListObjectsV2Command'])
    expect(names(s3.calls)).not.toContain('PutObjectCommand')
  })

  it('refuses a bucket claimed by a different organization', async () => {
    const s3 = fakeS3({
      bucketExists: true,
      objects: new Map([[claimKey('org_SOMEONE_ELSE'), 'org_SOMEONE_ELSE']]),
    })
    await expect(ensureTenantBucket({ send: s3.send } as never, ORG)).rejects.toThrow(
      /claimed by organization "org_SOMEONE_ELSE"/,
    )
    expect(names(s3.calls)).not.toContain('PutObjectCommand')
    expect(owners(s3.objects)).toEqual(['org_SOMEONE_ELSE'])
  })

  it.each([
    ['foreign_claim', new Map([[claimKey('org_SOMEONE_ELSE'), 'org_SOMEONE_ELSE']])],
    ['unclaimed_objects', new Map([['org/other/doc.pdf', 'x']])],
  ] as const)('refuses as a BucketOwnershipError with code %s', async (code, objects) => {
    const s3 = fakeS3({ bucketExists: true, objects: new Map(objects) })
    const refusal = await ensureTenantBucket({ send: s3.send } as never, ORG).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(BucketOwnershipError)
    expect(refusal).toMatchObject({ name: 'BucketOwnershipError', code })
  })

  it('keeps a store fault as the cause of the UpstreamError it answers with', async () => {
    const fault = s3Error('InternalError', 503)
    const s3 = fakeS3({ bucketExists: true, headFails: Object.assign(fault, { $fault: 'server' }) })
    const error = await ensureTenantBucketChecked({ send: s3.send } as never, ORG).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'UPSTREAM_ERROR' })
    expect((error as Error).cause).toBe(fault)
  })

  it('does not cache a bucket it refused', async () => {
    const s3 = fakeS3({
      bucketExists: true,
      objects: new Map([[claimKey('org_SOMEONE_ELSE'), 'org_SOMEONE_ELSE']]),
    })
    await expect(ensureTenantBucket({ send: s3.send } as never, ORG)).rejects.toThrow()
    await expect(ensureTenantBucket({ send: s3.send } as never, ORG)).rejects.toThrow()
  })

  it('claims an empty unclaimed bucket, which is a half-finished provision', async () => {
    const s3 = fakeS3({ bucketExists: true })
    expect(await ensureTenantBucket({ send: s3.send } as never, ORG)).toBe(BUCKET)
    expect(owners(s3.objects)).toEqual([ORG])
  })

  it('refuses a NON-empty unclaimed bucket', async () => {
    const s3 = fakeS3({
      bucketExists: true,
      objects: new Map([['org/other/doc.pdf', 'x']]),
    })
    await expect(ensureTenantBucket({ send: s3.send } as never, ORG)).rejects.toThrow(
      /holds objects but carries no ownership claim/,
    )
    expect(owners(s3.objects)).toEqual([])
  })

  it('treats losing the create race as success', async () => {
    const s3 = fakeS3({
      bucketExists: false,
      createFails: s3Error('BucketAlreadyOwnedByYou', 409),
    })
    expect(await ensureTenantBucket({ send: s3.send } as never, ORG)).toBe(BUCKET)
    expect(owners(s3.objects)).toEqual([ORG])
  })

  it('cannot let two organizations both claim one bucket, whatever the interleaving', async () => {
    const OTHER = 'org_01H8COLLIDESWITHTHEFIRSTONE' // pragma: allowlist secret (an org id)
    const objects = new Map<string, string>()

    let release: (() => void) | undefined
    const parked = new Promise<void>((resolve) => {
      release = resolve
    })
    let lists = 0
    const onCommand = async (name: string): Promise<void> => {
      if (name !== 'ListObjectsV2Command') return
      lists += 1
      if (lists === 1) await parked
    }

    const s3 = fakeS3({ bucketExists: true, objects, onCommand })
    const first = ensureTenantBucket({ send: s3.send } as never, ORG)
    await vi.waitFor(() => expect(lists).toBe(1))

    const second = await Promise.allSettled([ensureTenantBucket({ send: s3.send } as never, OTHER)])
    release?.()
    const firstResult = await Promise.allSettled([first])

    const settled = [...firstResult, ...second]
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(second[0]!.status).toBe('fulfilled')
    expect(firstResult[0]!.status).toBe('rejected')
    expect(owners(objects).sort()).toEqual([OTHER, ORG].sort())
  })

  it('propagates a HeadBucket failure that is not a 404', async () => {
    const s3 = fakeS3({ bucketExists: true, headFails: s3Error('AccessDenied', 403) })
    await expect(ensureTenantBucket({ send: s3.send } as never, ORG)).rejects.toThrow()
    expect(names(s3.calls)).toEqual(['HeadBucketCommand'])
  })

  it('does not mistake a plain transport error for a missing bucket', async () => {
    const s3 = fakeS3({ bucketExists: true, headFails: new Error('ECONNREFUSED') })
    await expect(ensureTenantBucket({ send: s3.send } as never, ORG)).rejects.toThrow(
      'ECONNREFUSED',
    )
    expect(names(s3.calls)).toEqual(['HeadBucketCommand'])
  })

  it('does not treat an unreadable marker as an absent one', async () => {
    const s3 = fakeS3({ bucketExists: true })
    s3.send.mockImplementation(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'HeadBucketCommand') return {}
      throw s3Error('AccessDenied', 403)
    })
    await expect(ensureTenantBucket({ send: s3.send } as never, ORG)).rejects.toThrow(
      'AccessDenied',
    )
  })

  it('verifies once per bucket, then serves from the cache', async () => {
    const s3 = fakeS3({ bucketExists: true, objects: new Map([[claimKey(ORG), ORG]]) })
    await ensureTenantBucket({ send: s3.send } as never, ORG)
    const after = s3.calls.length
    await ensureTenantBucket({ send: s3.send } as never, ORG)
    expect(s3.calls.length).toBe(after)
    expect(after).toBe(2)
  })
})
