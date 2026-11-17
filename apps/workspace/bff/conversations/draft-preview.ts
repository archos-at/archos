import 'server-only'
import { z } from 'zod'
import { getBackendUrl } from '@/lib/backend-proxy'
import { InternalServiceUnavailableError, internalServiceHeaders } from '@/lib/internal-auth'
import {
  BadRequestError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  UpstreamError,
} from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireResourceAccess } from '@/lib/sharing/access'

const DRAFT_READ_TIMEOUT_MS = 10_000

const backendDraftSchema = z.object({
  path: z.string(),
  content: z.string(),
  version: z.number().int().nonnegative(),
})

export interface ConversationDraftPreview {
  path: string
  content: string
  version: number
  bytes: number
}

export async function readConversationDraft(
  session: AuthorizedSession,
  conversationId: string,
  path: string,
): Promise<ConversationDraftPreview> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')

  const trimmed = path.trim()
  if (!trimmed || trimmed.length > 500) {
    throw new BadRequestError('Invalid draft path')
  }
  const stripped = trimmed.replace(/^\/+/, '')
  if (!stripped) {
    throw new BadRequestError('Invalid draft path')
  }
  const encodedPath = stripped
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  let tokenHeaders: Record<string, string>
  try {
    tokenHeaders = internalServiceHeaders(getBackendUrl())
  } catch (error) {
    if (error instanceof InternalServiceUnavailableError) throw new ServiceUnavailableError('Draft preview is unavailable')
    throw error
  }

  let response: Response
  try {
    response = await fetch(
      `${getBackendUrl()}/v1/drafts/${encodeURIComponent(conversationId)}/${encodedPath}`,
      {
        method: 'GET',
        headers: tokenHeaders,
        signal: AbortSignal.timeout(DRAFT_READ_TIMEOUT_MS),
      },
    )
  } catch {
    throw new UpstreamError('Draft preview is unavailable')
  }

  if (!response.ok) {
    if (response.status === 404) throw new NotFoundError()
    if (response.status === 400) throw new BadRequestError('Invalid draft path')
    if (response.status === 413) throw new PayloadTooLargeError()
    throw new UpstreamError(`Draft preview failed with ${response.status}`)
  }

  const parsed = backendDraftSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) {
    throw new UpstreamError('Draft preview answered unexpectedly')
  }
  return {
    path: parsed.data.path,
    content: parsed.data.content,
    version: parsed.data.version,
    bytes: Buffer.byteLength(parsed.data.content, 'utf8'),
  }
}
