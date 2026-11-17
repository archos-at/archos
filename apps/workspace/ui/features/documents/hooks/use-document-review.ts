'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AnnotationRequestError,
  createAnnotation,
  deleteAnnotation,
  deleteReply,
  editReply as editReplyRequest,
  getAnnotation,
  listAnnotations,
  replyToAnnotation,
  updateAnnotation,
} from '@/lib/annotations/client'
import {
  compareAnnotations,
  isForReader,
  isGhostMark,
  isLive,
  REPLY_TAKEN_UP_REASON,
  type AnnotationKind,
  type AnnotationShape,
  type AnnotationStatus,
  type AnnotationView,
  type MarkMention,
  type UpdateAnnotationRequest,
} from '@/lib/annotations/types'
import type { RevisionRef } from '@/lib/documents/revision-links'
import { inPool } from '@/lib/utils/in-pool'
import { useChatStore } from '@/features/chat/store'
import { inboxClient, type InboxClient } from '@/lib/inbox/client'
import { ARCHIVE_UNDO_MS, useUndoableArchive } from '@/features/collaboration/hooks/use-undoable-archive'
import { useLiveEvents } from '@/features/collaboration/hooks/use-live-events'
import { registerCanvasFocusProvider } from '@/features/chat/lib/canvas-bridge'
import { reviewFocusOf } from '../lib/review-focus'
import { useCanvasAsk, type UseCanvasAskOptions } from './use-canvas-ask'
import { useDocumentRoom, type RoomTransport } from './use-document-room'

export type ReviewTool = 'select' | 'point' | 'region' | 'ask'
export type ReviewFilter = 'open' | 'closed'

export const HINT_READ_ONE_BY_ONE = 8

export const MARK_NEWS_SETTLE_MS = 400

export function readMarkNews(documentId: string, annotationId: string, client: InboxClient = inboxClient): void {
  void client.markMarkRead({ documentId, annotationId }).catch(() => undefined)
}

export const UNREAD_READ_DELAY_MS = 250

const NO_MARKS: ReadonlySet<string> = new Set()

export const DECISION_UNDO_MS = ARCHIVE_UNDO_MS

interface HeldDecision {
  documentId: string
  status: 'open' | 'resolved' | 'dismissed'
  expectedStatus: AnnotationStatus
  onFailed?: () => void
}

function rebased(input: UpdateAnnotationRequest, held: HeldDecision): UpdateAnnotationRequest {
  const { status, expectedStatus, ...rest } = input
  if (status === undefined || status === held.expectedStatus) return rest
  return { ...rest, status, expectedStatus: expectedStatus === held.status ? held.expectedStatus : expectedStatus }
}

export interface ReviewRevision {
  replacedBy: RevisionRef | null
  replaces: readonly RevisionRef[]
}

export interface CarriedGroup {
  from: RevisionRef
  annotations: AnnotationView[]
  load: 'ready' | 'error'
}

export const CARRY_GROUPS_MAX = 3

export const CARRY_AT_ONCE = 4

export interface ReviewDraft {
  page: number
  shape: AnnotationShape
  x: number
  y: number
  w: number | null
  h: number | null
}

export function useDocumentReview(
  documentId: string,
  {
    enabled,
    transport,
    piloti: agentOptions,
    viewerUserId,
    revision,
    inbox = inboxClient,
  }: {
    enabled: boolean
    transport?: RoomTransport
    inbox?: InboxClient
    piloti?: Omit<UseCanvasAskOptions, 'documentId' | 'enabled'>
    viewerUserId?: string | null
    revision?: ReviewRevision | null
  }
) {
  const room = useDocumentRoom(documentId, { enabled, transport })
  const canvas = useCanvasAsk({ ...agentOptions, documentId, enabled })
  const sessionUserId = useChatStore((state) => state.currentUserId)
  const me = room.self?.userId ?? viewerUserId ?? sessionUserId ?? null
  const [readLoad, setLoad] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listedFor, setListedFor] = useState<string | null>(null)
  const load = readLoad === 'ready' && listedFor !== documentId ? 'loading' : readLoad
  const [stored, setAnnotations] = useState<AnnotationView[]>([])
  const [canAnnotate, setCanAnnotate] = useState(false)
  const [pilotiWakes, setAgentWakes] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [tool, setToolState] = useState<ReviewTool>('select')
  const [draft, setDraft] = useState<ReviewDraft | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { sendSelection } = room
  useEffect(() => sendSelection(selectedId), [selectedId, sendSelection])

  const [unread, setUnread] = useState<ReadonlySet<string>>(NO_MARKS)
  const unreadRead = useRef({ documentId, ticket: 0 })
  unreadRead.current.documentId = documentId
  const fetchUnread = useCallback(async () => {
    const ticket = ++unreadRead.current.ticket
    const ids = await inbox.unreadMarks(documentId).catch(() => null)
    if (!ids || unreadRead.current.ticket !== ticket || unreadRead.current.documentId !== documentId) return
    setUnread(new Set(ids))
  }, [documentId, inbox])
  useEffect(() => {
    if (!enabled) return
    const asked = unreadRead.current
    setUnread(NO_MARKS)
    void fetchUnread()
    return () => {
      asked.ticket += 1
    }
  }, [enabled, fetchUnread])
  const unreadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (unreadTimer.current) clearTimeout(unreadTimer.current)
    },
    []
  )
  const marksSetWatched = useRef(false)
  const readMarksSetNews = useCallback(() => {
    void inbox.markMarksSetRead(documentId).catch(() => undefined)
  }, [documentId, inbox])
  const readInbox = useCallback(() => {
    void fetchUnread()
    if (marksSetWatched.current) readMarksSetNews()
  }, [fetchUnread, readMarksSetNews])
  useLiveEvents({
    enabled,
    onEvent: (event) => {
      if (event.kind !== 'inbox.changed') return
      if (unreadTimer.current) clearTimeout(unreadTimer.current)
      unreadTimer.current = setTimeout(readInbox, UNREAD_READ_DELAY_MS)
    },
    onRefresh: readInbox,
  })

  const selectedHasNews = selectedId !== null && unread.has(selectedId)
  useEffect(() => {
    if (!enabled || !selectedId || !selectedHasNews) return
    const timer = setTimeout(() => {
      setUnread((current) => {
        const next = new Set(current)
        next.delete(selectedId)
        return next
      })
      readMarkNews(documentId, selectedId, inbox)
    }, MARK_NEWS_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [enabled, documentId, selectedId, selectedHasNews, inbox])
  const watchMarksSetNews = useCallback(() => {
    marksSetWatched.current = true
    readMarksSetNews()
    return () => {
      marksSetWatched.current = false
    }
  }, [readMarksSetNews])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ReviewFilter>('open')
  const [mine, setMine] = useState(false)
  const [notice, setNotice] = useState<'conflict' | null>(null)
  const [carried, setCarried] = useState<CarriedGroup[]>([])
  const sourcesKey = JSON.stringify(
    revision?.replacedBy
      ? []
      : (revision?.replaces ?? []).slice(0, CARRY_GROUPS_MAX).map(({ id, filename }) => ({ id, filename }))
  )
  const sources = useMemo(() => JSON.parse(sourcesKey) as RevisionRef[], [sourcesKey])
  const carriedRead = useRef(0)
  const fetchCarried = useCallback(async () => {
    const ticket = ++carriedRead.current
    const groups = await Promise.all(
      sources.map(async (from): Promise<CarriedGroup> => {
        const listed = await listAnnotations(from.id).catch((error: unknown) =>
          error instanceof AnnotationRequestError && error.status === 404 ? { annotations: [] } : null
        )
        if (!listed) return { from, annotations: [], load: 'error' }
        const open = listed.annotations.filter((annotation) => annotation.status === 'open')
        return { from, annotations: open, load: 'ready' }
      })
    )
    if (carriedRead.current === ticket) {
      setCarried(groups.filter((group) => group.load === 'error' || group.annotations.length > 0))
    }
  }, [sources])
  const retryCarried = useCallback(() => void fetchCarried(), [fetchCarried])
  const checking = useRef(new Set<string>())
  useEffect(() => {
    let ended = false
    for (const ask of canvas.asks) {
      if (!ask.checkFixed || ask.checkFixed.documentId === documentId) continue
      if (ask.status === 'thinking') checking.current.add(ask.id)
      else if (checking.current.delete(ask.id)) ended = true
    }
    if (ended) void fetchCarried()
  }, [canvas.asks, documentId, fetchCarried])
  useEffect(() => {
    if (!enabled) return
    setCarried([])
    void fetchCarried()
    return () => {
      carriedRead.current += 1
    }
  }, [enabled, documentId, fetchCarried])

  const reads = useRef({ documentId, list: 0, mark: new Map<string, number>() })
  reads.current.documentId = documentId
  const bumpMark = useCallback((annotationId: string) => {
    const next = (reads.current.mark.get(annotationId) ?? 0) + 1
    reads.current.mark.set(annotationId, next)
    return next
  }, [])

  const fetchList = useCallback(async () => {
    const ticket = ++reads.current.list
    const result = await listAnnotations(documentId)
    if (reads.current.documentId !== documentId || reads.current.list !== ticket) return result.annotations
    setAnnotations(result.annotations)
    setCanAnnotate(result.canAnnotate)
    setAgentWakes(result.pilotiWakes)
    setListedFor(documentId)
    setLoad('ready')
    return result.annotations
  }, [documentId])

  useEffect(() => {
    if (!enabled) return
    setLoad('loading')
    setDraft(null)
    setSelectedId(null)
    fetchList().catch(() => setLoad('error'))
  }, [enabled, fetchList, attempt])

  const replace = useCallback((next: AnnotationView) => {
    setAnnotations((current) =>
      [...current.filter((annotation) => annotation.id !== next.id), next].sort(compareAnnotations)
    )
  }, [])
  const drop = useCallback(
    (annotationId: string) => {
      bumpMark(annotationId)
      setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId))
      setSelectedId((current) => (current === annotationId ? null : current))
    },
    [bumpMark]
  )

  const { onAnnotationsChanged, peerId } = room
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let named = new Set<string>()
    let live = true
    const readNamed = () => {
      timer = null
      const ids = [...named]
      named = new Set()
      if (ids.length > HINT_READ_ONE_BY_ONE) {
        void fetchList().catch(() => {})
        return
      }
      for (const id of ids) {
        const ticket = bumpMark(id)
        const list = reads.current.list
        const current = () => live && reads.current.mark.get(id) === ticket && reads.current.list === list
        getAnnotation(documentId, id)
          .then((fresh) => {
            if (current()) replace(fresh)
          })
          .catch((error: unknown) => {
            if (current() && error instanceof AnnotationRequestError && error.status === 404) drop(id)
          })
      }
    }
    const unsubscribe = onAnnotationsChanged((event) => {
      if (event.actor.peerId && event.actor.peerId === peerId) return
      for (const id of event.annotationIds) named.add(id)
      if (timer) clearTimeout(timer)
      timer = setTimeout(readNamed, 120)
    })
    return () => {
      live = false
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [enabled, onAnnotationsChanged, peerId, fetchList, documentId, replace, drop, bumpMark])

  const { status: roomStatus } = room
  const wasLive = useRef(roomStatus === 'live')
  const everLive = useRef(roomStatus === 'live')
  useEffect(() => {
    const live = roomStatus === 'live'
    const back = live && !wasLive.current && everLive.current
    wasLive.current = live
    everLive.current ||= live
    if (enabled && back) void fetchList().catch(() => {})
  }, [enabled, roomStatus, fetchList])
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchList().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [enabled, fetchList])

  const guard = useCallback(
    async <T,>(act: () => Promise<T>): Promise<T> => {
      try {
        return await act()
      } catch (error) {
        if (error instanceof AnnotationRequestError && error.status === 409) {
          if (error.reason !== REPLY_TAKEN_UP_REASON) setNotice('conflict')
          void fetchList().catch(() => {})
        }
        throw error
      }
    },
    [fetchList]
  )

  const write = useMemo(() => ({ peerId: room.peerId }), [room.peerId])

  const closeAskCard = canvas.open
  const select = useCallback(
    (annotationId: string | null) => {
      if (annotationId) closeAskCard(null)
      setSelectedId(annotationId)
    },
    [closeAskCard]
  )
  const placeDraft = useCallback(
    (next: ReviewDraft | null) => {
      if (next) closeAskCard(null)
      setDraft(next)
    },
    [closeAskCard]
  )
  const piloti = useMemo(
    () => ({
      ...canvas,
      compose: (...args: Parameters<typeof canvas.compose>) => {
        setDraft(null)
        setSelectedId(null)
        setToolState('select')
        return canvas.compose(...args)
      },
      ask: (input: Parameters<typeof canvas.ask>[0]) => {
        if (input.region && !input.replyInThread) {
          setDraft(null)
          setSelectedId(null)
        }
        return canvas.ask(input)
      },
      open: (id: string | null) => {
        if (id) {
          setDraft(null)
          setSelectedId(null)
        }
        canvas.open(id)
      },
    }),
    [canvas]
  )

  const setTool = useCallback((next: ReviewTool) => {
    setToolState(next)
    if (next !== 'select') setSelectedId(null)
  }, [])

  const create = useCallback(
    async (
      content: {
        kind: AnnotationKind
        body: string
        mentions?: MarkMention[]
        assigneeUserId?: string | null
        dueOn?: string | null
      },
      place: ReviewDraft | null = draft
    ) => {
      if (!place) return null
      const { mentions, ...fields } = content
      const created = await guard(() =>
        createAnnotation(documentId, { ...place, ...fields, ...(mentions && mentions.length > 0 ? { mentions } : {}) }, write)
      )
      replace(created)
      setDraft(null)
      setToolState('select')
      setSelectedId(created.id)
      setFilter('open')
      return created
    },
    [documentId, draft, guard, replace, write]
  )

  const [held, setHeld] = useState<ReadonlyMap<string, HeldDecision>>(new Map())
  const heldRef = useRef(held)
  const storedRef = useRef(stored)
  useEffect(() => {
    heldRef.current = held
    storedRef.current = stored
  })
  const letGo = useCallback((annotationId: string) => {
    setHeld((current) => {
      if (!current.has(annotationId)) return current
      const next = new Map(current)
      next.delete(annotationId)
      return next
    })
  }, [])
  const sending = useRef(new Set<string>())
  const holdOn = useCallback(
    (annotationId: string) => (sending.current.has(annotationId) ? undefined : heldRef.current.get(annotationId)),
    []
  )
  const sendHeld = useCallback(
    async (annotationId: string) => {
      const decision = holdOn(annotationId)
      if (!decision) return
      sending.current.add(annotationId)
      try {
        const { status, expectedStatus } = decision
        const updated = await guard(() =>
          updateAnnotation(decision.documentId, annotationId, { status, expectedStatus }, write)
        )
        if (reads.current.documentId === decision.documentId) replace(updated)
      } catch (error) {
        if (!(error instanceof AnnotationRequestError && error.status === 409)) decision.onFailed?.()
      } finally {
        sending.current.delete(annotationId)
        letGo(annotationId)
      }
    },
    [holdOn, guard, replace, write, letGo]
  )
  const { request: holdBack, undo: releaseHold } = useUndoableArchive(sendHeld, DECISION_UNDO_MS)

  const decide = useCallback(
    (annotation: Pick<AnnotationView, 'id' | 'status'>, status: HeldDecision['status'], onFailed?: () => void) => {
      if (heldRef.current.has(annotation.id)) return false
      const decision: HeldDecision = { documentId, status, expectedStatus: annotation.status, onFailed }
      heldRef.current = new Map(heldRef.current).set(annotation.id, decision)
      setHeld(heldRef.current)
      holdBack(annotation.id)
      return true
    },
    [documentId, holdBack]
  )
  const undoDecision = useCallback(
    (annotationId: string) => {
      if (sending.current.has(annotationId)) return
      releaseHold(annotationId)
      const next = new Map(heldRef.current)
      next.delete(annotationId)
      heldRef.current = next
      letGo(annotationId)
    },
    [releaseHold, letGo]
  )

  const update = useCallback(
    async (annotationId: string, change: UpdateAnnotationRequest) => {
      const pending = holdOn(annotationId)
      if (pending) undoDecision(annotationId)
      const input = pending ? rebased(change, pending) : change
      const unchanged = storedRef.current.find((annotation) => annotation.id === annotationId)
      if (Object.keys(input).length === 0 && unchanged) return unchanged
      const updated = await guard(() => updateAnnotation(documentId, annotationId, input, write))
      replace(updated)
      return updated
    },
    [documentId, guard, replace, write, holdOn, undoDecision]
  )

  const annotations = useMemo(
    () =>
      held.size === 0
        ? stored
        : stored.map((annotation) => {
            const decision = held.get(annotation.id)
            return decision ? { ...annotation, status: decision.status } : annotation
          }),
    [stored, held]
  )

  const focusNow = useRef<() => ReturnType<typeof reviewFocusOf>>(() => null)
  focusNow.current = () =>
    reviewFocusOf({
      documentId,
      draft,
      selected: annotations.find((annotation) => annotation.id === selectedId) ?? null,
      document: agentOptions ?? null,
    })
  const chatHosted = Boolean(enabled && agentOptions?.chatHosted)
  useEffect(() => (chatHosted ? registerCanvasFocusProvider(() => focusNow.current()) : undefined), [chatHosted])

  const reply = useCallback(
    async (
      annotationId: string,
      body: string,
      options: { addressesPiloti?: boolean; mentions?: MarkMention[] } = {}
    ) => {
      const result = await guard(() =>
        replyToAnnotation(
          documentId,
          annotationId,
          {
            body,
            ...(options.addressesPiloti ? { addressesPiloti: true } : {}),
            ...(options.mentions && options.mentions.length > 0 ? { mentions: options.mentions } : {}),
          },
          write
        )
      )
      replace(result.annotation)
      return result
    },
    [documentId, guard, replace, write]
  )

  const editReply = useCallback(
    async (annotationId: string, replyId: string, body: string, mentions: MarkMention[]) => {
      const updated = await guard(() => editReplyRequest(documentId, annotationId, replyId, { body, mentions }, write))
      replace(updated)
      return updated
    },
    [documentId, guard, replace, write]
  )

  const removeReply = useCallback(
    async (annotationId: string, replyId: string) => {
      await guard(() => deleteReply(documentId, annotationId, replyId, write))
      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === annotationId
            ? { ...annotation, replies: annotation.replies.filter((reply) => reply.id !== replyId) }
            : annotation
        )
      )
    },
    [documentId, guard, write]
  )

  const remove = useCallback(
    async (annotationId: string) => {
      if (holdOn(annotationId)) undoDecision(annotationId)
      await guard(() => deleteAnnotation(documentId, annotationId, write))
      drop(annotationId)
    },
    [documentId, guard, write, drop, holdOn, undoDecision]
  )

  const carry = useCallback(
    async (annotation: Pick<AnnotationView, 'id' | 'documentId' | 'status'>) => {
      const after = await guard(() =>
        updateAnnotation(annotation.documentId, annotation.id, { carryToCurrent: true, expectedStatus: annotation.status }, write)
      )
      if (after.documentId === documentId) replace(after)
      if (annotation.documentId !== documentId || after.documentId !== documentId) {
        await Promise.all([fetchList().catch(() => undefined), fetchCarried()])
      }
      return after
    },
    [documentId, guard, write, replace, fetchList, fetchCarried]
  )

  const resolveCarried = useCallback(
    async (annotation: Pick<AnnotationView, 'id' | 'documentId' | 'status'>) => {
      try {
        return await guard(() =>
          updateAnnotation(annotation.documentId, annotation.id, { status: 'resolved', expectedStatus: annotation.status }, write)
        )
      } finally {
        await fetchCarried()
      }
    },
    [guard, write, fetchCarried]
  )

  const carryAll = useCallback(
    async (marks: ReadonlyArray<Pick<AnnotationView, 'id' | 'documentId' | 'status'>>) => {
      const outcomes = await inPool(marks, CARRY_AT_ONCE, async (annotation) => {
        try {
          const after = await updateAnnotation(
            annotation.documentId,
            annotation.id,
            { carryToCurrent: true, expectedStatus: annotation.status },
            write
          )
          return { annotation, after, error: null }
        } catch (error) {
          return { annotation, after: null, error }
        }
      })
      let crossed = false
      let conflict = false
      for (const { annotation, after, error } of outcomes) {
        if (error instanceof AnnotationRequestError && error.status === 409) conflict = true
        if (!after) continue
        if (after.documentId === documentId) replace(after)
        if (annotation.documentId !== documentId || after.documentId !== documentId) crossed = true
      }
      if (conflict) setNotice('conflict')
      if (crossed || conflict) await Promise.all([fetchList().catch(() => undefined), fetchCarried()])
      const failed = outcomes.filter((outcome) => outcome.after === null).length
      return { carried: outcomes.length - failed, failed }
    },
    [documentId, write, replace, fetchList, fetchCarried]
  )

  const counts = useMemo(
    () => ({
      open: annotations.filter((annotation) => annotation.status === 'open').length,
      proposed: annotations.filter((annotation) => annotation.status === 'proposed').length,
      closed: annotations.filter((annotation) => !isLive(annotation)).length,
    }),
    [annotations]
  )

  const listed = useMemo(
    () =>
      annotations.filter(
        (annotation) =>
          (filter === 'open' ? isLive(annotation) : !isLive(annotation)) &&
          (!mine || isForReader(annotation, me))
      ),
    [annotations, filter, mine, me]
  )

  const step = useCallback(
    (direction: 1 | -1, scope: 'live' | 'proposed' = 'live') => {
      const shown = scope === 'proposed' ? annotations.filter((annotation) => annotation.status === 'proposed') : listed
      const walk = [
        ...shown.filter((annotation) => annotation.status === 'proposed'),
        ...shown.filter((annotation) => annotation.status !== 'proposed'),
      ].filter((annotation) => annotation.onCurrentRevision || isGhostMark(annotation, documentId))
      if (walk.length === 0) return null
      const index = walk.findIndex((annotation) => annotation.id === selectedId)
      const next =
        index === -1
          ? walk[direction === 1 ? 0 : walk.length - 1]
          : walk[(index + direction + walk.length) % walk.length]
      if (!next) return null
      setSelectedId(next.id)
      return next
    },
    [annotations, listed, selectedId, documentId]
  )

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const dismissNotice = useCallback(() => setNotice(null), [])

  return useMemo(
    () => ({
      documentId,
      room,
      piloti,
      load,
      retry,
      annotations,
      listed,
      counts,
      canAnnotate,
      pilotiWakes,
      tool,
      setTool,
      draft,
      setDraft: placeDraft,
      selectedId,
      select,
      hoveredId,
      hover: setHoveredId,
      filter,
      setFilter,
      mine,
      setMine,
      notice,
      dismissNotice,
      create,
      update,
      decide,
      undoDecision,
      reply,
      editReply,
      removeReply,
      remove,
      step,
      me,
      revision: revision ?? null,
      carried,
      retryCarried,
      carry,
      carryAll,
      resolveCarried,
      unread,
      watchMarksSetNews,
    }),
    [
      documentId,
      room,
      piloti,
      load,
      retry,
      annotations,
      listed,
      counts,
      canAnnotate,
      pilotiWakes,
      tool,
      setTool,
      draft,
      placeDraft,
      selectedId,
      select,
      hoveredId,
      filter,
      mine,
      notice,
      dismissNotice,
      create,
      update,
      decide,
      undoDecision,
      me,
      reply,
      editReply,
      removeReply,
      remove,
      step,
      revision,
      carried,
      retryCarried,
      carry,
      carryAll,
      resolveCarried,
      unread,
      watchMarksSetNews,
    ]
  )
}

export type DocumentReview = ReturnType<typeof useDocumentReview>
