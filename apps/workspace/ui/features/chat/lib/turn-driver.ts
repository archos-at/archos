import { v4 as uuidv4 } from 'uuid'
import { createTurnSocket, type OpenTurn } from '@/adapters/api/turn-socket'
import { browserPageLifecycle, isActive, sleptThrough } from '@/adapters/api/page-lifecycle'
import type { ClientMessage, ShownAnswer, WireEvent } from '@/adapters/api/wire-v2'
import { invalidateHealthCache } from '@/shared/hooks/use-backend-health'
import { isSteerRead, type TurnView } from '@/lib/turns/turn-fold'
import { watchRestoring } from '../connection-restoring'
import { useChatStore } from '../store'
import { clampFocusRegion, type CanvasFocusRegion } from './canvas-bridge'
import { fetchRunMessage } from './commissioned-run'
import { endFailedTurn, endInterruptedTurn, ending } from './turn-endings'
import { STAGE_COUNT } from './turn-projection'
import { dropViewerActions, newViewerActions, proposeViewerAction, releaseViewerActions } from './viewer-actions'

export const DELTA_FLUSH_MS = 100

const STAGE_WIRE_TTL_MS = 10 * 60_000

const MAX_CONSECUTIVE_AUTH_EXPIRED = 3

const MAX_WAITING = 8

export const ACK_TIMEOUT_MS = 15_000

const ACK_MISSES_BEFORE_GIVING_UP = 2

const SILENT_DROPS_BEFORE_GIVING_UP = 2

type Rejection = Extract<WireEvent, { type: 'CUSTOM'; name: 'rejected' }>
export type UserMessage = Extract<ClientMessage, { message_id: string }>

export interface DriverHooks {
  refreshAuth: () => Promise<void>
  onConnected: (connected: boolean, steerOffered: boolean) => void
  onGaveUp: () => Promise<'network' | 'other'>
  onOffline: () => void
  onQueueFull: (text: string, retryAfterSeconds: number | null) => void
}

export interface TurnDriver {
  conversationId: string
  projectId: string | undefined
  connect: () => Promise<void>
  close: () => void
  busy: () => boolean
  ask: (message: UserMessage) => void
  deliver: (message: ClientMessage) => void
  cancel: (turnId: string, shown?: ShownAnswer) => void
  steer: (turnId: string, text: string, options?: SteerOptions) => boolean
}

export interface SteerOptions {
  focusRegion?: CanvasFocusRegion | null
  onLeftover?: (text: string) => void
}

interface SentSteer {
  turnId: string
  text: string
  onLeftover?: (text: string) => void
}

const store = () => useChatStore.getState()


export const createTurnDriver = (conversationId: string, projectId: string | undefined, hooks: DriverHooks): TurnDriver => {
  const unacknowledged = new Map<string, ClientMessage>()
  const ackDeadlines = new Map<string, ReturnType<typeof setTimeout>>()
  const ackMisses = new Map<string, number>()
  const silentDrops = new Map<string, number>()
  const sent = new Map<string, ClientMessage>()
  const waiting: ClientMessage[] = []
  const finishedAt = new Map<string, number>()
  const gapsAttached = new Map<string, number>()
  let buffer: WireEvent[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let authExpired = 0
  let socketOpen = false
  const steers = new Map<string, SentSteer>()
  const asked = new Set<string>()

  const keyOf = (message: ClientMessage): string =>
    `${message.type}:${'turn_id' in message ? message.turn_id : message.message_id}`

  const lifecycle = browserPageLifecycle()

  const openTurns = (): OpenTurn[] => {
    const now = Date.now()
    return Object.values(store().turns).flatMap((view): OpenTurn[] => {
      if (view.conversationId !== conversationId || unacknowledged.has(view.turnId)) return []
      if (ending.has(view.turnId)) return []
      if (view.phase === 'running') return [{ turnId: view.turnId, lastSeq: view.lastSeq }]
      const finished = finishedAt.get(view.turnId)
      const stagesPending =
        view.phase === 'finished' &&
        view.outcome !== 'cancelled' &&
        finished !== undefined &&
        now - finished < STAGE_WIRE_TTL_MS &&
        Object.keys(view.stages).length < STAGE_COUNT
      return stagesPending ? [{ turnId: view.turnId, lastSeq: view.lastSeq, settled: true }] : []
    })
  }

  const forget = (turnId: string): void => {
    unacknowledged.delete(turnId)
    clearTimeout(ackDeadlines.get(turnId))
    ackDeadlines.delete(turnId)
    ackMisses.delete(turnId)
  }

  const awaitAck = (turnId: string): void => {
    clearTimeout(ackDeadlines.get(turnId))
    const armedAt = Date.now()
    ackDeadlines.set(turnId, setTimeout(() => missedAck(turnId, armedAt), ACK_TIMEOUT_MS))
  }

  function missedAck(turnId: string, armedAt: number): void {
    ackDeadlines.delete(turnId)
    if (!unacknowledged.has(turnId)) return
    if (!isActive(lifecycle) || sleptThrough(armedAt, ACK_TIMEOUT_MS)) return awaitAck(turnId)
    const misses = (ackMisses.get(turnId) ?? 0) + 1
    if (misses >= ACK_MISSES_BEFORE_GIVING_UP) {
      forget(turnId)
      const view = store().turns[turnId]
      if (view?.phase === 'running') endFailedTurn(view, { code: 'agent.no_response' })
      return
    }
    ackMisses.set(turnId, misses)
    if (socketOpen) socket.reconnect()
    awaitAck(turnId)
  }

  const silent = (turnIds: readonly string[]): void => {
    flush()
    for (const turnId of turnIds) {
      const drops = (silentDrops.get(turnId) ?? 0) + 1
      silentDrops.set(turnId, drops)
      const view = store().turns[turnId]
      if (drops < SILENT_DROPS_BEFORE_GIVING_UP || view?.phase !== 'running') continue
      silentDrops.delete(turnId)
      endInterruptedTurn(view)
    }
  }

  const socket = createTurnSocket({
    conversationId,
    projectId,
    openTurns,
    refreshAuth: hooks.refreshAuth,
    onEvent: (event) => receive(event),
    onSilent: silent,
    onStatus: watchRestoring(conversationId, (status) => {
      socketOpen = status === 'open'
      hooks.onConnected(socketOpen, socketOpen && socket.accepts('steer'))
      if (status === 'open') opened()
      else if (status === 'offline') hooks.onOffline()
      else if (status === 'failed' || status === 'incompatible' || status === 'outdated') gaveUp(status)
    }),
  })

  const deliver = (message: ClientMessage): void => {
    if (message.type !== 'user_message' || message.context_only) sent.set(keyOf(message), message)
    if (socket.send(message)) return
    waiting.push(message)
    if (waiting.length > MAX_WAITING) waiting.shift()
  }

  const opened = (): void => {
    invalidateHealthCache()
    store().dismissConnectionErrors()
    for (const message of unacknowledged.values()) socket.send(message)
    for (const message of waiting.splice(0)) deliver(message)
  }

  const runningTurns = (): TurnView[] =>
    Object.values(store().turns).filter((view) => view.conversationId === conversationId && view.phase === 'running')

  const endEverything = (): void => {
    flush()
    for (const turnId of [...unacknowledged.keys()]) forget(turnId)
    waiting.length = 0
    for (const view of runningTurns()) endInterruptedTurn(view)
  }

  const gaveUp = (status: 'failed' | 'incompatible' | 'outdated'): void => {
    if (status === 'outdated') store().addErrorCard('connection.client_outdated')
    else if (status === 'incompatible') store().addErrorCard('connection.server_incompatible')
    if (status !== 'failed') return endEverything()
    void hooks.onGaveUp().then((cause) => {
      if (cause === 'other' && !socketOpen) endEverything()
    })
  }

  const settleSteers = (view: TurnView): void => {
    for (const [steerId, note] of [...steers]) {
      if (note.turnId !== view.turnId) continue
      steers.delete(steerId)
      if (isSteerRead(view, steerId) || view.outcome === 'cancelled') continue
      const leftover = note.onLeftover
      if (leftover) setTimeout(() => leftover(note.text), 0)
    }
  }

  const react = (previous: TurnView | undefined, view: TurnView | undefined): void => {
    if (!view) return
    if (asked.has(view.turnId) && view.messageId) {
      for (const call of newViewerActions(previous?.viewerActions, view.viewerActions)) {
        proposeViewerAction(view.messageId, call)
      }
      const ended = view.phase !== 'running' && (previous === undefined || previous.phase === 'running')
      if (ended && view.phase === 'finished' && view.outcome === 'answered' && view.text) {
        void releaseViewerActions(view.messageId)
      } else if (ended) {
        dropViewerActions(view.messageId)
      }
    }
    if (view.phase !== 'running' && previous?.phase === 'running') settleSteers(view)
    if (view.gap && gapsAttached.get(view.turnId) !== view.lastSeq) {
      gapsAttached.set(view.turnId, view.lastSeq)
      socket.send({ type: 'attach', conversation_id: conversationId, turn_id: view.turnId, after_seq: view.lastSeq })
    }
    if (view.phase === 'failed' && previous?.phase !== 'failed') endFailedTurn(view)
    const result = view.result
    if (!result || result === previous?.result) return
    if (result.job_admission_rejected) hooks.onQueueFull(result.text, result.retry_after_seconds)
    const run = result.run
    if (run) {
      void fetchRunMessage(conversationId, run.run_message_id).then((message) => {
        if (message) store().adoptRunMessage(conversationId, message)
      })
    }
  }

  const flush = (): void => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    const events = buffer
    buffer = []
    if (events.length === 0) return
    const before = store().turns
    store().applyTurnEvents(events)
    const after = store().turns
    for (const turnId of new Set(events.map((event) => event.turn_id))) react(before[turnId], after[turnId])
  }

  const lost = (turnId: string): void => {
    flush()
    forget(turnId)
    const view = store().turns[turnId]
    if (view?.phase === 'running') endInterruptedTurn(view)
    else if (view) store().dropTurn(turnId)
  }

  const rejected = ({ turn_id: turnId, value }: Rejection): void => {
    const view = store().turns[turnId]
    if (value.of === 'steer' && value.code !== 'auth_expired') {
      if (view && view.phase !== 'running') settleSteers(view)
      return
    }
    switch (value.code) {
      case 'auth_expired': {
        authExpired += 1
        if (authExpired > MAX_CONSECUTIVE_AUTH_EXPIRED) {
          authExpired = 0
          store().addErrorCard('auth.session_expired')
          forget(turnId)
          if (view?.phase === 'running') store().failTurn(turnId)
          return
        }
        const refused = sent.get(`${value.of}:${turnId}`)
        if (refused) waiting.push(refused)
        socket.close()
        void socket.connect()
        return
      }
      case 'duplicate_turn':
        forget(turnId)
        socket.send({ type: 'attach', conversation_id: conversationId, turn_id: turnId, after_seq: view?.lastSeq ?? 0 })
        return
      case 'turn_not_found':
        if (value.of === 'cancel_turn') store().keepStoppedAnswer(turnId)
        return lost(turnId)
      case 'conversation_mismatch':
      case 'invalid_message':
        if (value.of === 'attach' || value.of === 'cancel_turn') return lost(turnId)
        if (value.of !== 'user_message') return
        forget(turnId)
        store().dropTurn(turnId)
        store().addErrorCard('agent.response_failed', value.message ?? undefined)
        return
      case 'not_asker':
      case 'no_pending_interaction':
        return
    }
  }

  function receive(event: WireEvent): void {
    if (unacknowledged.has(event.turn_id)) {
      ackMisses.delete(event.turn_id)
      awaitAck(event.turn_id)
    }
    if (event.type === 'CUSTOM' && event.name === 'rejected') return rejected(event)
    silentDrops.delete(event.turn_id)
    if (event.type === 'RUN_STARTED') {
      forget(event.turn_id)
      authExpired = 0
    }
    if (event.type === 'RUN_FINISHED') finishedAt.set(event.turn_id, Date.now())
    buffer.push(event)
    if (event.type !== 'TEXT_MESSAGE_CONTENT') flush()
    else flushTimer ??= setTimeout(flush, DELTA_FLUSH_MS)
  }

  return {
    conversationId,
    projectId,
    connect: socket.connect,
    close: () => {
      flush()
      for (const turnId of [...unacknowledged.keys()]) forget(turnId)
      socket.close()
    },
    busy: () => unacknowledged.size > 0 || openTurns().length > 0,
    ask: (message) => {
      asked.add(message.message_id)
      unacknowledged.set(message.message_id, message)
      awaitAck(message.message_id)
      if (!socket.send(message)) void socket.connect()
    },
    deliver,
    cancel: (turnId, shown) => {
      flush()
      forget(turnId)
      deliver({ type: 'cancel_turn', conversation_id: conversationId, turn_id: turnId, ...(shown && { shown }) })
    },
    steer: (turnId, text, options) => {
      if (!socket.accepts('steer')) return false
      const steerId = uuidv4()
      const message: ClientMessage = {
        type: 'steer',
        conversation_id: conversationId,
        turn_id: turnId,
        steer_id: steerId,
        text,
        ...(options?.focusRegion ? { focus_region: clampFocusRegion(options.focusRegion) } : {}),
      }
      steers.set(steerId, { turnId, text, onLeftover: options?.onLeftover })
      sent.set(keyOf(message), message)
      socket.send(message)
      return true
    },
  }
}
