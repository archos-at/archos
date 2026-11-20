/**
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { closeDb } from '@/lib/db'
import { bimQuerySchema, runBimQuery } from './query'
import { seedQueryFixture, type QueryFixture } from './query.fixtures'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/base-knowledge/context/service', async () => {
  const { settledContext } = await import('./rule-basis.fixtures')
  return { contextForPage: vi.fn(async () => settledContext()) }
})

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('BIM aggregates, schedule and take-off against live Postgres', () => {
  let fx: QueryFixture

  beforeAll(async () => {
    fx = await seedQueryFixture()
  }, 120_000)

  afterAll(async () => {
    await closeDb()
  })

  const run = (request: Parameters<typeof runBimQuery>[0]) =>
    runBimQuery(request, { modelId: fx.modelId, organizationId: fx.ORG })

  it('counts without grouping', async () => {
    const result = await run({
      op: 'aggregate',
      filter: { ifcTypes: ['IfcWall'] },
      metric: 'count',
      limit: 50,
    })
    expect(result.groups).toEqual([
      { key: null, elements: 5, metric: null, measured: 5, truncated: false },
    ])
    expect(result.summary).toBe('5 Bauteile.')
  })

  it('groups counts by storey', async () => {
    const result = await run({ op: 'aggregate', filter: {}, metric: 'count', groupBy: 'storey', limit: 50 })
    expect(result.groups).toEqual(
      expect.arrayContaining([
        { key: 'Erdgeschoss', elements: 12, metric: null, measured: 12, truncated: false },
        { key: 'Obergeschoss', elements: 7, metric: null, measured: 7, truncated: false },
      ])
    )
  })

  it('sums a quantity across a filtered set', async () => {
    const result = await run({
      op: 'aggregate',
      filter: { ifcTypes: ['IfcSpace'] },
      metric: 'sum',
      quantity: 'NetFloorArea',
      limit: 50,
    })
    expect(result.groups?.[0].metric).toBe(69)
    expect(result.summary).toContain('sum(NetFloorArea) = 69')
  })

  it('sums a quantity per storey — the answer a Flächenaufstellung needs', async () => {
    const result = await run({
      op: 'aggregate',
      filter: { ifcTypes: ['IfcSpace'] },
      metric: 'sum',
      quantity: 'NetFloorArea',
      groupBy: 'storey',
      limit: 50,
    })
    expect(result.groups).toEqual(
      expect.arrayContaining([
        { key: 'Erdgeschoss', elements: 2, metric: 44.5, measured: 2, truncated: false },
        { key: 'Obergeschoss', elements: 2, metric: 24.5, measured: 2, truncated: false },
      ])
    )
  })

  it('groups by a property value', async () => {
    const result = await run({
      op: 'aggregate',
      filter: { ifcTypes: ['IfcWall'] },
      metric: 'count',
      groupBy: 'property',
      groupProperty: { set: 'Pset_WallCommon', name: 'FireRating' },
      limit: 50,
    })
    expect(result.groups).toEqual(
      expect.arrayContaining([
        { key: 'REI 90', elements: 3, metric: null, measured: 3, truncated: false },
        { key: 'EI 30', elements: 2, metric: null, measured: 2, truncated: false },
      ])
    )
  })

  it('counts each element once when grouping by material', async () => {
    const result = await run({
      op: 'aggregate',
      filter: { ifcTypes: ['IfcWall'] },
      metric: 'count',
      groupBy: 'material',
      limit: 50,
    })
    expect(result.groups).toEqual([
      { key: 'Stahlbeton', elements: 5, metric: null, measured: 5, truncated: false },
    ])
  })

  it('reports the model health it computed at extraction', async () => {
    const result = await run({ op: 'health' })
    expect(result.health?.score).toBeGreaterThan(0)
    expect(result.health?.totals.error).toBe(0)
    expect(result.summary).toContain('Modellprüfung')
  })

  it('attaches no caveat when the model has nothing to qualify', async () => {
    const result = await run({ op: 'aggregate', filter: {}, metric: 'count', groupBy: 'storey', limit: 50 })
    expect(result.caveat).toBeNull()
  })

  it('builds the Raumbuch over the whole element set', async () => {
    const result = await run({ op: 'schedule' })
    const schedule = result.schedule
    expect(schedule?.totals.rooms).toBe(4)
    expect(schedule?.totals.netFloorArea).toBe(69)
    expect(schedule?.storeys.map((storey) => storey.storeyName)).toEqual([
      'Erdgeschoss',
      'Obergeschoss',
    ])
    expect(schedule?.storeys[0].rooms.length).toBeGreaterThan(0)
    expect(result.summary).toContain('Raumbuch')
  })

  it('sums a take-off per type and counts what publishes nothing', async () => {
    const result = await run(bimQuerySchema.parse({ op: 'takeoff', quantity: 'NetSideArea' }))
    const walls = result.takeoff?.find((row) => row.group === 'IfcWall')
    expect(walls?.elements).toBe(5)
    expect(walls?.missing).toBeLessThanOrEqual(walls?.elements ?? 0)
    expect(walls?.missing).toBe(3)
    expect(walls?.value).toBeGreaterThan(0)
    expect(result.summary).toContain('Massenermittlung')
  })

  it('splits a take-off by material without double-counting an element', async () => {
    const rows =
      (await run(bimQuerySchema.parse({ op: 'takeoff', quantity: 'NetSideArea', byMaterial: true })))
        .takeoff ?? []
    const wallRows = rows.filter((row) => row.group.startsWith('IfcWall'))
    expect(wallRows.reduce((sum, row) => sum + row.elements, 0)).toBe(5)
  })
})
