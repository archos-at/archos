import { z } from 'zod'

const RULE_ID = z.string().trim().min(1).max(120)

export const confirmCheckSchema = z.object({
  ruleId: RULE_ID,
  modelId: z.guid(),
  note: z.string().trim().max(2000).nullish(),
})

export const withdrawCheckSchema = z.object({ ruleId: RULE_ID, modelId: z.guid() })
