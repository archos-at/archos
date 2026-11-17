import { z } from 'zod'
import { geocodeResultSchema } from '@/lib/geocoding/types'
import { isValidCountryToken, isValidFederalStateToken } from '@/lib/project-profile/intake-conditions'
import { normalizeProfileToken } from '@/lib/project-profile/legacy-names'
import { MAX_INTAKE_DESCRIPTION_LENGTH } from '@/lib/project-intake/types'
import { monthSchema } from './month'
import { PROJECT_OUTCOMES } from './project-status'

export const MAX_ADDRESS_LENGTH = 200

export const PROJECT_SETUPS = ['piloti', 'self'] as const
export type ProjectSetup = (typeof PROJECT_SETUPS)[number]

export const createProjectFieldsSchema = z
  .object({
    name: z.string().min(1).max(255).trim(),
    closing: z
      .object({
        outcome: z.enum(PROJECT_OUTCOMES),
        endedOn: monthSchema,
        startedOn: monthSchema.nullable(),
      })
      .strict()
      .optional(),
    setup: z.enum(PROJECT_SETUPS).default('piloti'),
    description: z
      .string()
      .trim()
      .max(MAX_INTAKE_DESCRIPTION_LENGTH)
      .transform((value) => value || undefined)
      .optional(),
    location: geocodeResultSchema.optional(),
    address: z
      .string()
      .trim()
      .max(MAX_ADDRESS_LENGTH)
      .transform((value) => value || undefined)
      .optional(),
    federalState: z
      .string()
      .transform((token) => normalizeProfileToken('federal_state', token))
      .refine(isValidFederalStateToken, 'A Bundesland token.')
      .optional(),
    country: z.string().trim().toLowerCase().refine(isValidCountryToken, 'A country token: at, de, ch or other.').optional(),
  })
  .strict()

const renameLegacyFederalState = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || !('bundesland' in value)) return value
  const { bundesland, ...rest } = value as Record<string, unknown>
  return 'federalState' in rest ? rest : { ...rest, federalState: bundesland }
}

export const createProjectSchema = z.preprocess(renameLegacyFederalState, createProjectFieldsSchema)

export type CreateProjectBody = z.infer<typeof createProjectSchema>
