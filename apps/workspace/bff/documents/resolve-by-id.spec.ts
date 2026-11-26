/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/authz/folder-access', () => ({ getHiddenFolderIds: vi.fn(async () => ['folder-closed']) }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/upload-screening/quarantine-reviewers', () => ({ shelfReaderFor: vi.fn(async () => ({ kind: 'member', userId: 'user-1' })) }))
vi.mock('./personal-shelf-door', () => ({ requirePersonalShelfDoor: vi.fn() }))
vi.mock('./repository', () => ({ findDocumentsByIds: vi.fn(async () => []) }))
vi.mock('./shelf-listing', () => ({ toListedDocuments: vi.fn(async () => []) }))

import { requireProjectAccess } from '@/lib/authz/projects'
import { requirePersonalShelfDoor } from './personal-shelf-door'
import { findDocumentsByIds } from './repository'
import { resolveShelfDocumentsById } from './resolve-by-id'

const session = { userId: 'user-1', organizationId: 'org-1' } as AuthorizedSession
const IDS = ['4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f']

beforeEach(() => vi.clearAllMocks())

describe('resolveShelfDocumentsById', () => {
  it('reads a project shelf only with project:view, outside the folders the reader may not open', async () => {
    await resolveShelfDocumentsById(session, { kind: 'project', projectId: 'proj-1' }, IDS)

    expect(requireProjectAccess).toHaveBeenCalledWith(session, 'proj-1', 'project:view')
    expect(findDocumentsByIds).toHaveBeenCalledWith({ kind: 'project', projectId: 'proj-1' }, 'org-1', IDS, {
      hiddenFolderIds: ['folder-closed'],
      reader: { kind: 'member', userId: 'user-1' },
    })
  })

  it('reads the office shelf of the caller’s own organization', async () => {
    await resolveShelfDocumentsById(session, { kind: 'office_shelf' }, IDS)

    expect(requireProjectAccess).not.toHaveBeenCalled()
    expect(findDocumentsByIds).toHaveBeenCalledWith({ kind: 'office_shelf' }, 'org-1', IDS, { reader: { kind: 'member', userId: 'user-1' } })
  })

  it('reads a personal shelf through its door, as its owner', async () => {
    await resolveShelfDocumentsById(session, { kind: 'personal', userId: 'user-1' }, IDS)

    expect(requirePersonalShelfDoor).toHaveBeenCalledWith(session)
    expect(findDocumentsByIds).toHaveBeenCalledWith({ kind: 'personal', userId: 'user-1' }, 'org-1', IDS, {
      reader: { kind: 'member', userId: 'user-1' },
    })
  })
})
