import type { z } from 'zod'
import type { wireEventSchema } from '@/adapters/api/wire-v2'
import type { FakeTurnSocket } from './fake-turn-socket'
import { agentPeer } from './fixtures'
import { broadcast } from './room-broadcast'
import type { OIB_RL_4 } from './scripted-replies'

type Unenveloped<F> = F extends unknown ? Omit<F, 'v' | 'seq' | 'ts' | 'turn_id' | 'conversation_id'> : never
type WireBody = Unenveloped<z.input<typeof wireEventSchema>>

const DELTA_MS = 120
const DELTAS = 10

export interface ScriptedTurn {
  turnId: string
  conversationId: string
  messageId: string
  log: Record<string, unknown>[]
  socket: FakeTurnSocket | null
  timer: ReturnType<typeof setTimeout> | null
  text: string
  done: boolean
}

export const turns = new Map<string, ScriptedTurn>()

export const safely = (run: () => void) => {
  try {
    run()
  } catch (error) {
    console.warn('[dev/annotations] scripted turn', error)
  }
}

const deltasOf = (text: string): string[] => {
  const words = text.split(/(?<= )/)
  const size = Math.ceil(words.length / DELTAS)
  return Array.from({ length: Math.ceil(words.length / size) }, (_, index) => words.slice(index * size, (index + 1) * size).join(''))
}

export const emit = (turn: ScriptedTurn, body: WireBody) => {
  const frame = { v: 2, conversation_id: turn.conversationId, turn_id: turn.turnId, seq: turn.log.length + 1, ts: Date.now(), ...body }
  turn.log.push(frame)
  turn.socket?.deliver(frame)
}

export const play = (turn: ScriptedTurn, steps: ReadonlyArray<readonly [after: number, run: () => void]>, index = 0) => {
  const step = steps[index]
  if (!step) return
  turn.timer = setTimeout(() => {
    if (turn.done) return
    safely(step[1])
    play(turn, steps, index + 1)
  }, step[0])
}

export const streamAnswer = (turn: ScriptedTurn, text: string): Array<readonly [number, () => void]> => [
  [400, () => emit(turn, { type: 'TEXT_MESSAGE_START', message_id: turn.messageId })],
  ...deltasOf(text).map(
    (delta) =>
      [
        DELTA_MS,
        () => {
          turn.text += delta
          emit(turn, { type: 'TEXT_MESSAGE_CONTENT', message_id: turn.messageId, delta })
        },
      ] as const
  ),
  [DELTA_MS, () => emit(turn, { type: 'TEXT_MESSAGE_END', message_id: turn.messageId })],
]

export const finish = (turn: ScriptedTurn, text: string, sources: (typeof OIB_RL_4)[]) => {
  emit(turn, { type: 'RUN_FINISHED', outcome: 'answered', result: { message_id: turn.messageId, text, sources } })
  turn.done = true
  broadcast({ kind: 'activity', peer: agentPeer, state: 'idle' })
}

export const synthesis = { id: 'step-synthesis', kind: 'status', slot: 'synthesis', key: 'status.synthesis' } as const

export const stopTurn = (turn: ScriptedTurn) => {
  if (turn.timer) clearTimeout(turn.timer)
  turn.timer = null
  if (turn.done) return
  emit(turn, { type: 'RUN_FINISHED', outcome: 'cancelled', result: { message_id: turn.messageId, text: turn.text } })
  turn.done = true
  broadcast({ kind: 'activity', peer: agentPeer, state: 'idle' })
}
