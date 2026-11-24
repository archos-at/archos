/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'

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
import { resolvePeople } from '@/lib/sharing/directory'
import { recordAuditEvent } from '@/lib/audit/service'
import { publishToUsers } from '@/lib/events/bus'
import { emitInboxItems, resolveInboxItemsFor } from '@/lib/inbox/service'
import { listReviewCandidates, resolveReviewers } from './reviewers'
import {
  compareAndSwapVersionState,
  findDocumentVersion,
  findOpenVersion,
  findPreviousVersion,
  findPublishedVersion,
  listDocumentVersions,
} from './version-repository'
import { renderVersionBytes, writeVersionContent } from './version-content'
import { transitionDocumentVersion } from './lifecycle'
import { session, document, version, approvedInOneStep } from './lifecycle.fixtures'

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

describe('transitionDocumentVersion — a held document', () => {
  it.each([
    ['still being screened', { status: 'processing' as const, screeningOutcome: null }],
    ['quarantined', { status: 'quarantined' as const, screeningOutcome: 'quarantined' as const }],
    ['bytes swapped after its verdict', { contentHash: 'sha256:new', screenedHash: 'sha256:old', screeningOutcome: 'clean' as const }],
  ])('refuses to submit one %s, and tells nobody', async (_label, held) => {
    vi.mocked(getAccessibleDocument).mockResolvedValue({ ...document, ...held })
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(version({ state: 'in_review' }))

    await expect(
      transitionDocumentVersion(session, 'doc_1', 'ver_1', 'submit', { reviewerUserIds: ['user_a'] }),
    ).rejects.toMatchObject({ status: 409, details: { op: 'submit', reason: 'held' } })
    expect(compareAndSwapVersionState).not.toHaveBeenCalled()
    expect(emitInboxItems).not.toHaveBeenCalled()
  })

  it('submits it once its screening has passed', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue({ ...document, screeningOutcome: 'clean' })
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(version({ state: 'in_review' }))

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'submit', { reviewerUserIds: ['user_a'] })

    expect(emitInboxItems).toHaveBeenCalled()
  })
})

describe('transitionDocumentVersion — effects', () => {
  it('submit opens an actionable item for each named reviewer, anchored on the version', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(version({ state: 'in_review' }))

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'submit', {
      reviewerUserIds: ['user_a', 'user_b'],
    })

    const emissions = vi.mocked(emitInboxItems).mock.calls[0][0]
    expect(emissions.map((item) => item.recipientUserId)).toEqual(['user_a', 'user_b'])
    expect(emissions[0]).toMatchObject({
      type: 'document.review_requested',
      resourceType: 'document',
      resourceId: 'doc_1',
      anchorId: 'ver_1',
    })
  })

  it('names the document in the inbox payload, so the row is not about "a file"', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(version({ state: 'in_review' }))

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'submit', {
      reviewerUserIds: ['user_a'],
    })

    const emissions = vi.mocked(emitInboxItems).mock.calls[0][0]
    expect(emissions[0].payload).toMatchObject({
      versionId: 'ver_1',
      versionNumber: 2,
      subject: 'plan.pdf',
    })
  })

  it('falls back to the reviewer chain when no reviewer is named', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(version({ state: 'in_review' }))

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'submit', {})

    expect(vi.mocked(emitInboxItems).mock.calls[0][0][0].recipientUserId).toBe('user_anna')
  })

  it('resolves the round BEFORE the swap, not inside the effect', async () => {
    const order: string[] = []
    vi.mocked(resolveReviewers).mockImplementation(async () => {
      order.push('resolve')
      return { reviewers: ['user_anna'], selfReview: false }
    })
    vi.mocked(compareAndSwapVersionState).mockImplementation(async () => {
      order.push('swap')
      return version({ state: 'in_review' })
    })
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'submit', {})

    expect(order[0]).toBe('resolve')
    expect(order).toContain('swap')
  })

  it('submits an Unvergeben draft rather than refusing it', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(version({ state: 'in_review' }))

    await expect(
      transitionDocumentVersion(session, 'doc_1', 'ver_1', 'submit', {}),
    ).resolves.toMatchObject({ state: 'in_review' })
  })

  it('records the sole-editor waiver on the audit event', async () => {
    vi.mocked(resolveReviewers).mockResolvedValue({
      reviewers: [session.userId],
      selfReview: true,
    })
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(version({ state: 'in_review' }))

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'submit', {})

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ selfReview: true }) }),
    )
  })

  it('stamps whose HAND submitted, from the same flag the publish door reads', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft' }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(version({ state: 'in_review' }))

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'submit', {
      reviewerUserIds: ['user_a'],
      actingHuman: false,
    })

    expect(compareAndSwapVersionState).toHaveBeenCalledWith(
      'ver_1',
      'org_1',
      'draft',
      expect.objectContaining({ submittedBy: session.userId, submittedByActor: 'agent' }),
      expect.objectContaining({ kind: 'open', requestedBy: session.userId, requestedByActor: 'agent' }),
    )
  })

  it('carries the order and Frist into the inbox payload and the audit event', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft', versionNumber: 2 }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(
      version({ state: 'in_review', versionNumber: 2 }),
    )
    vi.mocked(findPreviousVersion).mockResolvedValue(null)

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'submit', {
      reviewerUserIds: ['user_a'],
      orderMessage: 'Bitte die Fluchtweglänge prüfen.',
      dueAt: '2026-09-20',
    })

    const emissions = vi.mocked(emitInboxItems).mock.calls[0][0]
    expect(emissions[0].payload).toMatchObject({
      versionId: 'ver_1',
      orderMessage: 'Bitte die Fluchtweglänge prüfen.',
      previousVersionId: null,
    })
    expect(emissions[0].payload).toHaveProperty('dueAt')
    expect(typeof (emissions[0].payload as { dueAt: unknown }).dueAt).toBe('string')
    expect((emissions[0].payload as { excerpt: unknown }).excerpt).toContain(
      'Bitte die Fluchtweglänge prüfen.',
    )
    expect((emissions[0].payload as { excerpt: unknown }).excerpt).toContain('2026-09-20')
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          orderMessage: 'Bitte die Fluchtweglänge prüfen.',
        }),
      }),
    )
  })

  it('leaves the order absent when the caller states none', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft', versionNumber: 1 }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(
      version({ state: 'in_review', versionNumber: 1 }),
    )
    vi.mocked(findPreviousVersion).mockResolvedValue(null)

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'submit', {
      reviewerUserIds: ['user_a'],
    })

    const emissions = vi.mocked(emitInboxItems).mock.calls[0][0]
    expect(emissions[0].payload).toMatchObject({
      orderMessage: null,
      dueAt: null,
      excerpt: null,
      previousVersionId: null,
    })
  })

  it('names the previous version for a real diff link', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft', versionNumber: 3 }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(
      version({ state: 'in_review', versionNumber: 3 }),
    )
    vi.mocked(findPreviousVersion).mockResolvedValue(
      version({ id: 'ver_2', versionNumber: 2 }),
    )

    await transitionDocumentVersion(session, 'doc_1', 'ver_3', 'submit', {
      reviewerUserIds: ['user_a'],
    })

    const emissions = vi.mocked(emitInboxItems).mock.calls[0][0]
    expect(emissions[0].payload).toMatchObject({ previousVersionId: 'ver_2' })
    expect(findPreviousVersion).toHaveBeenCalledWith('doc_1', 'org_1', 3)
    expect(listDocumentVersions).not.toHaveBeenCalled()
  })

  it('asks the direct predecessor query even past 200 versions', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft', versionNumber: 201 }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(
      version({ state: 'in_review', versionNumber: 201 }),
    )
    vi.mocked(findPreviousVersion).mockResolvedValue(
      version({ id: 'ver_200', versionNumber: 200 }),
    )

    await transitionDocumentVersion(session, 'doc_1', 'ver_201', 'submit', {
      reviewerUserIds: ['user_a'],
    })

    expect(findPreviousVersion).toHaveBeenCalledWith('doc_1', 'org_1', 201)
    const emissions = vi.mocked(emitInboxItems).mock.calls[0][0]
    expect(emissions[0].payload).toMatchObject({ previousVersionId: 'ver_200' })
  })

  it('falls back to no previous version for a first version and on a query failure', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft', versionNumber: 1 }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(
      version({ state: 'in_review', versionNumber: 1 }),
    )
    vi.mocked(findPreviousVersion).mockResolvedValue(null)

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'submit', {
      reviewerUserIds: ['user_a'],
    })
    expect(vi.mocked(emitInboxItems).mock.calls[0][0][0].payload).toMatchObject({
      previousVersionId: null,
    })

    vi.clearAllMocks()
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'draft', versionNumber: 2 }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(
      version({ state: 'in_review', versionNumber: 2 }),
    )
    vi.mocked(findPreviousVersion).mockRejectedValue(new Error('database went away'))

    await transitionDocumentVersion(session, 'doc_1', 'ver_2', 'submit', {
      reviewerUserIds: ['user_a'],
    })
    expect(vi.mocked(emitInboxItems).mock.calls[0][0][0].payload).toMatchObject({
      previousVersionId: null,
    })
  })

  it('resolves the round for every reviewer, not only the one who decided', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version())
    approvedInOneStep()

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'approve', {
      reviewerUserIds: ['user_a', 'user_b'],
    })

    const targets = vi.mocked(resolveInboxItemsFor).mock.calls[0][0]
    expect(targets.map((target) => target.recipientUserId).sort()).toEqual([
      'user_a',
      'user_b',
      session.userId,
    ])
    expect(new Set(targets.map((target) => target.groupKey)).size).toBe(1)
  })

  it('audits with the row’s own action and publishes a hint', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version())
    vi.mocked(compareAndSwapVersionState).mockResolvedValue(version({ state: 'changes_requested' }))

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'request_changes', {
      comment: 'Der Atrium-Fall ist OIB 2.3',
    })

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.version.changes_requested',
        targetType: 'document',
        targetId: 'doc_1',
        metadata: expect.objectContaining({ versionId: 'ver_1', withComment: true }),
      }),
    )
    expect(publishToUsers).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ kind: 'document.version.changed', versionId: 'ver_1' }),
    )
  })
})
