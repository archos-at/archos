/**
 * @vitest-environment node
 */
/**
 * The server's Herleitung (`turn-steps.ts`) is the browser's: over every
 * recorded turn and a row updated many times, the frames the agent tier keeps
 * (`turn_record.TurnFrames`) fold to exactly the rows the asker's fold leaves
 * on the question.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WIRE_TURN_FILES, frameOf, wireFixtureLines } from '@/test-utils/wire-v2-fixtures'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/conversations/repository', () => ({
  findConversationInOrg: vi.fn(),
  findMessageInConversation: vi.fn(),
  mergeMessageMetadata: vi.fn(),
}))

import { NotFoundError } from '@/lib/api/errors'
import { findConversationInOrg, findMessageInConversation, mergeMessageMetadata } from '@/lib/conversations/repository'
import { foldTurnEvents } from './turn-fold'
import { MAX_THINKING_STEPS_READ } from '@/lib/conversations/message-provenance'
import { MAX_TURN_STEP_FRAMES, foldedTurnSteps, recordTurnSteps } from './turn-steps'
import { eventOf } from '@/test-utils/wire-v2-fixtures'

const TURN_RECORD = (): string =>
  readFileSync(join(process.cwd(), '../agent-host/src/agent_host/turn_record.py'), 'utf8')

/** A Python `frozenset({...})` of strings in `turn_record.py`, read so the two sides cannot part. */
const pythonSet = (name: string): Set<string> => {
  const body = new RegExp(`^${name} = frozenset\\(([\\s\\S]*?)\\)$`, 'm').exec(TURN_RECORD())?.[1]
  if (!body) throw new Error(`${name} not found in turn_record.py`)
  return new Set([...body.matchAll(/"([A-Za-z_]+)"/g)].map((match) => match[1]!))
}
/** A Python integer constant in `turn_record.py`. */
const pythonInt = (name: string): number => {
  const value = new RegExp(`^${name} = (\\d+)$`, 'm').exec(TURN_RECORD())?.[1]
  if (!value) throw new Error(`${name} not found in turn_record.py`)
  return Number(value)
}
const STEP_TYPES = pythonSet('STEP_FRAME_TYPES')
const STEP_CUSTOM_NAMES = pythonSet('STEP_CUSTOM_NAMES')

type Frame = Record<string, unknown>
const stepOf = (frame: Frame) => frame.step as { id?: string; kind?: string; title?: string } | undefined
const rowIdOf = (frame: Frame): string | undefined => {
  if (frame.type === 'CUSTOM') return STEP_CUSTOM_NAMES.has(String(frame.name)) ? `steer:${(frame.value as { steer_id: string }).steer_id}` : undefined
  if (!STEP_TYPES.has(String(frame.type))) return undefined
  return String(frame.type).startsWith('STEP_') ? stepOf(frame)?.id : `subagent:${String(frame.subagent_run_id)}`
}
const endsSubagent = (frame: Frame) => frame.type === 'SUBAGENT_FINISHED' || frame.type === 'SUBAGENT_ERROR'

/**
 * What the agent tier hands over (`turn_record.TurnFrames`, held to this by
 * `test_turn_record.py`): per row, its first frame, the newest frame with a
 * skill title, and the newest frame (a subagent: up to its first end).
 */
const handedOver = (frames: readonly Frame[]): Frame[] => {
  const rows = new Map<string, { first: Frame; titled?: Frame; last?: Frame; closed: boolean }>()
  for (const frame of frames) {
    const id = rowIdOf(frame)
    if (id === undefined) continue
    const row = rows.get(id)
    const titled = stepOf(frame)?.kind === 'skill' && Boolean(stepOf(frame)?.title)
    if (!row) rows.set(id, { first: frame, titled: titled ? frame : undefined, closed: endsSubagent(frame) })
    else if (!row.closed) Object.assign(row, { last: frame, closed: endsSubagent(frame), ...(titled ? { titled: frame } : {}) })
  }
  const kept = new Set([...rows.values()].flatMap((row) => [row.first, row.titled, row.last].filter((frame) => frame !== undefined)))
  return [...kept].sort((a, b) => Number(a.seq) - Number(b.seq))
}

const browserRows = (frames: readonly Frame[]) => {
  const view = foldTurnEvents(undefined, frames.map(eventOf))!
  return view.stepOrder.map((id) => view.steps[id])
}

const ENDED = WIRE_TURN_FILES.filter((name) =>
  wireFixtureLines<Frame>(name).some((frame) => frame.type === 'RUN_FINISHED' || frame.type === 'RUN_ERROR')
)

describe('foldedTurnSteps', () => {
  it.each(ENDED)('stores what the asker’s browser stores for %s', (name) => {
    const frames = wireFixtureLines<Frame>(name)
    const first = frames[0]!

    const stored = foldedTurnSteps(String(first.conversation_id), String(first.turn_id), handedOver(frames))

    expect(stored).toEqual(browserRows(frames))
  })

  it('stores what the browser stores from a row updated many times: the last outcome, the carried title, the first end', () => {
    const tool = (seq: number, type: string, status: string) =>
      frameOf(seq, { type, step: { kind: 'tool', id: 'tool:1', tool: 'search', status } })
    const skill = (seq: number, phase: string, title?: string) =>
      frameOf(seq, { type: 'STEP_FINISHED', step: { kind: 'skill', id: 'skill:a', skill: 'a', phase, ...(title ? { title } : {}) } })
    const frames = [
      frameOf(1, { type: 'RUN_STARTED', message_id: 'answer-1' }),
      tool(2, 'STEP_STARTED', 'ok'),
      ...Array.from({ length: 20 }, (_, index) => tool(3 + index, 'STEP_STARTED', 'ok')),
      tool(23, 'STEP_FINISHED', 'error'),
      skill(24, 'offered'),
      skill(25, 'activated', 'Brandschutznachweis'),
      skill(26, 'loaded'),
      frameOf(27, { type: 'SUBAGENT_STARTED', subagent_run_id: 'sa_1', name: 'researcher-agent' }),
      frameOf(28, { type: 'SUBAGENT_ERROR', subagent_run_id: 'sa_1', message: 'failed', code: 'Boom' }),
      frameOf(29, { type: 'SUBAGENT_FINISHED', subagent_run_id: 'sa_1' }),
      frameOf(30, { type: 'CUSTOM', name: 'steer_received', value: { steer_id: 'st_1', text: 'die Treppe' } }),
      frameOf(31, { type: 'CUSTOM', name: 'steer_applied', value: { steer_id: 'st_1', round: 2 } }),
    ]

    const kept = handedOver(frames)
    const stored = foldedTurnSteps('conv_1', 'turn-1', kept)

    // The same seqs `test_turn_record.py` asserts the agent tier keeps of this turn.
    expect(kept.map((frame) => frame.seq)).toEqual([2, 23, 24, 25, 26, 27, 28, 30, 31])
    expect(stored).toEqual(browserRows([...frames, frameOf(32, { type: 'RUN_ERROR', code: 'workflow_error', message: 'x', details: 'x' })]))
    expect(stored.find((row) => row.id === 'tool:1')?.detail).toEqual({ status: 'error' })
  })

  it('takes its bounds from the agent tier’s, which take theirs from the stored Herleitung', () => {
    expect(pythonInt('MAX_STEP_ROWS')).toBe(MAX_THINKING_STEPS_READ)
    expect(pythonInt('MAX_STEP_FRAMES')).toBe(3 * MAX_THINKING_STEPS_READ)
    expect(MAX_TURN_STEP_FRAMES).toBe(pythonInt('MAX_STEP_FRAMES'))
  })

  it('folds frames whose seq has holes, out of order, once each, and only its own turn’s', () => {
    const step = (seq: number, type: string, id: string, turnId = 'turn-1') =>
      frameOf(seq, { type, step: { kind: 'tool', id, tool: 'search', status: 'ok' } }, turnId)
    const frames = [
      step(9, 'STEP_FINISHED', 's1'),
      step(3, 'STEP_STARTED', 's1'),
      step(3, 'STEP_STARTED', 's1'),
      step(14, 'STEP_STARTED', 's2'),
      step(5, 'STEP_STARTED', 'elsewhere', 'turn-2'),
      { not: 'a frame' },
    ]

    const stored = foldedTurnSteps('conv_1', 'turn-1', frames)

    expect(stored.map((row) => [row.id, row.isComplete, row.userMessageId])).toEqual([
      ['s1', true, 'turn-1'],
      // The turn has ended: a row whose end never came is closed, as the fold closes it at the terminal.
      ['s2', true, 'turn-1'],
    ])
    expect(stored[0]!.timestamp).toBe(new Date(1_759_000_000_030).toISOString())
  })
})

describe('recordTurnSteps', () => {
  const QUESTION = '4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f'
  const frames = [frameOf(2, { type: 'STEP_STARTED', step: { kind: 'tool', id: 's1', tool: 'search', status: 'ok' } }, QUESTION)]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findConversationInOrg).mockResolvedValue({ id: 'conv_1' } as never)
    vi.mocked(findMessageInConversation).mockResolvedValue({ id: QUESTION, role: 'user' } as never)
    vi.mocked(mergeMessageMetadata).mockResolvedValue({ id: QUESTION } as never)
  })

  it('replaces the question’s steps, the key the browser’s own write replaces, and keeps its other provenance', async () => {
    await expect(recordTurnSteps('org_1', 'conv_1', QUESTION, frames)).resolves.toEqual({ stored: 1 })

    expect(findConversationInOrg).toHaveBeenCalledWith('conv_1', 'org_1')
    const [, , patch, deep] = vi.mocked(mergeMessageMetadata).mock.calls[0]!
    expect(patch).toEqual({ provenance: { thinkingSteps: [expect.objectContaining({ id: 's1', isComplete: true })] } })
    expect(deep).toEqual(['provenance'])
  })

  it('writes nothing for a turn that took no step', async () => {
    await expect(recordTurnSteps('org_1', 'conv_1', QUESTION, [])).resolves.toEqual({ stored: 0 })
    expect(mergeMessageMetadata).not.toHaveBeenCalled()
  })

  it('refuses a conversation of another organization, and a message that is no question', async () => {
    vi.mocked(findConversationInOrg).mockResolvedValueOnce(null)
    await expect(recordTurnSteps('org_2', 'conv_1', QUESTION, frames)).rejects.toBeInstanceOf(NotFoundError)

    vi.mocked(findMessageInConversation).mockResolvedValueOnce({ id: QUESTION, role: 'assistant' } as never)
    await expect(recordTurnSteps('org_1', 'conv_1', QUESTION, frames)).rejects.toBeInstanceOf(NotFoundError)
    expect(mergeMessageMetadata).not.toHaveBeenCalled()
  })
})
