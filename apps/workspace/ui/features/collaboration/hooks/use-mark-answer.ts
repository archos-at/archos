'use client'

import { useState } from 'react'

import { AnnotationRequestError, replyToAnnotation, updateAnnotation } from '@/lib/annotations/client'
import type { MarkMention } from '@/lib/annotations/types'
import type { InboxItemView } from '@/lib/inbox/types'
import { isAgentMentionId } from '@/lib/mentions/types'
import type { ComposerSend } from '@/features/documents/review-links'
import { useUndoableArchive } from './use-undoable-archive'

export interface InboxMarkClient {
  reply: typeof replyToAnnotation
  update: typeof updateAnnotation
}

export const MARK_CLIENT: InboxMarkClient = { reply: replyToAnnotation, update: updateAnnotation }

export type MarkOutcome = 'sent' | 'sentAgentNotAsked' | 'resolved' | 'conflict' | 'failed'

export interface UseMarkAnswerOptions {
  item: InboxItemView
  markRow: boolean
  markClient?: InboxMarkClient
  onOpen?: (item: InboxItemView) => void
}

export function useMarkAnswer({ item, markRow, markClient = MARK_CLIENT, onOpen }: UseMarkAnswerOptions) {
  const resolved = item.state === 'resolved'
  const archived = item.archived
  const markOpen = markRow && item.answerIn !== null && item.actionable && !resolved && !archived
  const answerHere = markOpen && item.answerIn === 'row'
  const answerInReview = markOpen && item.answerIn === 'review'
  const canResolveMark = answerHere && item.type === 'annotation.assigned_to_you'
  const [replying, setReplying] = useState(false)
  const [markBusy, setMarkBusy] = useState(false)
  const [markOutcome, setMarkOutcome] = useState<MarkOutcome | null>(null)
  const [untold, setUntold] = useState<string[]>([])

  const sendReply = async (body: string, { piloti, mentions }: ComposerSend): Promise<readonly MarkMention[] | void> => {
    if (!answerHere || !item.anchorId) return
    setMarkBusy(true)
    setMarkOutcome(null)
    try {
      const { annotation, replyId, wake } = await markClient.reply(item.resourceId, item.anchorId, {
        body: body.trim(),
        ...(piloti ? { addressesPiloti: true } : {}),
        ...(mentions.length > 0 ? { mentions } : {}),
      })
      const kept = annotation.replies.find((reply) => reply.id === replyId)?.mentions ?? []
      const keptIds = new Set(kept.map((mention) => mention.targetId))
      setUntold(
        mentions
          .filter((mention) => !isAgentMentionId(mention.targetId) && !keptIds.has(mention.targetId))
          .map((mention) => mention.display),
      )
      setReplying(false)
      setMarkOutcome(wake === 'off' ? 'sentAgentNotAsked' : 'sent')
      onOpen?.(item)
      return kept
    } finally {
      setMarkBusy(false)
    }
  }

  const sendResolve = async (anchorId: string): Promise<void> => {
    setMarkBusy(true)
    try {
      await markClient.update(item.resourceId, anchorId, { status: 'resolved', expectedStatus: 'open' })
    } catch (error) {
      setMarkOutcome(error instanceof AnnotationRequestError && error.status === 409 ? 'conflict' : 'failed')
    } finally {
      setMarkBusy(false)
    }
  }
  const resolveLater = useUndoableArchive(sendResolve)
  const resolveHeld = item.anchorId !== null && resolveLater.pendingIds.has(item.anchorId)

  const resolveMark = (): void => {
    if (!canResolveMark || !item.anchorId || markBusy) return
    setMarkOutcome('resolved')
    resolveLater.request(item.anchorId)
  }

  const undoResolve = (): void => {
    if (!item.anchorId) return
    resolveLater.undo(item.anchorId)
    setMarkOutcome(null)
  }

  const offerUndo = resolveHeld && !markBusy && markOutcome === 'resolved'

  return {
    answerHere,
    answerInReview,
    canResolveMark,
    replying,
    setReplying,
    markBusy,
    markOutcome,
    setMarkOutcome,
    untold,
    sendReply,
    resolveMark,
    undoResolve,
    offerUndo,
  }
}
