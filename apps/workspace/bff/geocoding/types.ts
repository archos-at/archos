import { z } from 'zod'
import { normalizeProfileToken } from '@/lib/project-profile/legacy-names'

export const GEOCODE_MAX_LIMIT = 8
export const GEOCODE_DEFAULT_LIMIT = 5

export const geocodeKindSchema = z.enum(['address', 'street', 'place'])
export type GeocodeKind = z.infer<typeof geocodeKindSchema>

function renameLegacyGeocodeFields(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const { bundesland, gemeinde, ...rest } = value as Record<string, unknown>
  if (bundesland === undefined && gemeinde === undefined) return value
  return {
    ...rest,
    ...(rest.federalState === undefined && bundesland !== undefined
      ? { federalState: typeof bundesland === 'string' ? normalizeProfileToken('federal_state', bundesland) : bundesland }
      : {}),
    ...(rest.municipality === undefined && gemeinde !== undefined ? { municipality: gemeinde } : {}),
  }
}

export const geocodeResultSchema = z.preprocess(renameLegacyGeocodeFields, z.object({
  label: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  country: z.literal('at'),
  federalState: z.string().nullable(),
  state: z.string().nullable(),
  municipality: z.string().nullable(),
  postcode: z.string().nullable(),
  kind: geocodeKindSchema,
}))
export type GeocodeResult = z.infer<typeof geocodeResultSchema>

export const geocodeResponseSchema = z.object({
  enabled: z.boolean(),
  results: z.array(geocodeResultSchema),
})
export type GeocodeResponse = z.infer<typeof geocodeResponseSchema>

export const geocodeQuerySchema = z.object({
  q: z.string().trim().min(3).max(200),
  limit: z.coerce.number().int().min(1).max(GEOCODE_MAX_LIMIT).default(GEOCODE_DEFAULT_LIMIT),
})
export type GeocodeQuery = z.infer<typeof geocodeQuerySchema>
