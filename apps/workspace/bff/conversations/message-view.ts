import { MESSAGE_INCLUDES, type MessageInclude } from './conversation-wire'

export interface MessageMentionView {
  targetId: string
  display: string
}

export interface MessageView {
  id: string
  conversationId: string
  role: string
  content: string
  authorUserId: string | null
  authorName: string | null
  createdAt: string
  runId: string | null
  messageType: string
  mentions: MessageMentionView[]
  metadata?: Record<string, unknown>
}

export interface MessageListResponse {
  messages: MessageView[]
  nextCursor: string | null
}

export function parseMessageIncludes(value: string | undefined): ReadonlySet<MessageInclude> {
  const asked = (value ?? '').split(',').map((part) => part.trim())
  return new Set(MESSAGE_INCLUDES.filter((include) => asked.includes(include)))
}

const CITATION_KEYS = ['citations', 'readSources'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function metadataFor(
  stored: unknown,
  include: ReadonlySet<MessageInclude>
): Record<string, unknown> | undefined {
  if (include.size === 0 || !isRecord(stored)) return undefined
  const out: Record<string, unknown> = include.has('metadata') ? { ...stored } : {}
  if (include.has('citations')) {
    for (const key of CITATION_KEYS) if (stored[key] !== undefined) out[key] = stored[key]
  } else {
    for (const key of CITATION_KEYS) delete out[key]
  }
  const provenance = isRecord(stored.provenance) ? stored.provenance : null
  if (provenance) {
    const { thinkingSteps, ...rest } = provenance
    const kept: Record<string, unknown> = include.has('metadata') ? rest : {}
    if (include.has('steps') && thinkingSteps !== undefined) kept.thinkingSteps = thinkingSteps
    if (Object.keys(kept).length > 0) out.provenance = kept
    else delete out.provenance
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function mentionsOf(stored: unknown): MessageMentionView[] {
  const raw = isRecord(stored) ? stored.mentions : undefined
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry): MessageMentionView[] => {
    if (!isRecord(entry) || typeof entry.targetId !== 'string' || entry.targetId.length === 0) return []
    return [{ targetId: entry.targetId, display: typeof entry.display === 'string' ? entry.display : entry.targetId }]
  })
}

export interface StoredMessage {
  id: string
  conversationId: string
  role: string
  content: string
  authorUserId: string | null
  createdAt: Date
  runId: string | null
  metadata: unknown
}

export function toMessageView(
  row: StoredMessage,
  authorNames: ReadonlyMap<string, string>,
  include: ReadonlySet<MessageInclude>
): MessageView {
  const stored = isRecord(row.metadata) ? row.metadata : {}
  const metadata = metadataFor(row.metadata, include)
  const kind = typeof stored.messageType === 'string' && stored.messageType ? stored.messageType : null
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    authorUserId: row.authorUserId,
    authorName: row.authorUserId ? (authorNames.get(row.authorUserId) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    runId: row.runId,
    messageType: kind ?? (row.role === 'user' ? 'user' : 'agent_response'),
    mentions: mentionsOf(stored),
    ...(metadata ? { metadata } : {}),
  }
}
