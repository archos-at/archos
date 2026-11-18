import 'server-only'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { s3Client } from '@/lib/s3'

export async function discardObject(bucket: string, storageKey: string): Promise<void> {
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }))
  } catch (error) {
    console.error(
      '[storage] failed to remove an object nothing references',
      { bucket, storageKey, cause: error instanceof Error ? error.name : 'unknown' },
    )
  }
}
