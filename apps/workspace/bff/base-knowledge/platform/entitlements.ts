/**
 * Which countries an office is entitled to (migration 0205, ADR-0165, design
 * §5.1): its home country, and each country the platform entitled it to. The
 * read policy of every platform record asks the same question in SQL
 * (`knowledge_country_entitled`); this is the platform's write side and the
 * office's read.
 *
 * A home change keeps the old home as an entitlement, so an office that moves
 * keeps what it read until an operator withdraws it.
 */

import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { organizations } from '@/lib/db/schema/organizations'
import { organizationCountries } from '@/lib/db/schema/knowledge-platform'
import { HOME_COUNTRY_TIME_ZONES, type HomeCountry } from '@/lib/organizations/home-country'
import type { OrganizationCountriesView } from './wire'

/** The most countries one office is entitled to: every ISO 3166-1 country, and some room. */
const MAX_COUNTRIES = 300

export interface Decision {
  by: string
  decisionSource: 'app' | 'elicitation'
}

/** Entitle an office to a country, or withdraw it; returns whether anything changed. */
export async function setEntitlement(organizationId: string, countryId: string, entitled: boolean, decision: Decision): Promise<boolean> {
  return withPlatformAccess('platform base knowledge: entitle an office to a country', async () => {
    const db = getDb()
    if (!entitled) {
      const removed = await db
        .delete(organizationCountries)
        .where(and(eq(organizationCountries.organizationId, organizationId), eq(organizationCountries.countryId, countryId)))
        .returning({ countryId: organizationCountries.countryId })
      return removed.length > 0
    }
    const added = await db
      .insert(organizationCountries)
      .values({ organizationId, countryId, entitledBy: decision.by, decisionSource: decision.decisionSource })
      .onConflictDoNothing()
      .returning({ countryId: organizationCountries.countryId })
    return added.length > 0
  })
}

/** Move an office's seat; the old home stays an entitlement. Returns the previous home. */
export async function moveHomeCountry(organizationId: string, homeCountry: HomeCountry, decision: Decision): Promise<string | null> {
  return withPlatformAccess('platform base knowledge: set an office home country', () =>
    getDb().transaction(async (tx) => {
      const [row] = await tx
        .select({ homeCountry: organizations.homeCountry })
        .from(organizations)
        .where(eq(organizations.workosOrganizationId, organizationId))
        .for('update')
      const previous = row?.homeCountry ?? null
      await tx
        .insert(organizations)
        .values({ workosOrganizationId: organizationId, homeCountry, timeZone: HOME_COUNTRY_TIME_ZONES[homeCountry] })
        .onConflictDoUpdate({
          target: organizations.workosOrganizationId,
          set: { homeCountry, updatedAt: sql`now()` },
        })
      if (previous && previous !== homeCountry) {
        await tx
          .insert(organizationCountries)
          .values({ organizationId, countryId: previous, entitledBy: decision.by, decisionSource: decision.decisionSource })
          .onConflictDoNothing()
      }
      return previous
    }),
  )
}

/** What an office is entitled to, read as the office (its own rows only). */
export async function readOrganizationCountries(organizationId: string): Promise<OrganizationCountriesView> {
  return withTenant({ organizationId }, async () => {
    const db = getDb()
    const [row] = await db
      .select({ homeCountry: organizations.homeCountry })
      .from(organizations)
      .where(eq(organizations.workosOrganizationId, organizationId))
    const rows = await db
      .select()
      .from(organizationCountries)
      .where(eq(organizationCountries.organizationId, organizationId))
      .orderBy(organizationCountries.countryId)
      .limit(MAX_COUNTRIES)
    const home = row?.homeCountry ?? null
    return {
      homeCountry: home,
      entitled: [
        ...(home ? [{ countryId: home, source: 'home' as const, entitledAt: null }] : []),
        ...rows
          .filter((entry) => entry.countryId !== home)
          .map((entry) => ({ countryId: entry.countryId, source: 'platform' as const, entitledAt: entry.entitledAt.toISOString() })),
      ],
    }
  })
}
