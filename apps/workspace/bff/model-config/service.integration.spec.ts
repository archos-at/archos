/**
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('model-config service against live Postgres', () => {
  beforeAll(() => {
    process.env.APP_DATABASE_URL = url
  })

  afterAll(async () => {
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('creates versions, resolves overrides, rolls back, deactivates', async () => {
    const { activateVersion, createAndActivateVersion, getActiveModelOverrides, getOrgModelConfig, listVersions } =
      await import('./service')

    const org = `org_test_${Date.now()}`

    expect(await getActiveModelOverrides(org)).toBeNull()

    const v1 = await createAndActivateVersion({
      organizationId: org,
      overrides: { deep_research: { model: 'vendor/model-a' } },
      modelSnapshot: { deep_research: { id: 'vendor/model-a', contextLength: 200000 } },
      comment: 'first',
      actorUserId: 'admin_1',
    })
    expect(v1.version).toBe(1)
    expect(await getActiveModelOverrides(org)).toEqual({ deep_research: 'vendor/model-a' })

    const v2 = await createAndActivateVersion({
      organizationId: org,
      overrides: { deep_research: { model: 'vendor/model-b' }, shallow_research: { model: 'vendor/model-c' } },
      modelSnapshot: null,
      comment: 'second',
      actorUserId: 'admin_1',
    })
    expect(v2.version).toBe(2)
    expect(await getActiveModelOverrides(org)).toEqual({
      deep_research: 'vendor/model-b',
      shallow_research: 'vendor/model-c',
    })

    const versions = await listVersions(org)
    expect(versions.map((v) => v.version)).toEqual([2, 1])

    await activateVersion({ organizationId: org, versionId: v1.id, actorUserId: 'admin_2' })
    expect(await getActiveModelOverrides(org)).toEqual({ deep_research: 'vendor/model-a' })
    expect((await listVersions(org)).length).toBe(2)
    expect((await getOrgModelConfig(org)).updatedBy).toBe('admin_2')

    await expect(
      activateVersion({ organizationId: 'org_other', versionId: v1.id, actorUserId: 'admin_2' }),
    ).rejects.toThrow(/not found/)

    await activateVersion({ organizationId: org, versionId: null, actorUserId: 'admin_2' })
    expect(await getActiveModelOverrides(org)).toBeNull()
  })
})
