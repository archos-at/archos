'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchThreadHistory } from '@/lib/conversations/history-client'
import type { CollaborationEvent } from '@/lib/events/types'
import type { DirectoryPerson, ResourceRole, ResourceSharingState } from '@/lib/sharing/types'
import { useChatStore } from '@/features/chat/store'
import type { ChatMessage } from '@/features/chat/types'
import type { MessagesSlice } from '@/features/chat/stores/messages-store'
import { mapServerMessagesToChatMessages, type ServerMessageInput } from '@/features/chat/lib/server-message-mapper'
import {
  isConversationOnServer,
  useConversationOnServer,
} from '@/features/chat/lib/conversation-on-server'
import type { ConversationEngagement } from '@/lib/db/schema/conversations'
import {
  publishThreadRole,
  publishThreadSharing,
  publishTurnActor,
  useThreadRevision,
} from '@/shared/collaboration/thread-sharing'
import { createRetryLadder, type RetryLadder } from '@/shared/utils/backoff'
import { useLiveEvents } from './use-live-events'

const ACCESS_RETRY_DELAYS_MS = [1_000, 3_000, 8_000]

const TURN_BANNER_MAX_AGE_MS = 5 * 60_000

const TURN_SILENCE_POLL_MS = 30_000

const UNSHARED_FOCUS_REREAD_MIN_MS = 30_000

const MARK_READ_DEBOUNCE_MS = 1_200
const MARK_READ_RETRY_MS = 8_000
const MARK_READ_MAX_ATTEMPTS = 3

interface ConversationAccessFacts {
  shared?: boolean
  myRole?: ResourceRole | null
  myReadState?: { lastReadMessageId: string | null } | null
  engagementMode?: ConversationEngagement
  engagementSuggestion?: ConversationEngagement | null
}

export interface SharedThreadTurn {
  actorUserId: string | null
}

const TYPING_SWEEP_MS = 1_000

export interface SharedThreadArrival {
  messageId: string
  authorUserId: string | null
  authorName: string | null
}

export interface UseSharedThreadOptions {
  conversationId: string | null
  enabled?: boolean
  currentUserId?: string | null
  active?: boolean
}

export interface UseSharedThreadResult {
  shared: boolean
  myRole: ResourceRole | null
  loading: boolean
  connected: boolean
  accessLost: boolean
  turnInFlight: SharedThreadTurn | null
  clearTurnInFlight: () => void
  noteTurnActivity: () => void
  typists: DirectoryPerson[]
  participants: DirectoryPerson[]
  authorOf: (userId: string | null | undefined) => DirectoryPerson | null
  unreadAfterMessageId: string | null
  lastArrival: SharedThreadArrival | null
  engagement: ConversationEngagement
  engagementSuggestion: ConversationEngagement | null
  setEngagement: (mode: ConversationEngagement) => Promise<boolean>
  refresh: () => void
}

const INERT: Omit<
  UseSharedThreadResult,
  'refresh' | 'authorOf' | 'setEngagement' | 'clearTurnInFlight' | 'noteTurnActivity'
> = {
  shared: false,
  myRole: null,
  loading: false,
  connected: false,
  accessLost: false,
  turnInFlight: null,
  typists: [],
  participants: [],
  unreadAfterMessageId: null,
  lastArrival: null,
  engagement: 'ask',
  engagementSuggestion: null,
}

function withAuthorIdentity(
  messages: ChatMessage[],
  directory: Map<string, DirectoryPerson>
): ChatMessage[] {
  if (directory.size === 0) return messages
  return messages.map((message) => {
    if (!message.authorUserId) return message
    const person = directory.get(message.authorUserId)
    if (!person) return message
    if (
      message.authorName === person.name &&
      message.authorAvatarUrl === person.profilePictureUrl
    ) {
      return message
    }
    return { ...message, authorName: person.name, authorAvatarUrl: person.profilePictureUrl }
  })
}

export function useSharedThread(options: UseSharedThreadOptions): UseSharedThreadResult {
  const { conversationId, enabled = false, currentUserId = null, active = true } = options

  const [shared, setShared] = useState(false)
  const [myRole, setMyRole] = useState<ResourceRole | null>(null)
  const [engagement, setEngagementState] = useState<ConversationEngagement>('ask')
  const [engagementSuggestion, setEngagementSuggestion] = useState<ConversationEngagement | null>(
    null
  )
  const [loading, setLoading] = useState(false)
  const [accessLost, setAccessLost] = useState(false)
  const [participants, setParticipants] = useState<DirectoryPerson[]>([])
  const [turnInFlight, setTurnInFlight] = useState<SharedThreadTurn | null>(null)
  const [typingUntil, setTypingUntil] = useState<Record<string, number>>({})
  const [unreadAfterMessageId, setUnreadAfterMessageId] = useState<string | null>(null)
  const [lastArrival, setLastArrival] = useState<SharedThreadArrival | null>(null)
  const [newestMessageId, setNewestMessageId] = useState<string | null>(null)

  const sharedRef = useRef(false)
  const accessRetryRef = useRef<RetryLadder | null>(null)
  accessRetryRef.current ??= createRetryLadder({ delaysMs: ACCESS_RETRY_DELAYS_MS })
  const accessRetry = accessRetryRef.current
  const loadRef = useRef<(replace: boolean) => void>(() => {})


  const scheduleAccessRetry = useCallback(() => {
    accessRetry.schedule(() => loadRef.current(false))
  }, [accessRetry])
  const currentUserIdRef = useRef(currentUserId)
  currentUserIdRef.current = currentUserId
  const directoryRef = useRef<Map<string, DirectoryPerson>>(new Map())
  const seq = useRef(0)
  const unreadAnchoredRef = useRef<string | null>(null)
  const reportedReadIdRef = useRef<string | null>(null)
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const turnStartedAtRef = useRef<number>(0)
  const lastTurnActivityRef = useRef<number>(0)

  const turnHasGoneQuiet = useCallback((): boolean => {
    const lastSign = Math.max(lastTurnActivityRef.current, turnStartedAtRef.current)
    return lastSign > 0 && Date.now() - lastSign > TURN_BANNER_MAX_AGE_MS
  }, [])

  const base = conversationId ? `/api/conversations/${encodeURIComponent(conversationId)}` : null

  const applyMessages = useCallback(
    (targetConversationId: string, rows: ServerMessageInput[], replace: boolean) => {
      const mapped = withAuthorIdentity(mapServerMessagesToChatMessages(rows), directoryRef.current)

      const store = useChatStore.getState() as unknown as MessagesSlice
      store.insertRemoteMessages(targetConversationId, mapped, { replace })

      const newest = mapped[mapped.length - 1] ?? null
      setNewestMessageId(newest?.id ?? null)

      const me = currentUserIdRef.current
      const foreign = replace
        ? undefined
        : [...mapped]
            .reverse()
            .find((message) => message.authorUserId && message.authorUserId !== me)
      if (foreign) {
        setLastArrival((previous) =>
          previous?.messageId === foreign.id
            ? previous
            : {
                messageId: foreign.id,
                authorUserId: foreign.authorUserId ?? null,
                authorName: foreign.authorName ?? null,
              }
        )
      }

      if (newest?.role === 'assistant') setTurnInFlight(null)
    },
    []
  )

  const loadRoster = useCallback(async (targetConversationId: string, current: number) => {
    try {
      const response = await fetch(
        `/api/sharing/conversation/${encodeURIComponent(targetConversationId)}`
      )
      if (!response.ok) return
      const state = (await response.json()) as ResourceSharingState
      if (current !== seq.current) return
      const people = (state.entries ?? []).map((entry) => entry.person)
      directoryRef.current = new Map(people.map((person) => [person.userId, person]))
      setParticipants(people)
    } catch {
      // Names are a nicety; a thread with unresolved names still renders (the
    }
  }, [])

  const loadMessages = useCallback(
    async (
      targetConversationId: string,
      current: number,
      replace: boolean
    ): Promise<'ok' | 'denied' | 'failed'> => {
      try {
        const history = await fetchThreadHistory(targetConversationId)
        if (!history.ok) {
          const { status } = history.response
          if (status === 401 || status === 403 || status === 404) {
            return 'denied'
          }
          return 'failed'
        }
        const rows = history.messages
        if (current !== seq.current) return 'failed'
        applyMessages(targetConversationId, rows, replace)
        return 'ok'
      } catch {
        return 'failed'
      }
    },
    [applyMessages]
  )

  const load = useCallback(
    async (replace: boolean, generation?: number): Promise<'ok' | 'denied'> => {
      if (!enabled || !conversationId) {
        sharedRef.current = false
        setShared(false)
        setMyRole(null)
        setLoading(false)
        return 'ok'
      }

      const current = generation ?? ++seq.current

      if (!isConversationOnServer(conversationId)) {
        sharedRef.current = false
        setShared(false)
        setMyRole(null)
        setLoading(false)
        publishThreadSharing(conversationId, false)
        return 'ok'
      }

      if (replace) setLoading(true)
      try {
        const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`)
        if (!response.ok) {
          const authoritative = response.status === 401 || response.status === 403 || response.status === 404
          if (current === seq.current && !authoritative) {
            setLoading(false)
            scheduleAccessRetry()
            return 'ok'
          }
          if (current === seq.current) {
            const wasShared = sharedRef.current
            sharedRef.current = false
            setShared(false)
            setLoading(false)
            if (wasShared) setAccessLost(true)
            publishThreadSharing(conversationId, false)
          }
          return 'ok'
        }
        const facts = (await response.json()) as ConversationAccessFacts
        if (current !== seq.current) return 'ok'

        accessRetry.reset()
        setAccessLost(false)
        const isShared = facts.shared === true
        sharedRef.current = isShared
        setShared(isShared)
        setMyRole(facts.myRole ?? null)
        setEngagementState(facts.engagementMode ?? 'ask')
        setEngagementSuggestion(facts.engagementSuggestion ?? null)
        publishThreadSharing(conversationId, isShared)

        if (isShared && unreadAnchoredRef.current === null) {
          const anchor = facts.myReadState?.lastReadMessageId ?? null
          unreadAnchoredRef.current = anchor ?? ''
          setUnreadAfterMessageId(anchor)
        }

        if (!isShared) {
          setLoading(false)
          return 'ok'
        }

        const [, messages] = await Promise.all([
          loadRoster(conversationId, current),
          loadMessages(conversationId, current, replace),
        ])
        if (current === seq.current) {
          const conversation = useChatStore
            .getState()
            .conversations.find((candidate) => candidate.id === conversationId)
          if (conversation) {
            const store = useChatStore.getState() as unknown as MessagesSlice
            store.insertRemoteMessages(
              conversationId,
              withAuthorIdentity(conversation.messages, directoryRef.current)
            )
          }
        }
        return messages === 'denied' ? 'denied' : 'ok'
      } catch {
        if (current === seq.current) {
          scheduleAccessRetry()
        }
        return 'ok'
      } finally {
        if (current === seq.current) setLoading(false)
      }
    },
    [
      conversationId,
      enabled,
      loadMessages,
      loadRoster,
      scheduleAccessRetry,
      accessRetry,
    ]
  )

  const loadAndRevalidate = useCallback(
    async (replace: boolean) => {
      const generation = ++seq.current
      if ((await load(replace, generation)) === 'denied') await load(false, generation)
    },
    [load]
  )

  useEffect(() => {
    loadRef.current = (replace: boolean) => void loadAndRevalidate(replace)
  }, [loadAndRevalidate])

  useEffect(() => {
    unreadAnchoredRef.current = null
    reportedReadIdRef.current = null
    setNewestMessageId(null)
    setUnreadAfterMessageId(null)
    setLastArrival(null)
    setTurnInFlight(null)
    setAccessLost(false)
    setTypingUntil((previous) => (Object.keys(previous).length === 0 ? previous : {}))
    setParticipants((previous) => (previous.length === 0 ? previous : []))
    directoryRef.current = new Map()
    accessRetry.reset()
    sharedRef.current = false
    setShared(false)
    setMyRole(null)
    lastRevisionRef.current = revisionRef.current
    lastOnServerRef.current = onServerRef.current
    void loadAndRevalidate(true)
    return () => {
      seq.current += 1
      accessRetry.cancel()
    }
  }, [loadAndRevalidate, accessRetry])

  const revision = useThreadRevision(conversationId)
  const lastRevisionRef = useRef(revision)
  const revisionRef = useRef(revision)
  revisionRef.current = revision
  useEffect(() => {
    if (revision === lastRevisionRef.current) return
    lastRevisionRef.current = revision
    void loadAndRevalidate(false)
  }, [revision, loadAndRevalidate])

  const onServer = useConversationOnServer(conversationId)
  const onServerRef = useRef(onServer)
  onServerRef.current = onServer
  const lastOnServerRef = useRef(onServer)
  useEffect(() => {
    if (onServer === lastOnServerRef.current) return
    lastOnServerRef.current = onServer
    if (onServer) void loadAndRevalidate(false)
  }, [onServer, loadAndRevalidate])

  const onEvent = useCallback(
    (event: CollaborationEvent) => {
      if (!conversationId) return

      if (event.kind === 'conversation.message') {
        if (event.conversationId !== conversationId) return
        void loadMessages(conversationId, seq.current, false)
        return
      }

      if (event.kind === 'conversation.turn') {
        if (event.conversationId !== conversationId) return
        if (event.phase === 'started') {
          turnStartedAtRef.current = Date.now()
          lastTurnActivityRef.current = 0
          setTurnInFlight({ actorUserId: event.actorUserId })
        } else {
          const startedAt = turnStartedAtRef.current
          void loadMessages(conversationId, seq.current, false).then(() => {
            if (turnStartedAtRef.current === startedAt) setTurnInFlight(null)
          })
        }
        return
      }

      if (event.kind === 'conversation.typing') {
        if (event.conversationId !== conversationId) return
        if (event.userId === currentUserIdRef.current) return
        setTypingUntil((previous) => {
          if (!event.typing) {
            if (previous[event.userId] === undefined) return previous
            const next = { ...previous }
            delete next[event.userId]
            return next
          }
          return { ...previous, [event.userId]: Date.now() + event.ttlMs }
        })
        return
      }

      if (event.kind === 'resource.access.changed') {
        if (event.resourceType === 'conversation' && event.resourceId === conversationId) {
          void loadAndRevalidate(false)
        }
      }
    },
    [conversationId, loadAndRevalidate, loadMessages]
  )

  const refresh = useCallback(() => {
    if (turnHasGoneQuiet()) setTurnInFlight(null)
    if (!sharedRef.current) {
      void loadAndRevalidate(false)
      return
    }
    if (conversationId) {
      void loadMessages(conversationId, seq.current, false).then((outcome) => {
        if (outcome === 'denied') void load(false)
      })
    }
  }, [conversationId, load, loadAndRevalidate, loadMessages, turnHasGoneQuiet])

  const { connected } = useLiveEvents({
    enabled: enabled && shared && Boolean(conversationId),
    onEvent,
    onRefresh: refresh,
  })

  useEffect(() => {
    if (!enabled || shared || !conversationId) return
    if (typeof window === 'undefined') return
    let last = 0
    const maybeReread = () => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - last < UNSHARED_FOCUS_REREAD_MIN_MS) return
      last = now
      refresh()
    }
    window.addEventListener('focus', maybeReread)
    document.addEventListener('visibilitychange', maybeReread)
    return () => {
      window.removeEventListener('focus', maybeReread)
      document.removeEventListener('visibilitychange', maybeReread)
    }
  }, [enabled, shared, conversationId, refresh])

  useEffect(() => {
    if (!turnInFlight) return
    const id = setInterval(() => {
      if (turnHasGoneQuiet()) setTurnInFlight(null)
    }, TURN_SILENCE_POLL_MS)
    return () => clearInterval(id)
  }, [turnInFlight, turnHasGoneQuiet])

  useEffect(() => {
    if (Object.keys(typingUntil).length === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setTypingUntil((previous) => {
        const live = Object.entries(previous).filter(([, until]) => until > now)
        if (live.length === Object.keys(previous).length) return previous
        return Object.fromEntries(live)
      })
    }, TYPING_SWEEP_MS)
    return () => clearInterval(timer)
  }, [typingUntil])

  useEffect(() => {
    if (!enabled || !shared || !base || !active) return
    const newest = newestMessageId
    if (!newest || newest === reportedReadIdRef.current) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    let attempts = 0
    let left = false
    const report = () => {
      reportedReadIdRef.current = newest
      void fetch(`${base}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastReadMessageId: newest }),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`read receipt failed: ${response.status}`)
        })
        .catch(() => {
          if (reportedReadIdRef.current === newest) reportedReadIdRef.current = null
          if (left || ++attempts >= MARK_READ_MAX_ATTEMPTS) return
          markReadTimerRef.current = setTimeout(report, MARK_READ_RETRY_MS)
        })
    }
    markReadTimerRef.current = setTimeout(report, MARK_READ_DEBOUNCE_MS)

    return () => {
      left = true
      if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current)
      markReadTimerRef.current = null
    }
  }, [enabled, shared, base, active, newestMessageId])

  const directory = useMemo(
    () => new Map(participants.map((person) => [person.userId, person])),
    [participants]
  )

  const authorOf = useCallback(
    (userId: string | null | undefined): DirectoryPerson | null =>
      userId ? (directory.get(userId) ?? null) : null,
    [directory]
  )

  const typists = useMemo(
    () =>
      Object.keys(typingUntil)
        .map((userId) => directory.get(userId))
        .filter((person): person is DirectoryPerson => person !== undefined),
    [typingUntil, directory]
  )

  const setEngagement = useCallback(
    async (mode: ConversationEngagement): Promise<boolean> => {
      if (!base) return false
      const previous = engagement
      setEngagementState(mode)
      try {
        const response = await fetch(base, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engagement: mode }),
        })
        if (!response.ok) {
          setEngagementState(previous)
          return false
        }
        const facts = (await response.json()) as ConversationAccessFacts
        setEngagementState(facts.engagementMode ?? mode)
        setEngagementSuggestion(facts.engagementSuggestion ?? null)
        return true
      } catch {
        setEngagementState(previous)
        return false
      }
    },
    [base, engagement]
  )

  useEffect(() => {
    if (!conversationId) return
    const actorId = turnInFlight?.actorUserId ?? null
    const isSomeoneElse = actorId !== null && actorId !== currentUserId
    publishTurnActor(
      conversationId,
      isSomeoneElse ? (directory.get(actorId)?.name ?? null) : null,
    )
  }, [conversationId, turnInFlight, currentUserId, directory])

  const clearTurnInFlight = useCallback(() => setTurnInFlight(null), [])

  const noteTurnActivity = useCallback(() => {
    lastTurnActivityRef.current = Date.now()
  }, [])

  useEffect(() => {
    if (!conversationId) return
    publishThreadRole(conversationId, shared ? myRole : null)
  }, [conversationId, shared, myRole])

  const result = useMemo<UseSharedThreadResult>(
    () => ({
      shared,
      myRole,
      loading,
      connected,
      accessLost,
      turnInFlight,
      clearTurnInFlight,
      noteTurnActivity,
      typists,
      participants,
      authorOf,
      unreadAfterMessageId,
      lastArrival,
      engagement,
      engagementSuggestion,
      setEngagement,
      refresh,
    }),
    [
      shared,
      myRole,
      loading,
      connected,
      accessLost,
      turnInFlight,
      clearTurnInFlight,
      noteTurnActivity,
      typists,
      participants,
      authorOf,
      unreadAfterMessageId,
      lastArrival,
      engagement,
      engagementSuggestion,
      setEngagement,
      refresh,
    ]
  )

  return enabled && conversationId
    ? result
    : { ...INERT, authorOf, refresh, setEngagement, clearTurnInFlight, noteTurnActivity }
}
