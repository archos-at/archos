/**
 * @vitest-environment node
 *
 * The processing policy against a REAL Postgres (migration 0205, ADR-0167),
 * through the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/residency/processing-policy.integration.spec.ts
 *
 * Proves what the agent tier relies on: no row reads as the default purposes;
 * an office's row is its own and no other organization reads it; `service` can
 * never be removed and an unknown purpose never stored; the cell has one shape.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const ORG = `org_residency_${Date.now()}`
const OTHER_ORG = `${ORG}_other`

describe.skipIf(!url)('processing policy against Postgres', () => {
  let policy: typeof import('./processing-policy')
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>

  const as = <T>(organizationId: string, run: () => Promise<T>): Promise<T> =>
    withTenant({ organizationId, userId: null }, run)

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    policy = await import('./processing-policy')
  })

  afterAll(async () => {
    await withPlatformAccess('processing policy spec cleanup', async () => {
      await db.execute(
        sql`DELETE FROM organization_processing_policies WHERE organization_id IN (${ORG}, ${OTHER_ORG})`
      )
      await db.execute(
        sql`DELETE FROM organizations WHERE workos_organization_id IN (${ORG}, ${OTHER_ORG})`
      )
    })
  })

  it('reads the defaults for an office with no row and no placement', async () => {
    expect(await policy.getProcessingPolicy(ORG)).toEqual({
      residencyCell: null,
      purposes: ['service', 'quality_evaluation', 'human_review'],
      version: 1,
    })
  })

  it("reads an office's own row and cell, and no other organization sees that row", async () => {
    await as(ORG, async () => {
      await db.execute(
        sql`INSERT INTO organizations (workos_organization_id, residency_cell) VALUES (${ORG}, 'eu-at-1')`
      )
      await db.execute(
        sql`INSERT INTO organization_processing_policies (organization_id, version, purposes_allowed)
            VALUES (${ORG}, 2, ARRAY['service', 'product_improvement'])`
      )
    })
    expect(await policy.getProcessingPolicy(ORG)).toEqual({
      residencyCell: 'eu-at-1',
      purposes: ['service', 'product_improvement'],
      version: 2,
    })
    const seen = await as(OTHER_ORG, () =>
      db.execute(
        sql`SELECT organization_id FROM organization_processing_policies WHERE organization_id = ${ORG}`
      )
    )
    expect([...seen]).toEqual([])
    expect((await policy.getProcessingPolicy(OTHER_ORG)).purposes).toEqual([
      'service',
      'quality_evaluation',
      'human_review',
    ])
  })

  it("refuses a row written into another organization's name", async () => {
    await expect(
      as(OTHER_ORG, () =>
        db.execute(
          sql`INSERT INTO organization_processing_policies (organization_id) VALUES (${ORG}) ON CONFLICT DO NOTHING`
        )
      )
    ).rejects.toThrow()
  })

  it('never stores a policy without service, or a purpose nobody defined', async () => {
    await expect(
      as(OTHER_ORG, () =>
        db.execute(
          sql`INSERT INTO organization_processing_policies (organization_id, purposes_allowed) VALUES (${OTHER_ORG}, ARRAY['quality_evaluation'])`
        )
      )
    ).rejects.toThrow()
    await expect(
      as(OTHER_ORG, () =>
        db.execute(
          sql`INSERT INTO organization_processing_policies (organization_id, purposes_allowed) VALUES (${OTHER_ORG}, ARRAY['service', 'selling'])`
        )
      )
    ).rejects.toThrow()
  })

  it('keeps the cell to one shape', async () => {
    await expect(
      as(OTHER_ORG, () =>
        db.execute(
          sql`INSERT INTO organizations (workos_organization_id, residency_cell) VALUES (${OTHER_ORG}, 'EU West')`
        )
      )
    ).rejects.toThrow()
  })
})
