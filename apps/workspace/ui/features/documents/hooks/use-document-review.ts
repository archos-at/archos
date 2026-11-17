'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AnnotationRequestError,
  createAnnotation,
  deleteAnnotation,
  deleteReply,
  editReply as editReplyRequest,
  replyToAnnotation,
  updateAnnotation,
} from '@/lib/annotations/client'
import {
  isForReader,
  isGhostMark,
  isLive,
  REPLY_TAKEN_UP_REASON,
  type AnnotationKind,
  type AnnotationView,
  type MarkMention,
  type UpdateAnnotationRequest,
} from '@/lib/annotations/types'
import { inPool } from '@/lib/utils/in-pool'
import { useChatStore } from '@/features/chat/store'
import { inboxClient, type InboxClient } from '@/lib/inbox/client'
import { ARCHIVE_UNDO_MS, useUndoableArchive } from '@/features/collaboration/hooks/use-undoable-archive'
import { registerCanvasFocusProvider } from '@/features/chat/lib/canvas-bridge'
import { reviewFocusOf } from '../lib/review-focus'
import { rebased, type HeldDecision } from '../lib/held-decision'
import type { CarriedGroup, ReviewDraft, ReviewFilter, ReviewRevision, ReviewTool } from '../lib/review-types'
import { useCanvasAsk, type UseCanvasAskOptions } from './use-canvas-ask'
import { useDocumentRoom, type RoomTransport } from './use-document-room'
import { useAnnotationList } from './use-annotation-list'
import { useCarriedAnnotations } from './use-carried-annotations'
import { useUnreadReviewMarks } from './use-unread-review-marks'

export type { CarriedGroup, ReviewDraft, ReviewFilter, ReviewRevision, ReviewTool }
export { CARRY_GROUPS_MAX } from './use-carried-annotations'
export { HINT_READ_ONE_BY_ONE } from './use-annotation-list'
export { MARK_NEWS_SETTLE_MS, UNREAD_READ_DELAY_MS } from './use-unread-review-marks'
export { readMarkNews } from '../lib/mark-news'

export const DECISION_UNDO_MS = ARCHIVE_UNDO_MS

export const CARRY_AT_ONCE = 4

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
  const [tool, setToolState] = useState<ReviewTool>('select')
  const [draft, setDraft] = useState<ReviewDraft | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { sendSelection } = room
  useEffect(() => sendSelection(selectedId), [selectedId, sendSelection])

  const { unread, watchMarksSetNews } = useUnreadReviewMarks({ enabled, documentId, inbox, selectedId })
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ReviewFilter>('open')
  const [mine, setMine] = useState(false)
  const [notice, setNotice] = useState<'conflict' | null>(null)
  const { carried, fetchCarried, retryCarried } = useCarriedAnnotations({ enabled, documentId, revision, canvas })

  const { load, stored, setAnnotations, canAnnotate, pilotiWakes, setAttempt, reads, replace, drop, fetchList } =
    useAnnotationList({ enabled, documentId, room, setDraft, setSelectedId })

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
