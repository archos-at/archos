/**
 * @vitest-environment node
 *
 * Drawing calibrations (migration 0236) against a REAL Postgres through the
 * restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/drawing-calibrations/repository.integration.spec.ts
 *
 * What it proves, each a claim about SQL a mocked handle cannot disagree with:
 *   - another organization reads none of them and cannot plant one on this
 *     organization's document;
 *   - a reader who may not see the document (a held upload of somebody else)
 *     reads none of its calibrations, while its uploader, a reviewer and an
 *     internal read do;
 *   - setting a region again supersedes its active calibration in one move,
 *     and another region, page or version is left alone;
 *   - two active calibrations of one region are impossible: writers at once
 *     leave exactly one, and each loser is a conflict;
 *   - withdrawing stamps who and when, happens once, and does not revive the
 *     calibration it had superseded;
 *   - the CHECKs refuse a point outside its region and a region off the page;
 *   - the list is bounded and pages, oldest first, by status and by page.
 *
 * `task db:test:rls` (scripts/rls-test-db.sh) runs it with the other suites.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const STAMP = Date.now()
const ORG = `org_calibrations_${STAMP}`
const OTHER_ORG = `${ORG}_other`
const USER = `user_calibrations_${STAMP}`
const UPLOADER = `${USER}_uploader`

describe('the drawing calibrations suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('drawing calibrations against live Postgres', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let repo: typeof import('./repository')
  let readers: typeof import('@/lib/documents/visibility')
  const ids = { project: '', document: '', held: '', v1: '', v2: '', heldVersion: '' }

  const inOrg = <T>(organizationId: string, run: () => PromiseLike<T>) =>
    withTenant({ organizationId, userId: USER }, run)
  const first = (rows: Iterable<{ id: unknown }>) => String(Array.from(rows)[0]?.id)

  async function project(organizationId: string, name: string): Promise<string> {
    return first(
      await inOrg(organizationId, () =>
        db.execute<{ id: string }>(sql`
          insert into projects (organization_id, name, created_by, collection_name)
          values (${organizationId}, ${name}, ${USER}, ${`proj_cal_${name}_${STAMP}`}) returning id`)
      )
    )
  }

  async function document(filename: string, held = false): Promise<string> {
    return first(
      await inOrg(ORG, () =>
        db.execute<{ id: string }>(sql`
          insert into documents (organization_id, project_id, scope, filename, storage_key, collection_name, created_by,
                                 status, screening_outcome)
          values (${ORG}, ${ids.project}::uuid, 'project', ${filename}, ${`k/${STAMP}/${filename}`},
                  ${`proj_cal_${ids.project}`}, ${held ? UPLOADER : USER}, ${held ? 'quarantined' : 'completed'},
                  ${held ? 'quarantined' : 'clean'}) returning id`)
      )
    )
  }

  async function version(documentId: string, number: number, state: 'published' | 'superseded'): Promise<string> {
    return first(
      await inOrg(ORG, () =>
        db.execute<{ id: string }>(sql`
          insert into document_versions (organization_id, document_id, project_id, version_number, state, storage_key,
                                         content_hash, created_by, approved_by, approved_at)
          values (${ORG}, ${documentId}::uuid, ${ids.project}::uuid, ${number}, ${state},
                  ${`k/${STAMP}/${documentId}/v${number}`}, ${`sha256:${STAMP}${documentId}${number}`}, ${USER}, ${USER}, now())
          returning id`)
      )
    )
  }

  const REGION = { x: 0.1, y: 0.1, w: 0.5, h: 0.4 }
  const OTHER_REGION = { x: 0.6, y: 0.5, w: 0.4, h: 0.5 }

  const calibration = (extra: Partial<import('./repository').NewCalibrationInput> = {}) => {
    const region = extra.region ?? REGION
    return {
      organizationId: ORG,
      documentId: ids.document,
      versionId: ids.v2,
      page: 1,
      region,
      from: { x: region.x + 0.01, y: region.y + 0.01 },
      to: { x: region.x + 0.2, y: region.y + 0.01 },
      lengthM: 5,
      createdBy: USER,
      ...extra,
    }
  }
  const set = (extra: Partial<import('./repository').NewCalibrationInput> = {}) => repo.setDrawingCalibration(calibration(extra))

  const list = (
    filter: Partial<import('./repository').CalibrationFilter> = {},
    reader: import('@/lib/documents/visibility').DocumentReader = readers.memberReader(USER),
    window = { limit: 50, offset: 0 }
  ) =>
    repo.listDrawingCalibrations(
      { organizationId: ORG, documentId: ids.document, versionId: ids.v2, status: 'active', ...filter },
      reader,
      window
    )

  /** The constraint a refused statement names, read off the driver's error under drizzle's wrapper. */
  async function refusal(run: () => PromiseLike<unknown>): Promise<string> {
    try {
      await run()
    } catch (error) {
      const said: string[] = []
      for (let current: unknown = error; current instanceof Error; current = current.cause) {
        const name = (current as { constraint_name?: unknown }).constraint_name
        if (typeof name === 'string') return name
        said.push(current.message)
      }
      return said.join(' <- ')
    }
    return 'accepted'
  }

  const rawInsert = (
    organizationId: string,
    values: { region: [number, number, number, number]; a: [number, number]; b: [number, number]; page?: number }
  ) =>
    db.execute(sql`
      insert into drawing_calibrations (organization_id, document_id, version_id, page, region_x, region_y, region_w,
                                        region_h, point_a_x, point_a_y, point_b_x, point_b_y, reference_length_m, created_by)
      values (${organizationId}, ${ids.document}::uuid, ${ids.v2}::uuid, ${values.page ?? 9}, ${values.region[0]},
              ${values.region[1]}, ${values.region[2]}, ${values.region[3]}, ${values.a[0]}, ${values.a[1]},
              ${values.b[0]}, ${values.b[1]}, 5, ${USER})`)

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    repo = await import('./repository')
    readers = await import('@/lib/documents/visibility')
    ids.project = await project(ORG, 'Wohnbau')
    await project(OTHER_ORG, 'Fremd')
    ids.document = await document('EG_Grundriss.pdf')
    ids.held = await document('Held_Grundriss.pdf', true)
    ids.v1 = await version(ids.document, 1, 'superseded')
    ids.v2 = await version(ids.document, 2, 'published')
    ids.heldVersion = await version(ids.held, 1, 'published')
  })

  afterAll(async () => {
    if (!db) return
    await withPlatformAccess('test teardown', async () => {
      for (const organizationId of [ORG, OTHER_ORG]) {
        await db.execute(sql`delete from projects where organization_id = ${organizationId}`)
      }
    })
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('sets a calibration born active, with what the person did and nothing derived', async () => {
    const row = await set({ page: 2, lengthM: 5.4 })
    expect(row).toMatchObject({
      organizationId: ORG,
      documentId: ids.document,
      versionId: ids.v2,
      page: 2,
      regionX: REGION.x,
      regionY: REGION.y,
      regionW: REGION.w,
      regionH: REGION.h,
      referenceLengthM: 5.4,
      status: 'active',
      createdBy: USER,
      withdrawnAt: null,
      withdrawnBy: null,
    })
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(await repo.findDrawingCalibration(ORG, ids.document, row.id, readers.memberReader(USER))).toMatchObject({ id: row.id })
  })

  it('supersedes the active calibration of the same region, and leaves another region, page and version alone', async () => {
    const page = 3
    const earlier = await set({ page })
    const neighbour = await set({ page, region: OTHER_REGION })
    const otherPage = await set({ page: 4 })
    const otherVersion = await set({ page, versionId: ids.v1 })
    const later = await set({ page, lengthM: 6 })

    const active = await list({ page })
    expect(active.map((row) => row.id).sort()).toEqual([neighbour.id, later.id].sort())
    const superseded = await list({ page, status: 'superseded' })
    expect(superseded.map((row) => row.id)).toEqual([earlier.id])
    expect((await list({ page: 4 })).map((row) => row.id)).toEqual([otherPage.id])
    // A calibration belongs to one version: the other version's row is its own, still active.
    expect((await list({ page, versionId: ids.v1 })).map((row) => row.id)).toEqual([otherVersion.id])
  })

  it('makes two active calibrations of one region impossible: writers at once leave one, the losers conflict', async () => {
    const page = 5
    const settled = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => set({ page, lengthM: index + 1 })))
    const won = settled.filter((result) => result.status === 'fulfilled')
    const lost = settled.filter((result) => result.status === 'rejected')
    expect(won.length).toBeGreaterThanOrEqual(1)
    for (const result of lost) expect(result.reason).toBeInstanceOf(repo.CalibrationSetConflictError)
    expect(await list({ page })).toHaveLength(1)

    // And the index itself, without the repository in between.
    const name = await refusal(() =>
      inOrg(ORG, () => rawInsert(ORG, { page, region: [REGION.x, REGION.y, REGION.w, REGION.h], a: [0.2, 0.2], b: [0.3, 0.2] }))
    )
    expect(name).toBe('uniq_drawing_calibrations_active_region')
  })

  it('withdraws once, stamped, and does not revive the calibration it had superseded', async () => {
    const page = 6
    const earlier = await set({ page })
    const later = await set({ page })
    const withdrawn = await repo.withdrawDrawingCalibration(ORG, ids.document, later.id, UPLOADER)
    expect(withdrawn).toMatchObject({ id: later.id, status: 'withdrawn', withdrawnBy: UPLOADER })
    expect(withdrawn?.withdrawnAt).toBeInstanceOf(Date)

    expect(await list({ page })).toEqual([])
    const reader = readers.memberReader(USER)
    expect((await repo.findDrawingCalibration(ORG, ids.document, earlier.id, reader))?.status).toBe('superseded')
    // Neither a withdrawn nor a superseded calibration can be withdrawn; nor one named under another document.
    expect(await repo.withdrawDrawingCalibration(ORG, ids.document, later.id, USER)).toBeNull()
    expect(await repo.withdrawDrawingCalibration(ORG, ids.document, earlier.id, USER)).toBeNull()
    const fresh = await set({ page })
    expect(await repo.withdrawDrawingCalibration(ORG, ids.held, fresh.id, USER)).toBeNull()
    expect((await list({ page })).map((row) => row.id)).toEqual([fresh.id])
  })

  it('shows a held document’s calibrations only to those the document is not held from', async () => {
    const row = await set({ documentId: ids.held, versionId: ids.heldVersion, page: 1 })
    const filter = { documentId: ids.held, versionId: ids.heldVersion }
    expect(await list(filter, readers.memberReader(USER))).toEqual([])
    expect(await list(filter, readers.SCREENED_ONLY)).toEqual([])
    expect(await repo.findDrawingCalibration(ORG, ids.held, row.id, readers.memberReader(USER))).toBeNull()

    expect((await list(filter, readers.memberReader(UPLOADER))).map((found) => found.id)).toEqual([row.id])
    expect((await list(filter, readers.REVIEWER_READER)).map((found) => found.id)).toEqual([row.id])
    expect((await list(filter, readers.internalRead('reloaded'))).map((found) => found.id)).toEqual([row.id])
  })

  it('keeps another organization out: it reads none and cannot plant one', async () => {
    const row = await set({ page: 7 })
    const seen = await inOrg(OTHER_ORG, () =>
      db.execute<{ count: string }>(sql`select count(*)::text as count from drawing_calibrations`)
    )
    expect(Array.from(seen)[0]?.count).toBe('0')
    expect(
      await repo.listDrawingCalibrations(
        { organizationId: OTHER_ORG, documentId: ids.document, versionId: ids.v2, status: 'active' },
        readers.internalRead('reloaded'),
        { limit: 50, offset: 0 }
      )
    ).toEqual([])
    expect(await repo.findDrawingCalibration(OTHER_ORG, ids.document, row.id, readers.internalRead('reloaded'))).toBeNull()
    expect(await repo.withdrawDrawingCalibration(OTHER_ORG, ids.document, row.id, USER)).toBeNull()

    const planted = await refusal(() =>
      inOrg(OTHER_ORG, () => rawInsert(ORG, { region: [0.1, 0.1, 0.2, 0.2], a: [0.15, 0.15], b: [0.25, 0.15] }))
    )
    expect(planted).toMatch(/row-level security/)
    expect((await repo.findDrawingCalibration(ORG, ids.document, row.id, readers.memberReader(USER)))?.status).toBe('active')
  })

  it('refuses, in the database, a point outside its region and a region off the page', async () => {
    const insert = (values: Parameters<typeof rawInsert>[1]) => refusal(() => inOrg(ORG, () => rawInsert(ORG, values)))
    expect(await insert({ region: [0.1, 0.1, 0.2, 0.2], a: [0.15, 0.15], b: [0.5, 0.15] })).toBe(
      'drawing_calibrations_points_in_region'
    )
    expect(await insert({ region: [0.1, 0.1, 0.2, 0.2], a: [0.15, 0.05], b: [0.25, 0.15] })).toBe(
      'drawing_calibrations_points_in_region'
    )
    expect(await insert({ region: [0.7, 0.1, 0.5, 0.2], a: [0.75, 0.15], b: [0.9, 0.15] })).toBe(
      'drawing_calibrations_region_on_page'
    )
    expect(await insert({ region: [0.1, 0.1, 0.2, 0], a: [0.15, 0.1], b: [0.25, 0.1] })).toBe(
      'drawing_calibrations_region_on_page'
    )
    expect(await insert({ region: [0.1, 0.1, 0.2, 0.2], a: [0.15, 0.15], b: [0.15, 0.15] })).toBe(
      'drawing_calibrations_points_apart'
    )
    // The same refusal through the repository: nothing of a refused set is kept, the superseding included.
    const page = 8
    const standing = await set({ page })
    await expect(set({ page, to: { x: 0.9, y: 0.9 } })).rejects.toThrow()
    expect((await list({ page })).map((row) => row.id)).toEqual([standing.id])
  })

  it('pages the list, oldest first, one row past the limit telling of a next page', async () => {
    const page = 10
    const regions = [0.1, 0.2, 0.3, 0.4, 0.5].map((x) => ({ x, y: 0.1, w: 0.3, h: 0.3 }))
    const created: string[] = []
    for (const region of regions) created.push((await set({ page, region })).id)

    const firstWindow = await list({ page }, readers.memberReader(USER), { limit: 2, offset: 0 })
    expect(firstWindow.map((row) => row.id)).toEqual(created.slice(0, 3))
    const secondWindow = await list({ page }, readers.memberReader(USER), { limit: 2, offset: 2 })
    expect(secondWindow.map((row) => row.id)).toEqual(created.slice(2, 5))
    const lastWindow = await list({ page }, readers.memberReader(USER), { limit: 2, offset: 4 })
    expect(lastWindow.map((row) => row.id)).toEqual(created.slice(4))
    // Without a page, the version's calibrations of every page, still bounded by the window.
    expect(await list({}, readers.memberReader(USER), { limit: 3, offset: 0 })).toHaveLength(4)
  })
})
