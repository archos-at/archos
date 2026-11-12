/**
 * @vitest-environment node
 */
/**
 * The server's Herleitung (`turn-steps.ts`) is the browser's: over every
 * recorded turn, the frames the agent tier keeps (`turn_record.touches_steps`)
 * fold to exactly the rows the asker's fold leaves on the question.
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
import { foldedTurnSteps, recordTurnSteps } from './turn-steps'
import { eventOf } from '@/test-utils/wire-v2-fixtures'

/** A Python `frozenset({...})` of strings in `turn_record.py`, read so the two sides cannot part. */
const pythonSet = (name: string): Set<string> => {
  const source = readFileSync(join(process.cwd(), '../agent-host/src/agent_host/turn_record.py'), 'utf8')
  const body = new RegExp(`^${name} = frozenset\\(([\\s\\S]*?)\\)$`, 'm').exec(source)?.[1]
  if (!body) throw new Error(`${name} not found in turn_record.py`)
  return new Set([...body.matchAll(/"([A-Za-z_]+)"/g)].map((match) => match[1]!))
}
const STEP_TYPES = pythonSet('STEP_FRAME_TYPES')
const STEP_CUSTOM_NAMES = pythonSet('STEP_CUSTOM_NAMES')
const keptByAgentTier = (frame: Record<string, unknown>): boolean =>
  STEP_TYPES.has(String(frame.type)) || (frame.type === 'CUSTOM' && STEP_CUSTOM_NAMES.has(String(frame.name)))

const ENDED = WIRE_TURN_FILES.filter((name) =>
  wireFixtureLines<Record<string, unknown>>(name).some((frame) => frame.type === 'RUN_FINISHED' || frame.type === 'RUN_ERROR')
)

describe('foldedTurnSteps', () => {
  it.each(ENDED)('stores what the asker’s browser stores for %s', (name) => {
    const frames = wireFixtureLines<Record<string, unknown>>(name)
    const browser = foldTurnEvents(undefined, frames.map(eventOf))!
    const first = frames[0]!

    const stored = foldedTurnSteps(String(first.conversation_id), String(first.turn_id), frames.filter(keptByAgentTier))

    expect(stored).toEqual(browser.stepOrder.map((id) => browser.steps[id]))
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
