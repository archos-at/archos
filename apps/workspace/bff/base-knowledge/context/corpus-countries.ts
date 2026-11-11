/**
 * The countries whose shared-corpus chunks an office may read (ADR-0173,
 * audit of #1559 item 1): its entitled countries, and `EU` while one of them
 * is a member (`knowledge_country_entitled('EU')`). Signed onto the base
 * corpus's entry of every collection scope (`collection-scope-request.ts`), so
 * every reader the agent tier runs, a chat turn, a run, a door tool, filters
 * the base corpus by it in one place (`vector_store.scope.scope_filter`).
 * Read for every office since the cut-over (ADR-0175): an office entitled to
 * nothing reads none of the base corpus. Cached per organization for five minutes.
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import { getCached } from '@/lib/cache'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { readOrganizationCountries } from '../platform/entitlements'

const TTL_MS = 5 * 60 * 1000

/** The office's corpus countries, sorted; empty when it is entitled to none. */
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
