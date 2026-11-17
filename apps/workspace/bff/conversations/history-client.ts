import type { MessageListResponse, MessageView } from './message-view'

const HISTORY_PAGE = 200
const HISTORY_MESSAGES_MAX = 1000

export type ThreadHistory = { ok: true; messages: MessageView[] } | { ok: false; response: Response }

export async function fetchThreadHistory(
  conversationId: string,
  run: (url: string) => Promise<Response> = (url) => fetch(url)
): Promise<ThreadHistory> {
  const history: MessageView[] = []
  let cursor: string | null = null
  do {
    const params = new URLSearchParams({ limit: String(HISTORY_PAGE), include: 'citations,steps,metadata' })
    if (cursor) params.set('cursor', cursor)
    const response = await run(`/api/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`)
    if (!response.ok) return { ok: false, response }
    const page = (await response.json()) as MessageListResponse
    history.unshift(...page.messages)
    cursor = history.length < HISTORY_MESSAGES_MAX ? page.nextCursor : null
  } while (cursor)
  return { ok: true, messages: history }
}
