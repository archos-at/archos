import { sql, type SQL } from 'drizzle-orm'

const ALIAS = /^[a-z_][a-z0-9_]*$/

export function recordReadable(alias: string, organizationId: string): SQL {
  if (!ALIAS.test(alias)) throw new RangeError(`not a table alias: ${alias}`)
  const r = sql.raw(alias)
  return sql`(${r}.organization_id = ${organizationId} OR (${r}.organization_id IS NULL AND ${r}.head_revision_id IS NOT NULL
    AND (${r}.country_id IN (SELECT knowledge_entitled_countries()) OR ${r}.id IN (SELECT knowledge_reached_ids()))))`
}
