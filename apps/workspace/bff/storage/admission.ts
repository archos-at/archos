import 'server-only'
import type { NewDocument } from '@/lib/db/schema/documents'
import { discardObject } from './discard'
import { admitDocumentWithinQuota, admitReplacementWithinQuota } from './service'

export async function admitOrDiscard(
  bucket: string,
  storageKey: string,
  values: NewDocument,
): Promise<void> {
  try {
    await admitDocumentWithinQuota(values)
  } catch (error) {
    await discardObject(bucket, storageKey)
    throw error
  }
}

export async function admitReplacementOrDiscard(
  bucket: string,
  storageKey: string,
  organizationId: string,
  documentId: string,
  next: {
    storageKey: string
    storageBucket: string | null
    fileSize: number
    contentType: string | null
    contentHash: string | null
    folderId: string | null
    createdBy: string
    uploadBatchId?: string | null
  },
): Promise<void> {
  try {
    await admitReplacementWithinQuota(organizationId, documentId, next)
  } catch (error) {
    await discardObject(bucket, storageKey)
    throw error
  }
}
