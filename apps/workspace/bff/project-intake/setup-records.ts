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
import { readSetupRulesetsInForce } from '@/lib/base-knowledge/store/rulesets'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'

export async function readSetupRecords(organizationId: string): Promise<readonly StoredRuleset[]> {
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
}
