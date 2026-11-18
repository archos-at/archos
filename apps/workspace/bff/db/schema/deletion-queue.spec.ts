// @disk-inputs: migrations/0223_deletion_queue_status_known.sql, migrations/0227_deletion_queue_pending_has_attempts.sql
/**
 * @vitest-environment node
 *
 * `deletion_queue.status` is declared once, as `DELETION_STATUSES`, and written
 * down again in migration 0223, the SQL that put the constraint into the
 * database. This holds the schema's CHECK and the migration to the tuple, so a
 * status added in one place fails here instead of at the first insert in
 * production.
 */
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { constraintClauses, listedValues, parseSql, readSql, type SqlStatement } from '@/test-utils/sql-statements'
import { DELETION_LIFECYCLE, DELETION_MAX_ATTEMPTS, DELETION_STATUSES, deletionQueue } from './deletion-queue'

const CONSTRAINT = 'deletion_queue_status_known'
const quoted = DELETION_STATUSES.map((status) => `'${status}'`).join(', ')

const tokensOf = (sql: string) => parseSql(sql)[0]!.tokens
const indexOf = (statements: SqlStatement[], sql: string) =>
  statements.findIndex((statement) => JSON.stringify(statement.tokens) === JSON.stringify(tokensOf(sql)))

describe('deletion_queue.status is one list in three places', () => {
  it('the schema’s CHECK names exactly the tuple’s values', () => {
    const check = getTableConfig(deletionQueue).checks.find((candidate) => candidate.name === CONSTRAINT)
    expect(check).toBeDefined()
    const { sql, params } = new PgDialect().sqlToQuery(check!.value)
    expect(sql).toBe(`"deletion_queue"."status" IN (${quoted})`)
    expect(params).toEqual([])
  })

  it('migration 0223 adds that CHECK, with the same values in the same order', () => {
    const migration = readSql('migrations/0223_deletion_queue_status_known.sql')
    expect(migration.map((statement) => statement.tokens)).toContainEqual(
      tokensOf(`ALTER TABLE "deletion_queue" ADD CONSTRAINT "${CONSTRAINT}" CHECK ("status" IN (${quoted})) NOT VALID`),
    )
    const spelled = constraintClauses(migration).flatMap((clause) => listedValues(clause.check ?? [], 'status'))
    expect(spelled).toEqual([...DELETION_STATUSES])
  })

  it('the lifecycle declares every status the column may hold, and no other', () => {
    expect([...DELETION_LIFECYCLE.states].sort()).toEqual([...DELETION_STATUSES].sort())
  })
})

describe('a pending deletion has an attempt left, in the schema and the migration', () => {
  const NAME = 'deletion_queue_pending_has_attempts'
  const migration = readSql('migrations/0227_deletion_queue_pending_has_attempts.sql')

  it('the schema’s CHECK reads the cap from the constant', () => {
    const check = getTableConfig(deletionQueue).checks.find((candidate) => candidate.name === NAME)
    expect(check).toBeDefined()
    const { sql, params } = new PgDialect().sqlToQuery(check!.value)
    expect(sql).toBe(`"deletion_queue"."status" <> 'pending' OR "deletion_queue"."attempts" < ${DELETION_MAX_ATTEMPTS}`)
    expect(params).toEqual([])
  })

  it('migration 0227 gives a stranded row its last attempt back, then adds that CHECK', () => {
    const repair = `UPDATE "deletion_queue" SET "attempts" = ${DELETION_MAX_ATTEMPTS - 1} WHERE "status" = 'pending' AND "attempts" >= ${DELETION_MAX_ATTEMPTS}`
    const constraint = `ALTER TABLE "deletion_queue" ADD CONSTRAINT "${NAME}" CHECK ("status" <> 'pending' OR "attempts" < ${DELETION_MAX_ATTEMPTS}) NOT VALID`
    expect(migration.map((statement) => statement.tokens)).toContainEqual(tokensOf(repair))
    expect(migration.map((statement) => statement.tokens)).toContainEqual(tokensOf(constraint))
    expect(indexOf(migration, repair)).toBeLessThan(indexOf(migration, constraint))
  })
})
