/**
 * The wire of an office's placement (ADR-0158, ADR-0165): its home country and
 * the countries it is entitled to, as the office and the platform read them.
 * Split out of `./wire.ts`, which re-exports it (the size limit). Pure zod and types.
 */

import { z } from 'zod'

export interface OrganizationCountriesView {
  homeCountry: string | null
  entitled: { countryId: string; source: 'home' | 'platform'; entitledAt: string | null }[]
}

/**
 * Why an office has no home country (ADR-0158): its WorkOS metadata names one, which the next signed-in page load
 * writes; or no row yet and nothing names one; or a row whose admins never stated it.
 */
export const UNPLACED_REASONS = ['directory_names', 'no_row', 'not_stated'] as const

/** One office's placement as the platform reads it: `platform-org-countries-list`. */
export interface OrganizationPlacementView {
  organizationId: string
  name: string
  homeCountry: string | null
  /** Null once placed. `directoryHomeCountry`: what the WorkOS organization's metadata names, if anything. */
  unplaced: { reason: (typeof UNPLACED_REASONS)[number]; directoryHomeCountry: string | null } | null
  /** Its home first (source `home`), then each country the platform entitled it to, with who and how. */
  entitled: {
    countryId: string
    source: 'home' | 'platform'
    entitledAt: string | null
    entitledBy: string | null
    decisionSource: string | null
  }[]
}

export interface PlatformOrganizationCountries {
  /** This page's offices, the unplaced first, then by name. */
  organizations: OrganizationPlacementView[]
  /** How many on this page have no home country. */
  unplaced: number
  /** Pass as `cursor` for the next page; null on the last. */
  nextCursor: string | null
}

export const listOrganizationCountriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().describe('Organizations per page; 100 at most and by default.'),
  cursor: z.string().trim().min(1).max(200).optional().describe('nextCursor of the previous page.'),
})
