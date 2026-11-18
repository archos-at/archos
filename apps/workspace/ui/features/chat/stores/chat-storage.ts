import type { PersistStorage, StorageValue } from 'zustand/middleware'
import type { ChatMessage, ChatStore, Conversation } from '../types'
import { pruneMessageForStorage } from '../lib/prune-message-for-storage'
import { hasLiveRun } from '../lib/session-activity'
import {
  logStorageAvailability,
  logStorageEviction,
  logStorageFailure,
  logStorageMigration,
  logStorageWrite,
} from '../lib/storage-logger'

export type PersistedChatState = Pick<
  ChatStore,
  'currentUserId' | 'conversations' | 'currentConversation' | 'composerDrafts'
>

type PersistedChatStorageValue = StorageValue<PersistedChatState>

type ConversationEntry = Omit<Conversation, 'messages'>

type StoredIndex = {
  version?: number
  shape?: number
  state: {
    currentUserId: string | null
    currentConversation: string | null
    composerDrafts: PersistedChatState['composerDrafts']
    conversations: ConversationEntry[]
    awaitingServerMessages?: string[]
  }
}

export const CHAT_MESSAGES_SHAPE = 4

export const chatIndexKey = (name: string): string => `${name}:index`

const messagesKeyPrefix = (name: string): string => `${name}:messages:`

export const chatMessagesKey = (name: string, conversationId: string): string =>
  `${messagesKeyPrefix(name)}${conversationId}`

const DRAFT_WRITE_DELAY_MS = 400

export const CHAT_STORAGE_BUDGET_CHARS = 3_000_000

const awaitingServerMessages = new Set<string>()

export const markAwaitingServerMessages = (conversationId: string): void => {
  awaitingServerMessages.add(conversationId)
}

export const clearAwaitingServerMessages = (conversationId: string): void => {
  awaitingServerMessages.delete(conversationId)
}

export const isAwaitingServerMessages = (conversationId: string): boolean =>
  awaitingServerMessages.has(conversationId)

const isQuotaExceededError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  if (error.name === 'QuotaExceededError') return true
  return /quota|exceeded|storage/i.test(error.message)
}

const updatedAtMs = (conversation: { updatedAt: Date | string }): number =>
  new Date(conversation.updatedAt).getTime() || 0

const entryOf = (conversation: Conversation): ConversationEntry => {
  const { messages: _messages, ...entry } = conversation
  return entry
}

function sameExcept(a: Conversation, b: Conversation, except: 'messages'): boolean
function sameExcept(a: ChatMessage, b: ChatMessage, except: 'thinkingSteps'): boolean
function sameExcept(
  a: Conversation | ChatMessage,
  b: Conversation | ChatMessage,
  except: 'messages' | 'thinkingSteps'
): boolean {
  const aFields: Record<string, unknown> = { ...a }
  const bFields: Record<string, unknown> = { ...b }
  for (const key of new Set([...Object.keys(aFields), ...Object.keys(bFields)])) {
    if (key !== except && aFields[key] !== bFields[key]) return false
  }
  return true
}

const lastUserMessageIndex = (messages: readonly ChatMessage[]): number => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.messageType === 'user' || message.role === 'user') return i
  }
  return -1
}

export const onlyTheLiveTurnGrewIn = (
  was: readonly ChatMessage[],
  now: readonly ChatMessage[]
): boolean => {
  if (now.length !== was.length && now.length !== was.length + 1) return false
  const last = now[now.length - 1]
  if (now.length === was.length + 1 && !last?.isStreaming) return false
  const question = lastUserMessageIndex(now)
  for (let i = 0; i < now.length; i++) {
    const message = now[i]!
    const previous = was[i]
    if (message === previous) continue
    if (i === now.length - 1 && message.isStreaming) continue
    if (i === question && previous && sameExcept(previous, message, 'thinkingSteps')) continue
    return false
  }
  return true
}

const onlyTheLiveTurnGrew = (
  before: Conversation | null | undefined,
  after: Conversation | null | undefined
): boolean => {
  if (!before || !after || before.id !== after.id) return false
  if (!sameExcept(before, after, 'messages')) return false
  return onlyTheLiveTurnGrewIn(before.messages, after.messages)
}

const restorableMessages = (messages: ChatMessage[]): ChatMessage[] =>
  messages.filter(
    (m) =>
      m.isStreaming !== true &&
      !(m.messageType === 'error' && m.errorData?.errorCode?.startsWith('connection.'))
  )

const parseJson = (raw: string | null): unknown => {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const asStoredIndex = (value: unknown): StoredIndex | null => {
  if (!value || typeof value !== 'object') return null
  const state = (value as { state?: unknown }).state
  if (!state || typeof state !== 'object') return null
  const conversations = (state as { conversations?: unknown }).conversations
  return Array.isArray(conversations) ? (value as StoredIndex) : null
}

export const readStoredChat = (name: string): PersistedChatStorageValue | null => {
  const index = asStoredIndex(parseJson(localStorage.getItem(chatIndexKey(name))))
  if (!index) return null
  const conversations = index.state.conversations.map((entry) => {
    const messages = parseJson(localStorage.getItem(chatMessagesKey(name, entry.id)))
    return { ...entry, messages: Array.isArray(messages) ? (messages as ChatMessage[]) : [] }
  })
  return {
    version: index.version,
    state: {
      currentUserId: index.state.currentUserId ?? null,
      conversations: conversations as Conversation[],
      currentConversation: (index.state.currentConversation ?? null) as unknown as Conversation | null,
      composerDrafts: index.state.composerDrafts ?? {},
    },
  }
}

type StoredMessages = {
  messages: readonly ChatMessage[]
  chars: number
  updatedAt: number
}

class ChatStorageArea {
  private readonly stored = new Map<string, StoredMessages>()
  private indexRaw: string | null = null
  private indexChars = 0
  lastState: PersistedChatState | null = null
  lastVersion: number | undefined
  lastWritten: PersistedChatState | null = null

  constructor(readonly name: string) {}

  private totalChars(): number {
    let total = this.indexChars
    for (const entry of this.stored.values()) total += entry.chars
    return total
  }

  reset(): void {
    this.stored.clear()
    this.indexRaw = null
    this.indexChars = 0
    this.lastState = null
    this.lastVersion = undefined
    this.lastWritten = null
  }

  noteRead(conversations: readonly Conversation[], rawChars: ReadonlyMap<string, number>): void {
    this.stored.clear()
    for (const conversation of conversations) {
      this.stored.set(conversation.id, {
        messages: conversation.messages,
        chars: rawChars.get(conversation.id) ?? 0,
        updatedAt: updatedAtMs(conversation),
      })
    }
  }

  noteIndexRead(raw: string): void {
    this.indexRaw = raw
    this.indexChars = chatIndexKey(this.name).length + raw.length
  }

  private evictOne(forId: string, protectedIds: ReadonlySet<string>, openId: string | null): boolean {
    const forUpdatedAt = this.stored.get(forId)?.updatedAt ?? Number.POSITIVE_INFINITY
    let oldest: [string, StoredMessages] | null = null
    for (const candidate of this.stored) {
      const [id, entry] = candidate
      if (entry.chars === 0 || id === forId || protectedIds.has(id)) continue
      if (forId !== openId && entry.updatedAt >= forUpdatedAt) continue
      if (!oldest || entry.updatedAt < oldest[1].updatedAt) oldest = candidate
    }
    if (!oldest) return false
    const [id, entry] = oldest
    localStorage.removeItem(chatMessagesKey(this.name, id))
    logStorageEviction(id, entry.chars)
    this.stored.set(id, { ...entry, chars: 0 })
    return true
  }

  private put(
    key: string,
    value: string,
    forId: string,
    previousChars: number,
    protectedIds: ReadonlySet<string>,
    openId: string | null
  ): boolean {
    const chars = key.length + value.length
    while (this.totalChars() - previousChars + chars > CHAT_STORAGE_BUDGET_CHARS) {
      if (this.evictOne(forId, protectedIds, openId)) continue
      if (forId === '' || forId === openId) break
      logStorageEviction(forId, chars)
      return false
    }
    for (;;) {
      try {
        localStorage.setItem(key, value)
        return true
      } catch (error) {
        if (!isQuotaExceededError(error)) throw error
        if (!this.evictOne(forId, protectedIds, openId)) {
          logStorageFailure(key, chars, error)
          return false
        }
      }
    }
  }

  private writeIndex(state: PersistedChatState, protectedIds: ReadonlySet<string>): void {
    const index: StoredIndex = {
      version: this.lastVersion,
      shape: CHAT_MESSAGES_SHAPE,
      state: {
        currentUserId: state.currentUserId ?? null,
        currentConversation: state.currentConversation?.id ?? null,
        composerDrafts: state.composerDrafts ?? {},
        conversations: (state.conversations ?? []).map(entryOf),
        awaitingServerMessages: (state.conversations ?? [])
          .filter((c) => isAwaitingServerMessages(c.id))
          .map((c) => c.id),
      },
    }
    const raw = JSON.stringify(index)
    if (raw === this.indexRaw) return
    const key = chatIndexKey(this.name)
    const openId = state.currentConversation?.id ?? null
    if (!this.put(key, raw, '', this.indexChars, protectedIds, openId)) return
    this.indexRaw = raw
    this.indexChars = key.length + raw.length
  }

  private writeMessages(
    conversation: Conversation,
    protectedIds: ReadonlySet<string>,
    openId: string | null
  ): void {
    const known = this.stored.get(conversation.id)
    const updatedAt = updatedAtMs(conversation)
    if (known?.messages === conversation.messages) {
      if (known.updatedAt !== updatedAt) this.stored.set(conversation.id, { ...known, updatedAt })
      return
    }
    if (known && onlyTheLiveTurnGrewIn(known.messages, conversation.messages)) return
    if (conversation.messages.length === 0 && isAwaitingServerMessages(conversation.id)) return

    const key = chatMessagesKey(this.name, conversation.id)
    const previousChars = known?.chars ?? 0
    this.stored.set(conversation.id, { messages: conversation.messages, chars: previousChars, updatedAt })
    const raw = JSON.stringify(conversation.messages.map(pruneMessageForStorage))
    if (this.put(key, raw, conversation.id, previousChars, protectedIds, openId)) {
      this.stored.set(conversation.id, { messages: conversation.messages, chars: key.length + raw.length, updatedAt })
      logStorageWrite(conversation.id, raw.length)
      return
    }
    localStorage.removeItem(key)
    this.stored.set(conversation.id, { messages: conversation.messages, chars: 0, updatedAt })
  }

  write(state: PersistedChatState, { messages = true }: { messages?: boolean } = {}): void {
    const conversations = state.conversations ?? []
    const present = new Set(conversations.map((c) => c.id))
    for (const id of [...this.stored.keys()]) {
      if (present.has(id)) continue
      localStorage.removeItem(chatMessagesKey(this.name, id))
      this.stored.delete(id)
    }

    const openId = state.currentConversation?.id ?? null
    const protectedIds = new Set(conversations.filter((c) => hasLiveRun(c.messages)).map((c) => c.id))
    if (openId) protectedIds.add(openId)

    this.writeIndex(state, protectedIds)
    if (!messages) return
    const byRecency = [...conversations].sort((a, b) => updatedAtMs(b) - updatedAtMs(a))
    for (const conversation of byRecency) this.writeMessages(conversation, protectedIds, openId)
    this.lastWritten = state
  }

  onlyTheOpenTurnOrDraftsChanged(next: PersistedChatState): boolean {
    const written: Record<string, unknown> | null = this.lastWritten
    if (written === null) return false
    const nextFields: Record<string, unknown> = next
    const keys = new Set([...Object.keys(written), ...Object.keys(nextFields)])
    for (const key of keys) {
      if (key === 'conversations' || key === 'currentConversation' || key === 'composerDrafts') continue
      if (nextFields[key] !== written[key]) return false
    }
    const before = this.lastWritten?.conversations ?? []
    const after = next.conversations ?? []
    const beforeOpen = this.lastWritten?.currentConversation ?? null
    const afterOpen = next.currentConversation ?? null
    if (after === before && afterOpen === beforeOpen) return true
    const openId = afterOpen?.id
    if (!openId || beforeOpen?.id !== openId) return false
    return (
      before.length === after.length &&
      after.every((c, i) => c === before[i] || (c.id === openId && onlyTheLiveTurnGrew(before[i], c))) &&
      onlyTheLiveTurnGrew(beforeOpen, afterOpen)
    )
  }

  unchangedSinceLastCall(value: PersistedChatStorageValue): boolean {
    const previous: Record<string, unknown> | null = this.lastState
    if (previous === null || value.version !== this.lastVersion) return false
    const next: Record<string, unknown> = value.state
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
    for (const key of keys) if (next[key] !== previous[key]) return false
    return true
  }
}

const removeOrphanedMessageKeys = (name: string, ids: ReadonlySet<string>): void => {
  const prefix = messagesKeyPrefix(name)
  const orphans: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix) && !ids.has(key.slice(prefix.length))) orphans.push(key)
  }
  for (const key of orphans) localStorage.removeItem(key)
}

const dropCachedMessages = (name: string, from: StoredIndex): void => {
  const open = from.state.currentConversation as unknown
  const entries = from.state.conversations.map((entry) => entryOf(entry as Conversation))
  const index: StoredIndex = {
    version: from.version,
    shape: CHAT_MESSAGES_SHAPE,
    state: {
      currentUserId: from.state.currentUserId ?? null,
      currentConversation: typeof open === 'string' ? open : ((open as { id?: string } | null)?.id ?? null),
      composerDrafts: from.state.composerDrafts ?? {},
      conversations: entries,
      awaitingServerMessages: entries.map((entry) => entry.id),
    },
  }
  localStorage.removeItem(name)
  removeOrphanedMessageKeys(name, new Set())
  try {
    localStorage.setItem(chatIndexKey(name), JSON.stringify(index))
  } catch (error) {
    logStorageFailure(chatIndexKey(name), 0, error)
  }
  logStorageMigration(entries.length)
}

let deferring = false

export function deferChatStorageWrites(update: () => void): void {
  deferring = true
  try {
    update()
  } finally {
    deferring = false
  }
}

export const createResilientStorage = (): PersistStorage<PersistedChatState> | undefined => {
  try {
    if (typeof localStorage === 'undefined') throw new Error('no localStorage')
    localStorage.getItem('')
  } catch {
    logStorageAvailability(false)
    return undefined
  }

  const areas = new Map<string, ChatStorageArea>()
  const areaFor = (name: string): ChatStorageArea => {
    let area = areas.get(name)
    if (!area) {
      area = new ChatStorageArea(name)
      areas.set(name, area)
    }
    return area
  }

  let heldDraft: { name: string; state: PersistedChatState } | null = null
  let heldDraftTimer: ReturnType<typeof setTimeout> | undefined
  const writeHeldDraft = (): void => {
    clearTimeout(heldDraftTimer)
    const held = heldDraft
    heldDraft = null
    if (held) areaFor(held.name).write(held.state)
  }
  const holdDraft = (name: string, state: PersistedChatState, delayMs = DRAFT_WRITE_DELAY_MS): void => {
    heldDraft = { name, state }
    clearTimeout(heldDraftTimer)
    heldDraftTimer = setTimeout(writeHeldDraft, delayMs)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', writeHeldDraft)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') writeHeldDraft()
    })
  }

  const read = (name: string): PersistedChatStorageValue | null => {
    const area = areaFor(name)
    const legacy = asStoredIndex(parseJson(localStorage.getItem(name)))
    const stored = legacy ?? asStoredIndex(parseJson(localStorage.getItem(chatIndexKey(name))))
    if (stored && (legacy || stored.shape !== CHAT_MESSAGES_SHAPE)) dropCachedMessages(name, stored)
    localStorage.removeItem(name)

    const indexRaw = localStorage.getItem(chatIndexKey(name))
    const index = asStoredIndex(parseJson(indexRaw))
    if (!index || indexRaw === null) return null
    const rawChars = new Map<string, number>()
    const awaiting = new Set(index.state.awaitingServerMessages ?? [])
    const conversations = index.state.conversations.map((entry): Conversation => {
      const key = chatMessagesKey(name, entry.id)
      const raw = localStorage.getItem(key)
      const parsed = parseJson(raw)
      if (awaiting.has(entry.id) || !Array.isArray(parsed) || parsed.length === 0) {
        markAwaitingServerMessages(entry.id)
      }
      if (raw === null || !Array.isArray(parsed)) return { ...entry, messages: [] }
      rawChars.set(entry.id, key.length + raw.length)
      return { ...entry, messages: restorableMessages(parsed as ChatMessage[]) }
    })
    removeOrphanedMessageKeys(name, new Set(conversations.map((c) => c.id)))
    area.reset()
    area.noteIndexRead(indexRaw)
    area.noteRead(conversations, rawChars)
    area.lastVersion = index.version
    return {
      version: index.version,
      state: {
        currentUserId: index.state.currentUserId ?? null,
        conversations,
        currentConversation: index.state.currentConversation as unknown as Conversation | null,
        composerDrafts: index.state.composerDrafts ?? {},
      },
    }
  }

  return {
    getItem: async (name: string): Promise<PersistedChatStorageValue | null> => {
      const value = read(name)
      if (!value) return null
      const storedId = value.state.currentConversation as unknown as string | null
      const conversations = value.state.conversations ?? []
      return {
        ...value,
        state: {
          ...value.state,
          currentConversation: storedId ? (conversations.find((c) => c.id === storedId) ?? null) : null,
        },
      }
    },
    removeItem: (name: string) => {
      if (heldDraft?.name === name) {
        heldDraft = null
        clearTimeout(heldDraftTimer)
      }
      areaFor(name).reset()
      localStorage.removeItem(name)
      localStorage.removeItem(chatIndexKey(name))
      removeOrphanedMessageKeys(name, new Set())
    },
    setItem: (name: string, value: PersistedChatStorageValue) => {
      const area = areaFor(name)
      if (area.unchangedSinceLastCall(value)) return
      area.lastState = value.state
      area.lastVersion = value.version
      if (area.onlyTheOpenTurnOrDraftsChanged(value.state)) {
        if (value.state.composerDrafts !== area.lastWritten?.composerDrafts) holdDraft(name, value.state)
        return
      }
      if (deferring) return holdDraft(name, value.state, 0)
      if (heldDraft?.name === name) {
        heldDraft = null
        clearTimeout(heldDraftTimer)
      }
      area.write(value.state)
    },
  }
}
