/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/projects/folder-service', () => ({ listProjectFolders: vi.fn() }))
vi.mock('./access', () => ({ getAccessibleDocument: vi.fn() }))

import type { AuthorizedSession } from '@/lib/auth/types'
import { listProjectFolders } from '@/lib/projects/folder-service'
import { getAccessibleDocument } from './access'
import { agentDestination, resolveNamedFolder, UnknownFolderError } from './agent-folder'

const session = { userId: 'user_1', organizationId: 'org_1' } as AuthorizedSession

const folder = (id: string, path: string) => ({ id, path, name: path.slice(path.lastIndexOf('/') + 1) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listProjectFolders).mockResolvedValue([
    folder('f-berichte', 'Berichte'),
    folder('f-einreichung', '02 Einreichung'),
    folder('f-plaene', '02 Einreichung/Pläne'),
    folder('f-plaene-alt', '01 Entwurf/Pläne'),
  ])
})

describe('resolveNamedFolder', () => {
  it('finds a folder by its name, as a person says it', async () => {
    await expect(resolveNamedFolder(session, 'proj_1', '02 einreichung')).resolves.toBe('f-einreichung')
  })

  it('finds a folder by its path when its name is not unique', async () => {
    await expect(resolveNamedFolder(session, 'proj_1', '/02 Einreichung / Pläne/')).resolves.toBe('f-plaene')
  })

  it('answers the project root for „Alle Dateien“', async () => {
    await expect(resolveNamedFolder(session, 'proj_1', 'Alle Dateien')).resolves.toBeNull()
  })

  it('refuses an unknown or ambiguous folder, naming the folders that exist', async () => {
    const unknown = await resolveNamedFolder(session, 'proj_1', 'Einreichung').catch((error: unknown) => error)
    expect(unknown).toBeInstanceOf(UnknownFolderError)
    expect(unknown).toMatchObject({
      status: 422,
      details: {
        reason: 'folder-unknown',
        folders: ['01 Entwurf/Pläne', '02 Einreichung', '02 Einreichung/Pläne', 'Berichte'],
      },
    })
    await expect(resolveNamedFolder(session, 'proj_1', 'Pläne')).rejects.toBeInstanceOf(UnknownFolderError)
  })
})

describe('agentDestination', () => {
  it('defaults to the folder of the document the file was made from, in the same project', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue({ projectId: 'proj_1', folderId: 'f-plaene' } as never)
    await expect(agentDestination(session, 'proj_1', { sourceDocumentId: 'doc_1' })).resolves.toBe('f-plaene')

    vi.mocked(getAccessibleDocument).mockResolvedValue({ projectId: 'proj_2', folderId: 'f-x' } as never)
    await expect(agentDestination(session, 'proj_1', { sourceDocumentId: 'doc_1' })).resolves.toBeUndefined()
  })

  it('leaves the default to the filing when nothing was named', async () => {
    await expect(agentDestination(session, 'proj_1', {})).resolves.toBeUndefined()
  })
})
