import type { FocusBox } from './fake-annotation-api'
import { answerAboutBox, checkFixed, reviewDocument } from './fake-annotation-api'
import type { ScriptedTurn } from './scripted-turns'
import { safely, stopTurn, turns } from './scripted-turns'

const ACCEPTS = ['user_message.focus_region', 'user_message.reply_in_thread', 'cancel_turn.shown']

const stringOf = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

const focusOf = (raw: unknown): FocusBox | null => {
  if (!raw || typeof raw !== 'object') return null
  const { page, x, y, w, h, annotation_id: annotationId } = raw as Record<string, unknown>
  const numbers = [page, x, y, w, h]
  if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
  const [p, bx, by, bw, bh] = numbers as number[]
  return { page: p, x: bx, y: by, w: bw, h: bh, annotationId: stringOf(annotationId) }
}

type RejectedCode = 'duplicate_turn' | 'turn_not_found' | 'invalid_message' | 'no_pending_interaction'
type RejectedOf = 'user_message' | 'interaction_response' | 'cancel_turn' | 'attach' | 'unknown'

export class FakeTurnSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(readonly url: string) {
    setTimeout(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.onopen?.(new Event('open'))
      this.deliver({ type: 'CUSTOM', name: 'hello', v: 2, ts: Date.now(), value: { build: 'dev-annotations', accepts: ACCEPTS } })
    }, 40)
  }

  deliver(frame: unknown) {
    setTimeout(() => {
      if (this.readyState === 1) safely(() => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) })))
    }, 0)
  }

  send(data: unknown) {
    safely(() => this.receive(String(data)))
  }

  close(code = 1000) {
    if (this.readyState >= 2) return
    this.readyState = 3
    for (const turn of turns.values()) if (turn.socket === this) turn.socket = null
    setTimeout(() => safely(() => this.onclose?.(new CloseEvent('close', { code, wasClean: true }))), 0)
  }

  addEventListener() {}
  removeEventListener() {}

  private reject(code: RejectedCode, of: RejectedOf, ids: { conversation_id?: unknown; turn_id?: unknown }) {
    this.deliver({
      type: 'CUSTOM',
      name: 'rejected',
      v: 2,
      seq: 0,
      ts: Date.now(),
      conversation_id: stringOf(ids.conversation_id) ?? 'unknown',
      turn_id: stringOf(ids.turn_id) ?? 'unknown',
      value: { code, of, message: null },
    })
  }

  private receive(data: string) {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(data) as Record<string, unknown>
    } catch {
      return this.reject('invalid_message', 'unknown', {})
    }
    switch (message.type) {
      case 'user_message':
        return this.ask(message)
      case 'attach':
        return this.attach(message)
      case 'cancel_turn': {
        const turn = turns.get(String(message.turn_id))
        return turn ? stopTurn(turn) : this.reject('turn_not_found', 'cancel_turn', message)
      }
      case 'interaction_response':
        return this.reject('no_pending_interaction', 'interaction_response', message)
      default:
        return this.reject('invalid_message', 'unknown', message)
    }
  }

  private ask(message: Record<string, unknown>) {
    const turnId = stringOf(message.message_id)
    const conversationId = stringOf(message.conversation_id)
    if (!turnId || !conversationId || !stringOf(message.text)) return this.reject('invalid_message', 'user_message', message)
    if (turns.has(turnId)) return this.reject('duplicate_turn', 'user_message', message)
    const turn: ScriptedTurn = {
      turnId,
      conversationId,
      messageId: `${turnId}-answer`,
      log: [],
      socket: this,
      timer: null,
      text: '',
      done: false,
    }
    turns.set(turnId, turn)
    const box = focusOf(message.focus_region)
    const text = stringOf(message.text) ?? ''
    if (box) answerAboutBox(turn, box, message.reply_in_thread === true)
    else if (/behoben|fixed/.test(text)) checkFixed(turn, text)
    else reviewDocument(turn)
  }

  private attach(message: Record<string, unknown>) {
    const turn = turns.get(String(message.turn_id))
    if (!turn) return this.reject('turn_not_found', 'attach', message)
    turn.socket = this
    const after = typeof message.after_seq === 'number' ? message.after_seq : 0
    for (const frame of turn.log) if (Number(frame.seq) > after) this.deliver(frame)
  }
}

export const isTurnSocket = (url: string | URL) => {
  try {
    return new URL(String(url), window.location.href).pathname === '/websocket'
  } catch {
    return false
  }
}
