'use client'

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { AnnotationRequestError, getAnnotation, listAnnotations } from '@/lib/annotations/client'
import { compareAnnotations, type AnnotationView } from '@/lib/annotations/types'
import type { ReviewDraft } from '../lib/review-types'
import type { DocumentRoom } from './use-document-room'

export const HINT_READ_ONE_BY_ONE = 8

export function useAnnotationList({
  enabled,
  documentId,
  room,
  setDraft,
  setSelectedId,
}: {
  enabled: boolean
  documentId: string
  room: DocumentRoom
  setDraft: Dispatch<SetStateAction<ReviewDraft | null>>
  setSelectedId: Dispatch<SetStateAction<string | null>>
}) {
  const [readLoad, setLoad] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listedFor, setListedFor] = useState<string | null>(null)
  const load = readLoad === 'ready' && listedFor !== documentId ? 'loading' : readLoad
  const [stored, setAnnotations] = useState<AnnotationView[]>([])
  const [canAnnotate, setCanAnnotate] = useState(false)
  const [pilotiWakes, setAgentWakes] = useState(false)
  const [attempt, setAttempt] = useState(0)

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

  return { load, stored, setAnnotations, canAnnotate, pilotiWakes, setAttempt, reads, replace, drop, fetchList }
}
