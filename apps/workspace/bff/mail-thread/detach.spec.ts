/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./write-repository', () => ({
  acquireRenderLease: vi.fn(async () => true),
  releaseRenderLease: vi.fn(async () => undefined),
  commitDetach: vi.fn(async () => [{ id: 'follow-1', userId: 'user_01JCX0R4D8M2W6YB3N5Q7T9V1B' }]),
  findCurrentVersions: vi.fn(async () => new Map()),
  findEntryAttachmentRows: vi.fn(async () => new Map()),
  findThreadEntryRows: vi.fn(async () => []),
  findWritableThread: vi.fn(async () => null),
}))
vi.mock('./repository', () => ({ findVisibleThread: vi.fn(async () => ({ id: 'visible' })) }))
vi.mock('./rematch', () => ({ rematchAfterWrite: vi.fn(async () => undefined) }))
vi.mock('@/lib/authz/folder-access-repository', () => ({
  listProjectFolderTree: vi.fn(async () => [
    { id: 'board', parentId: null, accessMode: 'custom', everyoneReads: false },
    { id: 'board-sub', parentId: 'board', accessMode: 'inherit', everyoneReads: false },
  ]),
}))
vi.mock('@/lib/inbound-mail/access', () => ({
  requireMailReviewer: vi.fn(async () => ({ closed: false })),
}))
vi.mock('@/lib/authz/folder-access', () => ({
  getHiddenFolderIds: vi.fn(async () => []),
  requireFolderWrite: vi.fn(async () => undefined),
}))
vi.mock('@/lib/inbound-mail/repository', () => ({
  findDocumentIdByStoredName: vi.fn(async () => null),
  findLiveFolders: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/inbound-mail/quiet-batch', () => ({
  openQuietBatch: vi.fn(async () => 'batch-1'),
  sealQuietBatch: vi.fn(async () => undefined),
}))
vi.mock('@/lib/inbound-mail/decision', () => ({ THREAD_DOCUMENT_TYPE: 'correspondence' }))
vi.mock('@/lib/documents/document-dispatch', () => ({ uploadDocument: vi.fn() }))
vi.mock('@/lib/projects/folder-service', () => ({ ensureProjectFolderPaths: vi.fn() }))
vi.mock('@/lib/audit/after-commit', () => ({ recordAuditEventAfterCommit: vi.fn() }))
vi.mock('@/lib/realtime/door-events', () => ({ publishProjectChanged: vi.fn() }))
vi.mock('@/lib/inbound-mail/announce', () => ({
  announceFollowsEnded: vi.fn(async () => undefined),
  settleFollowExpiring: vi.fn(async () => undefined),
}))
vi.mock('@/lib/upload-screening/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upload-screening/service')>()),
  gatePolicy: vi.fn(async () => ({
    enabled: true,
    nameTerms: ['Gehalt'],
    nameExceptions: [],
    contentTerms: [],
    detectors: [],
  })),
}))

import { InsufficientStorageError } from '@/lib/api/errors'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { MailThreadEntryAttachmentRow, MailThreadEntryRow, MailThreadRow } from '@/lib/db/schema/mail-thread'
import { uploadDocument } from '@/lib/documents/document-dispatch'
import { announceFollowsEnded, settleFollowExpiring } from '@/lib/inbound-mail/announce'
import { heldMail, PERSON, PROJECT_ID } from '@/lib/inbound-mail/__fixtures__/review'
import { findDocumentIdByStoredName } from '@/lib/inbound-mail/repository'
import { ensureProjectFolderPaths } from '@/lib/projects/folder-service'
import { inboundEntryOf } from './append'
import { detachMailThreadEntry } from './detach'
import { rematchAfterWrite } from './rematch'
import type { MailThreadEntryDetachBody } from './mail-thread-wire'
import { findVisibleThread, type ThreadRow } from './repository'
import {
  acquireRenderLease,
  commitDetach,
  findCurrentVersions,
  findEntryAttachmentRows,
  findThreadEntryRows,
  findWritableThread,
  releaseRenderLease,
  type DetachCommit,
} from './write-repository'

const session = {
  userId: PERSON,
  organizationId: 'org_1',
  email: 'petra@example.test',
} as AuthorizedSession
const SOURCE = '4e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a7b'
const TARGET = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d'
const AT = new Date('2026-10-21T08:14:00.000Z')

function thread(id: string, overrides: Partial<MailThreadRow> = {}): MailThreadRow {
  return {
    id,
    organizationId: 'org_1',
    projectId: PROJECT_ID,
    documentId: `doc-${id}`,
    baseSubject: 'statik',
    threadIndexGuid: null,
    participantDomains: [],
    continuesThreadId: null,
    entryCount: 2,
    renderedBytes: 100,
    lastEntryAt: AT,
    renderPendingAt: null,
    renderLeaseHolder: null,
    renderLeaseUntil: null,
    locale: 'de',
    createdBy: PERSON,
    createdAt: AT,
    ...overrides,
  }
}

const writable = (id: string, name: string) => ({
  thread: thread(id),
  document: { id: `doc-${id}`, filename: name, folderId: null, contentHash: 'sha256:before' },
})

function entry(
  id: string,
  threadId: string,
  text: string,
  minute: number,
  sender = 'DI Petra Weber'
): MailThreadEntryRow {
  const sentAt = new Date(AT.getTime() + minute * 60_000)
  const mail = heldMail({
    id: `aaaaaaaa-0000-4000-8000-00000000000${minute}`,
    sentAt,
    receivedAt: sentAt,
    senderName: sender,
    messageId: `<${id}@x.at>`,
  })
  const row = inboundEntryOf({
    id,
    threadId,
    mail,
    read: {
      readerVersion: 1,
      bodySource: 'plain',
      ownText: text,
      ownTextTruncated: false,
      split: true,
      signatureRemoved: false,
      quoted: [],
      quotedTruncated: false,
      calendar: [],
      calendarTruncated: false,
      encrypted: false,
      unreadableReasons: [],
      unreadable: false,
    },
    decision: { decidedBy: PERSON, via: 'app', decidedAt: sentAt } as Parameters<
      typeof inboundEntryOf
    >[0]['decision'],
    heading: '',
    inReplyToEntryId: null,
    form: { masked: false, rules: null },
  })
  const minuteText =
    String(10 + Math.floor((14 + minute) / 60)).padStart(2, '0') +
    ':' +
    String((14 + minute) % 60).padStart(2, '0')
  return {
    ...row,
    heading: `21.10.2026 ${minuteText} · ${sender} (statik-weber.at)`,
    firstVersionId: 'v1',
  } as MailThreadEntryRow
}

const KEEP = entry('e-keep', SOURCE, 'Die Statik bleibt hier.', 0)
const MOVE = entry('e-move', SOURCE, 'Diese Nachricht gehört zur Einreichung.', 1)
const OTHER = entry('e-other', TARGET, 'Die Einreichung läuft.', 0, 'Mag. Huber')

const detach = (target: MailThreadEntryDetachBody['target']) =>
  detachMailThreadEntry(
    session,
    PROJECT_ID,
    SOURCE,
    MOVE.id,
    { target },
    new Request('http://localhost/x')
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(acquireRenderLease).mockResolvedValue(true)
  vi.mocked(findVisibleThread).mockResolvedValue({ id: 'visible' } as ThreadRow)
  vi.mocked(findWritableThread).mockImplementation(async (_project, id) =>
    id === SOURCE
      ? writable(SOURCE, 'Statik.md')
      : id === TARGET
        ? writable(TARGET, 'Einreichung.md')
        : null
  )
  vi.mocked(findThreadEntryRows).mockImplementation(async (id) =>
    id === SOURCE ? [KEEP, MOVE] : id === TARGET ? [OTHER] : []
  )
  vi.mocked(uploadDocument).mockImplementation(async (_session, input) => ({
    documentId:
      input.file.name === 'Statik.md'
        ? `doc-${SOURCE}`
        : input.file.name === 'Einreichung.md'
          ? `doc-${TARGET}`
          : 'doc-new',
    jobId: 'job',
    status: 'pending',
    filename: input.file.name,
  }))
  vi.mocked(findCurrentVersions).mockImplementation(
    async (ids) =>
      new Map(
        ids.map((id) => [
          id,
          {
            documentId: id,
            versionId: `${id}-next`,
            versionCreatedAt: AT,
            contentHash: 'x',
            folderId: null,
          },
        ])
      )
  )
})

describe('moving a message into another thread', () => {
  it('writes the thread it leaves without it first, then the thread it joins with it, then moves the row', async () => {
    const result = await detach({ action: 'append', mailThreadId: TARGET })

    const [left, joined] = vi.mocked(uploadDocument).mock.calls.map((call) => call[1])
    expect(left!.file.name).toBe('Statik.md')
    const leftText = await left!.file.text()
    expect(leftText).toContain('Die Statik bleibt hier.')
    expect(leftText).not.toContain('Diese Nachricht gehört zur Einreichung.')
    expect(left).toMatchObject({
      uploadBatchId: 'batch-1',
      documentType: 'correspondence',
      mailThread: { message_count: 1 },
    })
    expect(joined!.file.name).toBe('Einreichung.md')
    expect(await joined!.file.text()).toContain('Diese Nachricht gehört zur Einreichung.')
    expect(joined).toMatchObject({ mailThread: { message_count: 2 } })

    const commit = vi.mocked(commitDetach).mock.calls[0]![0] as DetachCommit
    expect(commit).toMatchObject({
      entryId: MOVE.id,
      fromThreadId: SOURCE,
      toThreadId: TARGET,
      newThread: null,
      firstVersionId: `doc-${TARGET}-next`,
    })
    expect(commit.heading).toBe(MOVE.heading)
    expect(commit.fromThreadUpdate.entryCount).toBe(1)
    expect(commit.toThreadUpdate.entryCount).toBe(2)
    expect(vi.mocked(uploadDocument).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(commitDetach).mock.invocationCallOrder[0]!
    )
    expect(result).toEqual({
      entryId: MOVE.id,
      from: { threadId: SOURCE, documentId: `doc-${SOURCE}`, versionId: `doc-${SOURCE}-next` },
      to: { threadId: TARGET, documentId: `doc-${TARGET}`, versionId: `doc-${TARGET}-next` },
      followsEnded: 1,
    })
    expect(recordAuditEventAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mail_thread.entry_detached',
        metadata: expect.objectContaining({ threadAction: 'append' }),
      })
    )
    expect(recordAuditEventAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mail_thread.follow_ended',
        metadata: expect.objectContaining({ reason: 'detached' }),
      })
    )
    expect(settleFollowExpiring).toHaveBeenCalledWith(expect.any(String), [expect.any(String)])
    expect(announceFollowsEnded).toHaveBeenCalledWith(
      'org_1',
      PROJECT_ID,
      [{ id: 'follow-1', userId: 'user_01JCX0R4D8M2W6YB3N5Q7T9V1B' }],
      'detached',
      PERSON
    )
    expect(releaseRenderLease).toHaveBeenCalledTimes(2)
    expect(rematchAfterWrite).toHaveBeenCalledWith(PROJECT_ID, [
      expect.objectContaining({ id: SOURCE }),
      expect.objectContaining({ id: TARGET }),
    ])
  })

  it('refuses the thread it is in, a thread the reader may not read, and a busy one, moving nothing', async () => {
    await expect(detach({ action: 'append', mailThreadId: SOURCE })).rejects.toMatchObject({
      status: 409,
      details: { reason: 'target_unknown' },
    })
    vi.mocked(findVisibleThread).mockImplementation(async (_project, id) =>
      id === TARGET ? null : ({ id } as ThreadRow)
    )
    await expect(detach({ action: 'append', mailThreadId: TARGET })).rejects.toMatchObject({
      details: { reason: 'target_unknown' },
    })
    vi.mocked(findVisibleThread).mockResolvedValue({ id: 'visible' } as ThreadRow)
    vi.mocked(acquireRenderLease).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(detach({ action: 'append', mailThreadId: TARGET })).rejects.toMatchObject({
      details: { reason: 'busy' },
    })
    expect(releaseRenderLease).toHaveBeenCalledWith(SOURCE, expect.any(String))
    expect(uploadDocument).not.toHaveBeenCalled()
    expect(commitDetach).not.toHaveBeenCalled()
  })

  it('refuses to take the only message out of its thread', async () => {
    vi.mocked(findThreadEntryRows).mockImplementation(async (id) => (id === SOURCE ? [MOVE] : []))
    await expect(detach({ action: 'append', mailThreadId: TARGET })).rejects.toMatchObject({
      details: { reason: 'last_entry' },
    })
    expect(uploadDocument).not.toHaveBeenCalled()
  })

  it('moves nothing when the second upload is refused; the first thread brings the section back with its next Fassung', async () => {
    vi.mocked(uploadDocument).mockImplementationOnce(async (_session, input) => ({
      documentId: `doc-${SOURCE}`,
      jobId: 'j',
      status: 'pending',
      filename: input.file.name,
    }))
    vi.mocked(uploadDocument).mockRejectedValueOnce(new InsufficientStorageError('full'))
    await expect(detach({ action: 'append', mailThreadId: TARGET })).rejects.toMatchObject({
      details: { reason: 'upload_refused', failure: 'quota' },
    })
    expect(commitDetach).not.toHaveBeenCalled()
  })
})

describe('what the moved section names of its attachments (RT-S13)', () => {
  const attachment = (overrides: Partial<MailThreadEntryAttachmentRow> = {}): MailThreadEntryAttachmentRow => ({
    id: 'att-1',
    organizationId: 'org_1',
    projectId: PROJECT_ID,
    entryId: MOVE.id,
    position: 1,
    filename: 'Honorarvereinbarung.pdf',
    disposition: 'filed',
    notFiledReason: null,
    documentId: 'doc-fee',
    documentVersionId: 'ver-fee',
    sectionName: 'Honorarvereinbarung.pdf',
    sectionFolderPath: 'Vorstand/Verträge',
    createdAt: AT,
    ...overrides,
  })
  const filedIn = (folderId: string | null) => {
    vi.mocked(findEntryAttachmentRows).mockImplementation(
      async (ids) => new Map(ids.includes(MOVE.id) ? [[MOVE.id, [attachment()]]] : [])
    )
    vi.mocked(findCurrentVersions).mockImplementation(
      async (ids) =>
        new Map(
          ids.map((id) => [
            id,
            { documentId: id, versionId: `${id}-next`, versionCreatedAt: AT, contentHash: 'x', folderId: id === 'doc-fee' ? folderId : null },
          ])
        )
    )
  }

  it('stops naming a file and its folder the joined thread’s readers may not open', async () => {
    filedIn('board')
    await detach({ action: 'append', mailThreadId: TARGET })
    const joined = await vi.mocked(uploadDocument).mock.calls[1]![1].file.text()
    expect(joined).not.toContain('Honorarvereinbarung')
    expect(joined).not.toContain('Vorstand')
    expect(joined).toContain('1 Anhang nur im Original')
    expect(vi.mocked(commitDetach).mock.calls[0]![0].unnamedPositions).toEqual([1])
  })

  it('keeps naming it where the joined thread is as closed as the file', async () => {
    filedIn('board')
    vi.mocked(findWritableThread).mockImplementation(async (_project, id) =>
      id === SOURCE
        ? writable(SOURCE, 'Statik.md')
        : { ...writable(TARGET, 'Einreichung.md'), document: { ...writable(TARGET, 'Einreichung.md').document, folderId: 'board-sub' } }
    )
    await detach({ action: 'append', mailThreadId: TARGET })
    expect(await vi.mocked(uploadDocument).mock.calls[1]![1].file.text()).toContain('Honorarvereinbarung.pdf')
    expect(vi.mocked(commitDetach).mock.calls[0]![0].unnamedPositions).toEqual([])
  })

  it('names nothing in a new thread whose folder is not made yet: who reads it is not known', async () => {
    filedIn('board')
    vi.mocked(ensureProjectFolderPaths).mockResolvedValue({ ok: true, folders: [], folderIdByPath: { 'Vorstand/Neu': 'folder-new' } })
    await detach({ action: 'create', name: 'Honorar', newFolderPath: 'Vorstand/Neu' })
    expect(vi.mocked(commitDetach).mock.calls[0]![0].unnamedPositions).toEqual([1])
  })

  it('names nothing the person moving it cannot read', async () => {
    filedIn(null)
    const versions = vi.mocked(findCurrentVersions).getMockImplementation()!
    vi.mocked(findCurrentVersions).mockImplementation(async (ids, reader) =>
      versions(
        ids.filter((id) => id !== 'doc-fee'),
        reader
      )
    )
    await detach({ action: 'append', mailThreadId: TARGET })
    expect(vi.mocked(commitDetach).mock.calls[0]![0].unnamedPositions).toEqual([1])
  })
})

describe('moving a message into a new thread', () => {
  it('starts it under a name that passes the name check and is free, in the source thread’s locale', async () => {
    await detach({ action: 'create', name: 'Einreichung Statik' })
    const commit = vi.mocked(commitDetach).mock.calls[0]![0] as DetachCommit
    expect(vi.mocked(uploadDocument).mock.calls[1]![1].file.name).toBe('Einreichung Statik.md')
    expect(commit.newThread).toMatchObject({
      documentId: 'doc-new',
      locale: 'de',
      createdBy: PERSON,
    })
    expect(commit.toThreadId).toBe(commit.newThread!.id)
  })

  it('starts it under the moved message’s own subject and conversation, so replies to it match by reference', async () => {
    const guid = '6f1d2c3b-4a5e-4f60-8172-839405a6b7c8'
    vi.mocked(findThreadEntryRows).mockImplementation(async (id) =>
      id === SOURCE ? [KEEP, { ...MOVE, baseSubject: 'einreichung statik', threadIndexGuid: guid }] : []
    )
    await detach({ action: 'create', name: 'Einreichung Statik' })
    expect(vi.mocked(commitDetach).mock.calls[0]![0].newThread).toMatchObject({
      baseSubject: 'einreichung statik',
      threadIndexGuid: guid,
    })
  })

  it('keeps the left thread’s subject for a message filed before entries kept their own', async () => {
    vi.mocked(findThreadEntryRows).mockImplementation(async (id) =>
      id === SOURCE ? [KEEP, { ...MOVE, baseSubject: null, threadIndexGuid: null }] : []
    )
    await detach({ action: 'create', name: 'Einreichung Statik' })
    expect(vi.mocked(commitDetach).mock.calls[0]![0].newThread).toMatchObject({ baseSubject: 'statik', threadIndexGuid: null })
  })

  it('refuses a stopped name unless released, and a taken one', async () => {
    await expect(detach({ action: 'create', name: 'Gehaltsliste' })).rejects.toMatchObject({
      details: { reason: 'name_stop' },
    })
    vi.mocked(findDocumentIdByStoredName).mockResolvedValueOnce('another-doc')
    await expect(detach({ action: 'create', name: 'Einreichung' })).rejects.toMatchObject({
      details: { reason: 'name_taken' },
    })
    expect(uploadDocument).not.toHaveBeenCalled()
    await detach({ action: 'create', name: 'Gehaltsliste', screeningRelease: 'name' })
    expect(vi.mocked(uploadDocument).mock.calls[1]![1]).toMatchObject({ screeningRelease: true })
  })
})
