/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationConfinedError, ForbiddenError } from '@/lib/api/errors'
import { folderReadOnlyError, requireFolderWrite } from '@/lib/authz/folder-access'
import { makeProject } from '@/test-utils/db-fixtures'
import { GENERATED_DOCUMENT_PRODUCERS, fileGeneratedDocument } from './generated'
import { FOLDER, SESSION, filingInput, render } from './generated.fixtures'

const {
  s3Send,
  ensureTenantBucketChecked,
  admitOrDiscard,
  requireProjectAccess,
  recordAuditEventOrThrow,
  findProjectInOrg,
  getOrCreateProjectFolderByName,
  findRootProjectFolderByName,
  findDocumentAuthoredByRef,
  recordedRestrictedFolders,
  listProjectFolderTree,
} = vi.hoisted(() => ({
  s3Send: vi.fn(),
  ensureTenantBucketChecked: vi.fn(),
  admitOrDiscard: vi.fn(),
  requireProjectAccess: vi.fn(),
  recordAuditEventOrThrow: vi.fn(),
  findProjectInOrg: vi.fn(),
  getOrCreateProjectFolderByName: vi.fn(),
  findRootProjectFolderByName: vi.fn(),
  findDocumentAuthoredByRef: vi.fn(),
  recordedRestrictedFolders: vi.fn(),
  listProjectFolderTree: vi.fn(),
}))

vi.mock('@/lib/authz/folder-access', async () => (await import('@/test-utils/folder-access')).openFolderAccessModule())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/s3', () => ({
  s3Client: { send: s3Send },
  bucketAdminS3Client: {},
  buildStorageKey: (
    organizationId: string,
    projectId: string,
    documentId: string,
    filename: string,
    folderPath?: string | null,
  ) => `org/${organizationId}/project/${projectId}/${folderPath ?? ''}/doc/${documentId}/${filename}`,
}))
vi.mock('@/lib/storage/bucket', () => ({ ensureTenantBucketChecked }))
vi.mock('@/lib/storage/admission', () => ({ admitOrDiscard }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEventOrThrow }))
vi.mock('@/lib/projects/repository', () => ({ findProjectInOrg }))
vi.mock('@/lib/projects/folder-service', () => ({ getOrCreateProjectFolderByName, findRootProjectFolderByName }))
vi.mock('@/lib/conversations/restricted-use', () => ({
  recordedRestrictedFolders,
  recordedSourceProjects: async () => [],
}))
vi.mock('@/lib/authz/folder-access-repository', () => ({ listProjectFolderTree }))
vi.mock('./repository', () => ({ findDocumentAuthoredByRef, deleteProjectDocument: vi.fn() }))

const file = () => fileGeneratedDocument(filingInput())

beforeEach(() => {
  vi.clearAllMocks()
  requireProjectAccess.mockResolvedValue({ role: 'editor' })
  findDocumentAuthoredByRef.mockResolvedValue(null)
  findProjectInOrg.mockResolvedValue(makeProject({ id: 'proj-1', collectionName: 'proj_abc' }))
  getOrCreateProjectFolderByName.mockResolvedValue(FOLDER)
  findRootProjectFolderByName.mockResolvedValue(FOLDER)
  recordedRestrictedFolders.mockResolvedValue([])
  listProjectFolderTree.mockResolvedValue([])
  ensureTenantBucketChecked.mockResolvedValue('grid-org-org-1')
  s3Send.mockResolvedValue({})
  admitOrDiscard.mockResolvedValue(undefined)
  recordAuditEventOrThrow.mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('project:documents:write and project:documents:generate', () => {
  it('refuses a session without project:documents:write, before any byte is written', async () => {
    requireProjectAccess.mockRejectedValue(new ForbiddenError('project:documents:write required'))

    await expect(file()).rejects.toBeInstanceOf(ForbiddenError)

    expect(render).not.toHaveBeenCalled()
    expect(s3Send).not.toHaveBeenCalled()
    expect(admitOrDiscard).not.toHaveBeenCalled()
    expect(recordAuditEventOrThrow).not.toHaveBeenCalled()
  })

  it('requires the write permission with the legacy umbrella the upload path accepts', async () => {
    await file()
    expect(requireProjectAccess).toHaveBeenCalledWith(SESSION, 'proj-1', [
      'project:documents:write',
      'project:edit',
    ])
  })

  describe('project:documents:generate', () => {
    const grantAllBut = (withheld: string) =>
      requireProjectAccess.mockImplementation(
        async (_session: unknown, _projectId: string, permission: string | readonly string[]) => {
          const asked = Array.isArray(permission) ? permission : [permission as string]
          if (asked.includes(withheld)) throw new ForbiddenError(`${withheld} required`)
          return { role: 'editor' }
        },
      )

    it('is required IN ADDITION to the write permission, not instead of it', async () => {
      await file()

      expect(requireProjectAccess.mock.calls.map((call) => call[2])).toEqual([
        ['project:documents:write', 'project:edit'],
        'project:documents:generate',
      ])
    })

    it('does NOT accept the legacy project:edit umbrella for machine authorship', async () => {
      await file()

      const asked = requireProjectAccess.mock.calls
        .map((call) => call[2])
        .filter((permission: string | readonly string[]) =>
          (Array.isArray(permission) ? permission : [permission as string]).includes(
            'project:documents:generate',
          ),
        )
      expect(asked).toEqual(['project:documents:generate'])
    })

    it('refuses a session that may upload but may not generate, before any byte is written', async () => {
      grantAllBut('project:documents:generate')

      await expect(file()).rejects.toBeInstanceOf(ForbiddenError)

      expect(render).not.toHaveBeenCalled()
      expect(s3Send).not.toHaveBeenCalled()
      expect(admitOrDiscard).not.toHaveBeenCalled()
      expect(recordAuditEventOrThrow).not.toHaveBeenCalled()
    })

    it('still refuses a session that may generate but may not write documents', async () => {
      grantAllBut('project:documents:write')

      await expect(file()).rejects.toBeInstanceOf(ForbiddenError)
      expect(s3Send).not.toHaveBeenCalled()
      expect(admitOrDiscard).not.toHaveBeenCalled()
    })

    it('gates every producer, because the gate is on the service and not on a route', async () => {
      grantAllBut('project:documents:generate')

      for (const producer of GENERATED_DOCUMENT_PRODUCERS) {
        await expect(
          fileGeneratedDocument(filingInput({ producer, ref: 'ref-1', title: 'Ablauf' })),
        ).rejects.toBeInstanceOf(ForbiddenError)
      }
      expect(admitOrDiscard).not.toHaveBeenCalled()
    })
  })
})

describe('the agent-authored-documents feature flag', () => {
  it('files where nobody signs in — a rollout is on there', async () => {
    await file()
    expect(admitOrDiscard).toHaveBeenCalledTimes(1)
  })

  it('refuses when the organization lacks the flag, before any permission is read', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'true')

    await expect(
      fileGeneratedDocument(filingInput({ session: { ...SESSION, featureFlags: [] }, title: 'Brandschutz' })),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(requireProjectAccess).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
    expect(s3Send).not.toHaveBeenCalled()
  })

  it('follows the per-org WorkOS flag where people sign in', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'true')

    await expect(
      fileGeneratedDocument(filingInput({ session: { ...SESSION, featureFlags: [] }, title: 'Brandschutz' })),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(admitOrDiscard).not.toHaveBeenCalled()

    await fileGeneratedDocument(
      filingInput({ session: { ...SESSION, featureFlags: ['agent-authored-documents'] }, title: 'Brandschutz' }),
    )
    expect(admitOrDiscard).toHaveBeenCalledTimes(1)
  })
})

describe('filing out of a conversation that drew on a restricted folder (ADR-0087, ADR-0088)', () => {
  const CONTRACTS = 'folder-vertraege'
  const fileFromChat = () =>
    fileGeneratedDocument(
      filingInput({
        producer: 'agent_document',
        ref: 's_conv_1-honorar',
        title: 'Honorarübersicht',
        origin: { conversationId: 's_conv_1', locale: 'de' },
      }),
    )
  const tree = (reportsUnderContracts: boolean) => [
    { id: CONTRACTS, parentId: null, accessMode: 'custom', grants: [{ role: 'org-gf', level: 'write' }] },
    { id: FOLDER.id, parentId: reportsUnderContracts ? CONTRACTS : null, accessMode: 'inherit', grants: [] },
  ]

  beforeEach(() => {
    recordedRestrictedFolders.mockResolvedValue([CONTRACTS])
    listProjectFolderTree.mockResolvedValue(tree(false))
  })

  it('refuses an open Berichte folder before anything is rendered, created or written', async () => {
    const error = await fileFromChat().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConversationConfinedError)
    expect((error as ConversationConfinedError).action).toBe('filing')
    expect(recordedRestrictedFolders).toHaveBeenCalledWith('s_conv_1', 'org-1')
    expect(listProjectFolderTree).toHaveBeenCalledWith('org-1', 'proj-1')
    expect(render).not.toHaveBeenCalled()
    expect(getOrCreateProjectFolderByName).not.toHaveBeenCalled()
    expect(s3Send).not.toHaveBeenCalled()
    expect(admitOrDiscard).not.toHaveBeenCalled()
  })

  it('judges a Berichte folder that does not exist yet as the open root folder it would become', async () => {
    findRootProjectFolderByName.mockResolvedValue(null)

    await expect(fileFromChat()).rejects.toBeInstanceOf(ConversationConfinedError)
    expect(getOrCreateProjectFolderByName).not.toHaveBeenCalled()
  })

  it('files into a Berichte folder whose path carries every folder the conversation drew on', async () => {
    listProjectFolderTree.mockResolvedValue(tree(true))

    await fileFromChat()

    expect(admitOrDiscard).toHaveBeenCalledTimes(1)
  })

  it('files from a conversation that drew on nothing without reading the folder tree', async () => {
    recordedRestrictedFolders.mockResolvedValue([])
    await fileFromChat()

    expect(listProjectFolderTree).not.toHaveBeenCalled()
    expect(admitOrDiscard).toHaveBeenCalledTimes(1)
  })
})

describe('filing into a folder the commissioning person may only read (ADR-0088)', () => {
  const fileReadOnly = () =>
    fileGeneratedDocument(filingInput({ ref: 'ref-read-only', title: 'Bericht' }))

  it('refuses a read-only Berichte with a typed 403 before anything is rendered or written', async () => {
    vi.mocked(requireFolderWrite).mockRejectedValueOnce(folderReadOnlyError())

    await expect(fileReadOnly()).rejects.toBeInstanceOf(ForbiddenError)
    expect(requireFolderWrite).toHaveBeenCalledWith(SESSION, 'proj-1', [FOLDER.id])
    expect(render).not.toHaveBeenCalled()
    expect(admitOrDiscard).not.toHaveBeenCalled()
  })

  it('asks again for a Berichte created (or raced) after the first check', async () => {
    findRootProjectFolderByName.mockResolvedValue(null)
    await fileReadOnly()
    expect(requireFolderWrite).toHaveBeenNthCalledWith(1, SESSION, 'proj-1', [null])
    expect(requireFolderWrite).toHaveBeenNthCalledWith(2, SESSION, 'proj-1', [FOLDER.id])
  })
})
