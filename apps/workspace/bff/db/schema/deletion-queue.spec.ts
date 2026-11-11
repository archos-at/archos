// @disk-inputs: migrations/0223_deletion_queue_status_known.sql, ../../scripts/rls-test-db.sh
/**
 * @vitest-environment node
 *
 * `deletion_queue.status` is declared once, as `DELETION_STATUSES`, and written
 * down three more times: the CHECK drizzle generates from the schema, the SQL of
 * migration 0223 that put the constraint into the database, and the text
 * `scripts/rls-test-db.sh` expects Postgres to answer for it. This holds all
 * three to the tuple, so a status added in one place fails here instead of at
 * the first insert in production.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { DELETION_LIFECYCLE, DELETION_STATUSES, deletionQueue } from './deletion-queue'

const CONSTRAINT = 'deletion_queue_status_known'
const quoted = DELETION_STATUSES.map((status) => `'${status}'`).join(', ')

/** A file by its path from `apps/workspace`, where vitest runs. */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('deletion_queue.status is one list in four places', () => {
  it('the schema’s CHECK names exactly the tuple’s values', () => {
    const check = getTableConfig(deletionQueue).checks.find((candidate) => candidate.name === CONSTRAINT)
    expect(check).toBeDefined()
    const { sql, params } = new PgDialect().sqlToQuery(check!.value)
    expect(sql).toBe(`"deletion_queue"."status" IN (${quoted})`)
    expect(params).toEqual([])
  })

  it('migration 0223 adds that CHECK, with the same values in the same order', () => {
    const migration = read('migrations/0223_deletion_queue_status_known.sql').replace(/\s+/g, ' ')
    expect(migration).toContain(`ADD CONSTRAINT "${CONSTRAINT}" CHECK ("status" IN (${quoted})) NOT VALID;`)
    // No other statement in it spells a status the tuple does not have.
    const spelled = [...migration.matchAll(/CHECK \("status" IN \(([^)]*)\)\)/g)].flatMap((match) =>
      [...match[1].matchAll(/'([a-z_]+)'/g)].map((value) => value[1]),
    )
    expect(spelled).toEqual([...DELETION_STATUSES])
  })

  it('the Postgres check of 0223 expects the definition those values produce', () => {
    const asPostgresPrintsIt = DELETION_STATUSES.map((status) => `'${status}'::text`).join(', ')
    expect(read('../../scripts/rls-test-db.sh')).toContain(
      `"CHECK ((status = ANY (ARRAY[${asPostgresPrintsIt}]))) NOT VALID"`,
    )
  })

  it('the lifecycle declares every status the column may hold, and no other', () => {
    expect([...DELETION_LIFECYCLE.states].sort()).toEqual([...DELETION_STATUSES].sort())
  })
})
