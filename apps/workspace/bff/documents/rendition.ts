import 'server-only'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { buildRenditionStorageKey, s3Client, storageKeySegment } from '@/lib/s3'
import { NotFoundError } from '@/lib/api/errors'
import { getBackendUrl } from '@/lib/backend-url'
import { InternalServiceUnavailableError, internalServiceHeaders } from '@/lib/internal-auth'
import { isDrawingRenditionSource } from './preview-types'

export { isIndexedFromRendition as extractsFromRendition } from './preview-types'

const GOTENBERG_TIMEOUT_MS = 120_000

const DEFAULT_MAX_CONCURRENCY = 2

const FAILURE_MEMORY_MS = 5 * 60_000

const FAILURE_MEMORY_MAX_ENTRIES = 1_000

export class RenditionUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenditionUnavailableError'
  }
}

export class RenditionFailedError extends Error {
  readonly refusedFile: boolean

  constructor(message: string, options?: { cause?: unknown; refusedFile?: boolean }) {
    super(message, options)
    this.name = 'RenditionFailedError'
    this.refusedFile = options?.refusedFile ?? false
  }
}

function gotenbergUrl(): string | null {
  const raw = process.env.GOTENBERG_URL?.trim()
  return raw ? raw.replace(/\/+$/, '') : null
}

export function isRenditionEnabled(): boolean {
  return gotenbergUrl() !== null
}

export function isRenditionEnabledFor(file: { contentType?: string | null; filename?: string | null }): boolean {
  return isDrawingRenditionSource(file) || isRenditionEnabled()
}

type Converter = { kind: 'office'; baseUrl: string } | { kind: 'drawing' }

export const DXF_RENDITION_PATH = '/v1/renditions/dxf'

function converterFor(input: EnsureRenditionInput): Converter {
  if (isDrawingRenditionSource({ contentType: input.contentType, filename: input.filename })) return { kind: 'drawing' }
  const baseUrl = gotenbergUrl()
  if (!baseUrl) throw new RenditionUnavailableError('Office conversion is not configured (GOTENBERG_URL)')
  return { kind: 'office', baseUrl }
}

export interface EnsureRenditionOptions {
  readerWaitMs?: number
}

export interface EnsureRenditionInput {
  bucket: string
  storageKey: string
  filename: string
  contentType?: string | null
}

const inFlight = new Map<string, Promise<string>>()

const recentFailures = new Map<string, number>()

export async function ensureRendition(
  input: EnsureRenditionInput,
  options: EnsureRenditionOptions = {},
): Promise<string> {
  const converter = converterFor(input)
  const renditionKey = buildRenditionStorageKey(input.storageKey)
  if (!renditionKey) throw new RenditionUnavailableError('Storage key has no directory for a rendition')

  const flightKey = `${input.bucket}\u0000${renditionKey}`
  const reader = options.readerWaitMs !== undefined
  const running = inFlight.get(flightKey)
  if (running) {
    if (reader) promote(flightKey)
    return reader ? within(running, options.readerWaitMs ?? 0) : running
  }

  if (reader && failedRecently(flightKey)) {
    if (await renditionExists(input.bucket, renditionKey)) return renditionKey
    throw new RenditionFailedError('Office conversion failed recently and is not retried on read')
  }

  const flight = produceRendition(converter, input, renditionKey, flightKey, reader)
    .then(
      (key) => {
        recentFailures.delete(flightKey)
        return key
      },
      (error: unknown) => {
        if (error instanceof RenditionFailedError) rememberFailure(flightKey)
        throw error
      },
    )
    .finally(() => {
      inFlight.delete(flightKey)
    })
  inFlight.set(flightKey, flight)
  return reader ? within(flight, options.readerWaitMs ?? 0) : flight
}

async function produceRendition(
  converter: Converter,
  input: EnsureRenditionInput,
  renditionKey: string,
  flightKey: string,
  urgent: boolean,
): Promise<string> {
  if (await renditionExists(input.bucket, renditionKey)) return renditionKey

  await acquireSlot(flightKey, urgent)
  try {
    const original = await readOriginal(input.bucket, input.storageKey)
    const filename = converterFilename(input.filename, input.storageKey)
    const pdf =
      converter.kind === 'drawing'
        ? await convertDrawing(original, filename)
        : await convert(converter.baseUrl, original, filename)
    await s3Client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: renditionKey,
        Body: pdf,
        ContentType: 'application/pdf',
      }),
    )
    return renditionKey
  } finally {
    releaseSlot()
  }
}

function within(flight: Promise<string>, ms: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new RenditionFailedError(`Office conversion did not finish within ${Math.round(ms / 1000)}s`)),
      ms,
    )
  })
  return Promise.race([flight, deadline]).finally(() => clearTimeout(timer))
}

function failedRecently(flightKey: string): boolean {
  const until = recentFailures.get(flightKey)
  if (until === undefined) return false
  if (until > Date.now()) return true
  recentFailures.delete(flightKey)
  return false
}

function rememberFailure(flightKey: string): void {
  recentFailures.delete(flightKey)
  recentFailures.set(flightKey, Date.now() + FAILURE_MEMORY_MS)
  while (recentFailures.size > FAILURE_MEMORY_MAX_ENTRIES) {
    const oldest = recentFailures.keys().next().value
    if (oldest === undefined) break
    recentFailures.delete(oldest)
  }
}

interface SlotWaiter {
  flightKey: string
  start: () => void
}
let activeConversions = 0
const readerQueue: SlotWaiter[] = []
const backgroundQueue: SlotWaiter[] = []

function maxConcurrency(): number {
  const configured = Number(process.env.GOTENBERG_MAX_CONCURRENCY)
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_CONCURRENCY
}

function acquireSlot(flightKey: string, urgent: boolean): Promise<void> {
  return new Promise((start) => {
    ;(urgent ? readerQueue : backgroundQueue).push({ flightKey, start })
    drainQueue()
  })
}

function releaseSlot(): void {
  activeConversions -= 1
  drainQueue()
}

function drainQueue(): void {
  while (activeConversions < maxConcurrency()) {
    const next = readerQueue.shift() ?? backgroundQueue.shift()
    if (!next) return
    activeConversions += 1
    next.start()
  }
}

function promote(flightKey: string): void {
  const index = backgroundQueue.findIndex((waiter) => waiter.flightKey === flightKey)
  if (index >= 0) readerQueue.push(...backgroundQueue.splice(index, 1))
}

async function renditionExists(bucket: string, key: string): Promise<boolean> {
  try {
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return (head?.ContentLength ?? 0) > 0
  } catch {
    return false
  }
}

async function readOriginal(bucket: string, key: string): Promise<Blob> {
  let bytes: Uint8Array
  try {
    const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!object.Body) throw new Error('empty body')
    bytes = await object.Body.transformToByteArray()
  } catch {
    throw new NotFoundError('File not available')
  }
  const part = bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : Uint8Array.from(bytes)
  return new Blob([part])
}

function converterFilename(filename: string, storageKey: string): string {
  const fromName = filename.split('/').pop()?.trim()
  return storageKeySegment(fromName || storageKey.slice(storageKey.lastIndexOf('/') + 1))
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"

async function pdfFrom(response: Response, converter: string): Promise<Uint8Array> {
  const pdf = new Uint8Array(await response.arrayBuffer())
  if (pdf.byteLength < PDF_MAGIC.length || PDF_MAGIC.some((byte, i) => pdf[i] !== byte)) {
    throw new RenditionFailedError(`${converter} returned something that is not a PDF`)
  }
  return pdf
}

async function convertDrawing(original: Blob, filename: string): Promise<Uint8Array> {
  const backendUrl = getBackendUrl()
  let headers: Record<string, string>
  try {
    headers = internalServiceHeaders(backendUrl)
  } catch (error) {
    if (error instanceof InternalServiceUnavailableError) {
      throw new RenditionUnavailableError('Drawing conversion needs the internal service token')
    }
    throw error
  }
  let response: Response
  try {
    response = await fetch(`${backendUrl}${DXF_RENDITION_PATH}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream', 'x-filename': encodeURIComponent(filename) },
      body: original,
      signal: AbortSignal.timeout(GOTENBERG_TIMEOUT_MS),
    })
  } catch (error) {
    throw new RenditionFailedError('Drawing conversion did not answer', { cause: error })
  }
  if (!response.ok) {
    const refusedFile = response.status === 413 || response.status === 422
    throw new RenditionFailedError(`Drawing conversion answered ${response.status}`, { refusedFile })
  }
  return pdfFrom(response, 'Drawing conversion')
}

async function convert(baseUrl: string, original: Blob, filename: string): Promise<Uint8Array> {
  const form = new FormData()
  form.append('files', original, filename)

  let response: Response
  try {
    response = await fetch(`${baseUrl}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(GOTENBERG_TIMEOUT_MS),
    })
  } catch (error) {
    throw new RenditionFailedError('Office conversion did not answer', { cause: error })
  }
  if (!response.ok) {
    throw new RenditionFailedError(`Office conversion answered ${response.status}`)
  }

  return pdfFrom(response, 'Office conversion')
}
