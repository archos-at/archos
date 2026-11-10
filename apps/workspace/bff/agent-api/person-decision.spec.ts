/**
 * @vitest-environment node
 */
/**
 * The person's yes, held at the route (`person-decision.ts`): runs through the
 * real acting session the dispatcher binds, so what is tested is the guard a
 * route calls, not a stand-in for it.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { runAsActingSession } from './acting-session'
import { PersonDecisionRequiredError, personYesOf, requirePersonDecision } from './person-decision'

const SESSION = { userId: 'user_a', organizationId: 'org_a' } as unknown as AuthorizedSession
const decide = () => requirePersonDecision('publishing a change request')

describe('requirePersonDecision', () => {
  it("is the app outside an acting session: the person's own request", () => {
    expect(decide()).toBe('app')
  })

  it('refuses an agent call that carries no yes', async () => {
    await expect(runAsActingSession(SESSION, async () => decide(), 'agent')).rejects.toBeInstanceOf(
      PersonDecisionRequiredError,
    )
  })

  it('refuses an unverified MCP Apps call: it may be the model speaking', async () => {
    await expect(
      runAsActingSession(SESSION, async () => decide(), 'agent', personYesOf('app-unverified')),
    ).rejects.toBeInstanceOf(PersonDecisionRequiredError)
  })

  it('takes the elicited yes and records it as such', async () => {
    await expect(runAsActingSession(SESSION, async () => decide(), 'agent', personYesOf('elicitation'))).resolves.toBe(
      'elicitation',
    )
  })

  it('takes an accepted proposal as the yes given in the app', async () => {
    await expect(runAsActingSession(SESSION, async () => decide(), 'person', { proposalId: 'p_1' })).resolves.toBe('app')
  })

  it('answers 403 with a code the door relays', () => {
    const error = new PersonDecisionRequiredError('publishing')
    expect(error.status).toBe(403)
    expect(error.code).toBe('PERSON_DECISION_REQUIRED')
  })
})
