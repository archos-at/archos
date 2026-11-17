import 'server-only'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { ServiceUnavailableError } from '@/lib/api/errors'
import { bucketAdminS3Client, presignForBackend, s3Client } from '@/lib/s3'
import { ensureTenantBucketChecked } from '@/lib/storage/bucket'

export const RAW_MESSAGE_CONTENT_TYPE = 'message/rfc822'

export const READ_URL_TTL_SECONDS = 15 * 60

export async function stagingBucketFor(organizationId: string): Promise<string> {
  try {
    return await ensureTenantBucketChecked(bucketAdminS3Client, organizationId)
  } catch (cause) {
    const error = new ServiceUnavailableError('Object storage is unavailable', { reason: 'storage-unavailable' })
    error.cause = cause
    throw error
  }
}

export async function putRawMessage(bucket: string, key: string, body: ReadableStream<Uint8Array>, length: number): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
      ContentLength: length,
      ContentType: RAW_MESSAGE_CONTENT_TYPE,
    }),
  )
}

export async function putStagedObject(bucket: string, key: string, body: Uint8Array, contentType: string): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentLength: body.byteLength, ContentType: contentType }),
  )
}

export async function readStagedObject(bucket: string, key: string): Promise<Uint8Array> {
  const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const bytes = await object.Body?.transformToByteArray()
  if (!bytes) throw new Error(`staged object ${key} has no body`)
  return bytes
}

export async function streamStagedObject(bucket: string, key: string): Promise<AsyncIterable<Uint8Array>> {
  const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const body = object.Body
  if (!body) throw new Error(`staged object ${key} has no body`)
  return body as unknown as AsyncIterable<Uint8Array>
}

export function stagedObjectUrlForBackend(bucket: string, key: string): Promise<string> {
  return presignForBackend(new GetObjectCommand({ Bucket: bucket, Key: key }), READ_URL_TTL_SECONDS)
}

function isAlreadyGone(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return candidate.name === 'NoSuchKey' || candidate.$metadata?.httpStatusCode === 404
}

export async function eraseStagedObjects(bucket: string, keys: readonly string[]): Promise<string[]> {
  const remaining: string[] = []
  for (const key of keys) {
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    } catch (error) {
      if (!isAlreadyGone(error)) remaining.push(key)
    }
  }
  return remaining
}
