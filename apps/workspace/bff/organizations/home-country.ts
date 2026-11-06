/**
 * The countries an office can name as its seat when it creates its
 * organization (migration 0200, `organizations.home_country`).
 *
 * The home country is where the office is. It never decides which building
 * law applies to a project: that is the project's site (`resolve_site` in the
 * agent, `siteCountry` in `@/lib/project-profile/site`). The list is the
 * markets the product is offered in; adding one is a row here and its two
 * labels. Pure and client-safe: the onboarding form reads it.
 */

import { z } from 'zod'

/** ISO 3166-1 alpha-2, upper case, in the order the form lists them. */
export const HOME_COUNTRIES = ['AT', 'DE', 'CH', 'LI'] as const
export type HomeCountry = (typeof HOME_COUNTRIES)[number]

export const homeCountrySchema = z.enum(HOME_COUNTRIES)
