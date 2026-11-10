/**
 * When an edition applies to a project (ADR-0177, design §3.4): its scope, as
 * a `decision_table.v1` over the building's facts with a boolean output. True,
 * the building is within the edition's scope; false, it is outside it;
 * undetermined, a fact it waits for is open, or the case needs a person (an
 * `otherwise` left undetermined). It sits on the edition, not on a territory:
 * a guideline's scope can change between editions (OIB-RL 2.3, 2019 and 2023)
 * and does not depend on where the site is. Pure and zod.
 */

import { z } from 'zod'
import { decisionTableSchema } from './ruleset'

export const appliesWhenTableSchema = decisionTableSchema.superRefine((table, context) => {
  if (table.output.type !== 'boolean') {
    context.addIssue({ code: 'custom', path: ['output'], message: 'an edition’s scope outputs a boolean: whether the building is within it' })
  }
})
export type AppliesWhenTable = z.infer<typeof appliesWhenTableSchema>
