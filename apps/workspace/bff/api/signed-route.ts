import { requireInternalSignature, type SignatureRequirement, type VerifiedSignature } from '@/lib/internal-auth'
import type { FixedAuthzRouteOptions, InternalApiContext, InternalTenancy } from './handler'

export interface SignedInternalApiContext<TParams = Record<string, never>> extends InternalApiContext<TParams> {
  signature: VerifiedSignature
}

export interface SignedInternalRouteOptions extends FixedAuthzRouteOptions {
  readonly tenancy: InternalTenancy
  readonly auth: { readonly signature: SignatureRequirement }
  readonly tokenEnv?: never
}

export const SIGNED_INTERNAL_PREFIX = '/api/internal/signed/'

function assertSignedPath(request: Request, label: string): void {
  if (new URL(request.url).pathname.startsWith(SIGNED_INTERNAL_PREFIX)) return
  throw new Error(`[${label}] a signature-guarded route must live under ${SIGNED_INTERNAL_PREFIX}`)
}

export async function verifySignedRequest(
  request: Request,
  label: string,
  requirement: SignatureRequirement
): Promise<VerifiedSignature> {
  assertSignedPath(request, label)
  return requireInternalSignature(request, label, requirement)
}
