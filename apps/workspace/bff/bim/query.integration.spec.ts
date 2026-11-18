/**
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { closeDb } from '@/lib/db'
import { BimModelNotReadyError, buildBimPredicate, runBimQuery } from './query'
import { seedQueryFixture, type QueryFixture } from './query.fixtures'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/base-knowledge/context/service', async () => {
  const { settledContext } = await import('./rule-basis.fixtures')
  return { contextForPage: vi.fn(async () => settledContext()) }
})

const url = process.env.TEST_DATABASE_URL

describe('the BIM query suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(
      url,
      'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set, so the ' +
        'BIM query suite skipped and nothing verified the SQL. Check `task db:test:rls`.'
    ).toBeTruthy()
  })
})

describe.skipIf(!url)('BIM queries against live Postgres: overview and element filters', () => {
  let fx: QueryFixture

  beforeAll(async () => {
    fx = await seedQueryFixture()
  }, 120_000)

  afterAll(async () => {
    await closeDb()
  })

  const run = (request: Parameters<typeof runBimQuery>[0]) =>
    runBimQuery(request, { modelId: fx.modelId, organizationId: fx.ORG })

  it('serves the overview from the stored summary', async () => {
    const result = await run({ op: 'overview' })
    expect(result.overview?.projectName).toBe('Wohnhaus Beispielgasse')
    expect(result.overview?.totals.elements).toBe(19)
    expect(result.summary).toContain('19 Bauteile')
    expect(result.summary).toContain('Netto-Grundfläche 69 m²')
  })

  it('counts the element types from the rows, not from the summary', async () => {
    const result = await run({ op: 'types' })
    expect(result.types).toEqual(
      expect.arrayContaining([
        { ifcType: 'IfcWall', elements: 5 },
        { ifcType: 'IfcSpace', elements: 4 },
        { ifcType: 'IfcWindow', elements: 3 },
      ])
    )
  })

  it('filters by IFC type and storey together', async () => {
    const result = await run({
      op: 'elements',
      filter: { ifcTypes: ['IfcWall'], storeys: ['Erdgeschoss'] },
      limit: 25,
      offset: 0,
    })
    expect(result.total).toBe(3)
    expect(result.elements?.map((element) => element.name).sort()).toEqual([
      'Aussenwand Nord',
      'Aussenwand Sued',
      'Innenwand EG',
    ])
  })

  it('addresses a storey by GlobalId as readily as by name', async () => {
    const byId = await run({
      op: 'elements',
      filter: { ifcTypes: ['IfcWall'], storeys: ['0GridFixture00StoreyEG'] },
      limit: 25,
      offset: 0,
    })
    expect(byId.total).toBe(3)
  })

  it('matches IFC type names case-insensitively', async () => {
    const result = await run({ op: 'elements', filter: { ifcTypes: ['ifcwall'] }, limit: 25, offset: 0 })
    expect(result.total).toBe(5)
  })

  it('filters on a property value inside jsonb', async () => {
    const external = await run({
      op: 'elements',
      filter: {
        ifcTypes: ['IfcWall'],
        properties: [{ set: 'Pset_WallCommon', name: 'IsExternal', operator: 'eq', value: true, source: 'property' }],
      },
      limit: 25,
      offset: 0,
    })
    expect(external.total).toBe(3)

    const internal = await run({
      op: 'elements',
      filter: {
        ifcTypes: ['IfcWall'],
        properties: [{ name: 'IsExternal', operator: 'eq', value: false, source: 'property' }],
      },
      limit: 25,
      offset: 0,
    })
    expect(internal.total).toBe(2)
  })

  it('compares string property values case-insensitively', async () => {
    const result = await run({
      op: 'elements',
      filter: { properties: [{ name: 'FireRating', operator: 'eq', value: 'rei 90', source: 'property' }] },
      limit: 25,
      offset: 0,
    })
    expect(result.total).toBe(3)
  })

  it('keeps `missing` and `neq` as different questions', async () => {
    const notRei90 = await run({
      op: 'elements',
      filter: { properties: [{ name: 'FireRating', operator: 'neq', value: 'REI 90', source: 'property' }] },
      limit: 200,
      offset: 0,
    })
    expect(notRei90.total).toBe(2)

    const noRating = await run({
      op: 'elements',
      filter: { properties: [{ name: 'FireRating', operator: 'missing', source: 'property' }] },
      limit: 200,
      offset: 0,
    })
    expect(noRating.total).toBe(19 - 5)
  })

  it('compares numbers numerically, not as text', async () => {
    const result = await run({
      op: 'elements',
      filter: {
        properties: [{ name: 'ThermalTransmittance', operator: 'lte', value: 0.2, source: 'property' }],
      },
      limit: 25,
      offset: 0,
    })
    expect(result.total).toBe(3)
    expect(result.elements?.every((element) => element.ifcType === 'IfcWall')).toBe(true)
  })

  it('filters by material and by classification', async () => {
    const insulated = await run({
      op: 'elements',
      filter: { material: 'Waermedaemmung' },
      limit: 25,
      offset: 0,
    })
    expect(insulated.total).toBe(3)

    const classified = await run({
      op: 'elements',
      filter: { classification: 'B.1.3' },
      limit: 25,
      offset: 0,
    })
    expect(classified.total).toBe(2)
  })

  it('reads one element in full by GlobalId', async () => {
    const result = await run({ op: 'element', globalId: '0GridFixture00Wall0001' })
    expect(result.element?.name).toBe('Aussenwand Nord')
    expect(result.element?.properties['Pset_WallCommon']).toMatchObject({ FireRating: 'REI 90' })
    expect(result.element?.quantities['Qto_WallBaseQuantities']).toMatchObject({ NetSideArea: 24.5 })
    expect(result.element?.materials).toEqual(['Stahlbeton', 'Waermedaemmung EPS', 'Aussenputz'])
  })

  it('reports an exact total below the ceiling', async () => {
    const result = await run({ op: 'elements', filter: { ifcTypes: ['IfcWall'] }, limit: 25, offset: 0 })

    expect(result.total).toBe(5)
    expect(result.totalIsLowerBound).toBe(false)
    expect(result.truncated).toBe(false)
    expect(result.summary).toBe('5 Bauteile erfüllen die Abfrage.')
  })

  it('treats an absent filter as "every element" rather than crashing', () => {
    expect(buildBimPredicate(undefined)).toBeUndefined()
    expect(buildBimPredicate({})).toBeUndefined()
  })

  it('reports a model that is not ready as a retryable 409, not a crash', () => {
    const extracting = new BimModelNotReadyError('extracting', 'Model is still being extracted')
    const missing = new BimModelNotReadyError('failed', 'Model not found')

    expect(extracting.status).toBe(409)
    expect(extracting.code).toBe('MODEL_NOT_READY')
    expect(missing.status).toBe(404)
    expect(extracting.modelStatus).toBe('extracting')
  })

  it('refuses to answer for another tenant, even with the right model id', async () => {
    await expect(
      runBimQuery({ op: 'overview' }, { modelId: fx.modelId, organizationId: fx.OTHER_ORG })
    ).rejects.toBeInstanceOf(BimModelNotReadyError)
  })

  it('never returns another tenant’s elements', async () => {
    const result = await runBimQuery(
      { op: 'elements', filter: {}, limit: 200, offset: 0 },
      { modelId: fx.otherModelId, organizationId: fx.OTHER_ORG }
    )
    expect(result.total).toBe(19)

    await expect(
      runBimQuery(
        { op: 'elements', filter: {}, limit: 200, offset: 0 },
        { modelId: fx.otherModelId, organizationId: fx.ORG }
      )
    ).rejects.toBeInstanceOf(BimModelNotReadyError)
  })
})
