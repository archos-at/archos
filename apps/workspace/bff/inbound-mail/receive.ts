import 'server-only'
import { randomUUID } from 'node:crypto'
import { ApiError, BadRequestError, PayloadTooLargeError, ServiceUnavailableError } from '@/lib/api/errors'
import { BadDigestError, BodyOverlongError, BodyTruncatedError, streamBodyTo } from '@/lib/api/bounded-body'
import { errorResponse } from '@/lib/api/handler'
import { captureServer } from '@/lib/analytics/posthog-server'
import { FEATURE_FLAGS, isFeatureEnabled } from '@/lib/authz/feature-flags'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import type { VerifiedSignature } from '@/lib/internal-auth'
import { enforceLimit } from '@/lib/limits/enforce'
import { configuredPublicSiteOrigin } from '@/lib/public-site'
import {
  INBOUND_MAIL_ADDRESS_LIMIT,
  INBOUND_MAIL_ORGANIZATION_LIMIT,
  INBOUND_MAIL_SIGNING_KEY_LIMIT,
  INBOUND_MAIL_UNKNOWN_ADDRESS_LIMIT,
} from '@/lib/limits/catalog'
import { enabledFlagsForOrganization } from '@/lib/workos/feature-flags'
import { inboundMailDomain, parseInboundAddress } from './address'
import {
  decodeEnvelopeAddress,
  ENVELOPE_FROM_HEADER,
  ENVELOPE_TO_HEADER,
  MAX_RAW_MESSAGE_BYTES,
  rejectText,
  VERDICT_HEADER,
  VERDICT_REJECT,
} from './contract'
import { INBOUND_MAIL_WAIT_DAYS, inboundMailStagingKey } from './inbound-mail-vocabulary'
import { deliveryKey } from './mime'
import {
  completeReception,
  findActiveAddressByToken,
  findMailIdByDeliveryKey,
  forgetReceptionObject,
  insertReception,
  stagedBytes,
  type ResolvedInboundAddress,
} from './repository'
import { eraseStagedObjects, putRawMessage, stagingBucketFor } from './staging'

export const INBOUND_MAIL_ADDRESS_STAGED_BYTES = 1024 * 1024 * 1024

export const INBOUND_MAIL_ORGANIZATION_STAGED_BYTES = 5 * 1024 * 1024 * 1024

const DAY_MS = 24 * 60 * 60 * 1000

export type DeliveryOutcomeCode =
  | 'accepted'
  | 'duplicate'
  | 'unknown_address'
  | 'switched_off'
  | 'too_large'
  | 'rate_limited'
  | 'cap_reached'
  | 'paused'
  | 'bad_envelope'
  | 'misconfigured'
  | 'body_truncated'
  | 'body_overlong'
  | 'bad_digest'
  | 'unavailable'

const REFUSALS: ReadonlySet<DeliveryOutcomeCode> = new Set([
  'unknown_address',
  'switched_off',
  'too_large',
  'rate_limited',
  'cap_reached',
  'paused',
  'bad_envelope',
  'misconfigured',
  'body_truncated',
  'body_overlong',
  'bad_digest',
  'unavailable',
])

export class InboundMailRejectedError extends ApiError {
  constructor(readonly outcome: Extract<DeliveryOutcomeCode, 'unknown_address' | 'switched_off' | 'too_large'>) {
    super(outcome === 'too_large' ? 413 : 404, outcome === 'too_large' ? 'PAYLOAD_TOO_LARGE' : 'NOT_FOUND', rejectText(configuredPublicSiteOrigin()))
    this.name = 'InboundMailRejectedError'
  }
}

class InboundMailRetryError extends ServiceUnavailableError {
  constructor(readonly outcome: Extract<DeliveryOutcomeCode, 'paused' | 'misconfigured' | 'unavailable'>, message: string) {
    super(message, { reason: outcome })
    this.name = 'InboundMailRetryError'
  }
}

class StagedBytesCapError extends ApiError {
  readonly outcome = 'cap_reached' as const
  constructor() {
    super(429, 'RATE_LIMITED', 'Too much mail is waiting for this address', { reason: 'cap-reached' })
    this.name = 'StagedBytesCapError'
  }
}

export function inboundMailPaused(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.INBOUND_MAIL_PAUSED ?? '').trim().toLowerCase() === 'true'
}

interface Trail {
  outcome: DeliveryOutcomeCode
  stage: DeliveryStage
  organizationId: string | null
  addressId: string | null
  mailId: string | null
  bytes: number
  error: string | null
}

export const DELIVERY_STAGES = [
  'envelope',
  'address',
  'feature',
  'limits',
  'bucket',
  'reception',
  'body',
  'complete',
] as const
export type DeliveryStage = (typeof DELIVERY_STAGES)[number]

export interface ReceiveContext {
  request: Request
  signature: VerifiedSignature
}

export async function receiveInboundMail(context: ReceiveContext, now: () => Date = () => new Date()): Promise<Response> {
  const started = Date.now()
  const trail: Trail = {
    outcome: 'unavailable',
    stage: 'envelope',
    organizationId: null,
    addressId: null,
    mailId: null,
    bytes: 0,
    error: null,
  }
  try {
    const answer = await acceptDelivery(context, trail, now)
    return Response.json({ status: answer.outcome }, { status: answer.outcome === 'duplicate' ? 200 : 202 })
  } catch (error) {
    return refusalResponse(error, context.request, trail)
  } finally {
    logDelivery(trail, Date.now() - started)
  }
}

function refusalResponse(error: unknown, request: Request, trail: Trail): Response {
  trail.outcome = outcomeOf(error)
  const known = error instanceof ApiError ? error : new InboundMailRetryError('unavailable', 'Try again later')
  if (!(error instanceof ApiError) || UNEXPLAINED.has(trail.outcome)) trail.error = describeError(error)
  const response = errorResponse(known, request)
  if (known instanceof InboundMailRejectedError) response.headers.set(VERDICT_HEADER, VERDICT_REJECT)
  if (REFUSALS.has(trail.outcome)) {
    captureServer({
      event: 'inbound_mail_refused',
      distinctId: null,
      organizationId: trail.organizationId,
      properties: { reason: trail.outcome, stage: trail.stage, error: trail.error },
    })
  }
  return response
}

function outcomeOf(error: unknown): DeliveryOutcomeCode {
  if (error instanceof InboundMailRejectedError || error instanceof InboundMailRetryError) return error.outcome
  if (error instanceof StagedBytesCapError) return 'cap_reached'
  if (error instanceof BodyTruncatedError) return 'body_truncated'
  if (error instanceof BodyOverlongError) return 'body_overlong'
  if (error instanceof BadDigestError) return 'bad_digest'
  if (error instanceof ApiError && error.status === 429) return 'rate_limited'
  if (error instanceof BadRequestError) return 'bad_envelope'
  if (error instanceof PayloadTooLargeError) return 'too_large'
  return 'unavailable'
}

const UNEXPLAINED: ReadonlySet<DeliveryOutcomeCode> = new Set(['unavailable', 'misconfigured'])

const CAUSE_DEPTH = 4

function errorName(error: unknown): string {
  if (!(error instanceof Error)) return typeof error
  const fields = error as Error & { code?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } }
  const code = typeof fields.code === 'string' ? fields.code : typeof fields.Code === 'string' ? fields.Code : null
  const status = typeof fields.$metadata?.httpStatusCode === 'number' ? fields.$metadata.httpStatusCode : null
  return `${error.name}${code ? `:${code}` : ''}${status ? `:http${status}` : ''}`
}

export function describeError(error: unknown): string {
  const names: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < CAUSE_DEPTH && current !== undefined && current !== null; depth += 1) {
    names.push(errorName(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return names.join(' < ')
}

function logDelivery(trail: Trail, ms: number): void {
  const line =
    `[inbound-mail] delivery outcome=${trail.outcome} stage=${trail.stage} org=${trail.organizationId ?? '-'} ` +
    `address=${trail.addressId ?? '-'} mail=${trail.mailId ?? '-'} bytes=${trail.bytes} ms=${ms}` +
    (trail.error ? ` error=${trail.error}` : '')
  if (trail.outcome === 'accepted' || trail.outcome === 'duplicate') {
    // oxlint-disable-next-line no-console -- the per-delivery INFO line is the operator's trail
    console.info(line)
  } else if (trail.outcome === 'unavailable' || trail.outcome === 'misconfigured') console.error(line)
  else console.warn(line)
}

interface Envelope {
  token: string
  from: string
}

function readEnvelope(request: Request): Envelope {
  if (inboundMailPaused()) throw new InboundMailRetryError('paused', 'Receiving mail is paused')
  const toHeader = request.headers.get(ENVELOPE_TO_HEADER)
  const fromHeader = request.headers.get(ENVELOPE_FROM_HEADER)
  if (toHeader === null || fromHeader === null) {
    throw new BadRequestError('The envelope headers are missing', { reason: 'bad-envelope' })
  }
  let to: string
  let from: string
  try {
    to = decodeEnvelopeAddress(toHeader)
    from = decodeEnvelopeAddress(fromHeader)
  } catch {
    throw new BadRequestError('An envelope header is not encoded as agreed', { reason: 'bad-envelope' })
  }
  const domain = inboundMailDomain()
  if (!domain) throw new InboundMailRetryError('misconfigured', 'This deployment receives no mail')
  const recipient = parseInboundAddress(to, domain)
  if (recipient.kind === 'foreign') throw new InboundMailRetryError('misconfigured', 'The recipient is not in our domain')
  if (recipient.kind === 'malformed') throw new UnknownTokenError()
  return { token: recipient.token, from }
}

class UnknownTokenError extends Error {}

async function acceptDelivery(
  { request, signature }: ReceiveContext,
  trail: Trail,
  now: () => Date,
): Promise<{ outcome: 'accepted' | 'duplicate' }> {
  let address: ResolvedInboundAddress | null = null
  let envelope: Envelope | null = null
  try {
    envelope = readEnvelope(request)
    trail.stage = 'address'
    const token = envelope.token
    address = await withPlatformAccess('inbound mail: the address token names the project before any organization is known', () =>
      findActiveAddressByToken(token),
    )
  } catch (error) {
    if (!(error instanceof UnknownTokenError)) throw error
  }
  if (!address || !envelope) {
    await enforceLimit(INBOUND_MAIL_UNKNOWN_ADDRESS_LIMIT, `keyid:${signature.keyId}`)
    throw new InboundMailRejectedError('unknown_address')
  }
  const resolved = address
  const sender = envelope.from
  trail.organizationId = resolved.organizationId
  trail.addressId = resolved.addressId
  return withTenant({ organizationId: resolved.organizationId }, () => acceptForAddress(request, signature, resolved, sender, trail, now))
}

async function acceptForAddress(
  request: Request,
  signature: VerifiedSignature,
  address: ResolvedInboundAddress,
  envelopeFrom: string,
  trail: Trail,
  now: () => Date,
): Promise<{ outcome: 'accepted' | 'duplicate' }> {
  trail.stage = 'feature'
  await requireFeature(address.organizationId)
  const length = signature.contentLength
  trail.stage = 'limits'
  if (length > MAX_RAW_MESSAGE_BYTES) throw new InboundMailRejectedError('too_large')
  await enforceInboundLimits(signature, address, length)

  const mailId = randomUUID()
  trail.mailId = mailId
  trail.bytes = length
  const owner = { organizationId: address.organizationId, projectId: address.projectId }
  trail.stage = 'bucket'
  const bucket = await stagingBucketFor(address.organizationId)
  const key = inboundMailStagingKey(owner, mailId, 'raw.eml')
  const receivedAt = now()
  trail.stage = 'reception'
  await insertReception({
    id: mailId,
    ...owner,
    addressId: address.addressId,
    envelopeFrom: envelopeFrom.slice(0, 320),
    rawSizeBytes: length,
    stagingBucket: bucket,
    rawStorageKey: key,
    receivedAt,
    expiresAt: new Date(receivedAt.getTime() + INBOUND_MAIL_WAIT_DAYS * DAY_MS),
  })

  trail.stage = 'body'
  const raw = await stageRawMessage(request, signature, bucket, key, mailId)
  trail.stage = 'complete'
  const delivery = deliveryKey(raw, mailId)
  const held = await findMailIdByDeliveryKey(address.addressId, delivery)
  const outcome = held
    ? 'duplicate'
    : await completeReception({ mailId, ...owner, deliveryKey: delivery, rawSizeBytes: length })
  if (outcome === 'duplicate') {
    await discardReception(bucket, key, mailId)
    trail.outcome = 'duplicate'
    return { outcome: 'duplicate' }
  }
  trail.outcome = 'accepted'
  return { outcome: 'accepted' }
}

async function requireFeature(organizationId: string): Promise<void> {
  let featureFlags: string[]
  try {
    featureFlags = await enabledFlagsForOrganization(organizationId)
  } catch (cause) {
    const error = new InboundMailRetryError('unavailable', 'The office’s settings could not be read')
    error.cause = cause
    throw error
  }
  if (!isFeatureEnabled({ featureFlags }, FEATURE_FLAGS.inboundMail)) throw new InboundMailRejectedError('switched_off')
}

export async function enforceInboundLimits(signature: VerifiedSignature, address: ResolvedInboundAddress, length: number): Promise<void> {
  await enforceLimit(INBOUND_MAIL_ADDRESS_LIMIT, `${address.organizationId}:${address.addressId}`)
  await enforceLimit(INBOUND_MAIL_ORGANIZATION_LIMIT, address.organizationId)
  await enforceLimit(INBOUND_MAIL_SIGNING_KEY_LIMIT, `keyid:${signature.keyId}`)
  const staged = await stagedBytes(address.organizationId, address.addressId)
  if (staged.address + length > INBOUND_MAIL_ADDRESS_STAGED_BYTES) throw new StagedBytesCapError()
  if (staged.organization + length > INBOUND_MAIL_ORGANIZATION_STAGED_BYTES) throw new StagedBytesCapError()
}

async function stageRawMessage(
  request: Request,
  signature: VerifiedSignature,
  bucket: string,
  key: string,
  mailId: string,
): Promise<Uint8Array> {
  const length = signature.contentLength
  try {
    return await streamBodyTo(
      request,
      { expectedLength: length, maxBytes: MAX_RAW_MESSAGE_BYTES, contentDigest: signature.contentDigest },
      async (body) => {
        const [toStore, toKeep] = body.tee()
        const [, bytes] = await Promise.all([storeRaw(bucket, key, toStore, length), collect(toKeep, length)])
        return bytes
      },
    )
  } catch (error) {
    await discardReception(bucket, key, mailId)
    throw error
  }
}

async function storeRaw(bucket: string, key: string, body: ReadableStream<Uint8Array>, length: number): Promise<void> {
  try {
    await putRawMessage(bucket, key, body, length)
  } catch (error) {
    if (error instanceof ApiError) throw error
    const refusal = new InboundMailRetryError('unavailable', 'Object storage is unavailable')
    refusal.cause = error
    throw refusal
  }
}

async function collect(body: ReadableStream<Uint8Array>, length: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(length)
  let offset = 0
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return offset === length ? bytes : bytes.subarray(0, offset)
    bytes.set(value.subarray(0, Math.max(0, length - offset)), offset)
    offset += value.byteLength
  }
}

async function discardReception(bucket: string, key: string, mailId: string): Promise<void> {
  try {
    const left = await eraseStagedObjects(bucket, [key])
    if (left.length === 0) await forgetReceptionObject(mailId)
  } catch (error) {
    console.warn(`[inbound-mail] reception ${mailId} left for the sweep: ${errorName(error)}`)
  }
}
