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
vi.mock('@/lib/mail-thread/mail-origins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mail-thread/mail-origins')>()),
  documentMailOrigins: vi.fn(async () => []),
}))
vi.mock('@/lib/sharing/directory', () => ({ resolvePeople: vi.fn() }))
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

import { getAccessibleDocument } from './access'
import { versionBytesPassedScreening } from './document-reader'
import { resolvePeople } from '@/lib/sharing/directory'
import { listReviewCandidates, resolveReviewers } from './reviewers'
import { findOpenVersion, findPublishedVersion, listDocumentVersions } from './version-repository'
import { renderVersionBytes, versionBytesReadableBy, writeVersionContent } from './version-content'
import { documentMailOrigins } from '@/lib/mail-thread/mail-origins'
import { listDocumentVersionViews } from './lifecycle'
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

describe('listDocumentVersionViews — whether each version opens for this reader', () => {
  it('says per version whether the reader may receive its bytes (ADR-0086), from the one rule the routes apply', async () => {
    const earlier = version({ id: 'ver_1', versionNumber: 1, state: 'superseded', contentHash: 'sha256:before' })
    const current = version({ id: 'ver_2', versionNumber: 2, state: 'published', contentHash: 'sha256:now' })
    vi.mocked(listDocumentVersions).mockResolvedValue([earlier, current])
    vi.mocked(versionBytesReadableBy).mockResolvedValue((row) => row.contentHash === 'sha256:now')

    const listing = await listDocumentVersionViews(session, 'doc_1')

    expect(versionBytesReadableBy).toHaveBeenCalledWith(session, document, [earlier, current])
    expect(listing.versions.map((row) => [row.id, row.bytesReadable])).toEqual([
      ['ver_1', false],
      ['ver_2', true],
    ])
  })

  it('opens a screened earlier upload to a member and keeps an unscreened one closed (migration 0131)', async () => {
    const screened = { ...document, contentHash: 'sha256:now', screenedHash: 'sha256:now', screeningOutcome: 'clean' as const }
    vi.mocked(getAccessibleDocument).mockResolvedValue(screened)
    const rows = [
      version({ id: 'ver_1', versionNumber: 1, state: 'superseded', contentHash: 'sha256:first', screenedHash: 'sha256:first' }),
      version({ id: 'ver_2', versionNumber: 2, state: 'superseded', contentHash: 'sha256:unread', screenedHash: null }),
      version({ id: 'ver_3', versionNumber: 3, state: 'published', contentHash: 'sha256:now', screenedHash: 'sha256:now' }),
    ]
    vi.mocked(listDocumentVersions).mockResolvedValue(rows)
    vi.mocked(versionBytesReadableBy).mockImplementation(async (_session, item) => (row) => versionBytesPassedScreening(item, row))

    const listing = await listDocumentVersionViews(session, 'doc_1')

    expect(listing.versions.map((row) => [row.id, row.bytesReadable])).toEqual([
      ['ver_1', true],
      ['ver_2', false],
      ['ver_3', true],
    ])
  })

  it('names on each Fassung the mails that brought it, and nothing on the others (D36)', async () => {
    const rows = [
      version({ id: 'ver_1', versionNumber: 1, state: 'superseded', contentHash: 'sha256:first' }),
      version({ id: 'ver_2', versionNumber: 2, state: 'published', contentHash: 'sha256:now' }),
    ]
    vi.mocked(listDocumentVersions).mockResolvedValue(rows)
    vi.mocked(versionBytesReadableBy).mockResolvedValue(() => true)
    const origin = {
      threadId: 'thread-1',
      entryId: 'entry-1',
      sentAt: '2026-10-14T07:12:00.000Z',
      receivedAt: '2026-10-14T07:14:00.000Z',
      fromName: 'Ing. Paul Gruber',
      signerDomain: 'statik-weber.at',
      forwardedByName: null,
      forwarded: false,
      senderTrust: 'external_verified' as const,
    }
    vi.mocked(documentMailOrigins).mockResolvedValue([{ ...origin, documentVersionId: 'ver_2' }])

    const listing = await listDocumentVersionViews(session, 'doc_1')

    expect(documentMailOrigins).toHaveBeenCalledWith(session, expect.objectContaining({ id: document.id }))
    expect(listing.versions.map((row) => [row.id, row.mailOrigins])).toEqual([
      ['ver_1', undefined],
      ['ver_2', [origin]],
    ])
  })
})
