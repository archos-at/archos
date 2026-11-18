import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { organizations, type Organization } from '@/lib/db/schema/organizations'
import { HOME_COUNTRY_TIME_ZONES, type HomeCountry } from './home-country'

export async function findOrganization(organizationId: string): Promise<Organization | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(organizations)
      .where(eq(organizations.workosOrganizationId, organizationId))
      .limit(1),
  )
  return row ?? null
}

export const ORGANIZATION_PAGE_MAX = 1000

export interface OrganizationPage {
  organizations: Organization[]
  truncated: boolean
}

export async function findOrganizations(
  limit: number = ORGANIZATION_PAGE_MAX,
): Promise<OrganizationPage> {
  const db = getDb()
  const capped = Math.max(1, Math.min(limit, ORGANIZATION_PAGE_MAX))

  const rows = await withPlatformAccess(
    'platform storage: settings rows for every organization',
    () =>
      db
        .select()
        .from(organizations)
        .orderBy(organizations.workosOrganizationId)
        .limit(capped + 1),
  )

  return { organizations: rows.slice(0, capped), truncated: rows.length > capped }
}

export async function upsertOrganization(values: {
  organizationId: string
  displayName: string | null
  defaultLocale: string | null
  settings: Record<string, unknown>
}): Promise<void> {
  const db = getDb()
  const row = {
    displayName: values.displayName,
    defaultLocale: values.defaultLocale,
    settings: values.settings,
    updatedAt: new Date(),
  }
  await withTenant({ organizationId: values.organizationId }, () =>
    db
      .insert(organizations)
      .values({ workosOrganizationId: values.organizationId, ...row })
      .onConflictDoUpdate({ target: organizations.workosOrganizationId, set: row }),
  )
}

export async function placeOrganization(organizationId: string, homeCountry: HomeCountry): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .insert(organizations)
      .values({ workosOrganizationId: organizationId, homeCountry, timeZone: HOME_COUNTRY_TIME_ZONES[homeCountry] })
      .onConflictDoUpdate({
        target: organizations.workosOrganizationId,
        set: { homeCountry, timeZone: HOME_COUNTRY_TIME_ZONES[homeCountry], updatedAt: new Date() },
      }),
  )
}

export async function createOrganizationRow(organizationId: string): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db.insert(organizations).values({ workosOrganizationId: organizationId }).onConflictDoNothing({ target: organizations.workosOrganizationId }),
  )
}
