import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./personal-use', () => ({ listPersonalSources: vi.fn() }))
vi.mock('./restricted-use-repository', () => ({ readConversationAudience: vi.fn() }))

import { ConflictError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { SHARING_ERROR_REASONS } from '@/lib/sharing/types'
import { listPersonalSources } from './personal-use'
import { assertPersonalUseConfirmed } from './personal-use-widening'
import { readConversationAudience } from './restricted-use-repository'

const owner = { organizationId: 'org-1', userId: 'u-owner' } as AuthorizedSession
const admin = { organizationId: 'org-1', userId: 'u-admin' } as AuthorizedSession
const db = {} as never
const toColleague = { kind: 'person', userId: 'u-colleague', self: false } as const

beforeEach(() => {
  vi.mocked(listPersonalSources).mockResolvedValue(['personal_shelf'])
  vi.mocked(readConversationAudience).mockResolvedValue({
    exists: true,
    projectId: null,
    createdBy: 'u-owner',
    visibility: 'private',
    grantees: [],
  })
})

const reasonOf = async (run: Promise<void>): Promise<unknown> =>
  run.then(
    () => null,
    (error: unknown) => (error instanceof ConflictError ? (error.details as { reason?: string }).reason : error),
  )

describe('widening a chat that drew on personal material asks its owner first (ADR-0191 rule 5)', () => {
  it('asks the owner to confirm, for a person and for the whole project', async () => {
    expect(await reasonOf(assertPersonalUseConfirmed(owner, db, 'c1', toColleague))).toBe(
      SHARING_ERROR_REASONS.personalContentConfirm,
    )
    expect(await reasonOf(assertPersonalUseConfirmed(owner, db, 'c1', { kind: 'visibility' }))).toBe(
      SHARING_ERROR_REASONS.personalContentConfirm,
    )
  })

  it('shares once the owner confirmed', async () => {
    await expect(
      assertPersonalUseConfirmed(owner, db, 'c1', { ...toColleague, confirmedPersonal: true }),
    ).resolves.toBeUndefined()
  })

  it('lets nobody but the owner widen it, confirmed or not, and no one take it over', async () => {
    expect(await reasonOf(assertPersonalUseConfirmed(admin, db, 'c1', { ...toColleague, confirmedPersonal: true }))).toBe(
      SHARING_ERROR_REASONS.personalContentOwner,
    )
    expect(
      await reasonOf(
        assertPersonalUseConfirmed(admin, db, 'c1', { kind: 'person', userId: 'u-admin', self: true, confirmedPersonal: true }),
      ),
    ).toBe(SHARING_ERROR_REASONS.personalContentOwner)
  })

  it('asks nothing of a chat that drew on nothing personal', async () => {
    vi.mocked(listPersonalSources).mockResolvedValue([])
    await expect(assertPersonalUseConfirmed(owner, db, 'c1', toColleague)).resolves.toBeUndefined()
  })
})
