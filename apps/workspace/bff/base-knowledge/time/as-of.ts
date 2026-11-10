/**
 * Which edition of a work applied to a procedure (ADR-0171, design §3.6):
 * "what applied when this was submitted", with the edition named. Pure: the
 * caller reads the rulesets, editions and territory chain, this decides.
 *
 * 1. The reference date (Stichtag). The legislating node's `reference_date`
 *    ruleset names a procedure event, run on the one evaluator (`decide`). A
 *    node without a rule inherits only by saying `inherits: parent`; otherwise
 *    the answer is `no_reference_date_rule`, with the editions each known event
 *    would give, and no code default stands in.
 * 2. The walk. Starting from the edition in force on the earlier of filing and
 *    the reference date, every boundary (an edition coming into force) up to the
 *    decision, or today while the procedure is open, is crossed or not: by its
 *    transition table where the amending edition carries one, else by whether
 *    the reference date lies on or after it. Without transitions this is the
 *    edition in force on the reference date.
 *
 * Every unknown stays unknown: a missing date is asked for by name, never read
 * as today.
 */

import type {
  DatedEdition,
  EditionRef,
  Procedure,
  ProcedureEvent,
  TransitionOutcome,
} from '@/lib/base-knowledge/wire/time'
import type { Provision } from '@/lib/base-knowledge/wire/ruleset'
import { evaluateDecisionTable } from '../rulesets/decision-table'
import type { Facts } from '../rulesets/expression'
import { decide, type StoredRuleset } from '../rulesets/select'
import {
  boundariesBetween,
  editionInForce,
  editionRef,
  isIsoDate,
  type EditionOnDay,
} from './editions'
import { dayIn, zoneOf } from './today'

export interface ReferenceDate {
  date: string
  event: string
  rulesetId: string
  territoryId: string
  provision?: Provision
}

export interface TransitionStep {
  boundaryFrom: string
  editionId: string
  outcome: TransitionOutcome | 'reference_date'
  provision?: Provision
}

type Undetermined =
  | {
      status: 'undetermined'
      reason: 'unknown_inputs'
      unknownInputs: string[]
      candidates: EditionRef[]
    }
  | {
      status: 'undetermined'
      reason: 'no_reference_date_rule'
      candidates: { event: ProcedureEvent; edition: EditionRef }[]
    }
  | { status: 'undetermined'; reason: 'ambiguous_rules'; rulesetIds: string[] }
  | { status: 'undetermined'; reason: 'no_row_applies' | 'zone_unknown' }
  | Exclude<EditionOnDay, { status: 'determined' }>

export type AsOfAnswer =
  | {
      status: 'determined'
      edition: EditionRef
      referenceDate: ReferenceDate | null
      transitions: TransitionStep[]
    }
  | {
      status: 'choice'
      editions: [EditionRef, EditionRef]
      referenceDate: ReferenceDate
      boundary: TransitionStep
    }
  | Undetermined

export interface WorkInTime {
  id: string
  historyAvailableFrom: string | null
  editions: readonly DatedEdition[]
}

/** The procedure as the facts a reference-date or transition table reads. */
export function procedureFacts(procedure: Procedure): Record<string, unknown> {
  const decidedOn = procedure.decidedOn
  const started = procedure.worksStartedOn
  return {
    procedure_type: procedure.procedureType,
    filed_on: procedure.filedOn,
    decided_on: isIsoDate(decidedOn) ? decidedOn : null,
    decided: decidedOn === null ? null : decidedOn !== 'pending',
    works_started_on: isIsoDate(started) ? started : null,
    works_started: started === null ? null : started !== 'not_started',
  }
}

type ReferenceDateResult = { status: 'decided'; referenceDate: ReferenceDate } | Undetermined

/** The reference date for `workId` under the node `chain` (legislating node first). */
export function referenceDateOf(
  rulesets: readonly StoredRuleset[],
  query: { chain: readonly string[]; workId: string },
  facts: Facts
): ReferenceDateResult {
  const filedOn = facts.filed_on
  // The rule in force when the procedure was filed decides; without the filing day there is no rule to pick.
  if (!isIsoDate(filedOn))
    return {
      status: 'undetermined',
      reason: 'unknown_inputs',
      unknownInputs: ['filed_on'],
      candidates: [],
    }
  const result = decide(
    rulesets,
    { purpose: 'reference_date', chain: query.chain, on: filedOn, workId: query.workId },
    facts
  )
  if (result.status === 'undetermined') {
    if (result.reason === 'no_rule')
      return { status: 'undetermined', reason: 'no_reference_date_rule', candidates: [] }
    if (result.reason === 'ambiguous_rules')
      return { status: 'undetermined', reason: 'ambiguous_rules', rulesetIds: result.rulesetIds }
    if (result.reason === 'no_row_applies')
      return { status: 'undetermined', reason: 'no_row_applies' }
    return {
      status: 'undetermined',
      reason: 'unknown_inputs',
      unknownInputs: result.unknownInputs,
      candidates: [],
    }
  }
  const event = String(result.then)
  const date = facts[event]
  if (!isIsoDate(date))
    return {
      status: 'undetermined',
      reason: 'unknown_inputs',
      unknownInputs: [event],
      candidates: [],
    }
  return {
    status: 'decided',
    referenceDate: {
      date,
      event,
      rulesetId: result.rulesetId,
      territoryId: result.territoryId,
      ...(result.provision ? { provision: result.provision } : {}),
    },
  }
}

/** The edition in force on `day`: the plain as-of answer, for a date rather than a procedure. */
export function editionAsOf(work: WorkInTime, day: string): AsOfAnswer {
  const found = editionInForce(work.editions, day, work.historyAvailableFrom)
  if (found.status !== 'determined') return found
  return {
    status: 'determined',
    edition: editionRef(found.edition),
    referenceDate: null,
    transitions: [],
  }
}

/** Where no rule names the date: the edition each known event would give, so the answer shows both. */
function candidatesByEvent(
  work: WorkInTime,
  facts: Facts
): { event: ProcedureEvent; edition: EditionRef }[] {
  const seen = new Set<string>()
  const events: ProcedureEvent[] = ['filed_on', 'decided_on', 'works_started_on']
  return events.flatMap((event) => {
    const day = facts[event]
    if (!isIsoDate(day)) return []
    const found = editionInForce(work.editions, day, work.historyAvailableFrom)
    if (found.status !== 'determined' || seen.has(found.edition.id)) return []
    seen.add(found.edition.id)
    return [{ event, edition: editionRef(found.edition) }]
  })
}

/** Where the procedure's window ends: its decision, today in the node's zone while open, null when unknown. */
function windowEnd(
  procedure: Procedure,
  territoryId: string,
  now: Date
): string | null | 'zone_unknown' {
  if (isIsoDate(procedure.decidedOn)) return procedure.decidedOn
  if (procedure.decidedOn !== 'pending') return null
  const zone = zoneOf(territoryId)
  return zone ? dayIn(zone, now) : 'zone_unknown'
}

/** How the walk reached its edition: by the reference date, or by a transition's own outcome. */
type Reached = { by: 'reference_date' } | { by: 'old_law' } | { by: 'new_law'; on: string }

/**
 * The walk's edition must be the one in force where it was reached: on the
 * reference date, or on the boundary a `new_law` crossed. Only an explicit
 * `old_law` keeps an edition past its end. So a repeal, a gap or two editions
 * in force on that day answer as `editionInForce` does, never as determined.
 */
function unconfirmed(
  work: WorkInTime,
  current: DatedEdition,
  reached: Reached,
  referenceDay: string
): Undetermined | null {
  if (reached.by === 'old_law') return null
  const day = reached.by === 'new_law' ? reached.on : referenceDay
  const check = editionInForce(work.editions, day, work.historyAvailableFrom)
  if (check.status !== 'determined') return check
  if (check.edition.id === current.id) return null
  return {
    status: 'undetermined',
    reason: 'ambiguous_editions',
    editionIds: [check.edition.id, current.id].sort(),
  }
}

/** The edition that applied to `procedure`, under the node `chain` (legislating node first). */
export function editionForProcedure(input: {
  work: WorkInTime
  rulesets: readonly StoredRuleset[]
  chain: readonly string[]
  procedure: Procedure
  /** Dated facts a work-targeted rule reads, e.g. governing_plan_adopted_on. */
  facts?: Facts
  now: Date
}): AsOfAnswer {
  const { work, procedure } = input
  const facts: Facts = { ...input.facts, ...procedureFacts(procedure) }
  const reference = referenceDateOf(input.rulesets, { chain: input.chain, workId: work.id }, facts)
  if (reference.status !== 'decided') {
    if (reference.reason === 'no_reference_date_rule')
      return { ...reference, candidates: candidatesByEvent(work, facts) }
    return reference
  }
  const stichtag = reference.referenceDate
  const filedOn = procedure.filedOn as string
  const start = filedOn < stichtag.date ? filedOn : stichtag.date
  const end = windowEnd(procedure, input.chain[0] ?? '', input.now)
  if (end === 'zone_unknown') return { status: 'undetermined', reason: 'zone_unknown' }
  const last = end !== null && end < stichtag.date ? stichtag.date : end
  const first = editionInForce(work.editions, start, work.historyAvailableFrom)
  if (first.status !== 'determined') return first
  let current = first.edition
  let reached: Reached = { by: 'reference_date' }
  const transitions: TransitionStep[] = []
  for (const boundary of boundariesBetween(work.editions, start, last)) {
    const boundaryFrom = boundary.inForceFrom as string
    if (!boundary.transition) {
      if (stichtag.date >= boundaryFrom) {
        current = boundary
        reached = { by: 'reference_date' }
      }
      transitions.push({ boundaryFrom, editionId: boundary.id, outcome: 'reference_date' })
      continue
    }
    const result = evaluateDecisionTable(boundary.transition, {
      ...facts,
      boundary_from: boundaryFrom,
    })
    if (result.status === 'undetermined') {
      if (result.reason === 'no_row_applies')
        return { status: 'undetermined', reason: 'no_row_applies' }
      return {
        status: 'undetermined',
        reason: 'unknown_inputs',
        unknownInputs: result.unknownInputs,
        candidates: [editionRef(current), editionRef(boundary)],
      }
    }
    const step: TransitionStep = {
      boundaryFrom,
      editionId: boundary.id,
      outcome: result.then as TransitionOutcome,
      ...(result.provision ? { provision: result.provision } : {}),
    }
    if (step.outcome === 'choice')
      return {
        status: 'choice',
        editions: [editionRef(current), editionRef(boundary)],
        referenceDate: stichtag,
        boundary: step,
      }
    if (step.outcome === 'new_law') current = boundary
    reached = step.outcome === 'new_law' ? { by: 'new_law', on: boundaryFrom } : { by: 'old_law' }
    transitions.push(step)
  }
  const refused = unconfirmed(work, current, reached, stichtag.date)
  if (refused) return refused
  return {
    status: 'determined',
    edition: editionRef(current),
    referenceDate: stichtag,
    transitions,
  }
}
