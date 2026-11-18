import 'server-only'
import { getBackendUrl } from '@/lib/backend-proxy'
import { InternalServiceUnavailableError, internalServiceHeaders } from '@/lib/internal-auth'

const DRAFT_DISCARD_TIMEOUT_MS = 10_000

export async function discardConversationDrafts(conversationId: string): Promise<boolean> {
  let tokenHeaders: Record<string, string>
  try {
    tokenHeaders = internalServiceHeaders(getBackendUrl())
  } catch (error) {
    if (!(error instanceof InternalServiceUnavailableError)) throw error
    console.warn(`[conversations] ${error.message}; drafts not discarded`)
    return false
  }
  try {
    const response = await fetch(
      `${getBackendUrl()}/v1/drafts/${encodeURIComponent(conversationId)}`,
      {
        method: 'DELETE',
        headers: tokenHeaders,
        signal: AbortSignal.timeout(DRAFT_DISCARD_TIMEOUT_MS),
      },
    )
    if (response.ok || response.status === 404) return true
    console.warn(
      `[conversations] draft discard refused for ${conversationId}: HTTP ${response.status}`,
    )
    return false
  } catch (error) {
    console.warn(`[conversations] draft discard failed for ${conversationId}`, error)
    return false
  }
}
