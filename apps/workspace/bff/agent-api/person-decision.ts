import 'server-only'
import { ApiError } from '@/lib/api/errors'
import { actingDecision } from './acting-session'

export type PersonDecisionSource = 'app' | 'elicitation'

export class PersonDecisionRequiredError extends ApiError {
  constructor(what: string) {
    super(
      403,
      'PERSON_DECISION_REQUIRED',
      `${what} runs only on the person's own yes. Ask them to confirm it when your client asks, or to decide it in the app.`,
    )
  }
}

export function callDecisionSource(): PersonDecisionSource | 'agent' {
  const acting = actingDecision()
  if (!acting) return 'app'
  if (acting.proposalId) return 'app'
  if (acting.decisionSource === 'elicitation' || acting.decisionSource === 'app') return acting.decisionSource
  return 'agent'
}

export function requirePersonDecision(what: string): PersonDecisionSource {
  const source = callDecisionSource()
  if (source === 'agent') throw new PersonDecisionRequiredError(what)
  return source
}
