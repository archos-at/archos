/**
 * The signature-guarded internal routes' own pieces: the options and context
 * `internalApiRoute` takes for them, the path family they live under, and the
 * check that runs before the handler and before a byte of the body is read.
 * Split from `./handler` so the factory every route imports stays readable.
 */

import { requireInternalSignature, type SignatureRequirement, type VerifiedSignature } from '@/lib/internal-auth'
import type { FixedAuthzRouteOptions, InternalApiContext, InternalTenancy } from './handler'

/**
 * Context passed to signature-guarded internal handlers. `signature` is what
 * the verified signature vouches for; the body is not read yet, and the
 * handler reads it with `readBoundedBody` / `streamBodyTo` held to
 * `signature.contentLength` and `signature.contentDigest`.
 */
export interface SignedInternalApiContext<TParams = Record<string, never>> extends InternalApiContext<TParams> {
  signature: VerifiedSignature
}

/**
 * An internal route a caller OUTSIDE the cluster pushes bytes to. A shared
 * token proves only who sent a request; the RFC 9421 signature also binds the
 * method, the URL, the body (through `Content-Digest` and `Content-Length`)
 * and the time, so a captured request cannot be retargeted or given another
 * body (`@/lib/internal-auth`).
 *
 * Such a route must live under {@link SIGNED_INTERNAL_PREFIX}: the proxy
 * matcher excludes that prefix, so the body reaches the handler unbuffered
 * and uncut (`src/proxy.ts`). Anywhere else the factory refuses to serve it.
 */
export interface SignedInternalRouteOptions extends FixedAuthzRouteOptions {
  readonly tenancy: InternalTenancy
  readonly auth: { readonly signature: SignatureRequirement }
  readonly tokenEnv?: never
}

/**
 * The path family of signature-guarded routes. `src/proxy.ts` leaves it out of
 * the proxy matcher, which is the reason the prefix exists: a proxied body is
 * buffered and, above `proxyClientMaxBodySize`, silently cut.
 */
export const SIGNED_INTERNAL_PREFIX = '/api/internal/signed/'

/**
 * A signed route outside {@link SIGNED_INTERNAL_PREFIX} would sit behind the
 * proxy, whose buffering cuts a large body short without an error. That is a
 * route declared in the wrong folder, so it fails as a 500 on its first call
 * rather than serving truncated bodies (`signed-routes.spec.ts` catches it
 * before that).
 */
function assertSignedPath(request: Request, label: string): void {
  if (new URL(request.url).pathname.startsWith(SIGNED_INTERNAL_PREFIX)) return
  throw new Error(`[${label}] a signature-guarded route must live under ${SIGNED_INTERNAL_PREFIX}`)
}

/** The signed path, then the signature: what a signed route's handler may rely on. */
export async function verifySignedRequest(
  request: Request,
  label: string,
  requirement: SignatureRequirement
): Promise<VerifiedSignature> {
  assertSignedPath(request, label)
  return requireInternalSignature(request, label, requirement)
}
