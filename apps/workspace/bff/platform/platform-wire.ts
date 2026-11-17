import { z } from 'zod'
import { AGENT_GROUP_IDS, OPENROUTER_MODEL_ID_PATTERN } from '@/lib/model-config/agent-groups'
import { REASONING_EFFORTS } from '@/lib/reasoning-settings/catalog'

export const modelDefaultsPutSchema = z.object({
  defaults: z.partialRecord(
    z.enum(AGENT_GROUP_IDS as [string, ...string[]]),
    z.object({ model: z.string().regex(OPENROUTER_MODEL_ID_PATTERN, 'not an OpenRouter model id') })
  ),
  note: z.string().trim().max(500).nullable().optional(),
})

export const reasoningEffortsPutSchema = z.object({
  efforts: z.partialRecord(z.enum(AGENT_GROUP_IDS as [string, ...string[]]), z.enum(REASONING_EFFORTS)),
  note: z.string().trim().max(500).nullable().optional(),
})

export const retrievalSettingsPutSchema = z.object({
  settings: z.record(z.string(), z.number().int()),
  note: z.string().trim().max(500).nullable().optional(),
})

const creditsSchema = z.number().min(0).finite().nullable()

export const pricingPutSchema = z.object({
  marginMultiplier: z.number().finite(),
  usdPerCredit: z.number().finite(),
  defaultOrgDailyCredits: creditsSchema,
  defaultOrgMonthlyCredits: creditsSchema,
  note: z.string().trim().max(500).nullable().optional(),
})

export const reingestKnowledgeSchema = z.object({
  fileNames: z.array(z.string()).min(1),
})

export const knowledgeDisplayTitleSchema = z.object({
  display_title: z
    .string()
    .nullable()
    .optional()
    .describe('The new display title; empty or null clears the override.'),
})

export const knowledgeDocClassSchema = z.object({
  doc_class: z.string().min(1, 'A doc_class is required').describe('The document type to set.'),
})
