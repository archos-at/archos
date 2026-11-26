import 'server-only'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { presignForBackend, buildImageStorageKey, buildPageTextStorageKey } from '@/lib/s3'
import { resolveDocumentBucket } from '@/lib/storage/bucket'
import { ConflictError } from '@/lib/api/errors'
import {
  findPageTextTarget,
  findReadableStorageKeyById,
  findStorageKeyByIdAndCollection,
  findStorageKeysByCollectionAndFilename,
  type StoredDocumentFile,
} from './repository'

export async function presignDocumentImageUpload(
  documentId: string,
  collectionName: string,
  imageIndex: number,
  organizationId?: string
): Promise<{ uploadUrl: string; storageKey: string } | null> {
  const doc = await findStorageKeyByIdAndCollection(documentId, collectionName, organizationId)
  if (!doc) return null
  const storageKey = buildImageStorageKey(doc.storageKey, imageIndex)
  if (!storageKey) return null
  const uploadUrl = await presignForBackend(
    new PutObjectCommand({
      Bucket: resolveDocumentBucket(doc.storageBucket),
      Key: storageKey,
      ContentType: 'image/jpeg',
    }),
    3600
  )
  return { uploadUrl, storageKey }
}

export async function presignDocumentPageTextUpload(
  documentId: string,
  collectionName: string,
  part: string,
  organizationId?: string
): Promise<{
  uploadUrl: string
  storageKey: string
  storageBucket: string
  documentId: string
  version: number | null
  contentHash: string | null
} | null> {
  const doc = await findPageTextTarget(documentId, collectionName, organizationId)
  if (!doc) return null
  const storageKey = buildPageTextStorageKey(doc.storageKey, part)
  if (!storageKey) return null
  const storageBucket = resolveDocumentBucket(doc.storageBucket)
  const uploadUrl = await presignForBackend(
    new PutObjectCommand({
      Bucket: storageBucket,
      Key: storageKey,
      ContentType: part.endsWith('.json') ? 'application/json' : 'text/markdown; charset=utf-8',
    }),
    3600
  )
  return { uploadUrl, storageKey, storageBucket, documentId, version: doc.version, contentHash: doc.contentHash }
}

const AMBIGUOUS_NAME_REASON = 'ambiguous_name'

async function onlyDocumentNamed(
  collectionName: string,
  filename: string,
  organizationId: string | undefined
): Promise<StoredDocumentFile | null> {
  const rows = await findStorageKeysByCollectionAndFilename(collectionName, filename, organizationId)
  if (rows.length > 1) {
    throw new ConflictError('More than one document in this collection has this name; ask by its document id', {
      reason: AMBIGUOUS_NAME_REASON,
    })
  }
  return rows[0] ?? null
}

function imageOf(
  doc: StoredDocumentFile | null,
  imageIndex: number
): { storageKey: string; storageBucket: string | null; contentType: string } | null {
  if (!doc) return null
  const storageKey = buildImageStorageKey(doc.storageKey, imageIndex)
  if (!storageKey) return null
  return { storageKey, storageBucket: doc.storageBucket, contentType: 'image/jpeg' }
}

export async function findDocumentImageStorageKey(
  collectionName: string,
  filename: string,
  imageIndex: number,
  organizationId?: string
): Promise<{ storageKey: string; storageBucket: string | null; contentType: string } | null> {
  return imageOf(await onlyDocumentNamed(collectionName, filename, organizationId), imageIndex)
}

export async function findDocumentImageStorageKeyById(
  collectionName: string,
  documentId: string,
  imageIndex: number,
  organizationId?: string
): Promise<{ storageKey: string; storageBucket: string | null; contentType: string } | null> {
  return imageOf(await findReadableStorageKeyById(documentId, collectionName, organizationId), imageIndex)
}

export async function findDocumentStorageKey(
  collectionName: string,
  filename: string,
  organizationId?: string
): Promise<StoredDocumentFile | null> {
  return onlyDocumentNamed(collectionName, filename, organizationId)
}

export async function findDocumentStorageKeyById(
  collectionName: string,
  documentId: string,
  organizationId?: string
): Promise<StoredDocumentFile | null> {
  return findReadableStorageKeyById(documentId, collectionName, organizationId)
}
