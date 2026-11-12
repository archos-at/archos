/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: vi.fn() }))
vi.mock('@/lib/jobs-queue/repository', () => ({ insertJobIfAbsent: vi.fn() }))

import { insertJobIfAbsent } from '@/lib/jobs-queue/repository'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { revisionNoticeId } from './notice'
import { insertRevisionNotice, planRevisionNotice } from './queue'

const request = { organizationId: 'org-1', actorUserId: 'editor', newerId: 'doc-b', olderId: 'doc-a' }
const NOW = new Date('2026-10-21T10:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  vi.mocked(isOrgFeatureEnabled).mockResolvedValue(true)
  vi.mocked(insertJobIfAbsent).mockResolvedValue(true)
})

describe('planRevisionNotice', () => {
  it('plans one bulk job per pair, held for the debounce, naming the person and nothing of the content', async () => {
    const job = await planRevisionNotice(request, NOW)

    expect(isOrgFeatureEnabled).toHaveBeenCalledWith('piloti-notices', 'org-1')
    const noticeId = revisionNoticeId('doc-b', 'doc-a')
    expect(job).toEqual({
      kind: 'revision_notice',
      organizationId: 'org-1',
      priority: BFF_JOB_PRIORITY.bulk,
      jobId: noticeId,
      notBefore: new Date('2026-10-21T10:02:00Z'),
      payload: { noticeId, newerId: 'doc-b', olderId: 'doc-a', actor: { userId: 'editor', email: null } },
    })
  })

  it('reads the debounce from the deployment', async () => {
    vi.stubEnv('REVISION_NOTICE_DELAY_SECONDS', '0')

    expect((await planRevisionNotice(request, NOW))?.notBefore).toEqual(NOW)
  })

  it('plans nothing where the office has not switched it on', async () => {
    vi.mocked(isOrgFeatureEnabled).mockResolvedValue(false)

    expect(await planRevisionNotice(request, NOW)).toBeNull()
  })

  it('plans nothing without a person to act as, or for a document compared with itself', async () => {
    expect(await planRevisionNotice({ ...request, actorUserId: null }, NOW)).toBeNull()
    expect(await planRevisionNotice({ ...request, olderId: 'doc-b' }, NOW)).toBeNull()
    expect(isOrgFeatureEnabled).not.toHaveBeenCalled()
  })

  it('lets a failed flag read through, so the caller claims nothing', async () => {
    vi.mocked(isOrgFeatureEnabled).mockRejectedValue(new Error('workos down'))

    await expect(planRevisionNotice(request, NOW)).rejects.toThrow('workos down')
  })
})

describe('insertRevisionNotice', () => {
  it('stores the row in the caller\'s transaction', async () => {
    const tx = {} as never
    const job = (await planRevisionNotice(request, NOW))!

    await insertRevisionNotice(job, tx)

    expect(insertJobIfAbsent).toHaveBeenCalledWith(job, tx)
  })
})
