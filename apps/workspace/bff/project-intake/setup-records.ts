/**
 * The setup records an office reads (ADR-0169): the released `fact_definitions`,
 * `fact_sources` and `classification` rulesets of the countries it is entitled
 * to, through the same knowledge read path and entitlement predicate every
 * other base-knowledge read takes (`store/visibility.ts`). Nothing ships with
 * the build: a country whose records are not published (or not entitled) gives
 * an empty list, and every reader answers "not yet published" from it, never a
 * default of another country.
 *
 * Fail closed: a read that is incomplete (more than the store's bound, or a
 * stored body the current wire cannot read) gives nothing at all, so a
 * half-read country never decides a class.
 */

import 'server-only'
import { cache } from 'react'
import { readSetupRulesetsInForce } from '@/lib/base-knowledge/store/rulesets'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'

/**
 * Read once per request and organization (React `cache`): the intake view, the needs and a
 * reading's writes each ask for them. No read crosses a request, so a release is seen by the next
 * one; the repo has no cross-request cache keyed by head revisions to reuse, and none is added here.
 */
export const readSetupRecords = cache(async (organizationId: string): Promise<readonly StoredRuleset[]> => {
  const read = await readSetupRulesetsInForce(organizationId)
  if (read.truncated || read.unreadable.length > 0) {
    console.error('[setup_records_read=false] the setup records could not be read completely; none is used', {
      organizationId,
      truncated: read.truncated,
      unreadable: read.unreadable,
    })
    return []
  }
  return read.rulesets
})
