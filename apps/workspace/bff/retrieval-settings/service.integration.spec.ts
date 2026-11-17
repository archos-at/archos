/**
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('platform retrieval settings against live Postgres', () => {
  beforeAll(() => {
    process.env.APP_DATABASE_URL = url
  })

  afterAll(async () => {
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('saves, replaces and clears the pinned counts', async () => {
    const {
      getPlatformRetrievalSettings,
      listPlatformRetrievalSettings,
      savePlatformRetrievalSettings,
    } = await import('./service')

    const actor = { actorUserId: 'user_test', actorEmail: 'owner@example.test' }

    await savePlatformRetrievalSettings({ settings: {}, note: null, ...actor })
    expect(await getPlatformRetrievalSettings()).toEqual({})

    let view = await listPlatformRetrievalSettings()
    expect(view).toHaveLength(10)
    expect(view.every((row) => !row.overridden && row.value === row.defaultValue)).toBe(true)

    await savePlatformRetrievalSettings({
      settings: { 'knowledge.top_k': 12, 'web.max_results': 7 },
      note: 'wider net',
      ...actor,
    })
    expect(await getPlatformRetrievalSettings()).toEqual({ 'knowledge.top_k': 12, 'web.max_results': 7 })

    await savePlatformRetrievalSettings({ settings: { 'knowledge.top_k': 10 }, note: 'bump', ...actor })
    expect(await getPlatformRetrievalSettings()).toEqual({ 'knowledge.top_k': 10 })

    view = await listPlatformRetrievalSettings()
    const topK = view.find((row) => row.key === 'knowledge.top_k')
    expect(topK).toMatchObject({ value: 10, defaultValue: 8, overridden: true, note: 'bump' })
    expect(view.find((row) => row.key === 'web.max_results')).toMatchObject({ value: 5, overridden: false })

    await savePlatformRetrievalSettings({ settings: {}, note: null, ...actor })
    expect(await getPlatformRetrievalSettings()).toEqual({})
  })

  it('keeps the note and author of a key the save did not change', async () => {
    const { listPlatformRetrievalSettings, savePlatformRetrievalSettings } = await import('./service')

    await savePlatformRetrievalSettings({
      settings: { 'knowledge.top_k': 12, 'web.max_results': 7 },
      note: 'wider net',
      actorUserId: 'user_first',
      actorEmail: 'first@example.test',
    })

    await savePlatformRetrievalSettings({
      settings: { 'knowledge.top_k': 12, 'web.max_results': 8 },
      note: 'more web hits',
      actorUserId: 'user_second',
      actorEmail: 'second@example.test',
    })

    const view = await listPlatformRetrievalSettings()
    expect(view.find((row) => row.key === 'knowledge.top_k')).toMatchObject({
      value: 12,
      note: 'wider net',
      updatedByEmail: 'first@example.test',
    })
    expect(view.find((row) => row.key === 'web.max_results')).toMatchObject({
      value: 8,
      note: 'more web hits',
      updatedByEmail: 'second@example.test',
    })

    await savePlatformRetrievalSettings({
      settings: {},
      note: null,
      actorUserId: 'user_second',
      actorEmail: 'second@example.test',
    })
  })

  it('rejects values outside the catalog before touching the database', async () => {
    const { savePlatformRetrievalSettings } = await import('./service')
    const actor = { actorUserId: 'user_test', actorEmail: 'owner@example.test' }

    await expect(
      savePlatformRetrievalSettings({ settings: { 'knowledge.top_k': 0 }, note: null, ...actor })
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      savePlatformRetrievalSettings({ settings: { 'ris.page_size': 30 }, note: null, ...actor })
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      savePlatformRetrievalSettings({ settings: { 'not.a.key': 1 }, note: null, ...actor })
    ).rejects.toMatchObject({ status: 422 })
  })
})
