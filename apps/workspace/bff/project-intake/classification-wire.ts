/**
 * The wire of `classification-evaluate` (ADR-0169, design §5.4 „Classification
 * shift against existing", E34): a building's class on the planned values and,
 * for a Bestand, on today's, the shift between them with the inputs that
 * decided it, and for every input still open the document that settles it.
 * Pure zod, shared by the route, the agent operation and a later UI client.
 */

import { z } from 'zod'
import { ProjectPrimitiveValueSchema, type ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { factSourceCitationSchema } from '@/lib/base-knowledge/wire/setup-facts'
import { GATE_STATES, SITE_UNKNOWN_REASONS } from '@/lib/base-knowledge/wire/vocab'

const factKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
// Keys are checked by what the table reads: a key no input names is never read. Each value is a profile
// value, checked as a refinement so the tool schema an agent reads stays small (the door's size budget).
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
  /** The class, or null while an input is open, for a high-rise, or for no building. */
  value: z.number().int().min(1).max(9).nullable(),
  highRise: z.boolean(),
  /** False when the structure is no building: nothing is classified. */
  applicable: z.boolean(),
  /** The values the table read, by fact key; null where the profile holds none. */
  inputs: z.record(factKey, z.unknown()),
  /** The inputs whose value could still change the outcome, in the table's order. */
  missing: z.array(factKey),
  /** While open: the outcomes the open inputs can still produce, in row order. */
  possible: z.array(z.object({ value: z.number().int().nullable(), highRise: z.boolean(), applicable: z.boolean() })),
})
export type ClassificationOutcome = z.infer<typeof outcomeSchema>

export const classificationEvaluationSchema = z.object({
  /**
   * `site_unknown`: nothing places the project; `not_published`: its country's setup records are not published (or not
   * entitled) yet, so nothing is derived or asked, never another country's; `no_classification`: the country's setup
   * is published and holds no classification record;
   * `undetermined`: the project's knowledge context withholds law (`gate` says why), so no class is named.
   */
  status: z.enum(['evaluated', 'site_unknown', 'not_published', 'no_classification', 'undetermined']),
  /** The knowledge context's gate when it withholds law (ADR-0173), else null: the same gate the turn reads. */
  gate: z.object({ state: z.enum(GATE_STATES), reason: z.enum(SITE_UNKNOWN_REASONS).nullable() }).nullable(),
  site: z.object({ chain: z.array(z.string()) }),
  classification: z
    .object({ rulesetId: z.string(), territoryId: z.string(), rule: z.string(), citation: z.string() })
    .nullable(),
  planned: outcomeSchema.nullable(),
  /** Null when the building is no Bestand and no existing values were given. */
  existing: outcomeSchema.nullable(),
  /** Whether the class moves from the Bestand to the planned building, and which inputs differ. */
  shift: z
    .object({
      changed: z.boolean().nullable().describe('null while either side is undetermined.'),
      differingInputs: z.array(factKey),
    })
    .nullable(),
  /** For each open input, the document that settles it, from the country's fact sources. */
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
