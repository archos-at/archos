import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }))

import { getDb } from '@/lib/db'
import { getTenantContext, runWithTenantSlot, type TenantContext } from '@/lib/db/tenant-context'
import { asDb, makeProject } from '@/test-utils/db-fixtures'
import * as repository from './repository'

const PROJECT_UUID = '00000000-0000-4000-8000-000000000001'

let observed: (TenantContext | undefined)[] = []

function recordingDb(rows: unknown[] = [makeProject()]) {
  const chain: Record<string | symbol, unknown> = {}
  const proxy: unknown = new Proxy(chain, {
    get(_target, property) {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown) => {
          observed.push(getTenantContext())
          return Promise.resolve(rows).then(resolve)
        }
      }
      if (property === 'transaction') {
        return (callback: (tx: unknown) => unknown) => {
          observed.push(getTenantContext())
          return callback(proxy)
        }
      }
      return () => proxy
    },
  })
  return proxy
}

const CALLS: Array<[string, () => Promise<unknown>]> = [
  ['listProjectsInOrg', () => repository.listProjectsInOrg('org-1')],
  ['findProjectInOrg', () => repository.findProjectInOrg('proj-1', 'org-1')],
  ['findProjectTenancy', () => repository.findProjectTenancy(PROJECT_UUID)],
  [
    'insertProject',
    () =>
      repository.insertProject({
        organizationId: 'org-1',
        name: 'n',
        createdBy: 'u',
        collectionName: 'c',
      }),
  ],
  [
    'setProjectWorkosResourceId',
    () => repository.setProjectWorkosResourceId('proj-1', 'org-1', 'res-1'),
  ],
  ['renameProjectInOrg', () => repository.renameProjectInOrg('proj-1', 'org-1', 'n')],
  [
    'softDeleteProjectAndEnqueue',
    () =>
      repository.softDeleteProjectAndEnqueue(
        { id: 'proj-1', name: 'n', organizationId: 'org-1', collectionName: 'c' },
        'user-1',
        new Date('2026-08-01T00:00:00Z')
      ),
  ],
  ['findProjectProfileInOrg', () => repository.findProjectProfileInOrg('proj-1', 'org-1')],
  [
    'updateProjectProfileIfVersion',
    () =>
      repository.updateProjectProfileIfVersion('proj-1', 'org-1', 1, {
        profile: makeProject().profile,
        profileVersion: 2,
        profilePromptView: null,
        profileDisplay: null,
        profileUpdatedAt: null,
      }),
  ],
  ['findProjectWorkosResourceId', () => repository.findProjectWorkosResourceId('proj-1', 'org-1')],
  ['restoreProjectIfPending', () => repository.restoreProjectIfPending('proj-1', 'org-1')],
]

describe('projects repository establishes its own tenant scope', () => {
  beforeEach(() => {
    observed = []
    vi.mocked(getDb).mockReturnValue(asDb(recordingDb() as Record<string, unknown>))
  })

  it.each(CALLS)('%s runs every query inside a scope', async (_name, call) => {
    await runWithTenantSlot(async () => {
      await call()
    })

    expect(observed.length, 'the function ran no query — the recorder never fired').toBeGreaterThan(
      0
    )
    expect(
      observed.filter((context) => context === undefined),
      'a query ran with no tenant context. Wrap it in withTenant({ organizationId }) — or, if it ' +
        'genuinely spans tenants, withPlatformAccess(reason).'
    ).toEqual([])
  })

  it('the recorder really does observe an absent context', () => {
    expect(getTenantContext()).toBeUndefined()
  })

  it('the tenancy probe answers null for a non-uuid id without querying (#813)', async () => {
    await expect(repository.findProjectTenancy('e1105dec-20f7-4f9njl5f28e8d19')).resolves.toBeNull()
    expect(observed).toEqual([])
  })

  it('the tenancy probe states a platform reason rather than a tenant', async () => {
    await runWithTenantSlot(() => repository.findProjectTenancy(PROJECT_UUID))

    expect(observed.map((context) => context?.kind)).toContain('platform')
  })
})
