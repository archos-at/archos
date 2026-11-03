import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./review', () => ({ releaseQuarantinedDocument: vi.fn(), settleReleaseRequests: vi.fn() }))
vi.mock('./quarantine-reviewers', () => ({ mayReviewQuarantine: vi.fn() }))
vi.mock('@/lib/documents/access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('@/lib/documents/document-edits', () => ({ deleteDocument: vi.fn() }))
vi.mock('@/lib/session-documents/service', () => ({ deleteSessionDocument: vi.fn() }))
vi.mock('@/lib/documents/repository', () => ({ markForRescreening: vi.fn() }))
vi.mock('@/lib/documents/document-dispatch', () => ({
  dispatchDocument: vi.fn().mockResolvedValue({ jobId: 'job-1', status: 'processing' }),
}))
vi.mock('@/lib/documents/folder-path', () => ({ resolveDocumentFolderPath: vi.fn().mockResolvedValue('Pläne') }))
vi.mock('@/lib/documents/shelf-live', () => ({ publishShelfChanged: vi.fn() }))

import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getAccessibleDocument } from '@/lib/documents/access'
import { deleteDocument } from '@/lib/documents/document-edits'
import { deleteSessionDocument } from '@/lib/session-documents/service'
import { dispatchDocument } from '@/lib/documents/document-dispatch'
import { markForRescreening } from '@/lib/documents/repository'
import { makeDocument } from '@/test-utils/db-fixtures'
import { decideQuarantinedDocuments } from './decisions'
import { quarantineDecisionsSchema, QUARANTINE_DECISION_LIMIT } from './decisions-wire'
import { mayReviewQuarantine } from './quarantine-reviewers'
import { releaseQuarantinedDocument, settleReleaseRequests } from './review'

const reviewer: AuthorizedSession = {
  userId: 'user-admin',
  email: 'a@example.com',
  name: 'Admin',
  accessToken: 't',
  organizationId: 'org-1',
  organizationMembershipId: 'om-1',
  role: 'admin',
  permissions: ['org:projects:administer'],
  featureFlags: null,
}
const request = new Request('http://localhost/api/quarantine/decisions', { method: 'POST' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(mayReviewQuarantine).mockResolvedValue(true)
})

describe('decideQuarantinedDocuments', () => {
  it('allows each document through the single release, and gives each its own outcome', async () => {
    vi.mocked(releaseQuarantinedDocument)
      .mockResolvedValueOnce({ id: 'a', status: 'processing', jobId: 'j' })
      .mockRejectedValueOnce(new ConflictError('Only a held document can be released'))
      .mockRejectedValueOnce(new NotFoundError('Document not found'))
      .mockRejectedValueOnce(new ForbiddenError('read-only folder'))
      .mockRejectedValueOnce(new Error('dispatch down'))

    const { results } = await decideQuarantinedDocuments(
      reviewer,
      { decision: 'allow', documentIds: ['a', 'b', 'c', 'd', 'e'] },
      request
    )

    expect(results).toEqual([
      { id: 'a', outcome: 'allowed' },
      { id: 'b', outcome: 'changed' },
      { id: 'c', outcome: 'not_found' },
      { id: 'd', outcome: 'forbidden' },
      { id: 'e', outcome: 'failed' },
    ])
    expect(releaseQuarantinedDocument).toHaveBeenCalledWith(reviewer, 'a', request)
  })

  it('deletes a held document through its shelf, a chat attachment through the chat', async () => {
    vi.mocked(getAccessibleDocument)
      .mockResolvedValueOnce(
        makeDocument({ id: 'p', scope: 'project', projectId: 'proj-1', status: 'quarantined' })
      )
      .mockResolvedValueOnce(
        makeDocument({ id: 's', scope: 'session', conversationId: 'c-1', status: 'quarantined' })
      )

    const { results } = await decideQuarantinedDocuments(
      reviewer,
      { decision: 'delete', documentIds: ['p', 's'] },
      request
    )

    expect(results).toEqual([
      { id: 'p', outcome: 'deleted' },
      { id: 's', outcome: 'deleted' },
    ])
    expect(deleteDocument).toHaveBeenCalledWith(reviewer, 'p', request)
    expect(deleteSessionDocument).toHaveBeenCalledWith(reviewer, 's', request)
    // The uploader's ask about each is answered: it leaves the reviewers' inboxes.
    expect(settleReleaseRequests).toHaveBeenCalledWith('org-1', 'p')
  })

  it('deletes nothing that is no longer held, nor what the session does not review', async () => {
    vi.mocked(getAccessibleDocument)
      .mockResolvedValueOnce(
        makeDocument({ id: 'ready', status: 'completed', authoredBy: 'agent' })
      )
      .mockResolvedValueOnce(makeDocument({ id: 'other', status: 'quarantined' }))
    vi.mocked(mayReviewQuarantine).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const { results } = await decideQuarantinedDocuments(
      reviewer,
      { decision: 'delete', documentIds: ['ready', 'other'] },
      request
    )

    expect(results).toEqual([
      { id: 'ready', outcome: 'changed' },
      { id: 'other', outcome: 'not_found' },
    ])
    expect(deleteDocument).not.toHaveBeenCalled()
  })
})

describe('recheck', () => {
  const held = makeDocument({
    id: 'q',
    scope: 'project',
    projectId: 'proj-1',
    status: 'quarantined',
    contentHash: 'sha256:abc',
    storageKey: 'org/doc/q.xlsx',
  })

  it('screens a held document again, with the bytes the reviewer saw, and releases nothing', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValueOnce(held)
    vi.mocked(markForRescreening).mockResolvedValueOnce(true)

    const { results } = await decideQuarantinedDocuments(reviewer, { decision: 'recheck', documentIds: ['q'] }, request)

    expect(results).toEqual([{ id: 'q', outcome: 'rechecking' }])
    expect(markForRescreening).toHaveBeenCalledWith('q', 'org-1', 'sha256:abc')
    expect(dispatchDocument).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'q', folderPath: 'Pläne' }))
    expect(releaseQuarantinedDocument).not.toHaveBeenCalled()
    expect(settleReleaseRequests).not.toHaveBeenCalled()
  })

  it('dispatches nothing when the row moved on, nor for a document the session does not review', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValueOnce(held).mockResolvedValueOnce(held)
    vi.mocked(markForRescreening).mockResolvedValueOnce(false)
    vi.mocked(mayReviewQuarantine).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const { results } = await decideQuarantinedDocuments(
      reviewer,
      { decision: 'recheck', documentIds: ['q', 'other'] },
      request
    )

    expect(results).toEqual([
      { id: 'q', outcome: 'changed' },
      { id: 'other', outcome: 'not_found' },
    ])
    expect(dispatchDocument).not.toHaveBeenCalled()
  })
})

describe('quarantineDecisionsSchema', () => {
  it('takes each document once and refuses more than one request may decide', () => {
    expect(
      quarantineDecisionsSchema.parse({ decision: 'allow', documentIds: ['a', 'a', 'b'] })
        .documentIds
    ).toEqual(['a', 'b'])
    const tooMany = Array.from({ length: QUARANTINE_DECISION_LIMIT + 1 }, (_, i) => `d${i}`)
    expect(
      quarantineDecisionsSchema.safeParse({ decision: 'allow', documentIds: tooMany }).success
    ).toBe(false)
    expect(
      quarantineDecisionsSchema.safeParse({ decision: 'allow', documentIds: [] }).success
    ).toBe(false)
    expect(
      quarantineDecisionsSchema.safeParse({ decision: 'release', documentIds: ['a'] }).success
    ).toBe(false)
  })
})
