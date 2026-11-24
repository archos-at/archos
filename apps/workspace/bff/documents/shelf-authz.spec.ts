import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/authz/organizations', () => ({ canManageOfficeShelf: vi.fn(() => true) }))

import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { personalShelf } from './shelf'
import { requireShelfRead, requireShelfWrite } from './shelf-authz'

const owner = { organizationId: 'org-1', userId: 'u-owner' } as AuthorizedSession
const colleague = { organizationId: 'org-1', userId: 'u-colleague' } as AuthorizedSession

describe('a personal shelf is read and written by its owner alone (ADR-0191 rule 1)', () => {
  it('lets the owner read and write it', async () => {
    await expect(requireShelfRead(owner, personalShelf('u-owner'))).resolves.toBeUndefined()
    await expect(requireShelfWrite(owner, personalShelf('u-owner'))).resolves.toBeUndefined()
  })

  it('finds nothing for anyone else, even one who manages the office shelf', async () => {
    await expect(requireShelfRead(colleague, personalShelf('u-owner'))).rejects.toBeInstanceOf(NotFoundError)
    await expect(requireShelfWrite(colleague, personalShelf('u-owner'))).rejects.toBeInstanceOf(NotFoundError)
  })
})
