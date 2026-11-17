'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AnswerFeedbackReason, AnswerFeedbackVerdict } from '@/lib/db/schema/answer-feedback'
import { capturePosthog } from '@/lib/analytics/posthog'

export interface AnswerFeedbackState {
  verdict: AnswerFeedbackVerdict
  reason: AnswerFeedbackReason | null
  comment: string | null
  expectedAnswer: string | null
}

type ConversationFeedbackMap = Map<string, AnswerFeedbackState>

const conversationCache = new Map<string, Promise<ConversationFeedbackMap>>()

type VerdictListener = (next: AnswerFeedbackState | null) => void
const listeners = new Map<string, Set<VerdictListener>>()

function subscribeToVerdict(messageId: string, listener: VerdictListener): () => void {
  const set = listeners.get(messageId) ?? new Set<VerdictListener>()
  set.add(listener)
  listeners.set(messageId, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(messageId)
  }
}

export const REASON_GRACE_MS = 20_000

type Properties = Record<string, string | number | boolean | null>
const pendingDown = new Map<string, { properties: Properties; timer: ReturnType<typeof setTimeout> }>()

function flushPendingDown(messageId: string): void {
  const held = pendingDown.get(messageId)
  if (!held) return
  clearTimeout(held.timer)
  pendingDown.delete(messageId)
  capturePosthog('answer_feedback_submitted', held.properties)
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => [...pendingDown.keys()].forEach(flushPendingDown))
}

function recordVote(
  messageId: string,
  previous: AnswerFeedbackState | null,
  next: AnswerFeedbackState | null,
  ids: Properties,
): void {
  if (!next) {
    const held = pendingDown.get(messageId)
    if (held) clearTimeout(held.timer)
    pendingDown.delete(messageId)
    return
  }
  const properties: Properties = {
    verdict: next.verdict,
    reason: next.reason,
    has_comment: next.comment !== null || next.expectedAnswer !== null,
    comment_length: (next.comment?.length ?? 0) + (next.expectedAnswer?.length ?? 0),
    message_id: messageId,
    ...ids,
  }
  const held = pendingDown.get(messageId)
  if (held) {
    held.properties = { ...held.properties, ...properties }
    if (next.reason !== null) flushPendingDown(messageId)
    return
  }
  if (previous?.verdict === next.verdict && previous.reason === next.reason) return
  if (next.verdict === 'down' && next.reason === null) {
    pendingDown.set(messageId, { properties, timer: setTimeout(() => flushPendingDown(messageId), REASON_GRACE_MS) })
    return
  }
  capturePosthog('answer_feedback_submitted', properties)
}

export function __clearAnswerFeedbackCache(): void {
  conversationCache.clear()
  pendingDown.forEach((held) => clearTimeout(held.timer))
  pendingDown.clear()
}

async function loadConversationFeedback(conversationId: string): Promise<ConversationFeedbackMap> {
  try {
    const res = await fetch(
      `/api/feedback/answers?conversationId=${encodeURIComponent(conversationId)}`,
      { credentials: 'same-origin' },
    )
    if (!res.ok) return new Map()
    const data = (await res.json()) as {
      feedback?: {
        messageId: string
        verdict: AnswerFeedbackVerdict
        reason: AnswerFeedbackReason | null
        comment?: string | null
        expectedAnswer?: string | null
      }[]
    }
    return new Map(
      (data.feedback ?? []).map((f) => [
        f.messageId,
        {
          verdict: f.verdict,
          reason: f.reason ?? null,
          comment: f.comment ?? null,
          expectedAnswer: f.expectedAnswer ?? null,
        },
      ]),
    )
  } catch {
    return new Map()
  }
}

function updateCache(conversationId: string | null | undefined, messageId: string, next: AnswerFeedbackState | null): void {
  listeners.get(messageId)?.forEach((listener) => listener(next))
  if (!conversationId) return
  void conversationCache.get(conversationId)?.then((map) => {
    if (next) map.set(messageId, next)
    else map.delete(messageId)
  })
}

export interface UseAnswerFeedbackResult {
  state: AnswerFeedbackState | null
  setFeedback: (next: AnswerFeedbackState | null) => void
}

export function useAnswerFeedback(
  messageId: string,
  conversationId: string | null | undefined,
  projectId: string | null | undefined,
): UseAnswerFeedbackResult {
  const [state, setState] = useState<AnswerFeedbackState | null>(null)

  useEffect(() => {
    if (!conversationId) return
    let cancelled = false
    let promise = conversationCache.get(conversationId)
    if (!promise) {
      promise = loadConversationFeedback(conversationId)
      conversationCache.set(conversationId, promise)
    }
    void promise.then((map) => {
      if (cancelled) return
      const existing = map.get(messageId)
      if (existing) setState(existing)
    })
    return () => {
      cancelled = true
    }
  }, [conversationId, messageId])

  useEffect(() => subscribeToVerdict(messageId, setState), [messageId])

  const setFeedback = useCallback(
    (next: AnswerFeedbackState | null): void => {
      setState((previous) => {
        void (async () => {
          try {
            const res = next
              ? await fetch('/api/feedback/answers', {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    messageId,
                    verdict: next.verdict,
                    reason: next.reason,
                    comment: next.comment,
                    expectedAnswer: next.expectedAnswer,
                    conversationId: conversationId ?? null,
                    projectId: projectId ?? null,
                  }),
                })
              : await fetch(`/api/feedback/answers?messageId=${encodeURIComponent(messageId)}`, {
                  method: 'DELETE',
                  credentials: 'same-origin',
                })
            if (res.ok) {
              updateCache(conversationId, messageId, next)
              const body = (await res.json().catch(() => null)) as { traceId?: string | null } | null
              recordVote(messageId, previous, next, {
                conversation_id: conversationId ?? null,
                trace_id: body?.traceId ?? null,
                langfuse_trace_id: body?.traceId ?? null,
              })
            } else {
              setState(previous) // revert the optimistic update
            }
          } catch {
            setState(previous)
          }
        })()
        return next // optimistic
      })
    },
    [messageId, conversationId, projectId],
  )

  return { state, setFeedback }
}
