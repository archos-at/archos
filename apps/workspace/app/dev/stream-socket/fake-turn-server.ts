import { parseWireEvent, type ShownAnswer, type WireEvent } from '@/adapters/api/wire-v2'
import { foldTurnEvents } from '@/lib/turns/turn-fold'
import { stoppedAnswer } from '@/lib/turns/stopped-answer'
import { CONVERSATION_PLACEHOLDER, TURN_PLACEHOLDER, type FrameKind, type TurnScript } from './turn-script'

export interface SocketProbeSink {
  onOpen: () => void
  onUserMessage: (at: number, index: number) => void
  onFrameHandled: (kind: FrameKind, sentAt: number, handledAt: number) => void
  onHeartbeat: () => void
  onAttach?: (afterSeq: number, frames: number) => void
}

export interface ResumeTurn {
  index: number
  turnId: string
  conversationId: string
  startedAtEpoch: number
}

export interface FakeTurnServer {
  uninstall: () => void
  drop: () => void
  running: () => ResumeTurn | null
}

const WORKER_SOURCE = `
let turns = []
const timers = new Map()
const now = () => performance.timeOrigin + performance.now()
self.onmessage = (event) => {
  const message = event.data
  if (message.type === 'load') { turns = message.turns; return }
  if (message.type === 'stop') { clearTimeout(timers.get(message.index)); timers.set(message.index, -1); return }
  if (message.type !== 'start') return
  const frames = turns[message.index] || []
  const fill = (data) => data.split(${JSON.stringify(TURN_PLACEHOLDER)}).join(message.turnId)
    .split(${JSON.stringify(CONVERSATION_PLACEHOLDER)}).join(message.conversationId)
    .replace('"ts":0', '"ts":' + Math.round(now()))
  const started = message.startedAtEpoch
  let index = 0
  const tick = () => {
    if (timers.get(message.index) === -1) return
    const elapsed = now() - started
    while (index < frames.length && frames[index].at <= elapsed) {
      const frame = frames[index++]
      self.postMessage({ index: message.index, seq: index, kind: frame.kind, sentAt: now(), data: fill(frame.data) })
    }
    if (index < frames.length) timers.set(message.index, setTimeout(tick, Math.max(0, frames[index].at - (now() - started))))
    else self.postMessage({ index: message.index, kind: 'end', sentAt: now() })
  }
  tick()
}
`

interface WorkerFrame {
  index: number
  seq?: number
  kind: FrameKind | 'end'
  sentAt: number
  data?: string
}

interface LoggedFrame {
  seq: number
  kind: FrameKind
  data: string
}

interface ServerTurn extends ResumeTurn {
  log: LoggedFrame[]
  follower: FakeTurnSocket | null
  ended: boolean
}

const pageTime = (epoch: number): number => epoch - performance.timeOrigin
const epochNow = (): number => performance.timeOrigin + performance.now()

const OPEN = 1
const CLOSED = 3

const sentText = (log: readonly LoggedFrame[]): string => {
  let text = ''
  for (const { data } of log) {
    const frame = JSON.parse(data) as { type?: string; name?: string; delta?: string; snapshot?: { text?: string } }
    if (frame.type === 'TEXT_MESSAGE_CONTENT') text += frame.delta ?? ''
    if (frame.type === 'STATE_SNAPSHOT') text = frame.snapshot?.text ?? text
    if (frame.name === 'answer_retracted') text = ''
  }
  return text
}

const stoppedResult = (log: readonly LoggedFrame[], shown: ShownAnswer, messageId: string): Record<string, unknown> => {
  const events = log
    .filter((frame) => frame.seq <= shown.seq)
    .map((frame) => parseWireEvent(JSON.parse(frame.data)))
    .filter((event): event is WireEvent => event !== null)
  const view = foldTurnEvents(undefined, events)
  if (!view) return { message_id: messageId, text: '' }
  const kept = stoppedAnswer(
    { text: view.text, settled: view.settled, sources: view.sources, cards: view.cards },
    shown.chars
  )
  return {
    message_id: messageId,
    text: kept.text,
    ...(kept.sources.length > 0 && { sources: kept.sources }),
    ...(kept.cards.length > 0 && { cards: kept.cards }),
    ...(view.answerMeta && { answer_meta: view.answerMeta }),
  }
}

interface FakeTurnSocket {
  readonly conversationId: string
  readyState: number
  deliver: (data: string) => void
  drop: () => void
}

export const installFakeTurnServer = (
  script: TurnScript,
  sink: SocketProbeSink,
  onScriptEnd: (lastSentAt: number) => void,
  options: { resume?: ResumeTurn } = {}
): FakeTurnServer => {
  const RealWebSocket = window.WebSocket
  const workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
  const worker = new Worker(workerUrl)
  worker.postMessage({ type: 'load', turns: script.turns.map((turn) => turn.frames) })
  const turns: ServerTurn[] = []
  const sockets = new Set<FakeTurnSocket>()

  const forward = (turn: ServerTurn, frame: LoggedFrame, sentAt: number): void => {
    const socket = turn.follower
    if (!socket || socket.readyState !== OPEN) return
    socket.deliver(frame.data)
    if (frame.kind === 'heartbeat') sink.onHeartbeat()
    else sink.onFrameHandled(frame.kind, sentAt, performance.now())
  }

  worker.onmessage = (event: MessageEvent<WorkerFrame>) => {
    const message = event.data
    const turn = turns[message.index]
    if (!turn || turn.ended) return
    if (message.kind === 'end') {
      turn.ended = true
      if (message.index === script.turns.length - 1) onScriptEnd(pageTime(message.sentAt))
      return
    }
    if (!message.data || message.seq === undefined) return
    const frame = { seq: message.seq, kind: message.kind, data: message.data }
    turn.log.push(frame)
    forward(turn, frame, pageTime(message.sentAt))
  }

  const start = (turn: ServerTurn): void => {
    turns[turn.index] = turn
    const { index, turnId, conversationId, startedAtEpoch } = turn
    worker.postMessage({ type: 'start', index, turnId, conversationId, startedAtEpoch })
  }

  const cancel = (turn: ServerTurn, shown: ShownAnswer | undefined): void => {
    if (turn.ended) return
    worker.postMessage({ type: 'stop', index: turn.index })
    turn.ended = true
    const seq = turn.log.length + 1
    const terminal = {
      v: 2,
      conversation_id: turn.conversationId,
      turn_id: turn.turnId,
      seq,
      ts: Date.now(),
      type: 'RUN_FINISHED',
      outcome: 'cancelled',
      result: shown
        ? stoppedResult(turn.log, shown, messageIdOf(turn))
        : { message_id: messageIdOf(turn), text: sentText(turn.log) },
    }
    const frame = { seq, kind: 'terminal' as const, data: JSON.stringify(terminal) }
    turn.log.push(frame)
    forward(turn, frame, performance.now())
  }

  const messageIdOf = (turn: ServerTurn): string => {
    const started = turn.log[0] && (JSON.parse(turn.log[0].data) as { message_id?: string })
    return started?.message_id ?? ''
  }

  class Socket implements FakeTurnSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = OPEN
    static readonly CLOSING = 2
    static readonly CLOSED = CLOSED

    readonly url: string
    readonly conversationId: string = ''
    readonly protocol = ''
    readonly extensions = ''
    binaryType: BinaryType = 'blob'
    bufferedAmount = 0
    readyState = 0
    onopen: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null

    constructor(url: string | URL, protocols?: string | string[]) {
      const href = new URL(String(url), window.location.href)
      this.url = String(url)
      if (!href.pathname.endsWith('/websocket')) {
        return new RealWebSocket(url, protocols) as unknown as Socket
      }
      this.conversationId = href.searchParams.get('conversationId') ?? ''
      sockets.add(this)
      window.setTimeout(() => {
        if (this.readyState === CLOSED) return
        this.readyState = OPEN
        this.onopen?.(new Event('open'))
        this.deliver(
          JSON.stringify({
            v: 2,
            type: 'CUSTOM',
            name: 'hello',
            ts: Date.now(),
            value: { build: 'dev', accepts: ['cancel_turn.shown'] },
          })
        )
        sink.onOpen()
      }, 20)
    }

    send(raw: string): void {
      const message = JSON.parse(raw) as {
        type?: string
        message_id?: string
        turn_id?: string
        after_seq?: number
        shown?: ShownAnswer
      }
      if (message.type === 'user_message') return this.ask(message.message_id)
      const turnId = message.turn_id ?? ''
      if (message.type === 'attach') return this.attach(turnId, message.after_seq ?? 0)
      if (message.type === 'cancel_turn') {
        const turn = turns.find((candidate) => candidate?.turnId === turnId)
        if (turn && !turn.ended) cancel(turn, message.shown)
        else this.reject('cancel_turn', turnId)
      }
    }

    private ask(messageId: string | undefined): void {
      if (!messageId || turns.some((turn) => turn?.turnId === messageId)) return
      const index = turns.length
      if (index >= script.turns.length) return
      sink.onUserMessage(performance.now(), index)
      start({ index, turnId: messageId, conversationId: this.conversationId, startedAtEpoch: epochNow(), log: [], follower: this, ended: false })
    }

    private attach(turnId: string, afterSeq: number): void {
      const turn = turns.find((candidate) => candidate?.turnId === turnId)
      if (turn) {
        const replay = turn.log.filter((frame) => frame.seq > afterSeq)
        turn.follower = this
        sink.onAttach?.(afterSeq, replay.length)
        replay.forEach((frame) => forward(turn, frame, performance.now()))
        return
      }
      const resume = options.resume
      if (resume?.turnId === turnId) {
        sink.onAttach?.(afterSeq, 0)
        start({ ...resume, log: [], follower: this, ended: false })
        return
      }
      this.reject('attach', turnId)
    }

    private reject(of: 'attach' | 'cancel_turn', turnId: string): void {
      this.deliver(
        JSON.stringify({
          v: 2,
          conversation_id: this.conversationId,
          turn_id: turnId,
          seq: 0,
          ts: Date.now(),
          type: 'CUSTOM',
          name: 'rejected',
          value: { of, code: 'turn_not_found', message: null },
        })
      )
    }

    deliver(data: string): void {
      if (this.readyState === OPEN) this.onmessage?.(new MessageEvent('message', { data }))
    }

    drop(): void {
      this.shut(1006, false)
    }

    close(): void {
      this.shut(1000, true)
    }

    private shut(code: number, wasClean: boolean): void {
      if (this.readyState === CLOSED) return
      this.readyState = CLOSED
      sockets.delete(this)
      for (const turn of turns) if (turn?.follower === this) turn.follower = null
      this.onclose?.(new CloseEvent('close', { code, wasClean }))
    }

    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return true
    }
  }

  window.WebSocket = Socket as unknown as typeof WebSocket
  return {
    uninstall: () => {
      window.WebSocket = RealWebSocket
      worker.terminate()
      URL.revokeObjectURL(workerUrl)
    },
    drop: () => [...sockets].forEach((socket) => socket.drop()),
    running: () => {
      const turn = turns.findLast((candidate) => candidate && !candidate.ended)
      return turn ? { index: turn.index, turnId: turn.turnId, conversationId: turn.conversationId, startedAtEpoch: turn.startedAtEpoch } : null
    },
  }
}
