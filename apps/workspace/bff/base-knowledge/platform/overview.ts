/**
 * What the platform view shows (ADR-0165): each country with its released
 * records by type, its open change requests, how many offices are entitled to
 * it and how many released editions are past their check target; and the
 * review queue, which holds the submitted requests and every request approved
 * alone whose second review is due. Read as the platform role, bounded.
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { HOME_COUNTRIES } from '@/lib/organizations/home-country'
import type { KnowledgeWorkKind } from '@/lib/base-knowledge/wire/vocab'
import { platformEditionOverdue } from './freshness'
import { listChangeRequests } from './store'
import type { CountryCoverage, PlatformKnowledgeOverview } from './wire'

const MAX_COUNTRIES = 300

interface CountRow extends Record<string, unknown> {
  country_id: string
  type: string
  count: string
}

interface EditionCheckRow extends Record<string, unknown> {
  country_id: string
  kind: KnowledgeWorkKind
  checked_at: string | null
  result: string | null
}

export async function readOverview(now: Date = new Date()): Promise<PlatformKnowledgeOverview> {
  const [released, open, entitled, editions] = await withPlatformAccess('platform base knowledge: overview', () => {
    const db = getDb()
    return Promise.all([
      db.execute<CountRow>(sql`
        SELECT country_id, type, count(*)::text AS count FROM knowledge_records
        WHERE organization_id IS NULL AND head_revision_id IS NOT NULL
        GROUP BY country_id, type LIMIT ${MAX_COUNTRIES * 5}`),
      db.execute<CountRow>(sql`
        SELECT country_id, 'open' AS type, count(*)::text AS count FROM knowledge_change_requests
        WHERE status IN ('draft', 'submitted', 'approved') GROUP BY country_id LIMIT ${MAX_COUNTRIES}`),
      db.execute<CountRow>(sql`
        SELECT country_id, 'entitled' AS type, count(DISTINCT organization_id)::text AS count FROM (
          SELECT organization_id, country_id FROM organization_countries
          UNION SELECT workos_organization_id, home_country FROM organizations WHERE home_country IS NOT NULL
        ) entitlements GROUP BY country_id LIMIT ${MAX_COUNTRIES}`),
      db.execute<EditionCheckRow>(sql`
        SELECT er.country_id, w.kind, c.checked_at, c.result
        FROM knowledge_records er
        JOIN knowledge_edition_revisions e ON e.revision_id = er.head_revision_id
        JOIN knowledge_records wr ON wr.id = e.work_id
        JOIN knowledge_work_revisions w ON w.revision_id = wr.head_revision_id
        LEFT JOIN LATERAL (
          SELECT checked_at, result FROM knowledge_checks
          WHERE target_id = er.id AND organization_id IS NULL ORDER BY checked_at DESC LIMIT 1
        ) c ON true
        WHERE er.organization_id IS NULL AND er.type = 'edition'
        LIMIT 20000`),
    ])
  })
  const countries = new Map<string, CountryCoverage>()
  const country = (id: string) => {
    const existing = countries.get(id)
    if (existing) return existing
    const fresh: CountryCoverage = { countryId: id, released: {}, openRequests: 0, entitledOffices: 0, overdueEditions: 0 }
    countries.set(id, fresh)
    return fresh
  }
  for (const id of HOME_COUNTRIES) country(id)
  for (const row of released) country(row.country_id).released[row.type] = Number(row.count)
  for (const row of open) country(row.country_id).openRequests = Number(row.count)
  for (const row of entitled) country(row.country_id.trim()).entitledOffices = Number(row.count)
  for (const row of editions) {
    const last = row.checked_at ? { checkedAt: new Date(row.checked_at), result: String(row.result) } : null
    if (platformEditionOverdue(row.kind, last, now)) country(row.country_id).overdueEditions += 1
  }
  // The queue: what waits for a review, and what was approved alone and still owes its second one (ADR-0176).
  const [submitted, secondReviewDue] = await Promise.all([listChangeRequests({ status: 'submitted' }), listChangeRequests({ secondReview: 'due' })])
  // A submitted one is listed once; a rejected one reached no office and owes no review.
  const queue = [...submitted, ...secondReviewDue.filter((request) => request.status !== 'submitted' && request.status !== 'rejected')]
  return { countries: [...countries.values()].sort((a, b) => a.countryId.localeCompare(b.countryId)), queue }
}
