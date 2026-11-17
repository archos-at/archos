import { canShareNatively, conversationLink } from '@/features/collaboration/lib/share-link'
import { isConversationOnServer } from './conversation-on-server'

export { canShareNatively }

export interface AnswerSharePayload {
  title: string
  text: string
  url?: string
}

export type AnswerShareOutcome = 'shared' | 'cancelled' | 'copied' | 'failed'

export function answerShareUrl(
  conversationId: string | null | undefined,
  location: Pick<Location, 'origin' | 'pathname'>,
): string | undefined {
  if (!conversationId || !isConversationOnServer(conversationId)) return undefined
  return conversationLink('conversation', conversationId, location) ?? undefined
}

export async function shareAnswer(
  payload: AnswerSharePayload,
  copy: (text: string) => Promise<void>,
  nav: Partial<Pick<Navigator, 'share'>> | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): Promise<AnswerShareOutcome> {
  if (nav && canShareNatively(nav)) {
    try {
      await nav.share(payload.url ? payload : { title: payload.title, text: payload.text })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await copy(payload.url ? `${payload.text}\n\n${payload.url}` : payload.text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
