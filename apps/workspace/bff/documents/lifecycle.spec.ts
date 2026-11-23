/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import { makeDocument } from '@/test-utils/db-fixtures'

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
vi.mock('./repository', () => ({
  findDocumentInOrg: vi.fn(),
  findFolderPathInProject: vi.fn().mockResolvedValue('Berichte'),
}))
vi.mock('./document-dispatch', () => ({
  dispatchDocument: vi.fn(),
  AgentAuthoredDocumentNotIndexableError: class AgentAuthoredDocumentNotIndexableError extends Error {},
}))
vi.mock('./collection-file-ref', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./collection-file-ref')>()),
  purgeIngestedChunks: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('@/lib/sharing/directory', () => ({ resolvePeople: vi.fn() }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('@/lib/events/bus', () => ({ publishToUsers: vi.fn() }))
vi.mock('@/lib/inbox/service', () => ({
  emitInboxItems: vi.fn(),
  resolveInboxItemsFor: vi.fn(),
}))
vi.mock('./reviewers', () => ({
  listReviewCandidates: vi.fn(),
  resolveReviewers: vi.fn(),
}))
vi.mock('@/lib/tasks/delegation', () => ({ delegateTask: vi.fn() }))
vi.mock('./version-content', () => ({
  BACKEND_PURGE_TIMEOUT_MS: 10_000,
  readVersionTextForTask: vi.fn().mockResolvedValue('# Aktenvermerk'),
  renderVersionBytes: vi.fn(),
  versionBytesReadableBy: vi.fn(),
  writeVersionContent: vi.fn(),
}))
vi.mock('./revision-notify', () => ({ announceNewRevision: vi.fn().mockResolvedValue(undefined) }))
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

import { getAccessibleDocument } from './access'
import { purgeIngestedChunks } from './collection-file-ref'
import { dispatchDocument } from './document-dispatch'
import { announceNewRevision } from './revision-notify'
import { resolvePeople } from '@/lib/sharing/directory'
import { requireProjectAccess } from '@/lib/authz/projects'
import { recordAuditEvent } from '@/lib/audit/service'
import { listReviewCandidates, resolveReviewers } from './reviewers'
import {
  compareAndSwapVersionState,
  findDocumentVersion,
  findOpenVersion,
  findPublishedVersion,
  promoteVersionToPublished,
} from './version-repository'
import { renderVersionBytes, writeVersionContent } from './version-content'
import { replaceVersionContent, transitionDocumentVersion } from './lifecycle'
import { session, document, version, approvedInOneStep } from './lifecycle.fixtures'

const agentDocument: Document = makeDocument({
  id: 'doc_1',
  projectId: 'proj_1',
  authoredBy: 'agent',
  authoredByProducer: 'agent_document',
  authoredByRef: 'conv_1-aktenvermerk',
  authoredByRefKind: 'answer_artifact',
  filename: 'piloti/doc_1/aktenvermerk-2026-09-01.md',
  publishedVersionId: 'ver_1',
  folderId: 'folder_1',
  contentType: 'text/markdown',
})

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

describe('transitionDocumentVersion — guards', () => {
  it('refuses an op the version’s state has no row for, as a conflict', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'published' }))
    await expect(
      transitionDocumentVersion(session, 'doc_1', 'ver_1', 'approve'),
    ).rejects.toMatchObject({ status: 409 })
    expect(compareAndSwapVersionState).not.toHaveBeenCalled()
  })

  it('refuses a human-only op for a machine caller, before any permission is read', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version())
    await expect(
      transitionDocumentVersion(session, 'doc_1', 'ver_1', 'approve', { actingHuman: false }),
    ).rejects.toMatchObject({ status: 403 })
    expect(requireProjectAccess).not.toHaveBeenCalled()
  })

  it('refuses the submitter approving their own version', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(
      version({ submittedBy: session.userId, submittedByActor: 'human' }),
    )
    await expect(
      transitionDocumentVersion(session, 'doc_1', 'ver_1', 'approve'),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('lets the commissioner approve a version a RUN submitted in their session', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(
      version({ submittedBy: session.userId, submittedByActor: 'agent' }),
    )
    approvedInOneStep()

    await expect(
      transitionDocumentVersion(session, 'doc_1', 'ver_1', 'approve'),
    ).resolves.toMatchObject({ state: 'published' })
  })

  it('waives the guard for a sole editor, and says so on the trail', async () => {
    vi.mocked(listReviewCandidates).mockResolvedValue([])
    vi.mocked(findDocumentVersion).mockResolvedValue(
      version({ submittedBy: session.userId, submittedByActor: 'human' }),
    )
    approvedInOneStep()

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'approve')

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ selfReview: true }) }),
    )
  })

  it('refuses a refusal with no words', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version())
    await expect(
      transitionDocumentVersion(session, 'doc_1', 'ver_1', 'reject', { comment: '   ' }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it.each([[undefined], [null], ['']])(
    'treats a version with NO stored digest as having no If-Match to satisfy (%s)',
    async (ifMatch) => {
      vi.mocked(findDocumentVersion).mockResolvedValue(
        version({ state: 'draft', contentHash: null }),
      )

      await expect(
        replaceVersionContent(session, 'doc_1', 'ver_1', 'neu', ifMatch),
      ).resolves.toMatchObject({ state: 'draft' })
    },
  )

  it('still refuses a stale digest when the row HAS one', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(
      version({ state: 'draft', contentHash: 'sha256:abc' }),
    )
    await expect(
      replaceVersionContent(session, 'doc_1', 'ver_1', 'neu', 'sha256:stale'),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('reports a lost compare-and-swap as a conflict rather than a lost update', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version())
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(null)
    await expect(
      transitionDocumentVersion(session, 'doc_1', 'ver_1', 'reject', { comment: 'GK stimmt nicht' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('swaps on the state it read, which is what makes the race decidable', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version())
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(version({ state: 'changes_requested' }))
    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'request_changes', { comment: 'GK stimmt nicht' })
    expect(compareAndSwapVersionState).toHaveBeenCalledWith(
      'ver_1',
      'org_1',
      'in_review',
      expect.objectContaining({ state: 'changes_requested', reviewedBy: session.userId }),
      { kind: 'decide', outcome: 'changes_requested', decidedBy: session.userId, comment: 'GK stimmt nicht' },
    )
  })

  it('approves and publishes in one step, deciding the round in the promoting transaction', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version())
    approvedInOneStep()

    const result = await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'approve')

    expect(result.state).toBe('published')
    expect(promoteVersionToPublished).toHaveBeenCalledWith(
      'ver_1',
      'doc_1',
      'org_1',
      'in_review',
      expect.objectContaining({
        state: 'published',
        approvedBy: session.userId,
        publishedBy: session.userId,
        reviewedBy: session.userId,
      }),
      { kind: 'decide', outcome: 'approved', decidedBy: session.userId, comment: null },
    )
    expect(compareAndSwapVersionState).not.toHaveBeenCalled()
  })

  it('reports a lost race on approval as a conflict, with nothing promoted', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version())
    vi.mocked(promoteVersionToPublished).mockResolvedValue(null)
    await expect(transitionDocumentVersion(session, 'doc_1', 'ver_1', 'approve')).rejects.toMatchObject({
      status: 409,
    })
  })

  it('records a request for changes on the round, with its comment', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version())
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(version({ state: 'changes_requested' }))
    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'request_changes', { comment: ' Maße prüfen ' })
    expect(compareAndSwapVersionState).toHaveBeenCalledWith(
      'ver_1',
      'org_1',
      'in_review',
      expect.objectContaining({ state: 'changes_requested' }),
      { kind: 'decide', outcome: 'changes_requested', decidedBy: session.userId, comment: 'Maße prüfen' },
    )
  })
})

describe('transitionDocumentVersion — effects', () => {
  it('publish announces a new Fassung to the people who follow the document, as the publisher, when it replaces a version', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'approved' }))
    vi.mocked(promoteVersionToPublished).mockResolvedValue({
      version: version({ state: 'published' }),
      superseded: [version({ id: 'ver_0', state: 'superseded', createdBy: 'user_first' })],
    })

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')

    expect(announceNewRevision).toHaveBeenCalledTimes(1)
    expect(announceNewRevision).toHaveBeenCalledWith({
      organizationId: 'org_1',
      actorUserId: session.userId,
      newerId: 'doc_1',
      olderId: 'doc_1',
      versionId: 'ver_1',
      previousUploaderIds: ['user_first'],
    })
  })

  it('publish of a first version announces nothing: there is no earlier Fassung to follow', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'approved' }))
    vi.mocked(promoteVersionToPublished).mockResolvedValue({ version: version({ state: 'published' }), superseded: [] })

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')

    expect(announceNewRevision).not.toHaveBeenCalled()
  })

  it('publishes a version approved before approval became one step', async () => {
    const published = version({ state: 'published' })
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'approved' }))
    vi.mocked(promoteVersionToPublished).mockResolvedValue({
      version: published,
      superseded: [version({ id: 'ver_0', state: 'superseded' })],
    })

    const result = await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')

    expect(result.state).toBe('published')
    expect(promoteVersionToPublished).toHaveBeenCalledWith(
      'ver_1',
      'doc_1',
      'org_1',
      'approved',
      expect.objectContaining({ state: 'published', publishedBy: session.userId }),
      undefined,
    )
    expect(compareAndSwapVersionState).not.toHaveBeenCalled()
  })

  it('dispatches nothing on publish for bytes of a PERSON\'s document the gate already judged', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(
      makeDocument({ id: 'doc_1', projectId: 'proj_1', contentHash: 'sha256:abc', screeningOutcome: 'clean' }),
    )
    const published = version({ state: 'published' })
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'approved' }))
    vi.mocked(promoteVersionToPublished).mockResolvedValue({ version: published, superseded: [] })

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')

    expect(dispatchDocument).not.toHaveBeenCalled()
  })

  it('screens and indexes the new bytes of a PERSON\'s document published from a draft', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(
      makeDocument({ id: 'doc_1', projectId: 'proj_1', contentHash: 'sha256:before', screeningOutcome: 'clean' }),
    )
    const published = version({ state: 'published', contentHash: 'sha256:edited' })
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'approved', contentHash: 'sha256:edited' }))
    vi.mocked(promoteVersionToPublished).mockResolvedValue({ version: published, superseded: [] })

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')

    expect(dispatchDocument).toHaveBeenCalledTimes(1)
    const [input] = vi.mocked(dispatchDocument).mock.calls[0]
    expect(input).toMatchObject({ documentId: 'doc_1', storageKey: published.storageKey, collectionName: 'proj_abc' })
    expect(input.provenance ?? null).toBeNull()
    expect(input.versionId ?? null).toBeNull()
  })
})

describe('ingestPublished — what publishing an agent document does to the index', () => {
  const approved = () =>
    version({ state: 'approved', approvedBy: 'user_approver', approvedAt: new Date('2026-09-01T10:00:00Z') })
  const publishedVersion = () =>
    version({
      state: 'published',
      approvedBy: 'user_approver',
      approvedAt: new Date('2026-09-01T10:00:00Z'),
      storageKey: 'org/org_1/project/proj_1/Berichte/doc/doc_1/v2/aktenvermerk-2026-09-01.md',
    })

  beforeEach(() => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(agentDocument)
    vi.mocked(findDocumentVersion).mockResolvedValue(approved())
  })

  it('dispatches the published version with the four provenance keys', async () => {
    vi.mocked(promoteVersionToPublished).mockResolvedValue({
      version: publishedVersion(),
      superseded: [],
    })

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')

    expect(dispatchDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc_1',
        filename: 'piloti/doc_1/aktenvermerk-2026-09-01.md',
        storageKey: 'org/org_1/project/proj_1/Berichte/doc/doc_1/v2/aktenvermerk-2026-09-01.md',
        versionId: 'ver_1',
        collectionName: 'proj_abc',
        folderPath: 'Berichte',
        provenance: {
          authored_by: 'agent',
          approved_by: 'Maria Huber',
          approved_at: '2026-09-01T10:00:00.000Z',
          producer: 'agent_document',
        },
      }),
    )
  })

  it('leaves the doc_class alone: provenance is its own axis', async () => {
    vi.mocked(promoteVersionToPublished).mockResolvedValue({
      version: publishedVersion(),
      superseded: [],
    })

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')

    const [call] = vi.mocked(dispatchDocument).mock.calls
    expect(call[0]).not.toHaveProperty('docClass')
    expect(Object.keys(call[0].provenance ?? {})).toEqual([
      'authored_by',
      'approved_by',
      'approved_at',
      'producer',
    ])
  })

  it('purges the superseded version’s passages BEFORE the new bytes are sent', async () => {
    const order: string[] = []
    vi.mocked(purgeIngestedChunks).mockImplementation(async () => {
      order.push('purge')
      return true
    })
    vi.mocked(dispatchDocument).mockImplementation(async () => {
      order.push('dispatch')
      return { jobId: 'job-1', status: 'pending' as const }
    })
    vi.mocked(promoteVersionToPublished).mockResolvedValue({
      version: publishedVersion(),
      superseded: [version({ id: 'ver_0', state: 'superseded' })],
    })

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')

    expect(order).toEqual(['purge', 'dispatch'])
    expect(purgeIngestedChunks).toHaveBeenCalledWith(
      'http://backend:8000',
      expect.objectContaining({ filename: 'piloti/doc_1/aktenvermerk-2026-09-01.md' }),
      expect.any(Number),
    )
    expect(vi.mocked(purgeIngestedChunks).mock.calls[0]).toHaveLength(3)
  })

  it('purges nothing on a FIRST publish, because there is nothing to replace', async () => {
    vi.mocked(promoteVersionToPublished).mockResolvedValue({
      version: publishedVersion(),
      superseded: [],
    })

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')

    expect(purgeIngestedChunks).not.toHaveBeenCalled()
    expect(dispatchDocument).toHaveBeenCalled()
  })

  it('refuses to index a row of a producer that is never indexed, and still publishes it', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(
      makeDocument({ ...agentDocument, authoredByProducer: 'deep_research', authoredByRefKind: 'agent_run' }),
    )
    vi.mocked(promoteVersionToPublished).mockResolvedValue({
      version: publishedVersion(),
      superseded: [version({ id: 'ver_0', state: 'superseded' })],
    })

    const result = await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')

    expect(dispatchDocument).not.toHaveBeenCalled()
    expect(purgeIngestedChunks).not.toHaveBeenCalled()
    expect(result.state).toBe('published')
  })

  it('degrades to no approver name rather than printing a WorkOS id', async () => {
    vi.mocked(resolvePeople).mockResolvedValue(new Map())
    vi.mocked(promoteVersionToPublished).mockResolvedValue({
      version: publishedVersion(),
      superseded: [],
    })

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')

    expect(vi.mocked(dispatchDocument).mock.calls[0][0].provenance).toMatchObject({
      approved_by: null,
      approved_at: '2026-09-01T10:00:00.000Z',
    })
  })

  it('does not fail the publish when the dispatcher refuses the document', async () => {
    const { AgentAuthoredDocumentNotIndexableError } = await import('./document-dispatch')
    vi.mocked(dispatchDocument).mockRejectedValue(new AgentAuthoredDocumentNotIndexableError('doc_1'))
    vi.mocked(promoteVersionToPublished).mockResolvedValue({
      version: publishedVersion(),
      superseded: [],
    })

    await expect(transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')).resolves.toMatchObject({
      state: 'published',
    })
  })

  it('re-raises anything that is NOT that refusal', async () => {
    vi.mocked(dispatchDocument).mockRejectedValue(new Error('object store unreachable'))
    vi.mocked(promoteVersionToPublished).mockResolvedValue({
      version: publishedVersion(),
      superseded: [],
    })

    await expect(transitionDocumentVersion(session, 'doc_1', 'ver_1', 'publish')).rejects.toThrow(
      /object store unreachable/,
    )
  })
})
