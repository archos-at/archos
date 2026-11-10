/**
 * The countries whose shared-corpus chunks an office may read (ADR-0173,
 * audit of #1559 item 1): its entitled countries, and `EU` while one of them
 * is a member (`knowledge_country_entitled('EU')`). Signed onto the base
 * corpus's entry of every collection scope (`collection-scope-request.ts`), so
 * every reader the agent tier runs, a chat turn, a run, a door tool, filters
 * the base corpus by it in one place (`vector_store.scope.scope_filter`).
 * Behind `knowledge-context`: with it off nothing is read and the scope is what
 * it was. Cached per organization for five minutes.
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import { getCached } from '@/lib/cache'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { readOrganizationCountries } from '../platform/entitlements'

const TTL_MS = 5 * 60 * 1000

/** The office's corpus countries, sorted; undefined with the flag off. */
export async function corpusCountriesFor(organizationId: string): Promise<string[] | undefined> {
  if (!(await isOrgFeatureEnabled(FEATURE_FLAGS.knowledgeContext, organizationId))) return undefined
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
