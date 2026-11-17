/**
 * Where every office is placed, as the platform sees it (ADR-0158, ADR-0165):
 * each organization's home country, or why it has none, and the countries the
 * platform entitled it to. The read beside the two writes,
 * `platform-organization-home-country-set` and `platform-org-country-entitle`,
 * so an operator can find an office the overview counts nowhere.
 *
 * The organizations come from WorkOS, the directory of record: an office made
 * in the dashboard has no row here until somebody signs in to it. The platform
 * organization itself is left out. Read as the platform role, bounded.
 */

import 'server-only'
import { inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { organizations } from '@/lib/db/schema/organizations'
import { organizationCountries } from '@/lib/db/schema/knowledge-platform'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { getWorkOS } from '@/lib/workos/client'
import { homeCountryFromMetadata } from '@/lib/organizations/home-country-row'
import type { OrganizationPlacementView, PlatformOrganizationCountries } from './wire'

/** The most organizations one page returns: WorkOS's own page size. */
export const MAX_ORGANIZATIONS = 100

interface DirectoryOrganization {
  id: string
  name: string
  metadata?: Record<string, string> | null
}

interface PlacementRows {
  homes: Map<string, string | null>
  entitlements: { organizationId: string; countryId: string; entitledBy: string; decisionSource: string; entitledAt: Date }[]
}

/** One organization's placement, from its directory entry and its rows. Pure. */
export function placementOf(organization: DirectoryOrganization, rows: PlacementRows): OrganizationPlacementView {
  const hasRow = rows.homes.has(organization.id)
  const home = rows.homes.get(organization.id) ?? null
  // What the next signed-in page load writes (`ensureOrganizationRow`), with a row or without one.
  const fromDirectory = homeCountryFromMetadata(organization.metadata)
  const unplaced: OrganizationPlacementView['unplaced'] = home
    ? null
    : { reason: fromDirectory ? 'directory_names' : hasRow ? 'not_stated' : 'no_row', directoryHomeCountry: fromDirectory }
  const granted = rows.entitlements
    .filter((entry) => entry.organizationId === organization.id && entry.countryId !== home)
    .map((entry) => ({
      countryId: entry.countryId,
      source: 'platform' as const,
      entitledAt: entry.entitledAt.toISOString(),
      entitledBy: entry.entitledBy,
      decisionSource: entry.decisionSource,
    }))
  return {
    organizationId: organization.id,
    name: organization.name,
    homeCountry: home,
    unplaced,
    entitled: [...(home ? [{ countryId: home, source: 'home' as const, entitledAt: null, entitledBy: null, decisionSource: null }] : []), ...granted],
  }
}

async function placementRows(ids: readonly string[]): Promise<PlacementRows> {
  if (ids.length === 0) return { homes: new Map(), entitlements: [] }
  return withPlatformAccess('platform base knowledge: where each office is placed', async () => {
    const db = getDb()
    const [homes, entitlements] = await Promise.all([
      db
        .select({ id: organizations.workosOrganizationId, homeCountry: organizations.homeCountry })
        .from(organizations)
        .where(inArray(organizations.workosOrganizationId, [...ids])),
      db
        .select()
        .from(organizationCountries)
        .where(inArray(organizationCountries.organizationId, [...ids]))
        .orderBy(organizationCountries.organizationId, organizationCountries.countryId)
        .limit(ids.length * 300),
    ])
    return { homes: new Map(homes.map((row) => [row.id, row.homeCountry?.trim() ?? null])), entitlements }
  })
}

/** One page of offices, in the directory's order; `cursor` is the previous page's `nextCursor` (WorkOS's own). */
export async function readOrganizationPlacements(page: { limit?: number; cursor?: string } = {}): Promise<PlatformOrganizationCountries> {
  const [directory, platformOrganizationId] = await Promise.all([
    getWorkOS().organizations.listOrganizations({ limit: page.limit ?? MAX_ORGANIZATIONS, ...(page.cursor ? { after: page.cursor } : {}) }),
    getPlatformOrganizationId(),
  ])
  const offices = directory.data.filter((organization) => organization.id !== platformOrganizationId)
  const rows = await placementRows(offices.map((organization) => organization.id))
  const placements = offices.map((organization) => placementOf(organization, rows))
  return {
    // The unplaced first within the page: they are what an operator comes here to find.
    organizations: placements.sort((a, b) => Number(Boolean(a.homeCountry)) - Number(Boolean(b.homeCountry)) || a.name.localeCompare(b.name)),
    unplaced: placements.filter((placement) => placement.unplaced).length,
    nextCursor: directory.listMetadata?.after ?? null,
  }
}
