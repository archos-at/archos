/**
 * Lists as SQL parameters. Drizzle spreads a bare array into `($1, $2)`, which
 * is a row, not an array; these say which one a statement means. Each value
 * is its own bound parameter, never spliced into the text.
 */

import { sql, type SQL } from 'drizzle-orm'

/** `$1, $2, …`: for `IN (…)` and `array[…]`. */
export function sqlList(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )
}

/** A `text[]`, empty included: for `= ANY(…)` and `&&`. */
export function sqlTextArray(values: readonly string[]): SQL {
  return sql`array[${sqlList(values)}]::text[]`
}
