/**
 * @vitest-environment node
 *
 * Whether local work still owns a document row, against a REAL Postgres: the
 * rule in memory (`localWorkOwnsRow`) and the rule as the WHERE of the failure
 * write (`stillOwnedBy`) answer the same for every row and every claim, so the
 * check a job makes before its work and the write it makes after cannot
 * disagree. And the case the job id is there for: the same bytes read again
 * under a new job are not failed by the earlier job's last attempt.
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/documents/local-work-ownership.integration.spec.ts
 *
 * `task db:test:rls` (scripts/rls-test-db.sh) builds that database and runs it.
 */

import { and, eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { localWorkOwnsRow, type LocalWorkOwnership } from './local-work-ownership'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const STAMP = Date.now()
const ORG = `org_ownership_${STAMP}`
const USER = 'user_ownership'
const KEY = 'k/ownership/model.ifc'
const EARLIER = '0e0e0e0e-0000-4000-8000-000000000001'
const LATER = '0e0e0e0e-0000-4000-8000-000000000002'

const CLAIMS: Array<[string, LocalWorkOwnership]> = [
  ['the bytes alone', { storageKey: KEY }],
  ['a job, by bytes and id', { storageKey: KEY, backgroundJobId: EARLIER, unnamedCounts: true }],
  ['the sweep, by the dead job it read', { backgroundJobId: EARLIER }],
  ['a job with no id of its own', { storageKey: KEY, backgroundJobId: null, unnamedCounts: true }],
  ['nothing but the status', {}],
]

describe.skipIf(!url)('local work owning a document row, against Postgres', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let schema: typeof import('@/lib/db/schema')
  let ingestState: typeof import('./repository/ingest-state')
  let n = 0

  const inTenant = <T>(run: () => Promise<T>): Promise<T> => withTenant({ organizationId: ORG, userId: USER }, run)

  async function insert(fields: { status: string; storageKey: string; jobId: string | null }): Promise<string> {
    n += 1
    const metadata = fields.jobId ? JSON.stringify({ bffJobId: fields.jobId }) : null
    const rows = await inTenant(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, metadata)
        VALUES (${ORG}, ${USER}, ${`model-${n}.ifc`}, ${fields.storageKey}, ${`archiv_${ORG}`}, ${fields.status},
                'office_shelf', ${metadata}::jsonb)
        RETURNING id
      `),
    )
    return String(Array.from(rows)[0].id)
  }

  const statusOf = async (id: string): Promise<string> => {
    const [row] = await inTenant(() =>
      db.select({ status: schema.documents.status }).from(schema.documents).where(eq(schema.documents.id, id)),
    )
    return row.status
  }

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    withTenant = (await import('@/lib/db/tenant-context')).withTenant
    db = (await import('@/lib/db')).getDb()
    schema = await import('@/lib/db/schema')
    ingestState = await import('./repository/ingest-state')
  })

  it('answers the same in SQL as in memory, for every row and every claim', async () => {
    for (const status of ['processing', 'pending', 'failed', 'stored']) {
      for (const storageKey of [KEY, 'k/ownership/replaced.ifc']) {
        for (const jobId of [null, EARLIER, LATER]) {
          const id = await insert({ status, storageKey, jobId })
          const row = { status, storageKey, metadata: jobId ? { bffJobId: jobId } : null }
          for (const [label, claim] of CLAIMS) {
            const matched = await inTenant(() =>
              db
                .select({ id: schema.documents.id })
                .from(schema.documents)
                .where(and(eq(schema.documents.id, id), ingestState.stillOwnedBy(claim))),
            )
            expect(matched.length === 1, `${label}: ${status}, ${storageKey}, job ${jobId}`).toBe(
              localWorkOwnsRow(row, claim),
            )
          }
        }
      }
    }
  })

  it('does not let an earlier job fail the row a later job of the same bytes has taken', async () => {
    const id = await insert({ status: 'processing', storageKey: KEY, jobId: LATER })
    const earlier = { storageKey: KEY, backgroundJobId: EARLIER, unnamedCounts: true }

    await expect(ingestState.markDocumentIngestFailed(id, ORG, 'IFC extraction failed', earlier)).resolves.toBe(false)
    expect(await statusOf(id)).toBe('processing')

    // The bytes alone still match, which is how the earlier job used to fail it.
    expect(localWorkOwnsRow({ status: 'processing', storageKey: KEY, metadata: { bffJobId: LATER } }, { storageKey: KEY })).toBe(true)

    // And the later job's own failure lands.
    const later = { ...earlier, backgroundJobId: LATER }
    await expect(ingestState.markDocumentIngestFailed(id, ORG, 'IFC extraction failed', later)).resolves.toBe(true)
    expect(await statusOf(id)).toBe('failed')
  })

  it('lets a job fail a row that does not name a job yet, and the sweep not', async () => {
    const id = await insert({ status: 'processing', storageKey: KEY, jobId: null })

    await expect(ingestState.markDocumentIngestFailed(id, ORG, 'boom', { backgroundJobId: EARLIER })).resolves.toBe(false)
    await expect(
      ingestState.markDocumentIngestFailed(id, ORG, 'boom', { storageKey: KEY, backgroundJobId: EARLIER, unnamedCounts: true }),
    ).resolves.toBe(true)
  })
})
