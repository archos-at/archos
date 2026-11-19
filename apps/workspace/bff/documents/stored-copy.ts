import 'server-only'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { NotFoundError } from '@/lib/api/errors'
import type { Document } from '@/lib/db/schema/documents'
import { s3Client } from '@/lib/s3'
import { resolveDocumentBucket } from '@/lib/storage/bucket'

export async function storedFileOf(
  document: Pick<Document, 'storageBucket' | 'storageKey' | 'contentType'>,
  name: string
): Promise<File> {
  const object = await s3Client.send(
    new GetObjectCommand({ Bucket: resolveDocumentBucket(document.storageBucket), Key: document.storageKey })
  )
  const bytes = await object.Body?.transformToByteArray()
  if (!bytes) throw new NotFoundError('The file’s stored bytes could not be read.')
  return new File([new Uint8Array(bytes)], name, { type: document.contentType ?? object.ContentType ?? 'application/octet-stream' })
}
