/**
 * @vitest-environment node
 *
 * One model row, two extractions, against a REAL Postgres.
 *
 * `bim_models` holds one row per document and a re-ingest reuses it. A new
 * version's bytes queue their own `bim_extract` job while the job for the old
 * bytes may still be parsing, so two runs can hold the same model id at once.
 * Before `run_id` (migration 0222) the slower one wrote last: the old file's
 * elements under `ready`, or `failed` over a model that had just been read.
 * Both cases below failed on that code.
 *
 * The claim is about SQL (a compare in a WHERE, and the order of two
 * statements in one transaction), so a mock cannot make it.
 *
 *   bash scripts/rls-test-db.sh --only bff/bim/extraction-repository.integration.spec.ts
 */
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BimModelRun } from './extraction-repository'
import type { BimElement, BimModelSummary } from './types'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const ORG = `org_bim_run_${Date.now()}`

const element = (globalId: string): BimElement => ({
  globalId,
  expressId: 1,
  ifcType: 'IfcWall',
  name: globalId,
  description: null,
  predefinedType: null,
  objectType: null,
  tag: null,
  typeName: null,
  storeyGlobalId: null,
  storeyName: null,
  containerGlobalId: null,
  containerKind: null,
  containerName: null,
  materials: [],
  classifications: [],
  properties: {},
  quantities: {},
})
// Only what `completeBimModel` reads of a summary; the rest is the parser's and not under test.
const summary = { schema: 'IFC4', truncatedAt: null } as unknown as BimModelSummary

describe('the extraction-run suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(
      url,
      'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set, so the ' +
        'extraction-run suite skipped and nothing verified the SQL. Check `task db:test:rls`.'
    ).toBeTruthy()
  })
})

describe.skipIf(!url)('a model row is moved only by the run that started it', () => {
  let extraction: typeof import('./extraction-repository')
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let closeDb: typeof import('@/lib/db').closeDb

  const seedDocument = async (filename: string): Promise<string> => {
    const rows = await withPlatformAccess('seed a BIM fixture document', () =>
      db.execute<{ id: string }>(sql`
        INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status)
        VALUES (${ORG}, 'seed', ${filename}, ${`seed/${filename}`}, 'seed', 'processing')
        RETURNING id
      `)
    )
    return Array.from(rows)[0].id
  }

  const readModel = async (modelId: string) => {
    const rows = await withPlatformAccess('read the model and its elements', () =>
      db.execute<{ status: string; error_message: string | null; global_ids: string[] | null }>(sql`
        SELECT m.status, m.error_message,
               (SELECT array_agg(e.global_id) FROM bim_elements e WHERE e.model_id = m.id) AS global_ids
        FROM bim_models m WHERE m.id = ${modelId}::uuid
      `)
    )
    return Array.from(rows)[0]
  }

  const start = (documentId: string) => extraction.startBimModel({ organizationId: ORG, projectId: null, documentId })
  const complete = (run: BimModelRun, globalId: string) =>
    extraction.completeBimModel({
      run,
      organizationId: ORG,
      summary,
      elements: [element(globalId)],
      indexStorageKey: null,
      indexStorageBucket: null,
    })

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const dbModule = await import('@/lib/db')
    db = dbModule.getDb()
    closeDb = dbModule.closeDb
    withPlatformAccess = (await import('@/lib/db/tenant-context')).withPlatformAccess
    extraction = await import('./extraction-repository')
  })

  afterAll(async () => {
    await withPlatformAccess('remove the fixture documents', () =>
      db.execute(sql`DELETE FROM documents WHERE organization_id = ${ORG}`)
    )
    await closeDb()
  })

  it('gives a re-ingest the same row and a run of its own', async () => {
    const documentId = await seedDocument('same-row.ifc')
    const first = await start(documentId)
    const second = await start(documentId)

    expect(second.modelId).toBe(first.modelId)
    expect(second.runId).not.toBe(first.runId)
  })

  it('keeps the newer run’s elements when the older run finishes after it', async () => {
    const documentId = await seedDocument('late-complete.ifc')
    const older = await start(documentId)
    const newer = await start(documentId)

    expect(await complete(newer, 'from-the-newer-bytes')).toBe(true)
    expect(await complete(older, 'from-the-older-bytes')).toBe(false)

    expect(await readModel(newer.modelId)).toMatchObject({ status: 'ready', global_ids: ['from-the-newer-bytes'] })
  })

  it('leaves a running extraction alone when the run it replaced fails', async () => {
    const documentId = await seedDocument('late-fail.ifc')
    const older = await start(documentId)
    const newer = await start(documentId)

    expect(await extraction.failBimModel(older, ORG, 'the older bytes were not IFC')).toBe(false)
    expect(await readModel(newer.modelId)).toMatchObject({ status: 'extracting', error_message: null })

    expect(await complete(newer, 'wall')).toBe(true)
    expect(await extraction.failBimModel(older, ORG, 'the older bytes were not IFC')).toBe(false)
    expect(await readModel(newer.modelId)).toMatchObject({ status: 'ready', error_message: null })
  })

  it('moves only from `extracting`: a run cannot fail or finish the model twice', async () => {
    const documentId = await seedDocument('once.ifc')
    const run = await start(documentId)

    expect(await complete(run, 'wall')).toBe(true)
    expect(await extraction.failBimModel(run, ORG, 'too late')).toBe(false)
    expect(await complete(run, 'again')).toBe(false)
    expect(await readModel(run.modelId)).toMatchObject({ status: 'ready', global_ids: ['wall'] })
  })

  it('still records the failure of the run that holds the row, and a later start clears it', async () => {
    const documentId = await seedDocument('fail-then-retry.ifc')
    const run = await start(documentId)

    expect(await extraction.failBimModel(run, ORG, 'not IFC')).toBe(true)
    expect(await readModel(run.modelId)).toMatchObject({ status: 'failed', error_message: 'not IFC' })

    const retry = await start(documentId)
    expect(await readModel(retry.modelId)).toMatchObject({ status: 'extracting', error_message: null })
  })

  it('refuses a status outside the vocabulary', async () => {
    const documentId = await seedDocument('vocabulary.ifc')
    const run = await start(documentId)

    await expect(
      withPlatformAccess('write an unknown status', () =>
        db.execute(sql`UPDATE bim_models SET status = 'completed' WHERE id = ${run.modelId}::uuid`)
      )
    ).rejects.toThrow()
  })
})
