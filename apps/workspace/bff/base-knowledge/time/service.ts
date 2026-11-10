/**
 * "Which edition of this work applied" (ADR-0171, ticket 30): on a date, or to
 * a permit procedure, with the edition named. The route's logic; the decision
 * itself is the pure resolver (`as-of.ts`) on the one rulesets evaluator.
 *
 * Fail closed: a read that is incomplete (too many rows, a stored transition
 * or ruleset the current schema cannot read) decides nothing and says why.
 */

import 'server-only'
import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { FEATURE_FLAGS, isFeatureEnabled } from '@/lib/authz/feature-flags'
import { getProjectProfile } from '@/lib/project-profile/profile-service'
import { procedureSchema, type AsOfQuery, type Procedure } from '@/lib/base-knowledge/wire/time'
import { readRulesetsInForce } from '../store/rulesets'
import { editionAsOf, editionForProcedure, type AsOfAnswer } from './as-of'
import { procedureFromProfile, profileHasProcedure } from './profile-procedure'
import { readTerritoryChain, readWorkInTime } from './repository'

export class TimeEditionsDisabledError extends ForbiddenError {
  constructor() {
    super('Editions in time are not enabled for this organization.')
  }
}

export type AsOfResponse = {
  workId: string
  /** The legislating node and the territories it lies in, nearest first. */
  territoryChain: string[]
  asOf: string | null
  procedure: Procedure | null
  answer: AsOfAnswer | { status: 'undetermined'; reason: 'records_unreadable'; recordIds: string[] }
}

async function procedureOf(
  session: AuthorizedSession,
  query: AsOfQuery
): Promise<Procedure | null> {
  if (query.asOf !== undefined) return null
  if (query.projectId !== undefined && query.procedureId !== undefined) {
    const state = await getProjectProfile(session, query.projectId)
    const facts = state.profile.facts
    if (!profileHasProcedure(facts, query.procedureId))
      throw new NotFoundError(
        `The project's profile names no procedure ${query.procedureId}; record its dates first (filed_on@${query.procedureId}).`
      )
    return procedureFromProfile(facts, query.procedureId)
  }
  return procedureSchema.parse({
    procedureType: query.procedureType ?? null,
    filedOn: query.filedOn ?? null,
    decidedOn: query.decidedOn ?? null,
    worksStartedOn: query.worksStartedOn ?? null,
  })
}

export async function editionAsOfForSession(
  session: AuthorizedSession,
  query: AsOfQuery,
  now: Date = new Date()
): Promise<AsOfResponse> {
  if (!isFeatureEnabled(session, FEATURE_FLAGS.timeEditions)) throw new TimeEditionsDisabledError()
  const organizationId = session.organizationId
  const procedure = await procedureOf(session, query)
  const [read, chain] = await Promise.all([
    readWorkInTime(organizationId, query.workId),
    readTerritoryChain(organizationId, query.territoryId),
  ])
  if (!read)
    throw new NotFoundError(
      'No work with this id that this office reads; list the base knowledge first.'
    )
  const base = { workId: query.workId, territoryChain: chain, asOf: query.asOf ?? null, procedure }
  if (read.truncated || read.unreadable.length > 0)
    return {
      ...base,
      answer: { status: 'undetermined', reason: 'records_unreadable', recordIds: read.unreadable },
    }
  if (procedure === null) return { ...base, answer: editionAsOf(read.work, query.asOf as string) }
  const rules = await readRulesetsInForce(organizationId, {
    purpose: 'reference_date',
    territoryIds: chain,
  })
  if (rules.truncated || rules.unreadable.length > 0)
    return {
      ...base,
      answer: { status: 'undetermined', reason: 'records_unreadable', recordIds: rules.unreadable },
    }
  const answer = editionForProcedure({
    work: read.work,
    rulesets: rules.rulesets,
    chain,
    procedure,
    now,
  })
  return { ...base, answer }
}
