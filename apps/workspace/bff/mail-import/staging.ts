import 'server-only'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
  type Part,
} from '@aws-sdk/client-s3'
import { bucketAdminS3Client, presignForBackend, s3Client } from '@/lib/s3'
import { ensureTenantBucketChecked } from '@/lib/storage/bucket'
import { ARCHIVE_URL_TTL_SECONDS, MAX_MULTIPART_PARTS } from './config'

export interface StagedArchive {
  bucket: string
  key: string
}

export interface UploadedPart {
  partNumber: number
  size: number
  etag: string
}

export function stagingKey(organizationId: string, projectId: string, importId: string): string {
  return `org/${organizationId}/project/${projectId}/mail-imports/${importId}/archive`
}

export function stagingBucket(organizationId: string): Promise<string> {
  return ensureTenantBucketChecked(bucketAdminS3Client, organizationId)
}

export async function beginStagedUpload(staged: StagedArchive): Promise<string> {
  const { bucket, key } = staged
  const created = await s3Client.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: 'application/vnd.ms-outlook' }),
  )
  if (!created.UploadId) throw new Error('object storage started no multipart upload')
  return created.UploadId
}

export async function stagedArchiveSize(staged: StagedArchive): Promise<number | null> {
  try {
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: staged.bucket, Key: staged.key }))
    return head.ContentLength ?? null
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode
    if (status === 404 || (error as { name?: string } | null)?.name === 'NotFound') return null
    throw error
  }
}

export async function putStagedPart(
  staged: StagedArchive,
  uploadId: string,
  partNumber: number,
  body: Uint8Array,
): Promise<void> {
  await s3Client.send(
    new UploadPartCommand({
      Bucket: staged.bucket,
      Key: staged.key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
      ContentLength: body.byteLength,
    }),
  )
}

export async function listStagedParts(staged: StagedArchive, uploadId: string): Promise<UploadedPart[]> {
  const parts: UploadedPart[] = []
  let marker: string | undefined
  do {
    const page = await s3Client.send(
      new ListPartsCommand({ Bucket: staged.bucket, Key: staged.key, UploadId: uploadId, PartNumberMarker: marker }),
    )
    for (const part of page.Parts ?? []) parts.push(toUploadedPart(part))
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined
  } while (marker && parts.length < MAX_MULTIPART_PARTS)
  return parts.sort((a, b) => a.partNumber - b.partNumber)
}

export async function completeStagedUpload(
  staged: StagedArchive,
  uploadId: string,
  parts: readonly UploadedPart[],
): Promise<void> {
  await s3Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: staged.bucket,
      Key: staged.key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) },
    }),
  )
}

export async function abortStagedUpload(staged: StagedArchive, uploadId: string): Promise<void> {
  try {
    await s3Client.send(
      new AbortMultipartUploadCommand({ Bucket: staged.bucket, Key: staged.key, UploadId: uploadId }),
    )
  } catch (error) {
    if (!isNoSuchUpload(error)) throw error
  }
}

export async function deleteStagedArchive(staged: StagedArchive): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: staged.bucket, Key: staged.key }))
}

export function archiveUrlForBackend(staged: StagedArchive): Promise<string> {
  return presignForBackend(new GetObjectCommand({ Bucket: staged.bucket, Key: staged.key }), ARCHIVE_URL_TTL_SECONDS)
}

function toUploadedPart(part: Part): UploadedPart {
  return { partNumber: part.PartNumber ?? 0, size: part.Size ?? 0, etag: part.ETag ?? '' }
}

export function isNoSuchUpload(error: unknown): boolean {
  const name = (error as { name?: string; Code?: string } | null)?.name
  const code = (error as { Code?: string } | null)?.Code
  return name === 'NoSuchUpload' || code === 'NoSuchUpload'
}
