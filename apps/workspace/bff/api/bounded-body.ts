import { createHash, timingSafeEqual } from 'node:crypto'
import { parseDictionary } from 'structured-headers'
import { ApiError, BadRequestError, PayloadTooLargeError, ServiceUnavailableError } from './errors'

export interface BodyExpectation {
  readonly expectedLength: number
  readonly maxBytes: number
  readonly contentDigest?: string
}

export type BodyRefusal = 'body-truncated' | 'body-overlong' | 'bad-digest'

export class BodyTruncatedError extends ServiceUnavailableError {
  readonly reason = 'body-truncated' satisfies BodyRefusal
  constructor(expected: number, received: number) {
    super('Request body is shorter than its declared length', { reason: 'body-truncated', expected, received })
  }
}

export class BodyOverlongError extends BadRequestError {
  readonly reason = 'body-overlong' satisfies BodyRefusal
  constructor(expected: number) {
    super('Request body is longer than its declared length', { reason: 'body-overlong', expected })
  }
}

export class BadDigestError extends ApiError {
  readonly reason = 'bad-digest' satisfies BodyRefusal
  constructor(why: string) {
    super(401, 'UNAUTHORIZED', `Content-Digest ${why}`, { reason: 'bad-digest' })
  }
}

const DIGEST_ALGORITHMS = { 'sha-256': 'sha256', 'sha-512': 'sha512' } as const
type DigestAlgorithm = keyof typeof DIGEST_ALGORITHMS

function isDigestAlgorithm(name: string): name is DigestAlgorithm {
  return Object.hasOwn(DIGEST_ALGORITHMS, name)
}

export function declaredContentLength(request: Request): number {
  const raw = request.headers.get('content-length')
  if (raw === null) throw new ApiError(411, 'LENGTH_REQUIRED', 'Content-Length is required')
  if (!/^\d{1,15}$/.test(raw)) throw new BadRequestError('Content-Length is not a number')
  return Number(raw)
}

export async function readBoundedBody(request: Request, expectation: BodyExpectation): Promise<Uint8Array> {
  return streamBodyTo(request, expectation, async (body) => {
    const bytes = new Uint8Array(expectation.expectedLength)
    const reader = body.getReader()
    let offset = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return bytes
      bytes.set(value, offset)
      offset += value.byteLength
    }
  })
}

export async function streamBodyTo<T>(
  request: Request,
  expectation: BodyExpectation,
  consume: (body: ReadableStream<Uint8Array>) => Promise<T>,
): Promise<T> {
  const { expectedLength, maxBytes } = expectation
  if (expectedLength > maxBytes) throw new PayloadTooLargeError(maxBytes)
  const hashes = expectation.contentDigest === undefined ? null : digestHashes(expectation.contentDigest)
  const meter = new BodyMeter(expectedLength, hashes)
  const source = request.body ?? new ReadableStream<Uint8Array>({ start: (controller) => controller.close() })
  const checked = source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        meter.add(chunk)
        controller.enqueue(chunk)
      },
      flush: () => meter.finish(),
    }),
  )
  let result: T
  try {
    result = await consume(checked)
  } catch (error) {
    throw meter.refusal ?? error
  }
  if (meter.refusal) throw meter.refusal
  if (!meter.finished) throw new Error('streamBodyTo: the consumer returned before reading the whole body')
  return result
}

class BodyMeter {
  received = 0
  finished = false
  refusal: ApiError | null = null

  constructor(
    private readonly expectedLength: number,
    private readonly hashes: ReadonlyMap<DigestAlgorithm, { expected: Buffer; hash: ReturnType<typeof createHash> }> | null,
  ) {}

  add(chunk: Uint8Array): void {
    this.received += chunk.byteLength
    if (this.received > this.expectedLength) this.refuse(new BodyOverlongError(this.expectedLength))
    for (const { hash } of this.hashes?.values() ?? []) hash.update(chunk)
  }

  finish(): void {
    this.finished = true
    if (this.received < this.expectedLength) this.refuse(new BodyTruncatedError(this.expectedLength, this.received))
    for (const { expected, hash } of this.hashes?.values() ?? []) {
      const actual = hash.digest()
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        this.refuse(new BadDigestError('does not match the body'))
      }
    }
  }

  private refuse(error: ApiError): never {
    this.refusal ??= error
    throw this.refusal
  }
}

function digestHashes(
  contentDigest: string,
): Map<DigestAlgorithm, { expected: Buffer; hash: ReturnType<typeof createHash> }> {
  let dictionary: ReturnType<typeof parseDictionary>
  try {
    dictionary = parseDictionary(contentDigest)
  } catch {
    throw new BadDigestError('is not a structured dictionary')
  }
  const hashes = new Map<DigestAlgorithm, { expected: Buffer; hash: ReturnType<typeof createHash> }>()
  for (const [name, member] of dictionary) {
    if (!isDigestAlgorithm(name)) continue
    const value = member[0]
    if (!(value instanceof ArrayBuffer)) throw new BadDigestError(`${name} is not a byte sequence`)
    hashes.set(name, { expected: Buffer.from(value), hash: createHash(DIGEST_ALGORITHMS[name]) })
  }
  if (hashes.size === 0) throw new BadDigestError('names no supported algorithm (sha-256, sha-512)')
  return hashes
}
