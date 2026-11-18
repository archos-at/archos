import { sql, type SQL } from 'drizzle-orm'

export function sqlList(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )
}

export function sqlTextArray(values: readonly string[]): SQL {
  return sql`array[${sqlList(values)}]::text[]`
}
