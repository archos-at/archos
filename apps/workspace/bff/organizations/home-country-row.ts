/**
 * Every organization has its row, and the row its home country (design 5.1,
 * ADR-0158).
 *
 * The self-service route states the country when it creates the organization
 * (`placeOrganization`). Two paths make an organization without it: one created
 * in the WorkOS dashboard, which has no row until something writes one, and a
 * settings save on such an organization. Both go through
 * {@link ensureOrganizationRow}: it writes the row on the organization's first
 * signed-in page load (the shell) or first settings save, with the country the
 * WorkOS organization's metadata names (`home_country`, set by whoever created
 * it in the dashboard), else with none.
 *
 * An organization left without a country is logged at WARN, once per process,
 * and its admins see a notice on the organization page that lets them state it
 * once ({@link stateHomeCountry}). Its office defaults (the clock) fall back to
 * Austria's until then. Refusing such an organization's requests is the later
 * gate (`organization_unplaced`, build split S15); this only stops new rows
 * without one and makes every remaining one visible.
 */

import 'server-only'
import { ConflictError } from '@/lib/api/errors'
import { getWorkOS } from '@/lib/workos/client'
import { homeCountrySchema, type HomeCountry } from './home-country'
import { createOrganizationRow, findOrganization, placeOrganization } from './repository'

/**
 * Organizations this process has seen placed. Ids only, never their data, and
 * an organization's country never goes back to none, so a hit is never stale.
 */
const placed = new Set<string>()
const warned = new Set<string>()

/** The home country the WorkOS organization's metadata names, or null. Never throws. */
export async function homeCountryFromDirectory(organizationId: string): Promise<HomeCountry | null> {
  try {
    const organization = await getWorkOS().organizations.getOrganization(organizationId)
    const raw = organization.metadata?.home_country
    const parsed = homeCountrySchema.safeParse(typeof raw === 'string' ? raw.trim().toUpperCase() : raw)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function warnUnplaced(organizationId: string): void {
  if (warned.has(organizationId)) return
  warned.add(organizationId)
  console.warn(
    `[organizations] ${organizationId} has no home country: its clock falls back to Europe/Vienna until an admin ` +
      'states it (organization page) or the WorkOS organization carries metadata home_country (ADR-0158)'
  )
}

/**
 * Make sure the organization has its row and, where anything says it, its home
 * country. Cheap after the first call per process; never throws (a failure is
 * logged and the next request tries again).
 */
export async function ensureOrganizationRow(organizationId: string): Promise<void> {
  if (placed.has(organizationId)) return
  try {
    const row = await findOrganization(organizationId)
    if (row?.homeCountry) {
      placed.add(organizationId)
      return
    }
    const fromDirectory = await homeCountryFromDirectory(organizationId)
    if (fromDirectory) {
      await placeOrganization(organizationId, fromDirectory)
      placed.add(organizationId)
      return
    }
    if (!row) await createOrganizationRow(organizationId)
    warnUnplaced(organizationId)
  } catch (error) {
    console.warn(`[organizations] could not ensure the row of ${organizationId}:`, error)
  }
}

/**
 * State an organization's home country, once. The same country again is a
 * no-op; a different one is refused, because the seat is stated, not edited
 * (ADR-0158): moving an office is a platform matter.
 */
export async function stateHomeCountry(organizationId: string, homeCountry: HomeCountry): Promise<void> {
  const row = await findOrganization(organizationId)
  if (row?.homeCountry && row.homeCountry !== homeCountry) {
    throw new ConflictError(`The home country is already ${row.homeCountry}; it is stated once and not changed here.`)
  }
  if (row?.homeCountry !== homeCountry) await placeOrganization(organizationId, homeCountry)
  placed.add(organizationId)
}
