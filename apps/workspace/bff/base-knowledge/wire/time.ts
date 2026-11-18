import { z } from 'zod'
import { decisionTableSchema } from './ruleset'

const isoDate = z.iso.date()

export const PROCEDURE_EVENTS = ['filed_on', 'decided_on', 'works_started_on'] as const
export type ProcedureEvent = (typeof PROCEDURE_EVENTS)[number]

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

export interface DatedEdition {
  id: string
  label: string
  inForceFrom: string | null
  inForceTo: string | null
  transition: TransitionTable | null
}

export interface EditionRef {
  id: string
  label: string
  inForceFrom: string | null
  inForceTo: string | null
}

export const queryDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'an ISO date, YYYY-MM-DD')
  .refine((value) => isoDate.safeParse(value).success, 'not a calendar day')

const procedureIdSchema = z.string().regex(/^p[0-9]{1,3}$/, 'a procedure id such as p1')

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
