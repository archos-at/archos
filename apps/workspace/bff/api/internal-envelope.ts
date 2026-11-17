import 'server-only'

import { BadRequestError, ForbiddenError, UnauthorizedError } from '@/lib/api/errors'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { readHeader } from '@/lib/http/legacy-header-names'
import { verifyRequestContextEnvelope, type VerifiedRequestContext } from '@/lib/request-context'

export function requireVerifiedContext(request: Request): VerifiedRequestContext {
  const context = verifyRequestContextEnvelope(
    readHeader(request.headers, 'X-Request-Context'),
    readHeader(request.headers, 'X-Request-Context-Sig'),
    process.env.INTERNAL_API_TOKEN,
  )
  if (!context) throw new UnauthorizedError('Missing or invalid request context envelope')
  return context
}

export function requireEnvelopeProject(
  context: VerifiedRequestContext,
  projectId: string,
): void {
  if (!context.projectId) return
  if (context.projectId === projectId) return
  throw new BadRequestError('projectId does not match the request context envelope', {
    projectId,
  })
}

export async function requirePinnedSession(
  context: VerifiedRequestContext,
): Promise<AuthorizedSession> {
  const session = await resolvePinnedRequesterSession({
    userId: context.userId,
    email: null,
    organizationId: context.organizationId,
  })
  if (!session) throw new ForbiddenError('The requesting user is no longer a member here')
  return session
}
