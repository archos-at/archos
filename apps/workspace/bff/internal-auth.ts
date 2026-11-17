import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createVerifier, ExpiredError, httpbis, type VerifyingKey } from 'http-message-signatures'
import { isInnerList, parseDictionary, Token, type BareItem } from 'structured-headers'
import { ApiError, ServiceUnavailableError } from '@/lib/api/errors'
import { configuredAppOrigin } from '@/lib/app-origin'
import { readHeader } from '@/lib/http/legacy-header-names'

export const INTERNAL_TOKEN_HEADER = 'x-internal-token'

export type InternalTokenEnv = 'INTERNAL_API_TOKEN' | 'CORPUS_EXPORT_TOKEN' | 'PLATFORM_MCP_ADMISSION_TOKEN'

const DEV_DEFAULT_TOKEN = 'grid-internal-dev-token'
const DEV_APP_ENVS = new Set(['development', 'dev', 'local'])

function tokensMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function isDevEnvironment(): boolean {
  const env = (process.env.APP_ENV ?? process.env.NODE_ENV ?? 'production').toLowerCase()
  return DEV_APP_ENVS.has(env)
}

export function usableInternalSecret(tokenEnv: InternalTokenEnv = 'INTERNAL_API_TOKEN'): string | null {
  const secret = process.env[tokenEnv]
  if (!secret) return null
  if (secret === DEV_DEFAULT_TOKEN && !isDevEnvironment()) return null
  return secret
}

export function requireInternalToken(
  request: Request,
  label: string,
  tokenEnv: InternalTokenEnv = 'INTERNAL_API_TOKEN'
): Response | null {
  const expectedToken = process.env[tokenEnv]
  if (!expectedToken) {
    console.error(`[${label}] ${tokenEnv} is not configured — rejecting`)
    return NextResponse.json({ error: 'Internal API disabled' }, { status: 503 })
  }
  if (expectedToken === DEV_DEFAULT_TOKEN && !isDevEnvironment()) {
    console.error(
      `[${label}] ${tokenEnv} is the well-known dev default in a non-dev environment — refusing to serve.`,
    )
    return NextResponse.json({ error: 'Internal API disabled' }, { status: 503 })
  }
  if (!tokensMatch(readHeader(request.headers, INTERNAL_TOKEN_HEADER), expectedToken)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

export function isTokenSafeDestination(baseUrl: string): boolean {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true
  if (host.endsWith('.internal') || host.endsWith('.local')) return true
  if (!host.includes('.') && !host.includes(':')) return true

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 127 || a === 10) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true
  return false
}

export class InternalServiceUnavailableError extends ServiceUnavailableError {
  constructor(
    readonly reason: 'token_missing' | 'unsafe_destination',
    message: string
  ) {
    super(message, { reason })
    this.name = 'InternalServiceUnavailableError'
  }
}

export function internalServiceHeaders(destination: string): Record<string, string> {
  const token = process.env.INTERNAL_API_TOKEN
  if (!token) {
    throw new InternalServiceUnavailableError('token_missing', 'INTERNAL_API_TOKEN is not configured')
  }
  if (!isTokenSafeDestination(destination)) {
    throw new InternalServiceUnavailableError(
      'unsafe_destination',
      'Withholding the internal token: the backend URL is plain HTTP to a non-internal host'
    )
  }
  return { [INTERNAL_TOKEN_HEADER]: token }
}

export type SigningKeysEnv = 'INBOUND_MAIL_SIGNING_KEYS'

export const SIGNATURE_ALGORITHM = 'hmac-sha256'

export const REQUIRED_COVERED_COMPONENTS = ['@method', '@target-uri', 'content-digest', 'content-length'] as const

export const MAX_SIGNATURE_LIFETIME_S = 300

export const MAX_CLOCK_SKEW_S = 30

export const MAX_SIGNING_KEYS = 2

export const MIN_SIGNING_SECRET_BYTES = 32

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

export const DEV_DEFAULT_SIGNING_SECRET = Buffer.from('internal-dev-signing-secret-0032').toString('base64')

export type SignatureRefusal =
  | 'unsigned'
  | 'malformed'
  | 'expired'
  | 'unknown-key'
  | 'bad-signature'

export interface VerifiedSignature {
  readonly keyId: string
  readonly created: Date
  readonly expires: Date
  readonly contentLength: number
  readonly contentDigest: string
}

export interface SignatureRequirement {
  readonly keysEnv: SigningKeysEnv
  readonly components?: readonly string[]
}

export class SignatureRefusedError extends ApiError {
  constructor(readonly reason: SignatureRefusal) {
    super(401, 'UNAUTHORIZED', 'Request signature refused', { reason })
  }
}

export function usableSigningKeys(keysEnv: SigningKeysEnv, label: string): ReadonlyMap<string, Buffer> | null {
  const raw = process.env[keysEnv]
  if (!raw) return disabled(label, `${keysEnv} is not configured`)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return disabled(label, `${keysEnv} is not JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return disabled(label, `${keysEnv} is not an object of keyid to secret`)
  }
  const entries = Object.entries(parsed)
  if (entries.length === 0 || entries.length > MAX_SIGNING_KEYS) {
    return disabled(label, `${keysEnv} holds ${entries.length} keys; 1 or ${MAX_SIGNING_KEYS} are accepted`)
  }
  const keys = new Map<string, Buffer>()
  for (const [keyId, secret] of entries) {
    const problem = signingKeyProblem(keyId, secret)
    if (problem) return disabled(label, `${keysEnv} key ${KEY_ID_PATTERN.test(keyId) ? keyId : '(invalid id)'}: ${problem}`)
    keys.set(keyId, Buffer.from(secret as string, 'base64'))
  }
  return keys
}

function signingKeyProblem(keyId: string, secret: unknown): string | null {
  if (!KEY_ID_PATTERN.test(keyId)) return 'the keyid must match [A-Za-z0-9._-]{1,64}'
  if (typeof secret !== 'string' || !BASE64_PATTERN.test(secret)) return 'the secret must be base64'
  if (Buffer.from(secret, 'base64').length < MIN_SIGNING_SECRET_BYTES) {
    return `the secret must be at least ${MIN_SIGNING_SECRET_BYTES} bytes`
  }
  if (secret === DEV_DEFAULT_SIGNING_SECRET && !isDevEnvironment()) {
    return 'the well-known dev secret is refused outside a dev environment'
  }
  return null
}

function disabled(label: string, why: string): null {
  console.error(`[${label}] signed requests disabled: ${why}`)
  return null
}

export async function requireInternalSignature(
  request: Request,
  label: string,
  requirement: SignatureRequirement,
): Promise<VerifiedSignature> {
  const keys = usableSigningKeys(requirement.keysEnv, label)
  if (!keys) throw new ServiceUnavailableError('Internal API disabled')
  try {
    return await verifySignature(request, keys, requirement)
  } catch (error) {
    if (error instanceof SignatureRefusedError) {
      console.warn(`[${label}] request signature refused reason=${error.reason}`)
    }
    throw error
  }
}

async function verifySignature(
  request: Request,
  keys: ReadonlyMap<string, Buffer>,
  requirement: SignatureRequirement,
): Promise<VerifiedSignature> {
  const signatureInput = request.headers.get('signature-input')
  if (!signatureInput || !request.headers.get('signature')) throw new SignatureRefusedError('unsigned')
  const params = signatureParameters(signatureInput)
  const nowS = Math.floor(Date.now() / 1000)
  if (params.created > nowS + MAX_CLOCK_SKEW_S || params.expires < nowS) throw new SignatureRefusedError('expired')
  const secret = keys.get(params.keyId)
  if (!secret) throw new SignatureRefusedError('unknown-key')

  const contentLength = signedContentLength(request)
  const contentDigest = request.headers.get('content-digest')
  if (contentDigest === null) throw new SignatureRefusedError('malformed')

  const key: VerifyingKey = { id: params.keyId, algs: [SIGNATURE_ALGORITHM], verify: createVerifier(secret, SIGNATURE_ALGORITHM) }
  let verified: boolean | null
  try {
    verified = await httpbis.verifyMessage(
      {
        keyLookup: async ({ keyid }) => (keyid === params.keyId ? key : null),
        requiredParams: ['created', 'expires', 'keyid', 'alg'],
        requiredFields: [...REQUIRED_COVERED_COMPONENTS, ...(requirement.components ?? [])],
        notAfter: nowS + MAX_CLOCK_SKEW_S,
        maxAge: MAX_SIGNATURE_LIFETIME_S + MAX_CLOCK_SKEW_S,
      },
      { method: request.method, url: trustedTargetUri(request), headers: headerRecord(request) },
    )
  } catch (error) {
    throw new SignatureRefusedError(error instanceof ExpiredError ? 'expired' : 'malformed')
  }
  if (verified !== true) throw new SignatureRefusedError('bad-signature')
  return {
    keyId: params.keyId,
    created: new Date(params.created * 1000),
    expires: new Date(params.expires * 1000),
    contentLength,
    contentDigest,
  }
}

interface SignatureParameters {
  readonly keyId: string
  readonly created: number
  readonly expires: number
}

function signatureParameters(signatureInput: string): SignatureParameters {
  let inputs: ReturnType<typeof parseDictionary>
  try {
    inputs = parseDictionary(signatureInput)
  } catch {
    throw new SignatureRefusedError('malformed')
  }
  const [only, ...rest] = [...inputs.values()]
  if (!only || rest.length > 0 || !isInnerList(only)) throw new SignatureRefusedError('malformed')
  const parameters = only[1]
  const keyId = parameters.get('keyid')
  const created = parameters.get('created')
  const expires = parameters.get('expires')
  if (typeof keyId !== 'string' || !isInteger(created) || !isInteger(expires)) {
    throw new SignatureRefusedError('malformed')
  }
  if (bareText(parameters.get('alg')) !== SIGNATURE_ALGORITHM) throw new SignatureRefusedError('malformed')
  const lifetime = expires - created
  if (lifetime <= 0 || lifetime > MAX_SIGNATURE_LIFETIME_S) throw new SignatureRefusedError('malformed')
  return { keyId, created, expires }
}

function isInteger(value: BareItem | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function bareText(value: BareItem | undefined): string | null {
  if (typeof value === 'string') return value
  return value instanceof Token ? value.toString() : null
}

function signedContentLength(request: Request): number {
  const raw = request.headers.get('content-length')
  if (raw === null || !/^\d{1,15}$/.test(raw)) throw new SignatureRefusedError('malformed')
  return Number(raw)
}

function trustedTargetUri(request: Request): string {
  const url = new URL(request.url)
  return `${configuredAppOrigin() ?? url.origin}${url.pathname}${url.search}`
}

function headerRecord(request: Request): Record<string, string> {
  return Object.fromEntries(request.headers.entries())
}
