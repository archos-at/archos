import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/authz/folder-access', () => ({ isFolderVisibleTo: vi.fn(async () => true) }))
vi.mock('@/lib/authz/organizations', () => ({ canManageOfficeShelf: vi.fn(() => true) }))
vi.mock('@/lib/authz/permissions', () => ({ hasPermission: vi.fn(() => true), ORG_PERMISSIONS: { projectsAdminister: 'x' } }))

import type { AuthorizedSession } from '@/lib/auth/types'
import { mayReviewQuarantine } from './quarantine-reviewers'

const admin = { organizationId: 'org-1', userId: 'u-admin' } as AuthorizedSession

describe('a held upload on a personal shelf (ADR-0193)', () => {
  it('is reviewed by nobody, not even an administrator: only its owner sees it', async () => {
    await expect(mayReviewQuarantine(admin, { scope: 'personal', projectId: null, folderId: null })).resolves.toBe(false)
  })

  it('leaves an office-shelf upload to the administrator as before', async () => {
    await expect(mayReviewQuarantine(admin, { scope: 'office_shelf', projectId: null, folderId: null })).resolves.toBe(true)
  })
})
