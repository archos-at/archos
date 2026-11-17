import 'server-only'
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import {
  s3Client,
  buildImageDerivedPrefix,
  buildPageTextPrefix,
  buildRenditionStorageKey,
  buildThumbnailStorageKey,
} from '@/lib/s3'
import { resolveDocumentBucket } from '@/lib/storage/bucket'
import { deleteBimDerivedObjects } from '@/lib/bim/service'
import type { Document } from '@/lib/db/schema/documents'
import { UpstreamError } from '@/lib/api/errors'
import { listDocumentVersionObjects } from './version-repository'

export interface ExternalCleanupResult {
  ok: boolean
  reason?: string
}

export function describeCleanupError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.slice(0, 200)
}

function isAlreadyGone(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return candidate.name === 'NoSuchKey' || candidate.$metadata?.httpStatusCode === 404
}

async function attemptObjectDelete(what: string, run: () => Promise<unknown>): Promise<ExternalCleanupResult> {
  try {
    await run()
    return { ok: true }
  } catch (error) {
    if (isAlreadyGone(error)) return { ok: true }
    return { ok: false, reason: `${what}: ${describeCleanupError(error)}` }
  }
}

type StoredObjectRef = Pick<Document, 'storageKey' | 'storageBucket'>

async function deleteObjectsUnderPrefix(bucket: string, prefix: string): Promise<void> {
  let continuationToken: string | undefined
  do {
    const listed = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    )
    for (const object of listed.Contents ?? []) {
      if (!object.Key) continue
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }))
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined
  } while (continuationToken)
}

function resolveBucket(doc: StoredObjectRef): { bucket: string } | { failure: ExternalCleanupResult } {
  try {
    return { bucket: resolveDocumentBucket(doc.storageBucket) }
  } catch (error) {
    return { failure: { ok: false, reason: `bucket resolution: ${describeCleanupError(error)}` } }
  }
}

export async function deleteDerivedObjects(doc: StoredObjectRef): Promise<ExternalCleanupResult> {
  const storageKey = doc.storageKey
  if (!storageKey) return { ok: true }

  const resolved = resolveBucket(doc)
  if ('failure' in resolved) return resolved.failure

  const thumbKey = buildThumbnailStorageKey(storageKey)
  if (thumbKey) {
    const thumb = await attemptObjectDelete(`thumbnail ${thumbKey}`, () =>
      s3Client.send(new DeleteObjectCommand({ Bucket: resolved.bucket, Key: thumbKey })),
    )
    if (!thumb.ok) return thumb
  }

  const renditionKey = buildRenditionStorageKey(storageKey)
  if (renditionKey) {
    const rendition = await attemptObjectDelete(`rendition ${renditionKey}`, () =>
      s3Client.send(new DeleteObjectCommand({ Bucket: resolved.bucket, Key: renditionKey })),
    )
    if (!rendition.ok) return rendition
  }

  const imagePrefix = buildImageDerivedPrefix(storageKey)
  if (imagePrefix) {
    const images = await attemptObjectDelete(`stored rasters under ${imagePrefix}`, () =>
      deleteObjectsUnderPrefix(resolved.bucket, imagePrefix),
    )
    if (!images.ok) return images
  }

  const textPrefix = buildPageTextPrefix(storageKey)
  if (textPrefix) {
    const text = await attemptObjectDelete(`stored page text under ${textPrefix}`, () =>
      deleteObjectsUnderPrefix(resolved.bucket, textPrefix),
    )
    if (!text.ok) return text
  }

  return attemptObjectDelete(`bim derivatives of ${storageKey}`, () =>
    deleteBimDerivedObjects(storageKey, doc.storageBucket),
  )
}

export async function deleteDocumentObjects(doc: StoredObjectRef): Promise<ExternalCleanupResult> {
  const storageKey = doc.storageKey
  if (!storageKey) return { ok: true }

  const resolved = resolveBucket(doc)
  if ('failure' in resolved) return resolved.failure

  const object = await attemptObjectDelete(`object ${storageKey}`, () =>
    s3Client.send(new DeleteObjectCommand({ Bucket: resolved.bucket, Key: storageKey })),
  )
  if (!object.ok) return object

  return deleteDerivedObjects(doc)
}

export async function eraseDocumentObjectsOrKeepRow(
  doc: Pick<Document, 'id' | 'storageKey' | 'storageBucket'>,
  organizationId: string
): Promise<{ versionsLeft: number }> {
  let versionsLeft = 0
  for (const version of await listDocumentVersionObjects(doc.id, organizationId)) {
    if (version.storageKey === doc.storageKey) continue
    const erased = await deleteDocumentObjects(version).catch(() => ({ ok: false }))
    if (!erased.ok) versionsLeft += 1
  }
  const objects = await deleteDocumentObjects(doc)
  if (objects.ok) return { versionsLeft }
  console.error('[documents] delete aborted, row retained for retry:', doc.id, objects.reason)
  throw new UpstreamError('Deleting the document failed; nothing was removed. Please try again.')
}
