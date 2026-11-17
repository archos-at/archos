import { z } from 'zod'
import {
  isSelectableCardType,
  parsePreferredCardTypes,
} from '@/features/skills/lib/card-catalog'
import type { SkillOrigin } from '@/lib/db/schema/jobs'
import { PLATFORM_SKILL_DELIVERIES } from '@/lib/db/schema/platform-skills'

export const MAX_SKILL_NAME_LENGTH = 64
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024
export const MAX_SKILL_BODY_LENGTH = 32000

export const METADATA_AGENTS = 'grid-agents'

export const METADATA_CARDS = 'grid-cards'

export const METADATA_CATALOG = 'grid-catalog'

export const CATALOG_CURATED = 'curated'

export function isCuratedPlatformSkill(metadata: Record<string, string>): boolean {
  return (metadata[METADATA_CATALOG] ?? '').trim().toLowerCase() === CATALOG_CURATED
}

export const METADATA_HIDDEN = 'grid-hidden'

const HIDDEN_TRUE: ReadonlySet<string> = new Set(['true', '1', 'yes'])

export function isHiddenSkill(metadata: Record<string, string>): boolean {
  return HIDDEN_TRUE.has((metadata[METADATA_HIDDEN] ?? '').trim().toLowerCase())
}

export const METADATA_AUTO_INVOKE = 'grid-auto-invoke'

export const KNOWN_SKILL_AGENTS = ['researcher', 'deep_researcher'] as const
export type KnownSkillAgent = (typeof KNOWN_SKILL_AGENTS)[number]

export const CHAT_SKILL_AGENT: KnownSkillAgent = 'researcher'

const SKILL_AGENT_ALIASES: Record<string, KnownSkillAgent> = {
  shallow_researcher: 'researcher',
}

export function canonicalSkillAgent(name: string): string {
  return SKILL_AGENT_ALIASES[name] ?? name
}

export function preferredCardsOf(metadata: Record<string, string>): string[] {
  return parsePreferredCardTypes(metadata[METADATA_CARDS])
}

export interface SkillSnapshot {
  name: string
  description: string
  body: string
  metadata: Record<string, string>
  origin: SkillOrigin | 'platform'
}

export function snapshotOf(skill: SkillSnapshot): SkillSnapshot {
  return {
    name: skill.name,
    description: skill.description,
    body: skill.body,
    metadata: { ...skill.metadata },
    origin: skill.origin,
  }
}

export const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const XML_TAG_PATTERN = /<[^>]+>/

export const skillNameSchema = z
  .string()
  .trim()
  .min(1, 'A skill name is required.')
  .max(MAX_SKILL_NAME_LENGTH, `Skill names are at most ${MAX_SKILL_NAME_LENGTH} characters.`)
  .regex(
    NAME_PATTERN,
    'Skill names must be lowercase a-z/0-9 separated by single hyphens (no leading, trailing or consecutive hyphens).'
  )
  .refine((name) => !XML_TAG_PATTERN.test(name), 'Skill names must not contain XML tags.')

const descriptionSchema = z
  .string()
  .trim()
  .min(1, 'A skill description is required.')
  .max(
    MAX_SKILL_DESCRIPTION_LENGTH,
    `Skill descriptions are at most ${MAX_SKILL_DESCRIPTION_LENGTH} characters.`
  )
  .refine(
    (description) => !XML_TAG_PATTERN.test(description),
    'Skill descriptions must not contain XML tags.'
  )

const bodySchema = z
  .string()
  .min(1, 'The skill body is required.')
  .max(MAX_SKILL_BODY_LENGTH, `Skill bodies are at most ${MAX_SKILL_BODY_LENGTH} characters.`)

const metadataSchema = z
  .record(z.string(), z.string())
  .refine(
    (metadata) => Object.keys(metadata).length <= 64,
    'A skill may carry at most 64 metadata keys.'
  )
  .superRefine((metadata, ctx) => {
    const raw = metadata[METADATA_CARDS]
    if (raw === undefined) return
    const unknown = raw
      .split(',')
      .map((part) => part.trim())
      .filter((type) => type !== '' && !isSelectableCardType(type))
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [METADATA_CARDS],
        message: `Unknown card type(s) in ${METADATA_CARDS}: ${unknown.join(', ')}.`,
      })
    }
  })

export const categoryIdSchema = z.string().trim().guid('A skill category id must be a UUID.')

export const createSkillSchema = z.object({
  name: skillNameSchema,
  description: descriptionSchema,
  body: bodySchema,
  metadata: metadataSchema.optional(),
  enabled: z.boolean().optional(),
  clonedFrom: z.string().trim().min(1).max(MAX_SKILL_NAME_LENGTH).optional(),
  categoryId: categoryIdSchema.optional(),
})
export type CreateSkillInput = z.infer<typeof createSkillSchema>

export const patchSkillSchema = z.object({
  name: skillNameSchema.optional(),
  description: descriptionSchema.optional(),
  body: bodySchema.optional(),
  metadata: metadataSchema.optional(),
  enabled: z.boolean().optional(),
  categoryId: categoryIdSchema.nullable().optional(),
})

export type PatchSkillInput = z.infer<typeof patchSkillSchema>

export const MAX_CATEGORY_NAME_LENGTH = 60
export const MAX_CATEGORY_DESCRIPTION_LENGTH = 500

export const sortOrderSchema = z.number().int().min(-2147483648).max(2147483647)

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, 'A category name is required.')
  .max(MAX_CATEGORY_NAME_LENGTH, `Category names are at most ${MAX_CATEGORY_NAME_LENGTH} characters.`)
  .refine((name) => !XML_TAG_PATTERN.test(name), 'Category names must not contain XML tags.')

const categoryDescriptionSchema = z
  .string()
  .trim()
  .max(
    MAX_CATEGORY_DESCRIPTION_LENGTH,
    `Category descriptions are at most ${MAX_CATEGORY_DESCRIPTION_LENGTH} characters.`
  )

export const createCategorySchema = z.object({
  name: categoryNameSchema,
  description: categoryDescriptionSchema.optional(),
  sortOrder: sortOrderSchema.optional(),
})

export type CreateCategoryInput = z.infer<typeof createCategorySchema>

export const patchCategorySchema = z.object({
  name: categoryNameSchema.optional(),
  description: categoryDescriptionSchema.nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
})

export type PatchCategoryInput = z.infer<typeof patchCategorySchema>

export type SkillCategoryListItem = {
  id: string
  name: string
  description: string | null
  slug: string | null
  sortOrder: number
  scope: 'platform' | 'org'
}

export const curatedSkillActivationSchema = z.object({
  enabled: z.boolean(),
})

export type CuratedSkillActivationInput = z.infer<typeof curatedSkillActivationSchema>

export const platformSkillDeliverySchema = z.enum(PLATFORM_SKILL_DELIVERIES)

export const createPlatformSkillSchema = z.object({
  name: skillNameSchema,
  description: descriptionSchema,
  body: bodySchema,
  metadata: metadataSchema.optional(),
  published: z.boolean().optional(),
  delivery: platformSkillDeliverySchema.optional(),
  categoryId: categoryIdSchema.optional(),
})

export type CreatePlatformSkillInput = z.infer<typeof createPlatformSkillSchema>

export const patchPlatformSkillSchema = createPlatformSkillSchema
  .partial()
  .extend({ categoryId: categoryIdSchema.nullable().optional() })

export type PatchPlatformSkillInput = z.infer<typeof patchPlatformSkillSchema>

export const resolveQuerySchema = z.object({
  organization_id: z.string().trim().min(1),
  agent: z.string().trim().min(1).optional(),
})

export type ResolveQuery = z.infer<typeof resolveQuerySchema>

export const reviewSkillSchema = z.object({
  name: z.string().max(MAX_SKILL_NAME_LENGTH).default(''),
  description: z.string().max(MAX_SKILL_DESCRIPTION_LENGTH).default(''),
  body: z.string().max(MAX_SKILL_BODY_LENGTH).default(''),
})

export const SKILL_SEARCH_MAX = 25

export const MAX_SKILL_SEARCH_QUERY_LENGTH = 200

export const skillSearchQuerySchema = z.object({
  query: z
    .string()
    .max(MAX_SKILL_SEARCH_QUERY_LENGTH)
    .default('')
    .describe('Plain words for the task at hand, German or English; empty lists every skill.'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SKILL_SEARCH_MAX)
    .default(10)
    .describe(`Most hits (default 10, most ${SKILL_SEARCH_MAX}).`),
})

export type SkillSearchQuery = z.infer<typeof skillSearchQuerySchema>
