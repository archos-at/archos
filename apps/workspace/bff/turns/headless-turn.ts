import 'server-only'
import WebSocket from 'ws'
import {
  createTurnSocket,
  type TurnSocket,
  type TurnSocketOptions,
  type WebSocketLike,
} from '@/adapters/api/turn-socket'
import type { ClientMessage } from '@/adapters/api/wire-v2'
import { affinityEnabled, createBackendTargetPicker } from '@/lib/proxy/backend-target.js'

export type HeadlessUserMessage = Extract<ClientMessage, { message_id: string; text: string }>

export type HeadlessTurnOutcome =
  | { kind: 'started' }
  | { kind: 'duplicate' }
  | { kind: 'busy' }
  | { kind: 'refused'; reason: string }
  | { kind: 'rejected'; code: string; message: string | null }
  | { kind: 'unavailable'; reason: string }

export interface HeadlessTurnRequest {
  url: string
  conversationId: string
  projectId?: string
  headers: Record<string, string>
  message: HeadlessUserMessage
  requires: readonly string[]
  detachAfterMs?: number
  timeoutMs?: number
  createSocket?: (options: TurnSocketOptions) => TurnSocket
  createWebSocket?: (url: string, headers: Record<string, string>) => WebSocketLike
}

const DEFAULT_DETACH_AFTER_MS = 5_000
const DEFAULT_TIMEOUT_MS = 45_000

export function nodeWebSocket(url: string, headers: Record<string, string>): WebSocketLike {
  const socket = new WebSocket(url, { headers })
  socket.on('error', (error) => console.warn('[headless-turn] socket error:', error.message))
  return socket as unknown as WebSocketLike
}

export function chatSocketUrl(conversationId: string, env: Record<string, string | undefined> = process.env): string {
  const chat = (env.BACKEND_CHAT_URL ?? '').trim().replace(/\/$/, '')
  if (!chat) throw new Error('BACKEND_CHAT_URL is not set: the wake has no chat socket to open')
  const pick = createBackendTargetPicker({
    replicas: Math.max(1, Number.parseInt(env.BACKEND_REPLICAS ?? '1', 10) || 1),
    podTemplate: env.BACKEND_POD_WS_TEMPLATE ?? '',
    affinity: affinityEnabled(env.CHAT_AFFINITY),
    serviceUrl: chat.replace(/^http/, 'ws'),
  })
  return `${pick(conversationId)}/websocket`
}

export function runHeadlessTurn(request: HeadlessTurnRequest): Promise<HeadlessTurnOutcome> {
  const { message } = request
  const detachAfterMs = request.detachAfterMs ?? DEFAULT_DETACH_AFTER_MS
  return new Promise((resolve) => {
    let settled = false
    let started = false
    let detach: ReturnType<typeof setTimeout> | null = null
    let socket: TurnSocket | null = null

    const finish = (outcome: HeadlessTurnOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (detach) clearTimeout(detach)
      socket?.close()
      resolve(outcome)
    }

    const deadline = setTimeout(
      () => finish(started ? { kind: 'started' } : { kind: 'unavailable', reason: 'no answer in time' }),
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )

    socket = (request.createSocket ?? createTurnSocket)({
      conversationId: request.conversationId,
      projectId: request.projectId,
      url: request.url,
      openTurns: () => [],
      ladder: { baseMs: 500, maxMs: 2_000, budget: 3 },
      createWebSocket: (url) => (request.createWebSocket ?? nodeWebSocket)(url, request.headers),
      onStatus: (status) => {
        if (status === 'failed' || status === 'incompatible' || status === 'outdated') {
          finish(started ? { kind: 'started' } : { kind: 'unavailable', reason: `socket ${status}` })
          return
        }
        if (status !== 'open' || started || !socket) return
        const missing = request.requires.filter((entry) => !socket?.accepts(entry))
        if (missing.length > 0) {
          finish({ kind: 'unavailable', reason: `the server does not read ${missing.join(', ')}` })
          return
        }
        if (!socket.send(message)) finish({ kind: 'unavailable', reason: 'the socket would not take the message' })
      },
      onEvent: (event) => {
        if (event.turn_id !== message.message_id) return
        if (event.type === 'CUSTOM' && event.name === 'rejected') {
          if (event.value.of !== 'user_message') return
          const { code } = event.value
          if (code === 'busy') return finish({ kind: 'busy' })
          if (code === 'duplicate_turn') return finish({ kind: 'duplicate' })
          return finish({ kind: 'rejected', code, message: event.value.message ?? null })
        }
        if (event.type === 'RUN_FINISHED') {
          return finish(
            event.outcome === 'refused'
              ? { kind: 'refused', reason: event.result.text.trim() || 'refused' }
              : { kind: 'started' }
          )
        }
        if (event.type === 'RUN_STARTED') {
          started = true
          detach = setTimeout(() => finish({ kind: 'started' }), detachAfterMs)
          return
        }
        if (started) finish({ kind: 'started' })
      },
    })
    void socket.connect()
  })
}

export type HeadlessCancelOutcome =
  | { kind: 'sent' }
  | { kind: 'not_running' }
  | { kind: 'rejected'; code: string; message: string | null }
  | { kind: 'unavailable'; reason: string }

export interface HeadlessCancelRequest {
  url: string
  conversationId: string
  turnId: string
  headers: Record<string, string>
  graceMs?: number
  timeoutMs?: number
  createSocket?: (options: TurnSocketOptions) => TurnSocket
  createWebSocket?: (url: string, headers: Record<string, string>) => WebSocketLike
}

const DEFAULT_CANCEL_GRACE_MS = 2_000
const DEFAULT_CANCEL_TIMEOUT_MS = 20_000

export function cancelHeadlessTurn(request: HeadlessCancelRequest): Promise<HeadlessCancelOutcome> {
  const graceMs = request.graceMs ?? DEFAULT_CANCEL_GRACE_MS
  return new Promise((resolve) => {
    let settled = false
    let sent = false
    let socket: TurnSocket | null = null
    let grace: ReturnType<typeof setTimeout> | null = null

    const finish = (outcome: HeadlessCancelOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (grace) clearTimeout(grace)
      socket?.close()
      resolve(outcome)
    }

    const deadline = setTimeout(
      () => finish({ kind: 'unavailable', reason: 'no answer in time' }),
      request.timeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS
    )

    socket = (request.createSocket ?? createTurnSocket)({
      conversationId: request.conversationId,
      url: request.url,
      openTurns: () => [],
      ladder: { baseMs: 500, maxMs: 2_000, budget: 3 },
      createWebSocket: (url) => (request.createWebSocket ?? nodeWebSocket)(url, request.headers),
      onStatus: (status) => {
        if (status === 'failed' || status === 'incompatible' || status === 'outdated') {
          finish({ kind: 'unavailable', reason: `socket ${status}` })
          return
        }
        if (status !== 'open' || sent || !socket) return
        sent = true
        const accepted = socket.send({
          type: 'cancel_turn',
          conversation_id: request.conversationId,
          turn_id: request.turnId,
        })
        if (!accepted) return finish({ kind: 'unavailable', reason: 'the socket would not take the stop' })
        grace = setTimeout(() => finish({ kind: 'sent' }), graceMs)
      },
      onEvent: (event) => {
        if (event.turn_id !== request.turnId) return
        if (event.type === 'CUSTOM' && event.name === 'rejected' && event.value.of === 'cancel_turn') {
          const { code } = event.value
          return finish(
            code === 'turn_not_found'
              ? { kind: 'not_running' }
              : { kind: 'rejected', code, message: event.value.message ?? null }
          )
        }
        if (event.type === 'RUN_FINISHED') finish({ kind: 'sent' })
      },
    })
    void socket.connect()
  })
}
