import 'server-only'
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { bucketName, buildBaseCorpusStorageKey, presignForBackend, s3Client } from '@/lib/s3'

const BASE_CORPUS_UPLOAD_EXPIRES_SECONDS = 3600

export async function presignBaseCorpusUpload(
  fileName: string
): Promise<{ uploadUrl: string; storageKey: string }> {
  const storageKey = buildBaseCorpusStorageKey(fileName)
  const uploadUrl = await presignForBackend(
    new PutObjectCommand({ Bucket: bucketName, Key: storageKey, ContentType: 'application/pdf' }),
    BASE_CORPUS_UPLOAD_EXPIRES_SECONDS
  )
  return { uploadUrl, storageKey }
}

export async function deleteBaseCorpusObject(fileName: string): Promise<{ deleted: true }> {
  const storageKey = buildBaseCorpusStorageKey(fileName)
  await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: storageKey }))
  return { deleted: true }
}
