import { v4 as uuidv4 } from 'uuid'
import { watchConnectionWait } from '@/adapters/api/connection-wait'
import {
  createTurnSocket,
  type OpenTurn,
  type TurnSocket,
  type TurnSocketOptions,
  type TurnSocketStatus,
} from '@/adapters/api/turn-socket'
import type { ClientMessage, WireEvent } from '@/adapters/api/wire-v2'
import { foldTurnEvent, initialTurnView, isSteerRead, stopTurnView, type TurnView } from '@/lib/turns/turn-fold'
import { clampFocusRegion, type CanvasFocusRegion } from '@/features/chat/lib/canvas-bridge'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import type { ChatEffort } from '@/lib/reasoning-settings/catalog'
import { PRODUCT_NAME } from '@/lib/brand'

export const CANVAS_ACK_TIMEOUT_MS = 15_000
const ACK_MISSES_BEFORE_GIVING_UP = 2
const MAX_AUTH_EXPIRED = 3
const SILENT_DROPS_BEFORE_GIVING_UP = 2

export type FocusRegion = CanvasFocusRegion

type WireUserMessage = Extract<ClientMessage, { message_id: string }>

export type CanvasUserMessage = WireUserMessage & {
  focus_region?: FocusRegion | null
  reply_in_thread?: boolean
}

export interface CanvasQuestion {
  text: string
  region?: FocusRegion | null
  fileName?: string | null
  versionId?: string | null
  versionState?: DocumentVersionState | null
  shelf?: 'session' | 'project' | 'office_shelf' | null
  replyInThread?: boolean
  effort?: ChatEffort
}

export type CanvasDegradation = 'region' | 'thread'

export function canvasDegradations(
  message: CanvasUserMessage,
  accepts: (entry: string) => boolean
): CanvasDegradation[] {
  const dropped: CanvasDegradation[] = []
  if (message.focus_region && !accepts('user_message.focus_region')) dropped.push('region')
  if (message.reply_in_thread && !accepts('user_message.reply_in_thread')) dropped.push('thread')
  return dropped
}

export class CanvasTurnError extends Error {
  constructor(readonly code: 'busy' | 'closed') {
    super(code === 'busy' ? PRODUCT_NAME + ' is still answering the previous question' : 'The canvas client is closed')
    this.name = 'CanvasTurnError'
  }
}

export interface CanvasTurnClientOptions {
  conversationId: string
  conversationExists?: boolean
  projectId?: string | null
  documentId: string
  title: string
  onTurn: (view: TurnView) => void
  onConversation?: () => void
  onDegraded?: (turnId: string, dropped: CanvasDegradation[]) => void
  onRestoring?: (restoring: boolean) => void
  refreshAuth?: () => Promise<void>
  createSocket?: (options: TurnSocketOptions) => TurnSocket
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  ackTimeoutMs?: number
}

export interface CanvasTurnClient {
  readonly conversationId: string
  ensureConversation: () => Promise<void>
  ask: (question: CanvasQuestion, turnId: string) => Promise<void>
  cancel: (turnId: string) => void
  steer: (text: string, options?: { region?: FocusRegion | null; onLeftover?: (text: string) => void }) => boolean
  close: () => void
}

const openVersionState = (state: DocumentVersionState | null | undefined): CanvasUserMessage['focus_version_state'] =>
  state === 'draft' || state === 'in_review' || state === 'changes_requested' ? state : null

const jsonInit = (payload: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

export function canvasUserMessage(
  conversationId: string,
  documentId: string,
  turnId: string,
  question: CanvasQuestion
): CanvasUserMessage {
  return {
    type: 'user_message',
    conversation_id: conversationId,
    message_id: turnId,
    text: question.text,
    focus_file_name: question.fileName?.trim() || null,
    focus_shelf: question.shelf ?? 'project',
    focus_document_id: documentId,
    focus_version_id: question.versionId ?? null,
    focus_version_state: openVersionState(question.versionState),
    focus_region: question.region ? clampFocusRegion(question.region) : null,
    ...(question.replyInThread ? { reply_in_thread: true } : {}),
    reasoning_effort: question.effort ?? 'low',
  }
}

export function createCanvasTurnClient(options: CanvasTurnClientOptions): CanvasTurnClient {
  const { conversationId } = options
  const run = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init))
  const ackTimeout = options.ackTimeoutMs ?? CANVAS_ACK_TIMEOUT_MS
  const views = new Map<string, TurnView>()
  const gapsAttached = new Map<string, number>()
  const silentDrops = new Map<string, number>()
  let pending: {
    message: CanvasUserMessage
    timer: ReturnType<typeof setTimeout> | null
    misses: number
    degradedTold?: boolean
  } | null = null
  let running: string | null = null
  let conversation: Promise<void> | null = null
  let socket: TurnSocket | null = null
  let socketOpen = false
  let authExpired = 0
  let closed = false
  const steers = new Map<string, { turnId: string; text: string; onLeftover?: (text: string) => void }>()

  const settleSteers = (view: TurnView): void => {
    for (const [steerId, note] of [...steers]) {
      if (note.turnId !== view.turnId) continue
      steers.delete(steerId)
      if (isSteerRead(view, steerId) || view.outcome === 'cancelled' || !note.onLeftover) continue
      const leftover = note.onLeftover
      setTimeout(() => leftover(note.text), 0)
    }
  }

  const publish = (view: TurnView): void => {
    const previous = views.get(view.turnId)
    views.set(view.turnId, view)
    options.onTurn(view)
    if (view.phase !== 'running' && previous?.phase === 'running') settleSteers(view)
  }

  const forgetPending = (): void => {
    if (pending?.timer) clearTimeout(pending.timer)
    pending = null
  }

  const fail = (turnId: string, code: string, message: string): void => {
    if (pending?.message.message_id === turnId) forgetPending()
    if (running === turnId) running = null
    const view = views.get(turnId) ?? initialTurnView(turnId, conversationId)
    if (view.phase !== 'running') return
    publish({ ...view, phase: 'failed', streaming: false, interaction: undefined, error: { code, message } })
  }

  const awaitAck = (): void => {
    if (!pending) return
    if (pending.timer) clearTimeout(pending.timer)
    pending.timer = setTimeout(missedAck, ackTimeout)
  }

  function missedAck(): void {
    if (!pending) return
    pending.timer = null
    pending.misses += 1
    if (pending.misses >= ACK_MISSES_BEFORE_GIVING_UP) {
      fail(pending.message.message_id, 'agent.no_response', PRODUCT_NAME + ' did not answer')
      return
    }
    if (socketOpen) socket?.reconnect()
    awaitAck()
  }

  const sendPending = (): boolean => {
    if (!pending || !socket?.send(pending.message)) return false
    const dropped = canvasDegradations(pending.message, socket.accepts)
    if (dropped.length > 0 && !pending.degradedTold) {
      pending.degradedTold = true
      options.onDegraded?.(pending.message.message_id, dropped)
    }
    return true
  }

  const openTurns = (): OpenTurn[] => {
    if (!running || pending?.message.message_id === running) return []
    return [{ turnId: running, lastSeq: views.get(running)?.lastSeq ?? 0 }]
  }

  const attach = (turnId: string, afterSeq: number): void => {
    socket?.send({ type: 'attach', conversation_id: conversationId, turn_id: turnId, after_seq: afterSeq })
  }

  const rejected = (event: Extract<WireEvent, { type: 'CUSTOM'; name: 'rejected' }>): void => {
    const { turn_id: turnId, value } = event
    if (value.of === 'steer') return
    switch (value.code) {
      case 'auth_expired':
        authExpired += 1
        if (authExpired > MAX_AUTH_EXPIRED) return fail(turnId, 'auth.session_expired', 'The session expired')
        socket?.reconnect()
        return
      case 'duplicate_turn':
        if (pending?.message.message_id === turnId) forgetPending()
        attach(turnId, views.get(turnId)?.lastSeq ?? 0)
        return
      case 'turn_not_found':
      case 'conversation_mismatch':
      case 'invalid_message':
        if (value.of === 'cancel_turn') return
        return fail(turnId, value.of === 'user_message' ? 'agent.response_failed' : 'agent.response_interrupted', value.message ?? value.code)
      case 'not_asker':
      case 'no_pending_interaction':
        return
    }
  }

  const receive = (event: WireEvent): void => {
    if (!views.has(event.turn_id)) return
    if (event.type === 'CUSTOM' && event.name === 'rejected') return rejected(event)
    if (pending?.message.message_id === event.turn_id) forgetPending()
    if (event.type === 'RUN_STARTED') authExpired = 0
    silentDrops.delete(event.turn_id)
    const previous = views.get(event.turn_id)
    const next = foldTurnEvent(previous, event)
    if (next === previous) return
    if (next.gap && gapsAttached.get(next.turnId) !== next.lastSeq) {
      gapsAttached.set(next.turnId, next.lastSeq)
      attach(next.turnId, next.lastSeq)
    }
    if (next.phase !== 'running' && running === next.turnId) running = null
    publish(next)
  }

  const onStatus = (status: TurnSocketStatus): void => {
    socketOpen = status === 'open'
    if (status === 'open' && pending) sendPending()
    if (status === 'failed' || status === 'incompatible' || status === 'outdated') {
      if (running) fail(running, `connection.${status}`, 'The connection to ' + PRODUCT_NAME + ' gave up')
    }
  }

  const socketFor = (): TurnSocket => {
    socket ??= (options.createSocket ?? createTurnSocket)({
      conversationId,
      projectId: options.projectId ?? undefined,
      openTurns,
      refreshAuth: options.refreshAuth,
      onEvent: receive,
      onStatus: watchConnectionWait((restoring) => options.onRestoring?.(restoring), onStatus),
      onSilent: (turnIds) => {
        for (const turnId of turnIds) {
          const drops = (silentDrops.get(turnId) ?? 0) + 1
          silentDrops.set(turnId, drops)
          if (drops < SILENT_DROPS_BEFORE_GIVING_UP) continue
          silentDrops.delete(turnId)
          fail(turnId, 'agent.response_interrupted', PRODUCT_NAME + ' went silent')
        }
      },
    })
    return socket
  }

  const ensureConversation = (): Promise<void> => {
    if (options.conversationExists && !conversation) {
      conversation = Promise.resolve().then(() => options.onConversation?.())
    }
    conversation ??= (async () => {
      const response = await run(
        '/api/conversations',
        jsonInit({
          id: conversationId,
          title: options.title,
          projectId: options.projectId ?? null,
          subjectResourceType: 'document',
          subjectResourceId: options.documentId,
        })
      )
      if (!response.ok) throw new Error(`conversation ${response.status}`)
      options.onConversation?.()
    })().catch((error: unknown) => {
      conversation = null
      throw error
    })
    return conversation
  }

  const storeQuestion = async (turnId: string, text: string): Promise<void> => {
    const response = await run(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      jsonInit({ id: turnId, role: 'user', content: text, messageType: 'user' })
    )
    if (!response.ok) throw new Error(`message ${response.status}`)
  }

  return {
    conversationId,
    ensureConversation,
    ask: async (question, turnId) => {
      if (closed) throw new CanvasTurnError('closed')
      if (running) throw new CanvasTurnError('busy')
      running = turnId
      publish(initialTurnView(turnId, conversationId))
      try {
        await ensureConversation()
        await storeQuestion(turnId, question.text)
      } catch {
        return fail(turnId, 'canvas.not_stored', 'The question could not be stored')
      }
      if (closed || running !== turnId) return
      const message = canvasUserMessage(conversationId, options.documentId, turnId, question)
      pending = { message, timer: null, misses: 0 }
      awaitAck()
      const current = socketFor()
      if (!sendPending()) void current.connect()
    },
    cancel: (turnId) => {
      const view = views.get(turnId)
      const unasked = pending?.message.message_id === turnId
      if (unasked) forgetPending()
      if (running === turnId) running = null
      if (!view || view.phase !== 'running') return
      const stopped = stopTurnView(view, undefined)
      if (!unasked) {
        socket?.send({ type: 'cancel_turn', conversation_id: conversationId, turn_id: turnId, shown: stopped.shown })
      }
      publish(stopped.view)
    },
    steer: (text, steerOptions) => {
      const turnId = running
      if (!turnId || pending?.message.message_id === turnId || !socket?.accepts('steer')) return false
      const steerId = uuidv4()
      const region = steerOptions?.region
      steers.set(steerId, { turnId, text, onLeftover: steerOptions?.onLeftover })
      socket.send({
        type: 'steer',
        conversation_id: conversationId,
        turn_id: turnId,
        steer_id: steerId,
        text,
        ...(region ? { focus_region: clampFocusRegion(region) } : {}),
      })
      return true
    },
    close: () => {
      closed = true
      forgetPending()
      running = null
      socket?.close()
      socket = null
    },
  }
}
