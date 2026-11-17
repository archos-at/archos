// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { actingProposalId, actingReaderIsAgent, currentActingSession, runAsActingSession } from './acting-session'
import { SOURCE_DIRS, srcKey } from '@/test-utils/source-tree'


const ALLOWED = new Set(['lib/agent-api/acting-session.ts', 'lib/agent-api/dispatch.ts'])

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) found.push(path)
  }
  return found
}

describe('the acting session', () => {
  it('is entered only by the dispatcher', () => {
    const callers = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(process.cwd(), dir)))
      .filter((file) => readFileSync(file, 'utf8').includes('runAsActingSession'))
      .map((file) => srcKey(file))
      .filter((file) => !ALLOWED.has(file))
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
})
