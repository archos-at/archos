import { createHash } from 'node:crypto'
import { createSigner, httpbis } from 'http-message-signatures'
import { serializeDictionary } from 'structured-headers'
import { REQUIRED_COVERED_COMPONENTS, SIGNATURE_ALGORITHM } from '@/lib/internal-auth'

export const TEST_SIGNING_SECRET = Buffer.alloc(32, 7).toString('base64')
export const TEST_KEY_ID = 'test-2026-10'

export interface SignedRequestOptions {
  readonly url: string
  readonly body: Uint8Array | string
  readonly method?: string
  readonly keyId?: string
  readonly secret?: string
  readonly created?: Date
  readonly expires?: Date
  readonly headers?: Record<string, string>
  readonly components?: readonly string[]
  readonly sentBody?: Uint8Array | string
  readonly contentDigest?: string
  readonly contentLength?: string
}

export function contentDigestOf(body: Uint8Array | string, algorithm: 'sha-256' | 'sha-512' = 'sha-256'): string {
  const hash = createHash(algorithm === 'sha-256' ? 'sha256' : 'sha512').update(body).digest()
  return serializeDictionary({ [algorithm]: hash })
}

export async function signedHeaders(options: SignedRequestOptions): Promise<Record<string, string>> {
  const bytes = typeof options.body === 'string' ? Buffer.from(options.body) : options.body
  const created = options.created ?? new Date()
  const headers: Record<string, string> = {
    'content-digest': options.contentDigest ?? contentDigestOf(bytes),
    'content-length': options.contentLength ?? String(bytes.byteLength),
    ...options.headers,
  }
  const components = options.components ?? [...REQUIRED_COVERED_COMPONENTS, ...Object.keys(options.headers ?? {})]
  const signed = await httpbis.signMessage(
    {
      key: createSigner(Buffer.from(options.secret ?? TEST_SIGNING_SECRET, 'base64'), SIGNATURE_ALGORITHM, options.keyId ?? TEST_KEY_ID),
      fields: [...components],
      params: ['created', 'expires', 'keyid', 'alg'],
      paramValues: { created, expires: options.expires ?? new Date(created.getTime() + 300_000) },
    },
    { method: options.method ?? 'POST', url: options.url, headers },
  )
  return Object.fromEntries(Object.entries(signed.headers).map(([name, value]) => [name, String(value)]))
}

export async function signedRequest(options: SignedRequestOptions): Promise<Request> {
  const headers = await signedHeaders(options)
  const sent = options.sentBody ?? options.body
  return new Request(options.url, {
    method: options.method ?? 'POST',
    headers,
    body: typeof sent === 'string' ? sent : new Uint8Array(sent),
  })
}
