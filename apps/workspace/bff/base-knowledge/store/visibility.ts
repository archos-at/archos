/**
 * Which knowledge records an office reads (ADR-0165, design §3.5): the one
 * predicate, written once. It is the row policy migration 0211 puts on
 * `knowledge_records`, named in a query's own WHERE so the layered RLS stays
 * the backstop and never the filter:
 *
 * - the office's own record;
 * - a released platform record (it has a head) of a country the office is
 *   entitled to (`knowledge_country_entitled`, the `EU` pack following an
 *   entitled member), or one a released relation reaches from such a record
 *   (`knowledge_reached_by_relation`: a DIN edition a Land law makes binding).
 *
 * Every read of base knowledge for an office (the chain, the time path, the
 * territory chain, the office's listings, rulesets, coverage) ANDs this, so a
 * record that binds in the chain is also one `editions/as-of` answers for.
 * `visibility.integration.spec.ts` holds it to the policy in the database.
 */

import { sql, type SQL } from 'drizzle-orm'

/** A table alias in a query: letters, digits and underscores only, so it is safe to splice. */
const ALIAS = /^[a-z_][a-z0-9_]*$/

/** Whether the office `organizationId` reads the `knowledge_records` row aliased `alias`. */
export function recordReadable(alias: string, organizationId: string): SQL {
  if (!ALIAS.test(alias)) throw new RangeError(`not a table alias: ${alias}`)
  const r = sql.raw(alias)
  return sql`(${r}.organization_id = ${organizationId} OR (${r}.organization_id IS NULL AND ${r}.head_revision_id IS NOT NULL
    AND (knowledge_country_entitled(${r}.country_id) OR knowledge_reached_by_relation(${r}.id))))`
}
