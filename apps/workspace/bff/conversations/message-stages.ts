import { PROJECT_MEMORY_KINDS } from '@/lib/db/schema/project-memory'

export interface StoredFollowUp {
  question: string
  hint?: string
}

export interface StoredFollowUpsStage {
  items: StoredFollowUp[]
}

export interface StoredMemoryItem {
  id: string
  kind: string
  content: string
  provenance?: 'agent'
  scope?: 'organization'
  supersedes?: string
  restricted?: true
}

export interface StoredMemoryReflectionStage {
  items: StoredMemoryItem[]
}

export interface MessageStages {
  followUps?: StoredFollowUpsStage
  memoryReflection?: StoredMemoryReflectionStage
}

export const MAX_FOLLOW_UPS = 4
const MAX_QUESTION_CHARS = 300
const MAX_HINT_CHARS = 200

export const MAX_MEMORY_ITEMS = 12
const MAX_MEMORY_CONTENT_CHARS = 500
const MAX_MEMORY_ID_CHARS = 64

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const cap = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : undefined

export function sanitizeFollowUpsStage(input: unknown): StoredFollowUpsStage | null {
  if (!isRecord(input) || !Array.isArray(input.items)) return null

  const items: StoredFollowUp[] = []
  for (const raw of input.items) {
    if (items.length >= MAX_FOLLOW_UPS) break
    if (!isRecord(raw)) continue
    const question = cap(raw.question, MAX_QUESTION_CHARS)
    if (!question) continue
    const hint = cap(raw.hint, MAX_HINT_CHARS)
    items.push(hint ? { question, hint } : { question })
  }

  return items.length > 0 ? { items } : null
}

const MEMORY_KINDS: ReadonlySet<string> = new Set(PROJECT_MEMORY_KINDS)

export function sanitizeMemoryReflectionStage(input: unknown): StoredMemoryReflectionStage | null {
  if (!isRecord(input) || !Array.isArray(input.items)) return null

  const items: StoredMemoryItem[] = []
  for (const raw of input.items) {
    if (items.length >= MAX_MEMORY_ITEMS) break
    if (!isRecord(raw)) continue
    const id = cap(raw.id, MAX_MEMORY_ID_CHARS)
    const content = cap(raw.content, MAX_MEMORY_CONTENT_CHARS)
    const kind = typeof raw.kind === 'string' ? raw.kind.trim() : ''
    if (!id || !content || !MEMORY_KINDS.has(kind)) continue
    const supersedes = cap(raw.supersedes, MAX_MEMORY_CONTENT_CHARS)
    items.push({
      id,
      kind,
      content,
      ...(raw.provenance === 'agent' ? { provenance: 'agent' as const } : {}),
      ...(raw.scope === 'organization' ? { scope: 'organization' as const } : {}),
      ...(supersedes ? { supersedes } : {}),
      ...(raw.restricted === true ? { restricted: true as const } : {}),
    })
  }

  return items.length > 0 ? { items } : null
}

export function sanitizeStages(input: unknown): MessageStages | null {
  if (!isRecord(input)) return null
  const out: MessageStages = {}

  const followUps = sanitizeFollowUpsStage(input.followUps)
  if (followUps) out.followUps = followUps

  const memoryReflection = sanitizeMemoryReflectionStage(input.memoryReflection)
  if (memoryReflection) out.memoryReflection = memoryReflection

  return Object.keys(out).length > 0 ? out : null
}
