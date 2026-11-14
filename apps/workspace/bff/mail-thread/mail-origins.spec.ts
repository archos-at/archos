/**
 * @vitest-environment node
 */
/**
 * Which mail brought which Fassung (D36): asked only for a project document,
 * only with the office's `inbound-mail` entitlement, with the reader's hidden
 * folders; said as the Verlauf's heading says it (the send time clamped, no
 * address), and grouped by the Fassung for the version list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./repository', () => ({ findMailOrigins: vi.fn(async () => []) }))
vi.mock('@/lib/authz/folder-access', () => ({
  getHiddenFolderIds: vi.fn(async () => ['hidden-folder']),
}))
vi.mock('@/lib/authz/feature-flags', () => ({ isInboundMailEnabled: vi.fn(() => true) }))

import type { AuthorizedSession } from '@/lib/auth/types'
import { isInboundMailEnabled } from '@/lib/authz/feature-flags'
import { documentMailOrigins, mailOriginsByVersion } from './mail-origins'
import { findMailOrigins, type MailOriginRow } from './repository'

const session = {
  userId: 'user_01JCX0R4D8M2W6YB3N5Q7T9V1A',
  organizationId: 'org_1',
} as AuthorizedSession
const received = new Date('2026-10-14T07:14:00.000Z')
const row = (overrides: Partial<MailOriginRow> = {}): MailOriginRow => ({
  documentVersionId: 'ver-2',
  threadId: 'thread-1',
  entryId: 'entry-1',
  sentAt: new Date('2026-10-14T07:12:00.000Z'),
  receivedAt: received,
  senderName: 'Mag. Anna Huber',
  authorName: null,
  authorAddress: null,
  signerDomain: 'ma37.wien.gv.at',
  senderTrust: 'external_verified',
  ...overrides,
})

beforeEach(() => vi.clearAllMocks())

describe('the mails that brought a document', () => {
  it('reads them through the threads this reader may read, as the heading says them', async () => {
    vi.mocked(findMailOrigins).mockResolvedValueOnce([
      row(),
      row({
        entryId: 'entry-2',
        sentAt: new Date('2027-01-01T00:00:00Z'),
        documentVersionId: null,
      }),
    ])
    const origins = await documentMailOrigins(session, { id: 'doc-1', projectId: 'project-1' })
    expect(findMailOrigins).toHaveBeenCalledWith('project-1', 'doc-1', ['hidden-folder'])
    expect(origins).toEqual([
      {
        threadId: 'thread-1',
        entryId: 'entry-1',
        sentAt: '2026-10-14T07:12:00.000Z',
        receivedAt: received.toISOString(),
        fromName: 'Mag. Anna Huber',
        forwardedByName: null,
        forwarded: false,
        signerDomain: 'ma37.wien.gv.at',
        senderTrust: 'external_verified',
        documentVersionId: 'ver-2',
      },
      // A send time after the receipt is the receipt's (the clamp): a forger cannot place a mail later.
      expect.objectContaining({
        entryId: 'entry-2',
        sentAt: received.toISOString(),
        documentVersionId: null,
      }),
    ])
  })

  it('names a forward as the Verlauf heads it: its author, then who forwarded it, never an address (S6)', async () => {
    vi.mocked(findMailOrigins).mockResolvedValueOnce([
      row({ senderName: 'Miriam Huber', authorName: 'MA 37 – Baupolizei', authorAddress: 'post@ma37.wien.gv.at' }),
      row({ entryId: 'entry-2', senderName: 'Miriam Huber', authorName: null, authorAddress: 'post@ma37.wien.gv.at' }),
    ])
    const [named, unnamed] = await documentMailOrigins(session, { id: 'doc-1', projectId: 'project-1' })
    expect(named).toMatchObject({ fromName: 'MA 37 – Baupolizei', forwardedByName: 'Miriam Huber', forwarded: true })
    expect(unnamed).toMatchObject({ fromName: 'ma37.wien.gv.at', forwardedByName: 'Miriam Huber', forwarded: true })
  })

  it('asks nothing for an Archiv document, or with the office’s entitlement off', async () => {
    expect(await documentMailOrigins(session, { id: 'doc-1', projectId: null })).toEqual([])
    vi.mocked(isInboundMailEnabled).mockReturnValueOnce(false)
    expect(await documentMailOrigins(session, { id: 'doc-1', projectId: 'project-1' })).toEqual([])
    expect(findMailOrigins).not.toHaveBeenCalled()
  })

  it('groups them by the Fassung each brought, leaving out one whose Fassung is gone', () => {
    const origin = {
      threadId: 't',
      entryId: 'e',
      sentAt: 's',
      receivedAt: 'r',
      fromName: null,
      forwardedByName: null,
      forwarded: false,
      signerDomain: null,
      senderTrust: 'not_checked' as const,
    }
    const grouped = mailOriginsByVersion([
      { ...origin, documentVersionId: 'ver-1' },
      { ...origin, entryId: 'e2', documentVersionId: 'ver-1' },
      { ...origin, entryId: 'e3', documentVersionId: null },
    ])
    expect([...grouped.keys()]).toEqual(['ver-1'])
    expect(grouped.get('ver-1')!.map((item) => item.entryId)).toEqual(['e', 'e2'])
  })
})
