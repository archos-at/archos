'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { canvasChatSender, canvasChatSteerer } from '@/features/chat/lib/canvas-bridge'
import type { TurnView } from '@/lib/turns/turn-fold'
import { useChatStore } from '@/features/chat/store'
import { runningTurnIn } from '@/features/chat/stores/messages-store'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import { documentThread } from '@/lib/annotations/client'
import { regionAround } from '@/lib/annotations/types'
import {
  CanvasTurnError,
  createCanvasTurnClient,
  type CanvasDegradation,
  type CanvasQuestion,
  type CanvasTurnClient,
  type CanvasTurnClientOptions,
} from '../lib/canvas-turn-client'

export interface CanvasAskRegion {
  page: number
  x: number
  y: number
  w: number
  h: number
}

export const CANVAS_ASK_INTENTS = ['what', 'dimensions', 'oib', 'question'] as const
export type CanvasAskIntent = (typeof CANVAS_ASK_INTENTS)[number]

export type CanvasAskStatus =
  | 'composing'
  | 'thinking'
  | 'answered'
  | 'declined'
  | 'handedOff'
  | 'stopped'
  | 'failed'

export type CanvasAskBackend = 'chat' | 'canvas'

export interface CheckFixedScope {
  documentId: string
  annotationIds: readonly string[]
}

export interface CanvasAsk {
  id: string
  turnId: string | null
  backend: CanvasAskBackend | null
  region: CanvasAskRegion | null
  annotationId: string | null
  replyInThread: boolean
  question: string
  intent: CanvasAskIntent | null
  view: TurnView | null
  status: CanvasAskStatus
  error: string | null
  baseline: number
  effort: CanvasQuestion['effort'] | null
  degraded: CanvasDegradation[]
  checkFixed: CheckFixedScope | null
}

export interface CanvasAskInput {
  id?: string
  text: string
  region: CanvasAskRegion | null
  annotationId?: string | null
  replyInThread?: boolean
  intent?: CanvasAskIntent | null
  baseline?: number
  effort?: CanvasQuestion['effort'] | null
  turnId?: string
  checkFixed?: CheckFixedScope | null
}

export interface UseCanvasAskOptions {
  documentId: string
  enabled: boolean
  projectId?: string | null
  fileName?: string | null
  versionId?: string | null
  versionState?: DocumentVersionState | null
  shelf?: CanvasQuestion['shelf']
  refreshAuth?: () => Promise<void>
  chatHosted?: boolean
  createClient?: (options: CanvasTurnClientOptions) => CanvasTurnClient
  resolveThread?: (documentId: string, title: string) => Promise<string>
}

export const canvasConversationHref = (conversationId: string, projectId?: string | null): string =>
  projectId
    ? `/app/projects/${encodeURIComponent(projectId)}/chat?session=${encodeURIComponent(conversationId)}`
    : `/app/chat?session=${encodeURIComponent(conversationId)}`

export const askRegionOf = (place: {
  page: number
  x: number
  y: number
  w?: number | null
  h?: number | null
}): CanvasAskRegion => regionAround(place)

export const stepsOf = (view: TurnView | null): StoredThinkingStep[] =>
  view ? view.stepOrder.flatMap((id) => (view.steps[id] ? [view.steps[id]] : [])) : []

export function statusOf(view: TurnView): CanvasAskStatus {
  if (view.phase === 'running') return 'thinking'
  if (view.phase === 'failed') return 'failed'
  if (view.result?.job_admission_rejected || view.outcome === 'refused') return 'declined'
  if (view.result?.run || view.outcome === 'handed_off') return 'handedOff'
  if (view.outcome === 'cancelled') return 'stopped'
  return 'answered'
}

const blankAsk = (id: string): CanvasAsk => ({
  id,
  turnId: null,
  backend: null,
  region: null,
  annotationId: null,
  replyInThread: false,
  question: '',
  intent: null,
  view: null,
  status: 'composing',
  error: null,
  baseline: 0,
  effort: null,
  degraded: [],
  checkFixed: null,
})

export function useCanvasAsk(options: UseCanvasAskOptions) {
  const t = useTranslations(filesCopy)
  const { documentId, enabled, projectId } = options
  const [asks, setAsksState] = useState<CanvasAsk[]>([])
  const [openId, setOpenIdState] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const client = useRef<CanvasTurnClient | null>(null)
  const clientPending = useRef<Promise<CanvasTurnClient> | null>(null)
  const asksRef = useRef<CanvasAsk[]>([])
  const openRef = useRef<string | null>(null)
  const latest = useRef(options)
  const title = t('review.piloti.conversationTitle', { name: options.fileName ?? '' })
  const titleRef = useRef(title)
  useEffect(() => {
    latest.current = options
    titleRef.current = title
  })

  const setAsks = useCallback((update: (current: CanvasAsk[]) => CanvasAsk[]) => {
    asksRef.current = update(asksRef.current)
    setAsksState(asksRef.current)
  }, [])
  const patch = useCallback(
    (id: string, change: Partial<CanvasAsk>) =>
      setAsks((current) => current.map((ask) => (ask.id === id ? { ...ask, ...change } : ask))),
    [setAsks]
  )
  const setOpen = useCallback((id: string | null) => {
    openRef.current = id
    setOpenIdState(id)
  }, [])

  const remove = useCallback(
    (id: string) => {
      setAsks((current) => current.filter((ask) => ask.id !== id))
      if (openRef.current === id) setOpen(null)
    },
    [setAsks, setOpen]
  )

  const onTurn = useCallback(
    (view: TurnView) => {
      const entry = asksRef.current.find((ask) => ask.turnId === view.turnId)
      if (!entry || entry.view === view) return
      const status = statusOf(view)
      if (entry.replyInThread && status === 'answered' && !entry.degraded.includes('thread')) return remove(entry.id)
      patch(entry.id, { view, status })
    },
    [patch, remove]
  )

  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.turns === previous.turns) return
        for (const ask of asksRef.current) {
          if (ask.backend !== 'chat' || !ask.turnId || ask.status !== 'thinking') continue
          const view = state.turns[ask.turnId]
          if (view) onTurn(view)
          else if (previous.turns[ask.turnId]) patch(ask.id, { status: 'failed', error: 'interrupted' })
        }
      }),
    [onTurn, patch]
  )

  const clientFor = useCallback((): Promise<CanvasTurnClient> => {
    if (client.current) return Promise.resolve(client.current)
    const current = latest.current
    const resolveThread =
      current.resolveThread ?? ((documentId: string, title: string) => documentThread(documentId, { title }))
    clientPending.current ??= resolveThread(current.documentId, titleRef.current)
      .then((id) => {
        if (latest.current.documentId !== current.documentId) throw new CanvasTurnError('closed')
        client.current ??= (current.createClient ?? createCanvasTurnClient)({
          conversationId: id,
          conversationExists: true,
          projectId: current.projectId,
          documentId: current.documentId,
          title: titleRef.current,
          refreshAuth: current.refreshAuth,
          onTurn,
          onConversation: () => setConversationId(id),
          onDegraded: (turnId, dropped) =>
            setAsks((asks) => asks.map((ask) => (ask.turnId === turnId ? { ...ask, degraded: dropped } : ask))),
        })
        return client.current
      })
      .finally(() => {
        clientPending.current = null
      })
    return clientPending.current
  }, [onTurn, setAsks])

  useEffect(() => {
    return () => {
      client.current?.close()
      client.current = null
      clientPending.current = null
      setAsks(() => [])
      setOpen(null)
      setConversationId(null)
    }
  }, [documentId, setAsks, setOpen])

  const available = enabled && Boolean(projectId)
  const chatBusy = useChatStore((state) =>
    Boolean(options.chatHosted && runningTurnIn(state.turns, state.currentConversation?.id))
  )

  const askRef = useRef<((input: CanvasAskInput) => string) | null>(null)

  const steer = useCallback((text: string, region: CanvasAskRegion | null = null): boolean => {
    const note = text.trim()
    if (!note) return false
    const onLeftover = (leftover: string) => void askRef.current?.({ text: leftover, region })
    const running = asksRef.current.find((entry) => entry.status === 'thinking' && entry.turnId)
    if (running?.backend === 'canvas') return client.current?.steer(note, { region, onLeftover }) ?? false
    if (!latest.current.chatHosted) return false
    const chat = useChatStore.getState()
    if (!runningTurnIn(chat.turns, chat.currentConversation?.id)) return false
    return canvasChatSteerer()?.({ text: note, focusRegion: region, onLeftover }) ?? false
  }, [])

  const open = useCallback(
    (id: string | null) => {
      const previous = openRef.current
      if (previous && previous !== id) {
        setAsks((current) => current.filter((ask) => !(ask.id === previous && ask.status === 'composing')))
      }
      setOpen(id)
    },
    [setAsks, setOpen]
  )

  const compose = useCallback(
    (region: CanvasAskRegion, extra?: { annotationId?: string | null }): string => {
      const id = uuidv4()
      setAsks((current) => [
        ...current.filter((ask) => ask.status !== 'composing'),
        { ...blankAsk(id), region, annotationId: extra?.annotationId ?? null },
      ])
      setOpen(id)
      return id
    },
    [setAsks, setOpen]
  )

  const askInChat = useCallback(
    (entry: CanvasAsk, question: CanvasQuestion): boolean => {
      const send = latest.current.chatHosted ? canvasChatSender() : null
      if (!send) return false
      const chat = useChatStore.getState()
      if (runningTurnIn(chat.turns, chat.currentConversation?.id)) {
        patch(entry.id, { backend: 'chat', status: 'failed', error: 'busy' })
        return true
      }
      const opened = send({
        text: question.text,
        effort: question.effort,
        focus: {
          documentId: latest.current.documentId,
          fileName: question.fileName ?? null,
          versionId: question.versionId ?? null,
          versionState: question.versionState ?? null,
          shelf: question.shelf ?? 'project',
          region: question.region ?? null,
          replyInThread: Boolean(question.replyInThread),
        },
      })
      if (!opened) {
        patch(entry.id, { backend: 'chat', status: 'failed', error: 'not_sent' })
        return true
      }
      patch(entry.id, { backend: 'chat', turnId: opened.turnId })
      setConversationId(opened.conversationId)
      const view = useChatStore.getState().turns[opened.turnId]
      if (view) onTurn(view)
      return true
    },
    [onTurn, patch]
  )

  const ask = useCallback(
    (input: CanvasAskInput): string => {
      const working = asksRef.current.find(
        (entry) => entry.status === 'thinking' && entry.turnId && entry.id !== input.id
      )
      const chat = useChatStore.getState()
      const chatWorking = latest.current.chatHosted && runningTurnIn(chat.turns, chat.currentConversation?.id)
      if ((working || chatWorking) && !input.replyInThread && steer(input.text, input.region)) {
        setAsks((current) => current.filter((entry) => !(entry.id === input.id && entry.status === 'composing')))
        if (working) setOpen(working.id)
        else if (openRef.current === input.id) setOpen(null)
        return working?.id ?? input.id ?? ''
      }
      const id = uuidv4()
      const entry: CanvasAsk = {
        ...blankAsk(id),
        region: input.region,
        annotationId: input.annotationId ?? null,
        replyInThread: Boolean(input.replyInThread),
        question: input.text,
        intent: input.intent ?? null,
        status: 'thinking',
        baseline: input.baseline ?? 0,
        effort: input.effort ?? null,
        checkFixed: input.checkFixed ?? null,
      }
      setAsks((current) => [...current.filter((existing) => existing.id !== input.id), entry])
      if (!entry.replyInThread && entry.region) setOpen(id)
      else if (openRef.current === input.id) setOpen(null)
      const { fileName, versionId, versionState, shelf } = latest.current
      const region = input.region
      const question: CanvasQuestion = {
        text: input.text,
        region: region ? { ...region, ...(input.annotationId ? { annotation_id: input.annotationId } : {}) } : null,
        fileName,
        versionId,
        versionState,
        shelf,
        replyInThread: entry.replyInThread,
        effort: input.effort ?? undefined,
      }
      if (askInChat(entry, question)) return id
      const turnId = input.turnId ?? id
      patch(id, { backend: 'canvas', turnId })
      clientFor()
        .then((canvasClient) => canvasClient.ask(question, turnId))
        .catch((error: unknown) =>
          patch(id, { status: 'failed', error: error instanceof CanvasTurnError ? error.code : 'unknown' })
        )
      return id
    },
    [askInChat, clientFor, patch, setAsks, setOpen, steer]
  )
  useEffect(() => {
    askRef.current = ask
  })

  const dismiss = useCallback(
    (id: string) => {
      const entry = asksRef.current.find((existing) => existing.id === id)
      if (entry?.status === 'thinking' && entry.turnId) {
        if (entry.backend === 'canvas') client.current?.cancel(entry.turnId)
        else {
          const chat = useChatStore.getState()
          const view = chat.turns[entry.turnId]
          if (view?.phase === 'running' && chat.currentConversation?.id === view.conversationId) chat.stopStreaming()
        }
      }
      remove(id)
    },
    [remove]
  )

  const retry = useCallback(
    (id: string) => {
      const entry = asksRef.current.find((existing) => existing.id === id)
      if (!entry || entry.status === 'composing') return
      ask({
        id,
        text: entry.question,
        region: entry.region,
        annotationId: entry.annotationId,
        replyInThread: entry.replyInThread,
        intent: entry.intent,
        baseline: entry.baseline,
        effort: entry.effort,
        checkFixed: entry.checkFixed,
      })
    },
    [ask]
  )

  const conversationHref = conversationId ? canvasConversationHref(conversationId, projectId) : null

  return useMemo(
    () => ({
      available,
      asks,
      openId,
      open,
      busy: chatBusy || asks.some((entry) => entry.status === 'thinking'),
      compose,
      ask,
      steer,
      dismiss,
      retry,
      conversationHref,
    }),
    [available, chatBusy, asks, openId, open, compose, ask, steer, dismiss, retry, conversationHref]
  )
}

export type CanvasAskState = ReturnType<typeof useCanvasAsk>
