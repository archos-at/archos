import 'server-only'
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { s3Client } from '@/lib/s3'
import { resolveDocumentBucket } from '@/lib/storage/bucket'
import { completeBimModel, failBimModel, startBimModel } from './extraction-repository'
import { IfcArchiveError, unwrapIfcArchive } from './ifc-archive'
import { isIfcFilename, maxIfcBytesFrom } from './types'

export const MAX_IFC_BYTES = maxIfcBytesFrom(process.env)

const CONFIGURED_ELEMENT_LIMIT = Number(process.env.BIM_ELEMENT_LIMIT)
export const BIM_ELEMENT_LIMIT =
  Number.isFinite(CONFIGURED_ELEMENT_LIMIT) && CONFIGURED_ELEMENT_LIMIT > 0
    ? Math.trunc(CONFIGURED_ELEMENT_LIMIT)
    : 200_000

const DERIVED_SEGMENT = '_bim'

export { isIfcFilename }

export function buildBimDerivedKeys(storageKey: string): {
  prefix: string
  digestKey: string
  indexKey: string
  sourceKey: string
} | null {
  const index = storageKey.lastIndexOf('/')
  if (index <= 0 || index === storageKey.length - 1) return null
  const directory = storageKey.slice(0, index)
  const filename = storageKey.slice(index + 1)
  const prefix = `${directory}/${DERIVED_SEGMENT}/`
  return {
    prefix,
    digestKey: `${prefix}${filename}`,
    indexKey: `${prefix}index.json`,
    sourceKey: `${prefix}source.ifc.gz`,
  }
}

async function writeCompressedSource(
  bucket: string,
  key: string,
  buffer: Uint8Array
): Promise<void> {
  try {
    const { gzip } = await import('node:zlib')
    const { promisify } = await import('node:util')
    const compressed = await promisify(gzip)(buffer)
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: compressed,
        ContentType: 'application/octet-stream',
        ContentEncoding: 'gzip',
        Metadata: { 'uncompressed-length': String(buffer.byteLength) },
      })
    )
  } catch {
    // slower and completely correct.
  }
}

export interface BimExtractionInput {
  organizationId: string
  projectId: string | null
  documentId: string
  filename: string
  storageKey: string
  storageBucket: string | null
  dispatchDigest: (digestStorageKey: string) => Promise<unknown>
}

export interface BimExtractionOutcome {
  modelId: string
  status: 'ready' | 'failed' | 'superseded'
  elementCount: number
  error?: string
}

async function fetchObject(bucket: string, key: string): Promise<ArrayBuffer> {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const declared = response.ContentLength
  if (typeof declared === 'number' && declared > MAX_IFC_BYTES) {
    throw new IfcTooLargeError(declared)
  }
  const bytes = await response.Body?.transformToByteArray()
  if (!bytes) throw new Error('object body was empty')
  if (bytes.byteLength > MAX_IFC_BYTES) throw new IfcTooLargeError(bytes.byteLength)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

class IfcTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(
      `Model is ${Math.round(bytes / 1024 / 1024)} MB, above the ` +
        `${Math.round(MAX_IFC_BYTES / 1024 / 1024)} MB extraction limit`
    )
    this.name = 'IfcTooLargeError'
  }
}

export async function runBimExtraction(input: BimExtractionInput): Promise<BimExtractionOutcome> {
  const bucket = resolveDocumentBucket(input.storageBucket)
  const run = await startBimModel({
    organizationId: input.organizationId,
    projectId: input.projectId,
    documentId: input.documentId,
  })
  const { modelId } = run

  const { extractIfcModel, IfcExtractionError } = await import('./extract')
  const { buildModelDigest } = await import('./digest')

  try {
    let buffer: ArrayBuffer
    try {
      buffer = await fetchObject(bucket, input.storageKey)
    } catch (error) {
      if (error instanceof IfcTooLargeError) {
        throw new IfcExtractionError('parse-failed', error.message)
      }
      throw error
    }

    const { bytes: source } = await unwrapIfcArchive(buffer, MAX_IFC_BYTES)

    const index = await extractIfcModel(source, input.filename, { elementLimit: BIM_ELEMENT_LIMIT })
    const { elements, ...summary } = index
    const keys = buildBimDerivedKeys(input.storageKey)

    let indexKey: string | null = null
    let digestKey: string | null = null
    if (keys) {
      const digest = buildModelDigest(summary, elements, { filename: input.filename })
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keys.indexKey,
          Body: Buffer.from(JSON.stringify(index)),
          ContentType: 'application/json',
        })
      )
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keys.digestKey,
          Body: Buffer.from(digest, 'utf8'),
          ContentType: 'text/markdown; charset=utf-8',
        })
      )
      await writeCompressedSource(bucket, keys.sourceKey, new Uint8Array(source))
      indexKey = keys.indexKey
      digestKey = keys.digestKey
    }

    const landed = await completeBimModel({
      run,
      organizationId: input.organizationId,
      summary,
      elements,
      indexStorageKey: indexKey,
      indexStorageBucket: input.storageBucket,
    })
    if (!landed) return { modelId, status: 'superseded', elementCount: 0 }

    if (digestKey) {
      await input.dispatchDigest(digestKey).catch(() => undefined)
    }

    return { modelId, status: 'ready', elementCount: elements.length }
  } catch (error) {
    const reason =
      error instanceof IfcArchiveError
        ? `Das IFC-Archiv konnte nicht verarbeitet werden: ${error.message}`
        : error instanceof IfcExtractionError
          ? error.code === 'not-ifc'
            ? 'Die Datei ist keine gültige IFC-Datei (STEP/ISO-10303-21).'
            : `Das IFC-Modell konnte nicht gelesen werden: ${error.message}`
          : 'Das IFC-Modell konnte nicht verarbeitet werden.'
    const landed = await failBimModel(run, input.organizationId, reason).catch(() => undefined)
    if (landed === false) return { modelId, status: 'superseded', elementCount: 0 }
    return { modelId, status: 'failed', elementCount: 0, error: reason }
  }
}

export async function deleteBimDerivedObjects(
  storageKey: string,
  storageBucket: string | null
): Promise<void> {
  const keys = buildBimDerivedKeys(storageKey)
  if (!keys) return
  const bucket = resolveDocumentBucket(storageBucket)

  let continuationToken: string | undefined
  do {
    const listed = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: keys.prefix,
        ContinuationToken: continuationToken,
      })
    )
    for (const object of listed.Contents ?? []) {
      if (!object.Key) continue
      await s3Client
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }))
        .catch(() => undefined)
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined
  } while (continuationToken)
}
