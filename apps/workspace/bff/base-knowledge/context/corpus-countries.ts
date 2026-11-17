import 'server-only'
import { sql } from 'drizzle-orm'
import { getCached } from '@/lib/cache'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { readOrganizationCountries } from '../platform/entitlements'

const TTL_MS = 5 * 60 * 1000

export async function corpusCountriesFor(organizationId: string): Promise<string[]> {
  return getCached(`corpus-countries:${organizationId}`, TTL_MS, async () => {
    const { entitled } = await readOrganizationCountries(organizationId)
    const [eu] = await withTenant({ organizationId }, () =>
      getDb().execute<{ entitled: boolean }>(sql`SELECT knowledge_country_entitled('EU') AS entitled`),
    )
    const countries = new Set(entitled.map((entry) => entry.countryId))
    if (eu?.entitled) countries.add('EU')
    return [...countries].sort()
  })
}
