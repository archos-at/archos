import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { bucketName as sharedBucketName } from '@/lib/s3'
import { UpstreamError } from '@/lib/api/errors'


export const DEFAULT_TENANT_BUCKET_PREFIX = 'grid-org-'

const HASH_CHARS = 32

const MAX_BUCKET_NAME = 63

function slugify(organizationId: string): string {
  return organizationId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function assertValidBucketName(name: string): string {
  if (name.length < 3 || name.length > MAX_BUCKET_NAME) {
    throw new Error(
      `Invalid S3 bucket name "${name}": length ${name.length} is outside 3–${MAX_BUCKET_NAME}.`,
    )
  }
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) {
    throw new Error(
      `Invalid S3 bucket name "${name}": must be lowercase alphanumeric, hyphen or dot, ` +
        'and start and end with a letter or digit.',
    )
  }
  if (name.includes('..')) {
    throw new Error(`Invalid S3 bucket name "${name}": consecutive dots are not allowed.`)
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) {
    throw new Error(`Invalid S3 bucket name "${name}": must not be formatted as an IP address.`)
  }
  if (name.startsWith('xn--')) {
    throw new Error(`Invalid S3 bucket name "${name}": must not start with "xn--".`)
  }
  if (name.endsWith('-s3alias')) {
    throw new Error(`Invalid S3 bucket name "${name}": must not end with "-s3alias".`)
  }
  return name
}

export function tenantBucketName(
  organizationId: string,
  prefix: string = tenantPrefix(),
): string {
  if (!organizationId) {
    throw new Error('tenantBucketName requires a non-empty organization id.')
  }
  const hash = createHash('sha256').update(organizationId).digest('hex').slice(0, HASH_CHARS)

  const slugBudget = MAX_BUCKET_NAME - prefix.length - 1 - HASH_CHARS
  if (slugBudget < 1) {
    throw new Error(
      `Tenant bucket prefix "${prefix}" leaves no room for an organization id ` +
        `within S3's ${MAX_BUCKET_NAME}-character limit.`,
    )
  }

  const slug = slugify(organizationId).slice(0, slugBudget).replace(/-+$/, '')

  return assertValidBucketName(slug ? `${prefix}${slug}-${hash}` : `${prefix}${hash}`)
}

export function perOrgBucketsEnabled(): boolean {
  return process.env.SEAWEED_PER_ORG_BUCKETS === 'true'
}

function tenantPrefix(): string {
  return process.env.SEAWEED_TENANT_BUCKET_PREFIX || DEFAULT_TENANT_BUCKET_PREFIX
}

export function bucketForWrite(organizationId: string): string {
  return perOrgBucketsEnabled() ? tenantBucketName(organizationId) : sharedBucketName
}

export function resolveDocumentBucket(storageBucket: string | null | undefined): string {
  return storageBucket ?? sharedBucketName
}

const known = new Set<string>()

export function __resetBucketCache(): void {
  known.clear()
}

export class BucketOwnershipError extends Error {
  override readonly name = 'BucketOwnershipError'
  constructor(
    readonly code: 'foreign_claim' | 'unclaimed_objects',
    message: string,
  ) {
    super(message)
  }
}

const OWNER_CLAIM_PREFIX = '.grid-bucket-owner/'

function ownerClaimKey(organizationId: string): string {
  return `${OWNER_CLAIM_PREFIX}${createHash('sha256').update(organizationId).digest('hex')}`
}

function isStoreFault(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const fault = (error as { $fault?: unknown }).$fault
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
  return fault === 'server' || (typeof status === 'number' && status >= 500)
}

export async function ensureTenantBucket(
  client: S3Client,
  organizationId: string,
): Promise<string> {
  const bucket = bucketForWrite(organizationId)
  if (bucket === sharedBucketName || known.has(bucket)) return bucket

  let exists = true
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch (error) {
    if (!isNotFound(error)) throw error
    exists = false
  }

  if (!exists) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }))
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      exists = true
    }
  }

  await assertBucketOwnership(client, bucket, organizationId, { created: !exists })
  known.add(bucket)
  return bucket
}

export async function ensureTenantBucketChecked(
  client: S3Client,
  organizationId: string,
): Promise<string> {
  try {
    return await ensureTenantBucket(client, organizationId)
  } catch (error) {
    if (isStoreFault(error)) {
      const upstream = new UpstreamError('Object storage is unavailable', {
        operation: 'ensureTenantBucket',
        code: (error as { Code?: string }).Code ?? null,
      })
      upstream.cause = error
      throw upstream
    }
    throw error
  }
}

async function assertBucketOwnership(
  client: S3Client,
  bucket: string,
  organizationId: string,
  { created }: { created: boolean },
): Promise<void> {
  const ours = ownerClaimKey(organizationId)

  if (!created) {
    const existing = await listOwnerClaims(client, bucket)
    if (existing.length === 1 && existing[0] === ours) return
    const foreign = existing.find((key) => key !== ours)
    if (foreign !== undefined) await refuseForeignClaim(client, bucket, organizationId, foreign)

    await assertNotOccupiedByStrangers(client, bucket, organizationId)
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: ours,
      Body: organizationId,
      ContentType: 'text/plain',
    }),
  )

  const foreign = (await listOwnerClaims(client, bucket)).find((key) => key !== ours)
  if (foreign !== undefined) await refuseForeignClaim(client, bucket, organizationId, foreign)
}

async function refuseForeignClaim(
  client: S3Client,
  bucket: string,
  organizationId: string,
  foreignKey: string,
): Promise<never> {
  const other = await readClaimOwner(client, bucket, foreignKey)
  throw new BucketOwnershipError(
    'foreign_claim',
    `Bucket "${bucket}" is already claimed by organization "${other ?? 'unknown'}", so it ` +
      `cannot also hold organization "${organizationId}". Refusing to write, for BOTH ` +
      'organizations: this is either a bucket-name collision or two deployments sharing one ' +
      'object store with the same tenant prefix, and neither party has the better claim. ' +
      'Change SEAWEED_TENANT_BUCKET_PREFIX for one deployment, or migrate the objects and ' +
      `remove the stale key under "${OWNER_CLAIM_PREFIX}".`,
  )
}

async function assertNotOccupiedByStrangers(
  client: S3Client,
  bucket: string,
  organizationId: string,
): Promise<void> {
  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 3 }),
  )
  const keys = (listed?.Contents ?? []).map((object) => object.Key ?? '')
  const claimed = keys.some((key) => key.startsWith(OWNER_CLAIM_PREFIX))
  const occupied = keys.some((key) => key !== '' && !key.startsWith(OWNER_CLAIM_PREFIX))

  if (!claimed && occupied) {
    throw new BucketOwnershipError(
      'unclaimed_objects',
      `Bucket "${bucket}" already holds objects but carries no ownership claim. Refusing to ` +
        `write on behalf of organization "${organizationId}": the existing objects cannot be ` +
        `attributed. Inspect the bucket and either remove it or add a key under ` +
        `"${OWNER_CLAIM_PREFIX}" naming its owner.`,
    )
  }
}

async function listOwnerClaims(client: S3Client, bucket: string): Promise<string[]> {
  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: OWNER_CLAIM_PREFIX, MaxKeys: 2 }),
  )
  return (listed?.Contents ?? []).map((object) => object.Key ?? '').filter((key) => key !== '')
}

async function readClaimOwner(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const body = await response?.Body?.transformToString()
    return body?.trim() || null
  } catch (error) {
    if (isNoSuchKey(error)) return null
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  if (error instanceof S3ServiceException) {
    if (error.name === 'NotFound' || error.name === 'NoSuchBucket') return true
    return error.$metadata?.httpStatusCode === 404
  }
  return false
}

function isAlreadyExists(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === 'BucketAlreadyExists' || error.name === 'BucketAlreadyOwnedByYou')
  )
}

function isNoSuchKey(error: unknown): boolean {
  return error instanceof S3ServiceException && error.name === 'NoSuchKey'
}
