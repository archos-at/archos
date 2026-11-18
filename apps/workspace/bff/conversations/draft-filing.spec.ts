/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/lib/db/schema/conversations'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { DocumentListRow } from '@/lib/documents/repository'

const requireResourceAccessMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sharing/access', () => ({
  requireResourceAccess: requireResourceAccessMock,
}))

vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))

vi.mock('@/lib/conversations/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/conversations/repository')>()),
  findConversationInOrg: vi.fn(),
}))

vi.mock('@/lib/conversations/draft-preview', () => ({
  readConversationDraft: vi.fn(),
}))

vi.mock('@/lib/documents/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/repository')>()),
  findDocumentAuthoredByRef: vi.fn(),
  listProjectDocuments: vi.fn(),
}))

vi.mock('@/lib/documents/version-repository', () => ({
  findOpenVersion: vi.fn(),
}))

vi.mock('@/lib/documents/agent-document', () => ({
  fileAgentDocumentDraft: vi.fn(),
}))

vi.mock('@/lib/documents/agent-file', () => ({
  fileAgentFileDraft: vi.fn(),
}))

vi.mock('@/lib/conversations/draft-file', () => ({
  readConversationDraftBytes: vi.fn(),
}))

import { findConversationInOrg } from '@/lib/conversations/repository'
import { readConversationDraft } from '@/lib/conversations/draft-preview'
import {
  fileConversationDraft,
  filingReference,
  normalizeDraftPath,
} from '@/lib/conversations/draft-filing'
import { fileAgentDocumentDraft } from '@/lib/documents/agent-document'
import { fileAgentFileDraft } from '@/lib/documents/agent-file'
import { readConversationDraftBytes } from '@/lib/conversations/draft-file'
import { draftFileType } from '@/lib/conversations/draft-media'
import {
  DOCUMENT_LIST_LIMIT,
  findDocumentAuthoredByRef,
  listProjectDocuments,
} from '@/lib/documents/repository'

const PROJECT = '33333333-3333-4333-8333-333333333333'
const DOC = '11111111-1111-4111-8111-111111111111'
const VERSION = '22222222-2222-4222-8222-222222222222'

const session = { userId: 'user_1', organizationId: 'org_1' } as never

const conversation = (overrides: Partial<Conversation> = {}): Conversation =>
  ({
    id: 'conv-1',
    organizationId: 'org_1',
    projectId: PROJECT,
    ...overrides,
  }) as Conversation

const filler = (count: number, start = 0): DocumentListRow[] =>
  Array.from(
    { length: count },
    (_, i) => ({ id: `doc-${start + i}`, filename: `f-${start + i}.md`, displayName: `Bericht ${start + i}` }) as DocumentListRow,
  )

beforeEach(() => {
  vi.clearAllMocks()
  requireResourceAccessMock.mockResolvedValue({ role: 'viewer' })
  vi.mocked(findConversationInOrg).mockResolvedValue(conversation())
  vi.mocked(readConversationDraft).mockResolvedValue({
    path: 'entwuerfe/aktenvermerk.md',
    encoding: 'utf-8',
    content: '# Aktenvermerk\n',
    version: 2,
    bytes: 16,
    mediaType: 'text/markdown',
  })
  vi.mocked(findDocumentAuthoredByRef).mockResolvedValue(null)
  vi.mocked(listProjectDocuments).mockResolvedValue([])
  vi.mocked(fileAgentDocumentDraft).mockResolvedValue({
    documentId: DOC,
    version: { id: VERSION, state: 'draft' } as DocumentVersion,
    alreadyFiled: false,
  })
})

describe('fileConversationDraft — one normalized path for read, title and ref', () => {
  it('reads, titles and refs the same normalized path, whatever fringe the card carried', async () => {
    const filed = await fileConversationDraft(session, 'conv-1', {
      path: ' /entwuerfe/Aktenvermerk.md',
      title: 'Aktenvermerk',
    })

    expect(filed.documentId).toBe(DOC)
    expect(readConversationDraft).toHaveBeenCalledWith(session, 'conv-1', 'entwuerfe/Aktenvermerk.md')
    expect(vi.mocked(fileAgentDocumentDraft).mock.calls[0][0]).toMatchObject({
      ref: filingReference('conv-1', '/entwuerfe/Aktenvermerk.md'),
    })
  })

  it('files as the thread it came from, refusing in the reader’s language (ADR-0087)', async () => {
    await fileConversationDraft(session, 'conv-1', { path: '/entwuerfe/Notiz.md', locale: 'en' })

    expect(vi.mocked(fileAgentDocumentDraft).mock.calls[0][0]).toMatchObject({
      originConversationId: 'conv-1',
      locale: 'en',
    })
  })

  it('falls back to the normalized file name when the card carried no title', async () => {
    await fileConversationDraft(session, 'conv-1', { path: '/entwuerfe/Notiz.md' })

    expect(vi.mocked(fileAgentDocumentDraft).mock.calls[0][0]).toMatchObject({
      title: 'Notiz.md',
      ref: 'conv-1-notiz',
    })
  })

  it('normalizes the same way twice — fringe never mints a second reference', () => {
    expect(normalizeDraftPath(' /entwuerfe/Aktenvermerk.md')).toBe('entwuerfe/Aktenvermerk.md')
    expect(filingReference('conv-1', ' /entwuerfe/Aktenvermerk.md')).toBe(
      filingReference('conv-1', '/entwuerfe/Aktenvermerk.md'),
    )
  })
})

describe('fileConversationDraft — the same-name veto scans every page', () => {
  it('vetoes a clash sitting past the first page, carrying that row', async () => {
    const clash = {
      id: 'doc-9',
      filename: 'x.md',
      displayName: 'Der späte Zwilling',
    } as DocumentListRow
    vi.mocked(listProjectDocuments)
      .mockResolvedValueOnce(filler(DOCUMENT_LIST_LIMIT))
      .mockResolvedValueOnce([clash])

    const failure = await fileConversationDraft(session, 'conv-1', {
      path: '/entwuerfe/zwilling.md',
      title: 'Der späte Zwilling',
    }).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      status: 409,
      details: { reason: 'same-name', documentId: 'doc-9', displayName: 'Der späte Zwilling' },
    })

    expect(listProjectDocuments).toHaveBeenCalledTimes(2)
    expect(vi.mocked(listProjectDocuments).mock.calls[1][2]).toMatchObject({
      offset: DOCUMENT_LIST_LIMIT,
    })
    expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
  })

  it('files once the scan ends on a short page with no clash', async () => {
    vi.mocked(listProjectDocuments)
      .mockResolvedValueOnce(filler(DOCUMENT_LIST_LIMIT))
      .mockResolvedValueOnce(filler(3, DOCUMENT_LIST_LIMIT))

    const filed = await fileConversationDraft(session, 'conv-1', {
      path: '/entwuerfe/neu.md',
      title: 'Ganz neu',
    })

    expect(filed.documentId).toBe(DOC)
    expect(listProjectDocuments).toHaveBeenCalledTimes(2)
    expect(fileAgentDocumentDraft).toHaveBeenCalled()
  })

  it('reads a single page when the project fits in one', async () => {
    await fileConversationDraft(session, 'conv-1', {
      path: '/entwuerfe/neu.md',
      title: 'Ganz neu',
    })

    expect(listProjectDocuments).toHaveBeenCalledTimes(1)
    expect(fileAgentDocumentDraft).toHaveBeenCalled()
  })
})

describe('fileConversationDraft — a file a script made', () => {
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  beforeEach(() => {
    vi.mocked(readConversationDraftBytes).mockResolvedValue({
      path: 'drafts/flaechen.xlsx',
      filename: 'flaechen.xlsx',
      type: draftFileType('drafts/flaechen.xlsx'),
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      etag: '"abc"',
    })
    vi.mocked(fileAgentFileDraft).mockResolvedValue({
      documentId: DOC,
      version: { id: VERSION, state: 'draft' } as DocumentVersion,
      alreadyFiled: false,
    })
  })

  it('files the bytes as an agent file in the reader’s session, never as Markdown', async () => {
    const filed = await fileConversationDraft(session, 'conv-1', {
      path: '/drafts/flaechen.xlsx',
      title: 'Flächenaufstellung',
    })

    expect(filed).toMatchObject({ documentId: DOC, versionId: VERSION, folderName: 'Berichte' })
    expect(readConversationDraftBytes).toHaveBeenCalledWith(session, 'conv-1', 'drafts/flaechen.xlsx')
    expect(readConversationDraft).not.toHaveBeenCalled()
    expect(fileAgentDocumentDraft).not.toHaveBeenCalled()
    const call = vi.mocked(fileAgentFileDraft).mock.calls[0][0]
    expect(call).toMatchObject({
      contentType: XLSX,
      filename: 'flaechen.xlsx',
      title: 'Flächenaufstellung',
      originConversationId: 'conv-1',
      ref: filingReference('conv-1', '/drafts/flaechen.xlsx'),
    })
    expect(call).not.toHaveProperty('actingHuman', false)
  })

  it('files an SVG the store kept as text through the file path too', async () => {
    vi.mocked(readConversationDraftBytes).mockResolvedValue({
      path: 'drafts/schnitt.svg',
      filename: 'schnitt.svg',
      type: draftFileType('drafts/schnitt.svg'),
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      etag: '"svg"',
    })

    await fileConversationDraft(session, 'conv-1', { path: '/drafts/schnitt.svg' })

    expect(vi.mocked(fileAgentFileDraft).mock.calls[0][0]).toMatchObject({ contentType: 'image/svg+xml' })
  })

  it('refuses a CSV before reading anything, and says why', async () => {
    const failure = await fileConversationDraft(session, 'conv-1', { path: '/drafts/tabelle.csv' }).catch(
      (error: unknown) => error,
    )

    expect(failure).toMatchObject({ status: 422, details: { reason: 'not-fileable', format: 'csv' } })
    expect(readConversationDraftBytes).not.toHaveBeenCalled()
    expect(fileAgentFileDraft).not.toHaveBeenCalled()
  })
})
