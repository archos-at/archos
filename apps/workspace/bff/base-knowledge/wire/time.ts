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

const procedureTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'a snake_case procedure type')

export const procedureSchema = z
  .object({
    procedureType: procedureTypeSchema
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

/** An edition as the resolver reads it. `inForceTo` is the first day no longer in force: the interval is half-open. */
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

/**
 * An ISO day in a query: a short pattern on the wire (the tool list's budget
 * pays for every character of `z.iso.date()`'s leap-year pattern) and the
 * calendar checked by zod's own date parser.
 */
const queryDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'an ISO date, YYYY-MM-DD')
  .refine((value) => isoDate.safeParse(value).success, 'not a calendar day')

const procedureIdSchema = z.string().regex(/^p[0-9]{1,3}$/, 'a procedure id such as p1')

/**
 * "Which edition of this work applied": on a date (`asOf`), to a procedure
 * stored on a project's profile (`projectId` and `procedureId`, its facts
 * `filed_on@p1`, `decided_on@p1`, …), or to a procedure given here.
 */
export const asOfQuerySchema = z
  .object({
    workId: z.string().min(1).max(120).describe('e.g. work:at-wien-bo'),
    territoryId: z.string().min(1).max(80).describe('The legislating node, e.g. AT-9.'),
    asOf: queryDay.optional(),
    projectId: z.string().min(1).max(120).optional(),
    procedureId: procedureIdSchema.optional(),
    procedureType: procedureTypeSchema.optional(),
    filedOn: queryDay.optional(),
    decidedOn: z.union([queryDay, z.literal('pending')]).optional(),
    worksStartedOn: z.union([queryDay, z.literal('not_started')]).optional(),
  })
  .strict()
  .superRefine((query, context) => {
    const given = query.procedureType ?? query.filedOn ?? query.decidedOn ?? query.worksStartedOn
    const modes = [
      query.asOf !== undefined,
      query.projectId !== undefined || query.procedureId !== undefined,
      given !== undefined,
    ]
    if (modes.filter(Boolean).length !== 1)
      context.addIssue({
        code: 'custom',
        path: [],
        message:
          'ask by asOf, by projectId and procedureId, or by a procedure given here: exactly one',
      })
    if ((query.projectId === undefined) !== (query.procedureId === undefined))
      context.addIssue({
        code: 'custom',
        path: ['procedureId'],
        message: 'projectId and procedureId come together',
      })
  })
export type AsOfQuery = z.infer<typeof asOfQuerySchema>
