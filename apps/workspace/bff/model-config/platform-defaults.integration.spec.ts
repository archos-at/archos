/**
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('platform model defaults against live Postgres', () => {
  beforeAll(() => {
    process.env.APP_DATABASE_URL = url
  })

  afterAll(async () => {
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('saves, replaces and clears the fleet defaults', async () => {
    const { getPlatformModelDefaults, listPlatformModelDefaults, savePlatformModelDefaults } =
      await import('./platform-defaults')

    const actor = { actorUserId: 'user_test', actorEmail: 'owner@example.test' }

    await savePlatformModelDefaults({ defaults: {}, modelSnapshot: {}, note: null, ...actor })
    expect(await getPlatformModelDefaults()).toEqual({})

    await savePlatformModelDefaults({
      defaults: { shallow_research: 'vendor/fast', deep_research: 'vendor/deep' },
      modelSnapshot: { shallow_research: { id: 'vendor/fast' }, deep_research: { id: 'vendor/deep' } },
      note: 'initial fleet default',
      ...actor,
    })
    expect(await getPlatformModelDefaults()).toEqual({ shallow_research: 'vendor/fast', deep_research: 'vendor/deep' })

    await savePlatformModelDefaults({
      defaults: { shallow_research: 'vendor/faster' },
      modelSnapshot: { shallow_research: { id: 'vendor/faster' } },
      note: 'model bump',
      ...actor,
    })
    expect(await getPlatformModelDefaults()).toEqual({ shallow_research: 'vendor/faster' })

    const rows = await listPlatformModelDefaults()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ agentGroup: 'shallow_research', model: 'vendor/faster', note: 'model bump' })

    await savePlatformModelDefaults({ defaults: {}, modelSnapshot: {}, note: null, ...actor })
    expect(await getPlatformModelDefaults()).toEqual({})
  })
})
