// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { actingDoor, actingProposalId, actingReaderIsAgent, currentActingSession, runAsActingSession } from './acting-session'
import { callsTo, nodesOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'

const ALLOWED = new Set(['bff/agent-api/acting-session.ts', 'bff/agent-api/dispatch.ts'])
const ENTRY = 'runAsActingSession'

function mentionsEntry(source: ts.SourceFile): boolean {
  return nodesOf(source, ts.isIdentifier).some((identifier) => identifier.text === ENTRY)
}

describe('the acting session', () => {
  it('is entered only by the dispatcher', () => {
    const dispatcher = parseSource('bff/agent-api/dispatch.ts')
    expect(callsTo(dispatcher, ENTRY)).not.toHaveLength(0)
    expect(productionSources()).toContain('bff/agent-api/dispatch.ts')

    const callers = productionSources().filter((file) => !ALLOWED.has(file) && mentionsEntry(parseSource(file)))
    expect(callers).toEqual([])
  })

  it('says whether an agent reads the answer, so the route words it in English', async () => {
    const session = { userId: 'user_1' } as AuthorizedSession
    expect(actingReaderIsAgent()).toBe(false)
    await runAsActingSession(session, async () => {
      expect(currentActingSession()).toBe(session)
      expect(actingReaderIsAgent()).toBe(true)
    }, 'agent')
    await runAsActingSession(session, async () => expect(actingReaderIsAgent()).toBe(false))
    expect(currentActingSession()).toBeUndefined()
  })

  it('names the proposal a call applies, and none outside that call or for any other', async () => {
    const session = { userId: 'user_1' } as AuthorizedSession
    await runAsActingSession(session, async () => expect(actingProposalId()).toBe('prop-1'), 'person', { proposalId: 'prop-1' })
    await runAsActingSession(session, async () => expect(actingProposalId()).toBeUndefined(), 'agent')
    expect(actingProposalId()).toBeUndefined()
  })

  it('names the agent door the call came through, and none outside a door', async () => {
    const session = { userId: 'user_1' } as AuthorizedSession
    await runAsActingSession(
      session,
      async () => expect(actingDoor()).toEqual({ door: 'mcp', sessionSource: 'mcp' }),
      'agent',
      { door: 'mcp', sessionSource: 'mcp' },
    )
    await runAsActingSession(session, async () => expect(actingDoor()).toBeUndefined(), 'agent')
    expect(actingDoor()).toBeUndefined()
  })
})
