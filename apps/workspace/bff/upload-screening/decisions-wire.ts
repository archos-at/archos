/**
 * The wire of `POST /api/quarantine/decisions` (ADR-0086): one reviewer's
 * decision about several held documents at once, the Quarantäne list's
 * selection. Client-safe: the route, the agent catalog and the browser client
 * read the same schema.
 */

import { z } from 'zod'

/**
 * How many documents one request decides about. Each is one bounded step (a
 * row update and a dispatch, or a delete), so the request ends in seconds, well
 * inside one request's time (ADR-0121, "Outside the rule").
 */
export const QUARANTINE_DECISION_LIMIT = 50

export const quarantineDecisionsSchema = z
  .object({
    decision: z
      .enum(['allow', 'delete'])
      .describe('allow: read each like any other upload. delete: remove each for good.'),
    documentIds: z
      .array(z.string().min(1))
      .min(1)
      .max(QUARANTINE_DECISION_LIMIT)
      .transform((ids) => [...new Set(ids)])
      .describe(
        `The held documents, at most ${QUARANTINE_DECISION_LIMIT}, as quarantine-list names them.`
      ),
  })
  .strict()
export type QuarantineDecisions = z.infer<typeof quarantineDecisionsSchema>

/**
 * What became of one document. `changed`: it is no longer held (someone decided
 * first). `not_found`: this session may not decide about it, answered as for a
 * document that does not exist. `forbidden`: a reviewer who may not write its
 * folder. `failed`: anything else; the document is as it was.
 */
export const QUARANTINE_DECISION_OUTCOMES = [
  'allowed',
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
