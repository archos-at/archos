import { z } from 'zod'
import { ProjectPrimitiveValueSchema, type ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { factSourceCitationSchema } from '@/lib/base-knowledge/wire/setup-facts'
import { GATE_STATES, SITE_UNKNOWN_REASONS } from '@/lib/base-knowledge/wire/vocab'

const factKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const overrides = z
  .record(z.string().max(64), z.unknown())
  .refine(
    (facts) => Object.values(facts).every((value) => ProjectPrimitiveValueSchema.safeParse(value).success),
    'each value is a string, number, boolean, list of strings or null'
  )
  .transform((facts) => facts as Record<string, ProjectPrimitiveValue>)

export const classificationEvaluateRequestSchema = z
  .object({
    buildingId: z.string().max(12).default('bldg1'),
    planned: overrides.optional(),
    existing: overrides.optional(),
    on: z.iso.date().optional(),
  })
  .strict()
export type ClassificationEvaluateRequest = z.input<typeof classificationEvaluateRequestSchema>

const outcomeSchema = z.object({
  value: z.number().int().min(1).max(9).nullable(),
  highRise: z.boolean(),
  applicable: z.boolean(),
  inputs: z.record(factKey, z.unknown()),
  missing: z.array(factKey),
  possible: z.array(z.object({ value: z.number().int().nullable(), highRise: z.boolean(), applicable: z.boolean() })),
})
export type ClassificationOutcome = z.infer<typeof outcomeSchema>

export const classificationEvaluationSchema = z.object({
  status: z.enum(['evaluated', 'site_unknown', 'not_published', 'no_classification', 'undetermined']),
  gate: z.object({ state: z.enum(GATE_STATES), reason: z.enum(SITE_UNKNOWN_REASONS).nullable() }).nullable(),
  site: z.object({ chain: z.array(z.string()) }),
  classification: z
    .object({ rulesetId: z.string(), territoryId: z.string(), rule: z.string(), citation: z.string() })
    .nullable(),
  planned: outcomeSchema.nullable(),
  existing: outcomeSchema.nullable(),
  shift: z
    .object({
      changed: z.boolean().nullable().describe('null while either side is undetermined.'),
      differingInputs: z.array(factKey),
    })
    .nullable(),
  requests: z.array(
    z.object({
      factKeys: z.array(factKey),
      document: z.string(),
      reason: z.string(),
      sources: z.array(factSourceCitationSchema),
    })
  ),
})
export type ClassificationEvaluation = z.infer<typeof classificationEvaluationSchema>
