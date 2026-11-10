/**
 * The person's own yes, asked for by the route that needs it (ADR-0165): a
 * decision a model must not make for a person, held at the server whichever
 * path the call took. The catalog's `personDecides` makes the door ask; this
 * makes the route refuse when nobody did, so a missed flag, a new door or a
 * direct dispatch cannot run it on a model's word.
 *
 * - A person's own request (their browser, no acting session): `app`.
 * - The in-product agent's card the person accepted (a proposal applied): `app`.
 * - An outside agent's call the person confirmed in their chat: `elicitation`;
 *   an MCP Apps card in a client that declared it renders them: `app`.
 * - Anything else under an acting session, `app-unverified` included: refused.
 *
 * Used by the platform's approve, publish, rollback and entitlement routes
 * (`bff/base-knowledge/platform/`); the agent-grade door (S10) reuses it.
 */

import 'server-only'
import { ApiError } from '@/lib/api/errors'
import { actingDecision, type ActingDecisionSource } from './acting-session'
import type { DecisionSource } from './telemetry'

/** What the decision records as how the person said yes. */
export type PersonDecisionSource = 'app' | 'elicitation'

/** 403 — the call needs the person's own yes, and it came without one. */
export class PersonDecisionRequiredError extends ApiError {
  constructor(what: string) {
    super(
      403,
      'PERSON_DECISION_REQUIRED',
      `${what} runs only on the person's own yes. Ask them to confirm it when your client asks, or to decide it in the app.`,
    )
  }
}

/** The person's yes for the call in flight, or a refusal naming `what` (an English phrase an agent reads). */
export function requirePersonDecision(what: string): PersonDecisionSource {
  const acting = actingDecision()
  if (!acting) return 'app'
  if (acting.proposalId) return 'app'
  if (acting.decisionSource === 'elicitation' || acting.decisionSource === 'app') return acting.decisionSource
  throw new PersonDecisionRequiredError(what)
}

/** The door's decision source as a yes the acting session carries, or none: `app-unverified` is not one. */
export function personYesOf(source: DecisionSource | undefined): { decisionSource?: ActingDecisionSource } {
  return source === 'elicitation' || source === 'app' ? { decisionSource: source } : {}
}
