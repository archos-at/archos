import { z } from 'zod'

export interface OrganizationCountriesView {
  homeCountry: string | null
  entitled: { countryId: string; source: 'home' | 'platform'; entitledAt: string | null }[]
}

export const UNPLACED_REASONS = ['directory_names', 'no_row', 'not_stated'] as const

export interface OrganizationPlacementView {
  organizationId: string
  name: string
  homeCountry: string | null
  unplaced: { reason: (typeof UNPLACED_REASONS)[number]; directoryHomeCountry: string | null } | null
  entitled: {
    countryId: string
    source: 'home' | 'platform'
    entitledAt: string | null
    entitledBy: string | null
    decisionSource: string | null
  }[]
}

export interface PlatformOrganizationCountries {
  organizations: OrganizationPlacementView[]
  unplaced: number
  nextCursor: string | null
}

export const listOrganizationCountriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().describe('Organizations per page; 100 at most and by default.'),
  cursor: z.string().trim().min(1).max(200).optional().describe('nextCursor of the previous page.'),
})
