import type { StateCreator } from 'zustand'
import type { ChatStore, Conversation } from '../types'
import type { SessionsSlice } from './sessions-store'
import { serverSideKey } from './server-sides'
import {
  clearAwaitingServerMessages,
  isAwaitingServerMessages,
  markAwaitingServerMessages,
} from './chat-storage'
import { mapServerMessagesToChatMessages } from '../lib/server-message-mapper'
import { mergeRemoteMessages } from './messages-store'
import { updateConversationInList } from '../lib/conversation-updates'
import { getConversationsClient, isRightsLost } from '../lib/conversations-client-access'
import { wasMintedHere, wasOnServerBefore } from '../lib/conversation-on-server'
import { isConversationErased } from '../lib/erased-conversations'
import { CONVERSATION_LIST_PAGE } from '../lib/conversation-list-page'
import { keepsProvisionalTitle, named } from '../lib/conversation-title'

const listScopeMatcher = (
  projectId: string | undefined,
  place: 'personal' | 'project' | undefined
): ((c: Conversation) => boolean) | null => {
  if (place === 'personal') return (c) => !c.projectId
  if (place === 'project' && projectId) return (c) => c.projectId === projectId
  return null
}

export const hydratingConversationIds = new Set<string>()

const SIDE_FRESH_MS = 20_000
interface SideLoad { at: number; settled: boolean; pending: Promise<void> }
const sideLoads = new Map<string, SideLoad>()

let sideLoadsOwner: string | null = null

export function forgetSideLoads(): void {
  sideLoads.clear()
  sideLoadsOwner = null
}

export function sideLoadsChangeHands(userId: string | null): boolean {
  if (userId === null) return false
  const changed = sideLoadsOwner !== null && sideLoadsOwner !== userId
  if (changed) sideLoads.clear()
  sideLoadsOwner = userId
  return changed
}

export const createSessionServerSyncSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  Pick<
    SessionsSlice,
    | 'loadServerConversations'
    | 'hydrateConversationMessages'
    | '_lockConversation'
  >
> = (set, get) => {
  const loadSide = async (
    projectId?: string,
    place?: 'personal' | 'project',
    isLatest: () => boolean = () => true,
    anotherSideLoading: () => boolean = () => false
  ): Promise<boolean> => {
    const since = Date.now()
    try {
      const conversationsClient = await getConversationsClient()
      const requestedAt = since
      const listed = await conversationsClient.list(projectId, place)
      if (!isLatest()) return true
      if (!listed) return true
      const serverConvs = listed.filter((c) => !isConversationErased(c.id))
      if (place) {
        const key = serverSideKey(place, projectId)
        set({ serverSides: { ...get().serverSides, [key]: { ids: serverConvs.map((c) => c.id), since } } }, false, 'serverSides')
      }

      const { conversations, currentUserId, currentConversation: openBefore } = get()
      const listedIds = new Set(serverConvs.map((c) => c.id))
      const inScope = listScopeMatcher(projectId, place)
      const goneFromServer = (c: Conversation): boolean =>
        isConversationErased(c.id) ||
        (inScope !== null &&
          listed.length < CONVERSATION_LIST_PAGE &&
          inScope(c) &&
          !listedIds.has(c.id) &&
          openBefore?.id !== c.id &&
          wasOnServerBefore(c.id, requestedAt) &&
          new Date(c.createdAt).getTime() < requestedAt)
      const merged = conversations.filter((c) => !goneFromServer(c))

      for (const serverConv of serverConvs) {
        const idx = merged.findIndex((c) => c.id === serverConv.id)
        const locked = serverConv.contentLocked === true
        const withheldFrom = locked && idx >= 0 ? merged[idx].withheldFrom : undefined
        const local: Conversation = {
          id: serverConv.id,
          userId: currentUserId ?? serverConv.createdBy ?? 'unknown',
          projectId: serverConv.projectId ?? (idx >= 0 ? merged[idx].projectId : null) ?? null,
          title: locked ? '' : (serverConv.title ?? (idx >= 0 ? merged[idx].title : '') ?? ''),
          ...(!locked && keepsProvisionalTitle(merged[idx], serverConv.title) ? { title: merged[idx].title, titleProvisional: true as const } : {}),
          messages: idx >= 0 && (!locked || withheldFrom) ? merged[idx].messages : [],
          ...(locked ? { contentLocked: true } : {}),
          ...(withheldFrom ? { withheldFrom } : {}),
          enabledDataSourceIds: idx >= 0 ? merged[idx].enabledDataSourceIds : undefined,
          createdAt: new Date(serverConv.createdAt as unknown as string),
          updatedAt: new Date(serverConv.updatedAt as unknown as string),
          jobId: serverConv.jobId ?? null,
          temporary: serverConv.temporary === true,
          shared: serverConv.shared === true,
          subjectResourceType: locked
            ? null
            : serverConv.subjectResourceType === 'document'
              ? 'document'
              : ((idx >= 0 ? merged[idx].subjectResourceType : null) ?? null),
          subjectResourceId: locked
            ? null
            : (serverConv.subjectResourceId ??
              (idx >= 0 ? merged[idx].subjectResourceId : null) ??
              null),
        }
        if (idx >= 0) {
          if ((merged[idx].contentLocked && !locked) || withheldFrom) markAwaitingServerMessages(local.id)
          merged[idx] = local
        } else {
          if (!locked) markAwaitingServerMessages(local.id)
          merged.push(local)
        }
      }

      const open = get().currentConversation
      const refreshedOpen = open ? merged.find((c) => c.id === open.id) : undefined
      const openChanged = refreshedOpen !== undefined && (refreshedOpen.contentLocked === true) !== (open?.contentLocked === true)
      set(
        {
          conversations: merged,
          ...(openChanged ? { currentConversation: refreshedOpen } : {}),
        },
        false,
        'loadServerConversations'
      )

      const { currentConversation } = get()
      if (
        currentConversation &&
        (currentConversation.messages.length === 0 ||
          isAwaitingServerMessages(currentConversation.id))
      ) {
        void get().hydrateConversationMessages(currentConversation.id)
      }
      return true
    } catch (err) {
      console.warn('[loadServerConversations] Failed to load server conversations:', err)
      return false
    } finally {
      if (isLatest() && !anotherSideLoading()) set({ serverConversationsLoaded: true }, false, 'serverConversationsLoaded')
    }
  }

  return {
  loadServerConversations: (projectId?: string, place?: 'personal' | 'project', wantConversationId?: string) => {
    if (!place) return loadSide(projectId, place).then(() => undefined)
    const key = serverSideKey(place, projectId)
    const known = sideLoads.get(key)
    if (known && !known.settled) return known.pending
    const hasWanted = !wantConversationId || (get().serverSides[key]?.ids.includes(wantConversationId) ?? false)
    if (known && hasWanted && Date.now() - known.at < SIDE_FRESH_MS) return known.pending
    const load: SideLoad = { at: Date.now(), settled: false, pending: Promise.resolve() }
    const isLatest = () => sideLoads.get(key) === load
    const anotherSideLoading = () => [...sideLoads.values()].some((other) => other !== load && !other.settled)
    load.pending = loadSide(projectId, place, isLatest, anotherSideLoading).then((ok) => {
      if (!isLatest()) return
      if (!ok) sideLoads.delete(key)
      else Object.assign(load, { at: Date.now(), settled: true })
      if (!anotherSideLoading()) set({ serverConversationsLoaded: true }, false, 'serverConversationsLoaded')
    })
    sideLoads.set(key, load)
    return load.pending
  },

  hydrateConversationMessages: async (conversationId: string) => {
    const conversation = get().conversations.find((c) => c.id === conversationId)
    if (!conversation) return
    if (conversation.messages.length > 0 && !isAwaitingServerMessages(conversationId)) return
    if (conversation.messages.length === 0 && wasMintedHere(conversationId) && !isAwaitingServerMessages(conversationId)) return
    if (get().currentConversation?.id === conversationId) get().setPendingMessagesFor(conversationId)
    if (hydratingConversationIds.has(conversationId)) return
    hydratingConversationIds.add(conversationId)
    const settledPending = (): Pick<SessionsSlice, 'pendingMessagesFor'> | Record<string, never> =>
      get().pendingMessagesFor === conversationId ? { pendingMessagesFor: null } : {}

    try {
      const conversationsClient = await getConversationsClient()
      const { messages: serverMessages, withheldFrom } = await conversationsClient.listReadableMessages(conversationId)
      const messages = mapServerMessagesToChatMessages(serverMessages)

      const { conversations, currentConversation, isStreaming, isLoading } = get()
      const target = conversations.find((c) => c.id === conversationId)
      if (!target) return
      if (messages.length === 0) {
        if (target.messages.length === 0) clearAwaitingServerMessages(conversationId)
        return
      }

      const merged = target.contentLocked ? messages : mergeRemoteMessages(target.messages, messages, false).messages
      const hydrated: Conversation = { ...target, messages: merged, withheldFrom }
      const isCurrent = currentConversation?.id === conversationId

      clearAwaitingServerMessages(conversationId)
      set(
        {
          conversations: updateConversationInList(conversations, hydrated),
          ...(isCurrent && { currentConversation: hydrated }),
          ...settledPending(),
        },
        false,
        'hydrateConversationMessages'
      )

      if (isCurrent && !isStreaming && !isLoading) {
        get().restoreSessionState(hydrated)
      }
    } catch (err) {
      if (isRightsLost(err)) get()._lockConversation(conversationId)
      else console.warn('[hydrateConversationMessages] Failed to load messages from server:', err)
    } finally {
      hydratingConversationIds.delete(conversationId)
      const pending = settledPending()
      if ('pendingMessagesFor' in pending) set(pending, false, 'hydrateConversationMessages/settled')
    }
  },

  _lockConversation: (conversationId: string) => {
    const { conversations, currentConversation } = get()
    const lock = (conversation: Conversation): Conversation => ({
      ...named(conversation, ''),
      messages: [],
      subjectResourceType: null,
      subjectResourceId: null,
      contentLocked: true,
      withheldFrom: undefined,
    })
    clearAwaitingServerMessages(conversationId)
    set(
      {
        conversations: conversations.map((c) => (c.id === conversationId ? lock(c) : c)),
        ...(currentConversation?.id === conversationId ? { currentConversation: lock(currentConversation) } : {}),
      },
      false,
      'lockConversation'
    )
  },
}
}
