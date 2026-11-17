'use client'

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { AnnotationChange } from '@/lib/annotations/room-types'
import type { DocumentReview } from '../../hooks/use-document-review'
import { PRODUCT_NAME } from '@/lib/brand'
import { isAgentKind, type AgentKind } from '@/lib/agent-kind'

export const ANNOUNCE_AFTER_MS = 3_000

export type Heard =
  | { kind: 'change'; actor: { name: string; kind: 'person' | AgentKind; userId: string }; change: AnnotationChange; ids: readonly string[] }
  | { kind: 'answered' }

type Translate = ReturnType<typeof useTranslations>

export function announcementOf(
  heard: readonly Heard[],
  numberOf: (annotationId: string) => number | null,
  t: Translate
): string {
  const groups = new Map<string, { actor: Extract<Heard, { kind: 'change' }>['actor']; change: AnnotationChange; ids: Set<string> }>()
  let answered = false
  for (const item of heard) {
    if (item.kind === 'answered') {
      answered = true
      continue
    }
    const key = `${item.actor.kind}:${item.actor.userId}:${item.change}`
    const group = groups.get(key) ?? { actor: item.actor, change: item.change, ids: new Set<string>() }
    for (const id of item.ids) group.ids.add(id)
    groups.set(key, group)
  }
  const lines = [...groups.values()].map(({ actor, change, ids }) => {
    const count = ids.size
    if (change === 'created' && isAgentKind(actor.kind)) return t('review.announce.agentProposed', { count })
    const numbers = [...ids]
      .map(numberOf)
      .filter((number): number is number => number !== null)
      .sort((a, b) => a - b)
      .join(', ')
    const name = isAgentKind(actor.kind) ? PRODUCT_NAME : actor.name
    return t(`review.announce.${change}`, { name, count, numbers }).replace(/\s+$/, '').replace(/\s{2,}/g, ' ')
  })
  if (answered) lines.push(t('review.announce.agentAnswered'))
  return lines.join('. ')
}

export function ReviewAnnouncer({ review }: { review: Pick<DocumentReview, 'room' | 'annotations' | 'piloti'> }): JSX.Element {
  const t = useTranslations(filesCopy)
  const [said, setSaid] = useState('')
  const { onAnnotationsChanged, peerId, self } = review.room
  const selfUserId = self?.userId ?? null
  const numbers = useRef(new Map<string, number>())
  useEffect(() => {
    for (const annotation of review.annotations) numbers.current.set(annotation.id, annotation.number)
  }, [review.annotations])

  const queue = useRef<Heard[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const translate = useRef(t)
  useEffect(() => {
    translate.current = t
  })
  const hear = useCallback((item: Heard) => {
    queue.current.push(item)
    timer.current ??= setTimeout(() => {
      timer.current = null
      const heard = queue.current
      queue.current = []
      const line = announcementOf(heard, (id) => numbers.current.get(id) ?? null, translate.current)
      if (line) setSaid((before) => (before === line ? `${line}\u200b` : line))
    }, ANNOUNCE_AFTER_MS)
  }, [])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  useEffect(
    () =>
      onAnnotationsChanged((event) => {
        if (event.actor.peerId && event.actor.peerId === peerId) return
        if (event.actor.kind === 'person' && event.actor.userId === selfUserId) return
        hear({
          kind: 'change',
          actor: { name: event.actor.name, kind: event.actor.kind, userId: event.actor.userId },
          change: event.change,
          ids: event.annotationIds,
        })
      }),
    [onAnnotationsChanged, peerId, selfUserId, hear]
  )

  const statuses = useRef(new Map<string, string>())
  useEffect(() => {
    for (const ask of review.piloti.asks) {
      if (statuses.current.get(ask.id) === 'thinking' && ask.status === 'answered') hear({ kind: 'answered' })
      statuses.current.set(ask.id, ask.status)
    }
  }, [review.piloti.asks, hear])

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="review-announcer">
      {said}
    </div>
  )
}
