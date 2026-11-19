import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./access', () => ({ officeStandardsEnabled: vi.fn(async () => true) }))
vi.mock('./folder-norms-repository', () => ({ listUndecidedFolderFiles: vi.fn(async () => []) }))
vi.mock('@/lib/inbox/best-effort', () => ({
  bestEffortInbox: vi.fn(async (_label: string, _organizationId: string, write: () => Promise<unknown>) => {
    await write()
  }),
}))
vi.mock('@/lib/inbox/service', () => ({
  emitInboxItems: vi.fn(async () => 0),
  openRecipientsOf: vi.fn(async () => []),
  refreshOpenInboxGroup: vi.fn(async () => 0),
  resolveInboxItemsFor: vi.fn(async () => 0),
}))
vi.mock('@/lib/inbox/repository', () => ({ recipientsHoldingGroup: vi.fn(async () => new Set()) }))
vi.mock('@/lib/jobs-queue/enqueue', () => ({ enqueueJob: vi.fn(), enqueueJobIfAbsent: vi.fn(async () => true) }))
vi.mock('@/lib/organizations/service', () => ({
  listOrganizationMembersWithRoles: vi.fn(async () => [
    { id: 'user-manager', status: 'active', roleSlug: 'buero' },
    { id: 'user-member', status: 'active', roleSlug: 'member' },
    { id: 'user-gone', status: 'inactive', roleSlug: 'buero' },
  ]),
}))
vi.mock('@/lib/authz/org-role-permissions', () => ({
  rolesHoldPermission: vi.fn(async (_organizationId: string, roles: readonly string[]) => roles.includes('buero')),
}))
vi.mock('@/lib/organizations/repository', () => ({
  findOrganizations: vi.fn(async () => ({
    organizations: [{ workosOrganizationId: 'org-on' }, { workosOrganizationId: 'org-off' }],
    truncated: false,
  })),
}))
vi.mock('@/lib/documents/shelf-folders', () => ({ findShelfFolder: vi.fn() }))
vi.mock('@/lib/db/tenant-context', () => ({ withTenant: vi.fn(async (_scope: unknown, run: () => Promise<unknown>) => run()) }))

import type { AuthorizedSession } from '@/lib/auth/types'
import { findShelfFolder } from '@/lib/documents/shelf-folders'
import { emitInboxItems, openRecipientsOf, refreshOpenInboxGroup, resolveInboxItemsFor } from '@/lib/inbox/service'
import { recipientsHoldingGroup } from '@/lib/inbox/repository'
import { enqueueJobIfAbsent } from '@/lib/jobs-queue/enqueue'
import { officeStandardsEnabled } from './access'
import { listUndecidedFolderFiles, type FolderFile } from './folder-norms-repository'
import {
  freshScan,
  normsScanJobId,
  runNormsScanSlice,
  scanAfterUpload,
  SCAN_PAGE,
  sweepNormsInFolders,
  UPLOAD_SCAN_DELAY_MS,
} from './folder-norms-scan'

const ORG = 'org-1'
const GROUP = `office_shelf.norms_found:organization:${ORG}`
const NORMEN = '7c0f2a8e-3f1b-4c55-9d1e-2a6b8c4d0e11'
const PLANUNG = '5d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const file = (n: number, fileName: string, folderId = NORMEN): FolderFile => ({ id: id(n), fileName, folderId })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('REQUIRE_AUTH', 'true')
})

afterEach(() => vi.unstubAllEnvs())

describe('the scan of an office’s folders for norms', () => {
  it('reads a full page and asks for the next, carrying what it found', async () => {
    vi.mocked(listUndecidedFolderFiles).mockResolvedValueOnce(
      Array.from({ length: SCAN_PAGE }, (_, n) => file(n + 1, n === 3 ? 'OENORM_B_1600.pdf' : `Plan_${n}.pdf`, n === 3 ? PLANUNG : NORMEN)),
    )
    const slice = await runNormsScanSlice(ORG, freshScan())
    expect(slice).toEqual({ done: false, payload: { afterId: id(SCAN_PAGE), found: 1, names: ['OENORM_B_1600.pdf'], folderId: PLANUNG } })
    expect(emitInboxItems).not.toHaveBeenCalled()
  })

  it('tells each office shelf manager once, with the files, and links the first folder', async () => {
    vi.mocked(listUndecidedFolderFiles).mockResolvedValueOnce([file(1, 'DIN_4109-1.pdf'), file(2, 'Grundriss.pdf')])
    const slice = await runNormsScanSlice(ORG, { afterId: id(0), found: 1, names: ['OENORM_B_1600.pdf'], folderId: PLANUNG })
    expect(slice.done).toBe(true)
    expect(emitInboxItems).toHaveBeenCalledWith([
      {
        organizationId: ORG,
        recipientUserId: 'user-manager',
        type: 'office_shelf.norms_found',
        resourceType: 'organization',
        resourceId: ORG,
        anchorId: PLANUNG,
        actorUserId: null,
        groupKey: GROUP,
        payload: { excerpt: 'OENORM_B_1600.pdf, DIN_4109-1.pdf' },
        occurrences: 2,
      },
    ])
    expect(resolveInboxItemsFor).not.toHaveBeenCalled()
  })

  it('tells nobody a second time, refreshes the open item and settles the item of one who may no longer manage', async () => {
    vi.mocked(listUndecidedFolderFiles).mockResolvedValueOnce([file(1, 'DIN_4109-1.pdf')])
    vi.mocked(openRecipientsOf).mockResolvedValueOnce(['user-manager', 'user-member'])
    vi.mocked(recipientsHoldingGroup).mockResolvedValueOnce(new Set(['user-manager']))
    await runNormsScanSlice(ORG, freshScan())
    expect(emitInboxItems).toHaveBeenCalledWith([])
    expect(refreshOpenInboxGroup).toHaveBeenCalledWith({
      organizationId: ORG,
      groupKey: GROUP,
      recipientUserIds: ['user-manager'],
      anchorId: NORMEN,
      count: 1,
      payload: { excerpt: 'DIN_4109-1.pdf' },
    })
    expect(resolveInboxItemsFor).toHaveBeenCalledWith([{ organizationId: ORG, recipientUserId: 'user-member', groupKey: GROUP }])
  })

  it('names twelve files and counts the rest', async () => {
    vi.mocked(listUndecidedFolderFiles).mockResolvedValueOnce(Array.from({ length: 15 }, (_, n) => file(n + 1, `OENORM_B_${2000 + n}.pdf`)))
    await runNormsScanSlice(ORG, freshScan())
    const [[emissions]] = vi.mocked(emitInboxItems).mock.calls
    expect(emissions[0].payload).toEqual({
      excerpt: `${Array.from({ length: 12 }, (_, n) => `OENORM_B_${2000 + n}.pdf`).join(', ')} +3`,
    })
    expect(emissions[0].occurrences).toBe(15)
  })

  it('settles every open item once nothing is left', async () => {
    vi.mocked(listUndecidedFolderFiles).mockResolvedValueOnce([file(1, 'Grundriss.pdf')])
    vi.mocked(openRecipientsOf).mockResolvedValueOnce(['user-manager'])
    await runNormsScanSlice(ORG, freshScan())
    expect(resolveInboxItemsFor).toHaveBeenCalledWith([{ organizationId: ORG, recipientUserId: 'user-manager', groupKey: GROUP }])
    expect(emitInboxItems).not.toHaveBeenCalled()
  })

  it('reads nothing and settles the items of an office without office-standards', async () => {
    vi.mocked(officeStandardsEnabled).mockResolvedValueOnce(false)
    vi.mocked(openRecipientsOf).mockResolvedValueOnce(['user-manager'])
    expect(await runNormsScanSlice(ORG, freshScan())).toMatchObject({ done: true })
    expect(listUndecidedFolderFiles).not.toHaveBeenCalled()
    expect(resolveInboxItemsFor).toHaveBeenCalledWith([{ organizationId: ORG, recipientUserId: 'user-manager', groupKey: GROUP }])
  })
})

describe('what starts a scan', () => {
  const session = { organizationId: ORG, featureFlags: ['office-standards'] } as unknown as AuthorizedSession

  it('queues one delayed scan per office when a norm lands in an ordinary folder', async () => {
    vi.mocked(findShelfFolder).mockResolvedValue({ path: 'Normen' } as Awaited<ReturnType<typeof findShelfFolder>>)
    const before = Date.now()
    await scanAfterUpload(session, { folderId: NORMEN, filename: 'OENORM_B_1600_2017-04-15.pdf' })
    expect(enqueueJobIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'office_norms_scan', organizationId: ORG, jobId: normsScanJobId(ORG), payload: freshScan() }),
    )
    const [[queued]] = vi.mocked(enqueueJobIfAbsent).mock.calls
    expect(queued.notBefore!.getTime()).toBeGreaterThanOrEqual(before + UPLOAD_SCAN_DELAY_MS)
    expect(normsScanJobId(ORG)).toBe(normsScanJobId(ORG))
    expect(normsScanJobId(ORG)).not.toBe(normsScanJobId('org-2'))
  })

  it('queues nothing for the standards tree, the top level, a file that is no norm, or an office without office-standards', async () => {
    vi.mocked(findShelfFolder).mockResolvedValue({ path: 'Grundlagen des Büros/Brandschutz' } as Awaited<ReturnType<typeof findShelfFolder>>)
    await scanAfterUpload(session, { folderId: NORMEN, filename: 'OENORM_B_3806.pdf' })
    vi.mocked(findShelfFolder).mockResolvedValue({ path: 'Normen' } as Awaited<ReturnType<typeof findShelfFolder>>)
    await scanAfterUpload(session, { folderId: null, filename: 'OENORM_B_3806.pdf' })
    await scanAfterUpload(session, { folderId: NORMEN, filename: 'Grundriss_EG.pdf' })
    await scanAfterUpload({ ...session, featureFlags: [] }, { folderId: NORMEN, filename: 'OENORM_B_3806.pdf' })
    expect(enqueueJobIfAbsent).not.toHaveBeenCalled()
  })

  it('never fails the upload it follows', async () => {
    vi.mocked(findShelfFolder).mockRejectedValueOnce(new Error('database away'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(scanAfterUpload(session, { folderId: NORMEN, filename: 'OENORM_B_3806.pdf' })).resolves.toBeUndefined()
    warn.mockRestore()
  })

  it('queues the daily scan of every office with office-standards on, and of no other', async () => {
    vi.mocked(officeStandardsEnabled).mockImplementation(async (organizationId) => organizationId === 'org-on')
    expect(await sweepNormsInFolders()).toEqual({ organizations: 2, queued: 1 })
    expect(enqueueJobIfAbsent).toHaveBeenCalledTimes(1)
    expect(enqueueJobIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-on', jobId: normsScanJobId('org-on') }))
  })
})
