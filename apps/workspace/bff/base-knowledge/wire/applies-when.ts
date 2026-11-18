import { z } from 'zod'
import { decisionTableSchema } from './ruleset'

export const appliesWhenTableSchema = decisionTableSchema.superRefine((table, context) => {
  if (table.output.type !== 'boolean') {
    context.addIssue({ code: 'custom', path: ['output'], message: 'an edition’s scope outputs a boolean: whether the building is within it' })
  }
})
export type AppliesWhenTable = z.infer<typeof appliesWhenTableSchema>
