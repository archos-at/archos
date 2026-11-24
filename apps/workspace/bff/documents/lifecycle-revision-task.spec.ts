/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
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
import { ConversationConfinedError } from '@/lib/api/errors'
import { listReviewCandidates, resolveReviewers } from './reviewers'
import { delegateTask } from '@/lib/tasks/delegation'
import { folderRestrictsReading } from '@/lib/conversations/restricted-egress'
import {
  compareAndSwapVersionState,
  findDocumentVersion,
  findOpenVersion,
  findPublishedVersion,
} from './version-repository'
import { readVersionTextForTask, renderVersionBytes, writeVersionContent } from './version-content'
import { transitionDocumentVersion } from './lifecycle'
import { DOCUMENT_VERSION_TRANSITIONS } from './lifecycle-types'
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

describe('request_changes and the revision task', () => {
  const refuse = async (version: DocumentVersion, input: Record<string, unknown> = {}) => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(document)
    vi.mocked(findDocumentVersion).mockResolvedValue(version)
    vi.mocked(compareAndSwapVersionState).mockResolvedValue({
      ...version,
      state: 'changes_requested',
      reviewComment: (input.comment as string) ?? 'Die Fluchtweglänge stimmt nicht',
    })
    return transitionDocumentVersion(session, 'doc_1', 'ver_1', 'request_changes', {
      comment: 'Die Fluchtweglänge stimmt nicht',
      ...input,
    })
  }

  beforeEach(() => {
    vi.mocked(delegateTask).mockResolvedValue({ id: 'task-1' } as never)
    vi.mocked(folderRestrictsReading).mockResolvedValue(false)
  })

  it('opens no task when the version came out of a live conversation', async () => {
    await refuse(version({ originConversationId: 'conv-1', createdBy: 'user_author' }))
    expect(delegateTask).not.toHaveBeenCalled()
  })

  it('opens a revision task when the version had no conversation behind it', async () => {
    await refuse(version({ originConversationId: null, createdBy: 'user_author' }))

    expect(delegateTask).toHaveBeenCalledTimes(1)
    expect(vi.mocked(delegateTask).mock.calls[0][1]).toMatchObject({
      projectId: 'proj_1',
      kind: 'revision',
      goal: 'Die Fluchtweglänge stimmt nicht',
      subject: {
        documentId: 'doc_1',
        versionId: 'ver_1',
        comment: 'Die Fluchtweglänge stimmt nicht',
      },
      requester: { userId: 'user_author', email: null },
    })
  })

  it('opens no task for a document whose screening has not passed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const held = { ...document, status: 'quarantined' as const, screeningOutcome: 'quarantined' as const }
    vi.mocked(getAccessibleDocument).mockResolvedValue(held)
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ originConversationId: null }))
    vi.mocked(compareAndSwapVersionState).mockResolvedValue({
      ...version({ originConversationId: null }),
      state: 'changes_requested',
      reviewComment: 'Die Fluchtweglänge stimmt nicht',
    })

    await transitionDocumentVersion(session, 'doc_1', 'ver_1', 'request_changes', {
      comment: 'Die Fluchtweglänge stimmt nicht',
    })

    expect(delegateTask).not.toHaveBeenCalled()
    expect(readVersionTextForTask).not.toHaveBeenCalled()
  })

  it('opens one for a conversation-born version when the reviewer asked outright', async () => {
    await refuse(version({ originConversationId: 'conv-1', createdBy: 'user_author' }), {
      delegateRevision: true,
    })
    expect(delegateTask).toHaveBeenCalledTimes(1)
  })

  it('still records the decision when the task cannot be opened', async () => {
    vi.mocked(delegateTask).mockRejectedValue(new Error('queue is down'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const refused = await refuse(version({ originConversationId: null }))
    expect(refused.state).toBe('changes_requested')
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.version.changes_requested' }),
    )
  })

  describe('a draft in a folder some project member may not read', () => {
    const restricted = makeDocument({ id: 'doc_1', projectId: 'proj_1', folderId: 'folder_hr' })

    beforeEach(() => {
      vi.mocked(folderRestrictsReading).mockResolvedValue(true)
    })

    it('refuses the agent revision action with the reason, before the decision is recorded', async () => {
      vi.mocked(getAccessibleDocument).mockResolvedValue(restricted)
      vi.mocked(findDocumentVersion).mockResolvedValue(version({ originConversationId: null }))

      const refused = transitionDocumentVersion(session, 'doc_1', 'ver_1', 'request_changes', {
        comment: 'Die Gehaltstabelle stimmt nicht',
        delegateRevision: true,
        locale: 'en',
      })

      await expect(refused).rejects.toBeInstanceOf(ConversationConfinedError)
      await expect(refused).rejects.toMatchObject({ action: 'revision', message: 'refused (en)' })
      expect(folderRestrictsReading).toHaveBeenCalledWith('org_1', 'proj_1', 'folder_hr')
      expect(compareAndSwapVersionState).not.toHaveBeenCalled()
      expect(delegateTask).not.toHaveBeenCalled()
    })

    it('opens no task for a version nobody typed, and still records the decision', async () => {
      vi.mocked(getAccessibleDocument).mockResolvedValue(restricted)
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      const refused = await refuse(version({ originConversationId: null, createdBy: 'user_author' }))

      expect(refused.state).toBe('changes_requested')
      expect(delegateTask).not.toHaveBeenCalled()
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'document.version.changes_requested' }),
      )
    })

    it('opens no task when the folder tree cannot be read', async () => {
      vi.mocked(folderRestrictsReading).mockRejectedValue(new Error('database is down'))
      vi.spyOn(console, 'error').mockImplementation(() => undefined)

      await refuse(version({ originConversationId: null }))

      expect(delegateTask).not.toHaveBeenCalled()
    })
  })

  it('is the only transition that carries the effect', () => {
    const carrying = DOCUMENT_VERSION_TRANSITIONS.filter((row) =>
      (row.effects as readonly string[]).includes('openRevisionTask'),
    )
    expect(carrying.map((row) => row.op)).toEqual(['request_changes'])
  })
})
