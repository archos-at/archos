import { z } from 'zod'

export const QUARANTINE_DECISION_LIMIT = 50

export const quarantineDecisionsSchema = z
  .object({
    decision: z
      .enum(['allow', 'delete', 'recheck'])
      .describe(
        'allow: read each like any other upload. delete: remove each for good. recheck: screen each again with the rules in force now; a match holds it again.'
      ),
    documentIds: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(QUARANTINE_DECISION_LIMIT)
      .transform((ids) => [...new Set(ids)])
      .describe(
        `The held documents, at most ${QUARANTINE_DECISION_LIMIT}, as quarantine-list names them.`
      ),
  })
  .strict()
export type QuarantineDecisions = z.infer<typeof quarantineDecisionsSchema>

export const QUARANTINE_DECISION_OUTCOMES = [
  'allowed',
  'rechecking',
  'deleted',
  'changed',
  'not_found',
  'forbidden',
  'failed',
] as const
export type QuarantineDecisionOutcome = (typeof QUARANTINE_DECISION_OUTCOMES)[number]

export const quarantineDecisionResultSchema = z.object({
  results: z.array(z.object({ id: z.string(), outcome: z.enum(QUARANTINE_DECISION_OUTCOMES) })),
})
export type QuarantineDecisionResult = z.infer<typeof quarantineDecisionResultSchema>
