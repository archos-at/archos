/**
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { closeDb } from '@/lib/db'
import { runBimQuery } from './query'
import { COUNT_CEILING } from './repository'
import { BIG_MODEL_ELEMENTS, seedQueryFixture, type QueryFixture } from './query.fixtures'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/base-knowledge/context/service', async () => {
  const { settledContext } = await import('./rule-basis.fixtures')
  return { contextForPage: vi.fn(async () => settledContext()) }
})

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('BIM property catalog and element counts against live Postgres', () => {
  let fx: QueryFixture

  beforeAll(async () => {
    fx = await seedQueryFixture()
  }, 120_000)

  afterAll(async () => {
    await closeDb()
  })

  const run = (request: Parameters<typeof runBimQuery>[0]) =>
    runBimQuery(request, { modelId: fx.modelId, organizationId: fx.ORG })

  it('publishes the property catalog with real values and counts', async () => {
    const result = await run({ op: 'properties', maxValues: 10 })
    const fireRating = result.properties?.find((entry) => entry.name === 'FireRating')
    expect(fireRating?.set).toBe('Pset_WallCommon')
    expect(fireRating?.source).toBe('property')
    expect(fireRating?.values).toEqual([
      { value: 'REI 90', elements: 3 },
      { value: 'EI 30', elements: 2 },
    ])

    const netFloorArea = result.properties?.find((entry) => entry.name === 'NetFloorArea')
    expect(netFloorArea?.source).toBe('quantity')
    expect(netFloorArea?.elements).toBe(4)
  })

  it('narrows the property catalog to one element type', async () => {
    const result = await run({ op: 'properties', ifcType: 'IfcWindow', maxValues: 10 })
    expect(result.properties?.map((entry) => entry.name).sort()).toEqual([
      'IsExternal',
      'ThermalTransmittance',
    ])
  })

  it('reports the property catalog of a small model as complete', async () => {
    const result = await run({ op: 'properties', maxValues: 10 })
    expect(result.propertyScan).toEqual({ scanned: 19, total: 19, complete: true })
    expect(result.summary).toBe(`${result.properties?.length} Merkmale im Modell.`)
  })

  it('samples the property catalog of a large model, and says it sampled', async () => {
    const result = await runBimQuery(
      { op: 'properties', maxValues: 10 },
      { modelId: fx.bigModelId, organizationId: fx.ORG }
    )

    expect(result.propertyScan?.total).toBe(BIG_MODEL_ELEMENTS)
    expect(result.propertyScan?.complete).toBe(false)
    expect(result.propertyScan?.scanned).toBe(600)

    expect(result.properties?.map((entry) => entry.set).sort()).toEqual([
      'Pset_DoorCommon',
      'Pset_DoorCommon',
      'Pset_WallCommon',
      'Pset_WallCommon',
      'Pset_WindowCommon',
      'Pset_WindowCommon',
    ])

    expect(result.summary).toContain('Stichprobe von 600 der 10100 Bauteile')
    expect(result.summary).toContain('NUR auf die Stichprobe')
  })

  it('stops counting elements at the ceiling and says the total is a floor', async () => {
    const result = await runBimQuery(
      { op: 'elements', filter: {}, limit: 25, offset: 0 },
      { modelId: fx.bigModelId, organizationId: fx.ORG }
    )

    expect(result.total).toBe(COUNT_CEILING)
    expect(result.totalIsLowerBound).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.summary).toContain(`Mindestens ${COUNT_CEILING} Bauteile`)
    expect(result.summary).not.toMatch(/^10000 Bauteile/)
  })
})
