import { STREAM_FRAMES } from '../_fixtures/stream-frames'
import { v2Scenario, type ErrorPhase, type StreamScenario } from '../_fixtures/v2-scenarios'

export const TURN_PLACEHOLDER = '__STREAM_SOCKET_TURN__'
export const CONVERSATION_PLACEHOLDER = '__STREAM_SOCKET_CONVERSATION__'
export const ANSWER_MESSAGE_ID = 'stream-socket-answer'
export const answerMessageId = (index: number): string => (index === 0 ? ANSWER_MESSAGE_ID : `${ANSWER_MESSAGE_ID}-${index + 1}`)

export type FrameKind = 'step' | 'delta' | 'response' | 'snapshot' | 'terminal' | 'heartbeat'

export interface ScriptFrame {
  at: number
  kind: FrameKind
  data: string
}

export interface ScriptTurn {
  question: string
  frames: ScriptFrame[]
}

export interface TurnScript {
  question: string
  frames: ScriptFrame[]
  turns: ScriptTurn[]
  stepBytes: number
  maxFrameBytes: number
  totalBytes: number
}

const kindOf = (frame: Record<string, unknown>): FrameKind => {
  if (frame.type === 'STEP_STARTED' || frame.type === 'STEP_FINISHED') return 'step'
  if (frame.type === 'TEXT_MESSAGE_CONTENT') return 'delta'
  if (frame.type === 'RUN_FINISHED' || frame.type === 'RUN_ERROR') return 'terminal'
  if (frame.type === 'STATE_SNAPSHOT') return 'snapshot'
  if (frame.name === 'heartbeat') return 'heartbeat'
  return 'response'
}

export interface ScriptOptions {
  scenario?: StreamScenario
  error?: ErrorPhase
}

export const buildTurnScript = (speed: number, { scenario = 'happy', error }: ScriptOptions = {}): TurnScript => {
  const recordings = scenario === 'two-turns' ? [STREAM_FRAMES.oib2, STREAM_FRAMES.varianten] : [STREAM_FRAMES.oib2]
  const turns = recordings.map((recording, index) => {
    const ids = { conversationId: CONVERSATION_PLACEHOLDER, turnId: TURN_PLACEHOLDER, messageId: answerMessageId(index) }
    const frames = v2Scenario(scenario, recording, ids, speed, index === 0 ? error : undefined).map(({ at, frame }) => ({
      at,
      kind: kindOf(frame),
      data: JSON.stringify(frame),
    }))
    return { question: recording.question, frames }
  })
  const encoder = new TextEncoder()
  const all = turns.flatMap((turn) => turn.frames)
  const bytes = (kinds: FrameKind[]) => all.filter((f) => kinds.includes(f.kind)).map((f) => encoder.encode(f.data).length)
  return {
    question: turns[0].question,
    frames: turns[0].frames,
    turns,
    stepBytes: bytes(['step']).reduce((sum, n) => sum + n, 0),
    maxFrameBytes: Math.max(0, ...bytes(['step', 'delta', 'response', 'heartbeat'])),
    totalBytes: bytes(['step', 'delta', 'response', 'snapshot', 'heartbeat', 'terminal']).reduce((sum, n) => sum + n, 0),
  }
}
