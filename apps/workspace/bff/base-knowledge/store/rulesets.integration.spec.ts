/**
 * @vitest-environment node
 *
 * Rulesets against a REAL Postgres (migration 0204, ADR-0166), through the
 * restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/store/rulesets.integration.spec.ts
 *
 * What the SQL must hold: an office reads its own ruleset in force and another
 * office reads none of it (with a positive control); a proposal without a head
 * does not count; a body is never updated; a row that is both a table and a
 * deferral, or a table for a purpose with no table schema, is refused by the
 * database itself; a tenant never writes a platform ruleset. And end to end,
 * E32 decided from a stored synthetic ruleset.
 */

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RulesetValuesInput } from '../wire/ruleset'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const ORG = `org_rs_${Date.now()}`
const OTHER_ORG = `${ORG}_other`
const CONTEXT = { createdBy: 'user_rs', provenance: { proposedBy: 'person' as const } }

/** Synthetic: the Bezirksamt of a synthetic Berlin city district (design E32). */
const BERLIN: RulesetValuesInput = {
  purpose: 'competence',
  territoryIds: ['DE-BE'],
  validFrom: '2020-01-01',
  body: {
    kind: 'table',
    payloadSchema: 'decision_table.v1',
    payload: {
      inputs: [{ key: 'city_district', type: 'code' }],
      output: { type: 'bodies' },
      rows: [
        {
          id: 'mitte',
          when: { '===': [{ var: 'city_district' }, 'DE:test:berlin-mitte'] },
          then: { bodies: [{ authorityId: 'authority:test:bezirksamt-mitte', role: 'decides' }] },
        },
      ],
      otherwise: { undetermined: true },
      examples: [{ facts: {}, expect: { undeterminedBy: ['city_district'] } }],
    },
  },
}

describe.skipIf(!url)('rulesets against Postgres', () => {
  let store: typeof import('./rulesets')
  let select: typeof import('../rulesets/select')
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>

  const as = <T>(organizationId: string, run: () => Promise<T>): Promise<T> =>
    withTenant({ organizationId, userId: null }, run)
  const competence = (organizationId: string) =>
    store.readRulesetsInForce(organizationId, {
      purpose: 'competence',
      territoryIds: ['DE-BE', 'DE'],
    })

  /** A raw body row for `recordId`'s first revision: to prove what the SQL refuses on its own. */
  async function rawBody(organizationId: string, columns: string) {
    const recordId = `ruleset_${randomUUID()}`
    const revisionId = randomUUID()
    return as(organizationId, () =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`INSERT INTO knowledge_records (id, organization_id, type, created_by) VALUES (${recordId}, ${organizationId}, 'ruleset', 'user_rs')`
        )
        await tx.execute(
          sql`INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by) VALUES (${revisionId}, ${recordId}, 'ruleset', ${organizationId}, 'user_rs')`
        )
        await tx.execute(
          sql.raw(
            `INSERT INTO knowledge_ruleset_revisions (revision_id, record_id, organization_id, territory_ids, valid_from, ${columns.split('|')[0]}) ` +
              `VALUES ('${revisionId}', '${recordId}', '${organizationId}', ARRAY['DE-BE'], '2020-01-01', ${columns.split('|')[1]})`
          )
        )
      })
    )
  }

  /** The constraint a refused statement names: drizzle wraps the driver's error as `cause`. */
  const refusedBy = (write: Promise<unknown>) =>
    write.then(
      () => null,
      (error: { cause?: { constraint_name?: string; constraint?: string } }) =>
        error.cause?.constraint_name ?? error.cause?.constraint ?? null
    )

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    store = await import('./rulesets')
    select = await import('../rulesets/select')
  })

  afterAll(async () => {
    for (const organizationId of [ORG, OTHER_ORG]) {
      await as(organizationId, () =>
        db.execute(
          sql`DELETE FROM knowledge_records WHERE organization_id = ${organizationId} AND type = 'ruleset'`
        )
      )
    }
  })

  it('an office reads its ruleset in force; another office reads none of it', async () => {
    const id = await store.insertOfficeRuleset(ORG, BERLIN, { ...CONTEXT, inForce: true })
    const own = await competence(ORG)
    expect(own.rulesets.map((ruleset) => ruleset.id)).toContain(id)
    expect(own.unreadable).toEqual([])
    expect((await competence(OTHER_ORG)).rulesets.map((ruleset) => ruleset.id)).not.toContain(id)
  })

  it('decides E32 from the stored ruleset: Berlin-Mitte gives Bezirksamt Mitte', async () => {
    const { rulesets } = await competence(ORG)
    const result = select.decide(
      rulesets,
      { purpose: 'competence', chain: ['DE:test:berlin-mitte', 'DE-BE', 'DE'], on: '2026-11-10' },
      { city_district: 'DE:test:berlin-mitte' }
    )
    expect(result).toMatchObject({
      status: 'decided',
      then: { bodies: [{ authorityId: 'authority:test:bezirksamt-mitte', role: 'decides' }] },
    })
  })

  it('a proposal without a head does not count', async () => {
    const id = await store.insertOfficeRuleset(
      ORG,
      { ...BERLIN, territoryIds: ['DE-HH'] },
      { ...CONTEXT, inForce: false }
    )
    const read = await store.readRulesetsInForce(ORG, {
      purpose: 'competence',
      territoryIds: ['DE-HH'],
    })
    expect(read.rulesets.map((ruleset) => ruleset.id)).not.toContain(id)
  })

  it('refuses a ruleset whose own examples fail before it reaches the database', async () => {
    const wrong = structuredClone(BERLIN)
    if (wrong.body.kind !== 'table') throw new Error('a table')
    wrong.body.payload.examples = [
      {
        facts: { city_district: 'DE:test:berlin-mitte' },
        expect: { undeterminedBy: ['city_district'] },
      },
    ]
    await expect(
      store.insertOfficeRuleset(ORG, wrong, { ...CONTEXT, inForce: true })
    ).rejects.toThrow(store.RulesetRejectedError)
  })

  it('never updates a body', async () => {
    await store.insertOfficeRuleset(ORG, BERLIN, { ...CONTEXT, inForce: true })
    await expect(
      as(ORG, () =>
        db.execute(
          sql`UPDATE knowledge_ruleset_revisions SET valid_from = '2021-01-01' WHERE organization_id = ${ORG}`
        )
      )
    ).rejects.toThrow()
  })

  it('refuses in SQL a row that is a table and a deferral, or a table for a purpose without a table schema', async () => {
    expect(
      await refusedBy(
        rawBody(
          ORG,
          `purpose, inherits, payload_schema, payload|'competence', 'parent', 'decision_table.v1', '{}'::jsonb`
        )
      )
    ).toBe('knowledge_ruleset_revisions_table_or_inherits')
    expect(
      await refusedBy(
        rawBody(
          ORG,
          `purpose, payload_schema, payload|'terminology', 'decision_table.v1', '{}'::jsonb`
        )
      )
    ).toBe('knowledge_ruleset_revisions_table_purpose')
    // Positive control: a well-formed deferral is accepted.
    await expect(
      rawBody(ORG, `purpose, inherits|'reference_date', 'parent'`)
    ).resolves.toBeUndefined()
  })

  it('never lets a tenant write a platform ruleset', async () => {
    const recordId = `ruleset_${randomUUID()}`
    await expect(
      as(ORG, () =>
        db.execute(
          sql`INSERT INTO knowledge_records (id, organization_id, type, created_by) VALUES (${recordId}, NULL, 'ruleset', 'user_rs')`
        )
      )
    ).rejects.toThrow()
    const leftover = await withPlatformAccess('rulesets spec residue', () =>
      db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM knowledge_records WHERE id = ${recordId}`
      )
    )
    expect(Number(leftover[0].n)).toBe(0)
  })
})
