export type AnswerTrailPlace =
  | { kind: 'project' | 'folder'; id: string; name: string }
  | { kind: 'project' | 'folder'; withheld: true }

export interface AnswerTrailView {
  messageId: string
  places: AnswerTrailPlace[]
  personalMemory: boolean
  personalShelf: boolean
  solo: boolean
}

const PAGE = 200
const REFETCH_AFTER_MS = 10_000
const KEEP_MS = 60_000
const trails = new Map<string, { loading: Promise<Map<string, AnswerTrailView>>; at: number }>()

async function fetchTrails(conversationId: string): Promise<Map<string, AnswerTrailView>> {
  const found = new Map<string, AnswerTrailView>()
  let cursor: string | null = null
  do {
    const params = new URLSearchParams({ limit: String(PAGE) })
    if (cursor) params.set('cursor', cursor)
    const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/answers/trail?${params.toString()}`)
    if (!response.ok) throw new Error(`answer trail ${response.status}`)
    const page = (await response.json()) as { answers: AnswerTrailView[]; nextCursor: string | null }
    for (const answer of page.answers) found.set(answer.messageId, answer)
    cursor = page.nextCursor
  } while (cursor)
  return found
}

function load(conversationId: string): Promise<Map<string, AnswerTrailView>> {
  const loading = fetchTrails(conversationId)
  trails.set(conversationId, { loading, at: Date.now() })
  loading.catch(() => trails.delete(conversationId))
  return loading
}

export async function answerTrailFor(conversationId: string, messageId: string): Promise<AnswerTrailView | null> {
  const held = trails.get(conversationId)
  const cached = held && Date.now() - held.at <= KEEP_MS ? held : undefined
  const known = await (cached?.loading ?? load(conversationId))
  if (known.has(messageId)) return known.get(messageId) ?? null
  const stale = cached !== undefined && Date.now() - cached.at > REFETCH_AFTER_MS
  return stale ? ((await load(conversationId)).get(messageId) ?? null) : null
}

export function forgetAnswerTrails(): void {
  trails.clear()
}
