/**
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { closeDb } from '@/lib/db'
import { bimQuerySchema, buildBimElementPlan, runBimQuery } from './query'
import { listBimElements } from './repository'
import {
  BIG_MODEL_ELEMENTS,
  clearSearchKeys,
  readSearchKeys,
  seedQueryFixture,
  setSearchKeysIndexed,
  sortedKeys,
  writeSearchKeys,
  type QueryFixture,
} from './query.fixtures'
import { buildSearchKeys } from './rule-inputs'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/base-knowledge/context/service', async () => {
  const { settledContext } = await import('./rule-basis.fixtures')
  return { contextForPage: vi.fn(async () => settledContext()) }
})

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('BIM element search keys against live Postgres', () => {
  let fx: QueryFixture

  beforeAll(async () => {
    fx = await seedQueryFixture()
  }, 120_000)

  afterAll(async () => {
    await closeDb()
  })

  const run = (request: Parameters<typeof runBimQuery>[0]) =>
    runBimQuery(request, { modelId: fx.modelId, organizationId: fx.ORG })

  it('stores the search keys buildSearchKeys derives for each element', async () => {
    const stored = await readSearchKeys(fx.modelId)
    expect(Object.values(stored).filter((keys) => Object.keys(keys).length > 0).length).toBeGreaterThan(0)

    for (const element of fx.elements) {
      expect(stored[element.globalId], element.name ?? element.globalId).toEqual(sortedKeys(buildSearchKeys(element)))
    }
  })

  it('answers every property filter identically with and without the pre-filter', async () => {
    const requests = [
      { properties: [{ name: 'FireRating', operator: 'eq', value: 'rei 90', source: 'property' }] },
      { properties: [{ set: 'Pset_WallCommon', name: 'FireRating', operator: 'eq', value: 'REI 90', source: 'property' }] },
      { properties: [{ name: 'FireRating', operator: 'exists', source: 'property' }] },
      { properties: [{ name: 'FireRating', operator: 'missing', source: 'property' }] },
      { properties: [{ name: 'FireRating', operator: 'neq', value: 'REI 90', source: 'property' }] },
      { properties: [{ name: 'FireRating', operator: 'contains', value: 'rei', source: 'property' }] },
      { properties: [{ name: 'IsExternal', operator: 'eq', value: true, source: 'property' }] },
      { properties: [{ name: 'ThermalTransmittance', operator: 'lte', value: 0.2, source: 'property' }] },
      { properties: [{ name: 'NetFloorArea', operator: 'gt', value: 10, source: 'quantity' }] },
      { properties: [{ set: 'Qto_WallBaseQuantities', name: 'NetSideArea', operator: 'exists', source: 'quantity' }] },
      { properties: [{ name: 'AcousticRating', operator: 'exists', source: 'property' }] },
      { storeys: ['Erdgeschoss'] },
      { storeys: ['ERDGESCHOSS'], properties: [{ name: 'FireRating', operator: 'exists', source: 'property' }] },
    ]
    const answers = async () =>
      Promise.all(
        requests.map(async (filter) => {
          const result = await run(bimQuerySchema.parse({ op: 'elements', filter, limit: 200, offset: 0 }))
          return {
            filter: JSON.stringify(filter),
            total: result.total ?? 0,
            globalIds: (result.elements ?? []).map((element) => element.globalId).sort(),
          }
        })
      )

    const withPrefilter = await answers()
    expect(withPrefilter.filter((answer) => answer.total > 0).length).toBe(requests.length)

    await setSearchKeysIndexed(fx.modelId, false)
    try {
      expect(await answers()).toEqual(withPrefilter)
    } finally {
      await setSearchKeysIndexed(fx.modelId, true)
    }
  })

  it('answers correctly for a model whose elements were never indexed', async () => {
    await clearSearchKeys(fx.modelId)
    await setSearchKeysIndexed(fx.modelId, false)

    try {
      const result = await run({
        op: 'elements',
        filter: { properties: [{ name: 'FireRating', operator: 'eq', value: 'REI 90', source: 'property' }] },
        limit: 25,
        offset: 0,
      })
      expect(result.total).toBe(3)
    } finally {
      await writeSearchKeys(fx.modelId, fx.elements)
      await setSearchKeysIndexed(fx.modelId, true)
    }
  })

  it('returns the same elements whichever plan serves the page', async () => {
    const plan = buildBimElementPlan(
      { properties: [{ name: 'FireRating', operator: 'eq', value: 'REI 90', source: 'property' }] },
      { searchKeysIndexed: true }
    )
    const page = (over: Partial<Parameters<typeof listBimElements>[0]>) =>
      listBimElements({
        modelId: fx.bigModelId,
        organizationId: fx.ORG,
        plan,
        elementCount: BIG_MODEL_ELEMENTS,
        limit: 25,
        offset: 50,
        ...over,
      })

    const walked = await page({})
    expect(walked.walked).toBe(true)

    const assisted = await page({ plan: { ...plan, candidates: null } })
    expect(assisted.walked).toBe(false)

    expect(walked.rows).toEqual(assisted.rows)
    expect(walked.rows).toHaveLength(25)
    expect(walked.total).toBe(assisted.total)
  })

  it('does not walk for a filter the pre-filter already answers narrowly', async () => {
    const result = await listBimElements({
      modelId: fx.bigModelId,
      organizationId: fx.ORG,
      plan: buildBimElementPlan(
        { properties: [{ name: 'Reference', operator: 'eq', value: 'R7777', source: 'property' }] },
        { searchKeysIndexed: true }
      ),
      elementCount: BIG_MODEL_ELEMENTS,
      limit: 25,
      offset: 0,
    })

    expect(result.walked).toBe(false)
    expect(result.total).toBe(1)
  })
})
