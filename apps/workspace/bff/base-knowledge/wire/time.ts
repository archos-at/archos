/**
 * The wire of time in base knowledge (ADR-0171, design §3.6): a permit
 * procedure as the dates it has, the transition table an amending edition
 * carries, and what "which edition applied" answers. Pure zod, shared by the
 * route, the agent operation and the resolver.
 *
 * A date nobody has given is `null`, and `null` is unknown, never today: the
 * resolver asks for it instead (ticket 30). A procedure that is still open says
 * so (`decidedOn: 'pending'`), which is a known fact, not a missing one.
 */

import { z } from 'zod'
import { decisionTableSchema } from './ruleset'

const isoDate = z.iso.date()

/** The procedure events a reference-date rule may name, as the fact keys its table reads. */
export const PROCEDURE_EVENTS = ['filed_on', 'decided_on', 'works_started_on'] as const
export type ProcedureEvent = (typeof PROCEDURE_EVENTS)[number]

/** What a transition decides for one procedure at one boundary (design §3.6). */
export const TRANSITION_OUTCOMES = ['old_law', 'new_law', 'choice'] as const
export type TransitionOutcome = (typeof TRANSITION_OUTCOMES)[number]

export const procedureSchema = z
  .object({
    procedureType: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .nullable()
      .default(null)
      .describe(
        'The node’s procedure type, e.g. building_permit or notification; null when unknown.'
      ),
    filedOn: isoDate
      .nullable()
      .default(null)
      .describe('The day the submission was filed; null when unknown.'),
    decidedOn: z
      .union([isoDate, z.literal('pending')])
      .nullable()
      .default(null)
      .describe('The day of the decision, "pending" while none is made, null when unknown.'),
    worksStartedOn: z
      .union([isoDate, z.literal('not_started')])
      .nullable()
      .default(null)
      .describe('The day works started, "not_started", or null when unknown.'),
  })
  .strict()
export type Procedure = z.infer<typeof procedureSchema>
export type ProcedureInput = z.input<typeof procedureSchema>

/**
 * A transition: a decision table on an amending edition whose output is one of
 * {@link TRANSITION_OUTCOMES}. It reads the procedure's facts (`filed_on`,
 * `decided_on`, `decided`, `works_started_on`, `procedure_type`) and
 * `boundary_from`, the day the amending edition comes into force.
 */
export const transitionTableSchema = decisionTableSchema.superRefine((table, context) => {
  const codes = table.output.type === 'code' ? table.output.codes : []
  const fits =
    table.output.type === 'code' &&
    codes.every((code) => (TRANSITION_OUTCOMES as readonly string[]).includes(code))
  if (!fits)
    context.addIssue({
      code: 'custom',
      path: ['output'],
      message: `a transition outputs codes from ${TRANSITION_OUTCOMES.join(', ')}`,
    })
})
export type TransitionTable = z.infer<typeof transitionTableSchema>

/** An edition as the resolver reads it. `inForceTo` is the last day in force, inclusive (the RIS reading). */
export interface DatedEdition {
  id: string
  label: string
  inForceFrom: string | null
  inForceTo: string | null
  transition: TransitionTable | null
}

/** What an answer names: the edition, by id and its masthead label. */
export interface EditionRef {
  id: string
  label: string
  inForceFrom: string | null
  inForceTo: string | null
}

export const asOfBodySchema = z
  .object({
    workId: z
      .string()
      .min(1)
      .max(120)
      .describe('The work whose edition is asked for, e.g. work:at-wien-bo.'),
    territoryId: z
      .string()
      .min(1)
      .max(80)
      .describe(
        'The legislating node, e.g. AT-9; its parents are read from the territory records.'
      ),
    asOf: isoDate
      .optional()
      .describe('A date: the edition in force on it. Give this or procedure, not both.'),
    procedure: procedureSchema
      .optional()
      .describe(
        'A permit procedure: the edition that applies to it, by the node’s reference-date rule and transitions.'
      ),
  })
  .strict()
  .refine((body) => (body.asOf === undefined) !== (body.procedure === undefined), {
    message: 'give asOf or procedure, exactly one',
  })
export type AsOfBody = z.infer<typeof asOfBodySchema>
