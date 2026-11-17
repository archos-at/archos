import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'
import type { AuthorizedSession } from '@/lib/auth/types'

export type ActingReader = 'agent' | 'person'

interface ActingCall {
  readonly session: AuthorizedSession
  readonly reader: ActingReader
  readonly proposalId?: string
  readonly decisionSource?: ActingDecisionSource
  readonly clientId?: string
}

export type ActingDecisionSource = 'elicitation' | 'app' | 'app-unverified'

export interface ActingOrigin {
  readonly proposalId?: string
  readonly decisionSource?: ActingDecisionSource
  readonly clientId?: string
}

const acting = new AsyncLocalStorage<ActingCall>()

export function runAsActingSession<T>(
  session: AuthorizedSession,
  fn: () => Promise<T>,
  reader: ActingReader = 'person',
  origin: ActingOrigin = {},
): Promise<T> {
  return acting.run(
    {
      session,
      reader,
      ...(origin.proposalId ? { proposalId: origin.proposalId } : {}),
      ...(origin.decisionSource ? { decisionSource: origin.decisionSource } : {}),
      ...(origin.clientId ? { clientId: origin.clientId } : {}),
    },
    fn,
  )
}

export function currentActingSession(): AuthorizedSession | undefined {
  return acting.getStore()?.session
}

export function actingReaderIsAgent(): boolean {
  return acting.getStore()?.reader === 'agent'
}

export function actingProposalId(): string | undefined {
  return acting.getStore()?.proposalId
}

export function actingDecision(): { proposalId?: string; decisionSource?: ActingDecisionSource } | undefined {
  const call = acting.getStore()
  if (!call) return undefined
  return { proposalId: call.proposalId, decisionSource: call.decisionSource }
}

export function actingClientId(): string | undefined {
  return acting.getStore()?.clientId
}
