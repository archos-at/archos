/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import { makeProject } from '@/test-utils/db-fixtures'

vi.mock('./access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('./version-repository', () => ({
  findDocumentVersion: vi.fn(),
  findOpenVersion: vi.fn(),
  findPreviousVersion: vi.fn().mockResolvedValue(null),
  findPublishedVersion: vi.fn(),
  insertDocumentVersion: vi.fn(),
  insertPublishedVersion: vi.fn(),
  listDocumentVersions: vi.fn(),
  nextVersionNumber: vi.fn().mockResolvedValue(2),
  compareAndSwapVersionState: vi.fn(),
  promoteVersionToPublished: vi.fn(),
  setDocumentLifecycle: vi.fn(),
  listDocumentVersionObjects: vi.fn().mockResolvedValue([]),
  listDocumentVersionSummaries: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/sharing/directory', () => ({ resolvePeople: vi.fn() }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('./reviewers', () => ({
  listReviewCandidates: vi.fn(),
  resolveReviewers: vi.fn(),
}))
vi.mock('./version-content', () => ({
  BACKEND_PURGE_TIMEOUT_MS: 10_000,
  readVersionTextForTask: vi.fn().mockResolvedValue('# Aktenvermerk'),
  renderVersionBytes: vi.fn(),
  versionBytesReadableBy: vi.fn(),
  writeVersionContent: vi.fn(),
}))
vi.mock('@/lib/conversations/restricted-egress', async () => {
  const { ConversationConfinedError } = await import('@/lib/api/errors')
  return {
    AGENT_REFUSAL_LOCALE: 'de',
    requireMayFileFrom: vi.fn(),
    folderRestrictsReading: vi.fn(),
    confinementRefusal: (action: 'revision', locale: string) =>
      new ConversationConfinedError(action, `refused (${locale})`),
  }
})
vi.mock('@/lib/projects/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/repository')>()),
  findProjectInOrg: vi.fn(),
}))

import { getAccessibleDocument } from './access'
import { resolvePeople } from '@/lib/sharing/directory'
import { recordAuditEvent } from '@/lib/audit/service'
import { ConflictError } from '@/lib/api/errors'
import { listReviewCandidates, resolveReviewers } from './reviewers'
import { findDocumentVersion, findOpenVersion, findPublishedVersion } from './version-repository'
import { renderVersionBytes, writeVersionContent } from './version-content'
import { replaceVersionContent } from './lifecycle'
import { session, document, version } from './lifecycle.fixtures'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolvePeople).mockResolvedValue(
    new Map([
      ['user_approver', { userId: 'user_approver', email: null, name: 'Maria Huber', profilePictureUrl: null }],
    ]),
  )
  vi.mocked(getAccessibleDocument).mockResolvedValue(document)
  vi.mocked(listReviewCandidates).mockResolvedValue([
    { userId: 'user_other', name: 'Anna Berger', email: null },
  ])
  vi.mocked(resolveReviewers).mockImplementation(async (_session, _document, named) => ({
    reviewers: named && named.length > 0 ? [...named] : ['user_anna'],
    selfReview: false,
  }))
  vi.mocked(findPublishedVersion).mockResolvedValue(null)
  vi.mocked(findOpenVersion).mockResolvedValue(null)
  vi.mocked(writeVersionContent).mockReset()
  vi.mocked(writeVersionContent).mockImplementation(async ({ version: read, stamp }) => ({
    ...read,
    ...stamp,
  }) as DocumentVersion)
  vi.mocked(renderVersionBytes).mockResolvedValue({
    bytes: Buffer.from('# Aktenvermerk', 'utf8'),
    contentType: 'text/markdown',
    contentHash: `sha256:${'a'.repeat(64)}`,
  })
})

describe('replaceVersionContent', () => {
  it('refuses a stale If-Match with a conflict, and stores nothing', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))
    await expect(
      replaceVersionContent(session, 'doc_1', 'ver_1', 'neu', 'sha256:stale'),
    ).rejects.toMatchObject({ status: 409 })
    expect(writeVersionContent).not.toHaveBeenCalled()
  })

  it('renders through the producer, then hands the byte half the row AS READ', async () => {
    const read = version({ state: 'draft', contentHash: 'sha256:abc' })
    vi.mocked(findDocumentVersion).mockResolvedValue(read)
    const order: string[] = []
    vi.mocked(renderVersionBytes).mockImplementation(async () => {
      order.push('render')
      return {
        bytes: Buffer.from('# gerendert', 'utf8'),
        contentType: 'text/markdown',
        contentHash: 'sha256:neu',
      }
    })
    vi.mocked(writeVersionContent).mockImplementation(async ({ version: v, stamp }) => {
      order.push('write')
      return { ...v, ...stamp } as DocumentVersion
    })

    await replaceVersionContent(session, 'doc_1', 'ver_1', '# Aktenvermerk', 'sha256:abc')

    expect(order).toEqual(['render', 'write'])
    expect(writeVersionContent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        version: read,
        rendered: expect.objectContaining({ contentHash: 'sha256:neu' }),
        stamp: expect.objectContaining({ state: 'draft' }),
      }),
    )
  })

  it('lets the loser of a write race through as a 409, and runs no effect for it', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))
    vi.mocked(writeVersionContent).mockRejectedValue(
      new ConflictError('The version changed while you were writing'),
    )

    await expect(
      replaceVersionContent(session, 'doc_1', 'ver_1', 'neu', 'sha256:abc'),
    ).rejects.toMatchObject({ status: 409 })
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('writes nothing when the quota refuses', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))
    vi.mocked(writeVersionContent).mockRejectedValue(new Error('no room'))

    await expect(
      replaceVersionContent(session, 'doc_1', 'ver_1', 'sehr lang', 'sha256:abc'),
    ).rejects.toThrow(/no room/)
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('carries the machine flag into the guards, so the door is one field', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))

    await replaceVersionContent(session, 'doc_1', 'ver_1', 'neu', 'sha256:abc', {
      actingHuman: false,
    })

    expect(writeVersionContent).toHaveBeenCalled()
  })

  it('asks the restricted-folder refusal about the document’s own folder before rendering (ADR-0087)', async () => {
    const { requireMayFileFrom } = await import('@/lib/conversations/restricted-egress')
    const { findProjectInOrg } = await import('@/lib/projects/repository')
    const { ConversationConfinedError } = await import('@/lib/api/errors')
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))
    vi.mocked(getAccessibleDocument).mockResolvedValue({ ...document, folderId: 'folder_open' })
    vi.mocked(findProjectInOrg).mockResolvedValue(makeProject({ id: 'proj_1', collectionName: 'proj_abc' }))
    vi.mocked(requireMayFileFrom).mockRejectedValueOnce(new ConversationConfinedError('filing', 'nein'))
    const origin = { conversationId: 's_conv_1', signedRestrictedCollections: ['proj_abc_r0123456789ab'], locale: 'de' as const }

    await expect(
      replaceVersionContent(session, 'doc_1', 'ver_1', 'Honorar 48.000', 'sha256:abc', { actingHuman: false, origin }),
    ).rejects.toBeInstanceOf(ConversationConfinedError)

    expect(requireMayFileFrom).toHaveBeenCalledWith(origin, {
      organizationId: 'org_1',
      projectId: 'proj_1',
      projectCollection: 'proj_abc',
      folderId: 'folder_open',
    })
    expect(renderVersionBytes).not.toHaveBeenCalled()
    expect(writeVersionContent).not.toHaveBeenCalled()
  })

  it('asks nothing for a person’s own edit, which names no conversation', async () => {
    const { requireMayFileFrom } = await import('@/lib/conversations/restricted-egress')
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))

    await replaceVersionContent(session, 'doc_1', 'ver_1', 'neu', 'sha256:abc')

    expect(requireMayFileFrom).not.toHaveBeenCalled()
    expect(writeVersionContent).toHaveBeenCalled()
  })

  it('clears the reviewer’s words, because they were about the bytes just replaced', async () => {
    const read = version({ state: 'changes_requested', reviewComment: 'GK stimmt nicht' })
    vi.mocked(findDocumentVersion).mockResolvedValue(read)

    await replaceVersionContent(session, 'doc_1', 'ver_1', 'korrigiert', 'sha256:abc')

    expect(writeVersionContent).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({ state: 'changes_requested' }),
        stamp: expect.objectContaining({ state: 'draft', reviewComment: null }),
      }),
    )
  })
})
