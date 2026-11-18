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
  readDraftFacts: vi.fn(),
}))

vi.mock('@/lib/conversations/draft-backend', () => ({
  recordDraftFilingInBackend: vi.fn(async () => undefined),
}))

vi.mock('@/lib/documents/agent-file-revision', () => ({
  reviseWithAgentWork: vi.fn(),
}))

vi.mock('@/lib/documents/agent-folder', () => ({
  folderOfSource: vi.fn(async () => 'folder-source'),
}))

vi.mock('@/lib/documents/access', () => ({
  getAccessibleDocument: vi.fn(async () => ({ id: 'doc-filed', folderId: 'folder-berichte' })),
}))

vi.mock('@/lib/documents/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/repository')>()),
  findDocumentAuthoredByRef: vi.fn(),
  listProjectDocuments: vi.fn(),
}))

vi.mock('@/lib/documents/version-repository', () => ({
  findOpenVersion: vi.fn(),
  findPublishedVersion: vi.fn(),
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

vi.mock('@/lib/projects/folder-service', () => ({
  findProjectFolder: vi.fn(async (_projectId: string, folderId: string) => ({ id: folderId, name: 'Berichte' })),
}))

import { findConversationInOrg } from '@/lib/conversations/repository'
import { readConversationDraft, readDraftFacts, type DraftFacts } from '@/lib/conversations/draft-preview'
import { recordDraftFilingInBackend } from '@/lib/conversations/draft-backend'
import { reviseWithAgentWork } from '@/lib/documents/agent-file-revision'
import { ConflictError } from '@/lib/api/errors'
import { findOpenVersion } from '@/lib/documents/version-repository'
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

const facts = (overrides: Partial<DraftFacts> = {}): DraftFacts => ({
  version: 2,
  filing: null,
  previousVersion: null,
  derivedFrom: null,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readDraftFacts).mockResolvedValue(facts())
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
    version: { id: VERSION, state: 'draft', contentHash: 'sha256:filed', versionNumber: 1 } as DocumentVersion,
    alreadyFiled: false,
    folderId: null,
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
      folderId: 'folder-1',
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


describe('fileConversationDraft — one filing truth for the card and the agent', () => {
  const XLSX_PATH = '/drafts/Flaechen.xlsx'
  const filedAt = (version: number) => ({
    documentId: 'doc-filed',
    versionId: 'ver-filed',
    contentHash: 'sha256:filed',
    state: 'draft',
    filedAtVersion: version,
  })

  beforeEach(() => {
    vi.mocked(readConversationDraftBytes).mockResolvedValue({
      path: 'drafts/Flaechen.xlsx',
      filename: 'Flaechen.xlsx',
      type: draftFileType('drafts/Flaechen.xlsx'),
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      etag: '"abc"',
    })
    vi.mocked(fileAgentFileDraft).mockResolvedValue({
      documentId: DOC,
      version: { id: VERSION, state: 'draft', contentHash: 'sha256:new', versionNumber: 1 } as DocumentVersion,
      alreadyFiled: false,
      folderId: null,
    })
    vi.mocked(reviseWithAgentWork).mockResolvedValue({
      document: { id: 'doc-filed', folderId: 'folder-berichte', displayName: 'Raumbuch.xlsx', filename: 'Raumbuch.xlsx' } as never,
      version: { id: 'ver-2', state: 'draft', contentHash: 'sha256:v2', versionNumber: 2 } as DocumentVersion,
      forked: false,
    })
  })

  it('writes a filing made with the button back to the conversation, with the draft version it filed', async () => {
    await fileConversationDraft(session, 'conv-1', { path: XLSX_PATH, name: 'Flächen' })

    expect(recordDraftFilingInBackend).toHaveBeenCalledWith('conv-1', '/drafts/Flaechen.xlsx', {
      documentId: DOC,
      versionId: VERSION,
      contentHash: 'sha256:new',
      state: 'draft',
      draftVersion: 2,
    })
  })

  it('updates the filed document with the new bytes when the draft changed since filing, never a silent no-op', async () => {
    vi.mocked(readDraftFacts).mockResolvedValue(facts({ version: 2, filing: filedAt(1) }))

    const filed = await fileConversationDraft(session, 'conv-1', { path: XLSX_PATH })

    expect(filed).toMatchObject({ outcome: 'updated', versionId: 'ver-2', documentId: 'doc-filed' })
    expect(vi.mocked(reviseWithAgentWork).mock.calls[0][1]).toMatchObject({
      documentId: 'doc-filed',
      ifMatch: 'sha256:filed',
      agentFiledOnly: true,
      work: { kind: 'file' },
    })
    expect(fileAgentFileDraft).not.toHaveBeenCalled()
    expect(listProjectDocuments).not.toHaveBeenCalled()
    expect(vi.mocked(recordDraftFilingInBackend).mock.calls[0][2]).toMatchObject({ versionId: 'ver-2', draftVersion: 2 })
  })

  it('answers the filed document unchanged when the draft did not change', async () => {
    vi.mocked(readDraftFacts).mockResolvedValue(facts({ version: 2, filing: filedAt(2) }))
    vi.mocked(findOpenVersion).mockResolvedValue({ id: 'ver-filed', state: 'draft', versionNumber: 1 } as DocumentVersion)

    const filed = await fileConversationDraft(session, 'conv-1', { path: XLSX_PATH })

    expect(filed).toMatchObject({ outcome: 'unchanged', versionId: 'ver-filed', folderId: 'folder-berichte' })
    expect(reviseWithAgentWork).not.toHaveBeenCalled()
  })

  it('finds a binary filed before the filing was written back under the producer it was filed as', async () => {
    vi.mocked(findDocumentAuthoredByRef).mockResolvedValue({ id: 'doc-filed', filename: 'x', folderId: null })
    vi.mocked(findOpenVersion).mockResolvedValue({ id: 'ver-1', state: 'draft', contentHash: 'sha256:old' } as DocumentVersion)

    await fileConversationDraft(session, 'conv-1', { path: XLSX_PATH })

    expect(vi.mocked(findDocumentAuthoredByRef).mock.calls[0][3]).toBe('agent_file')
    expect(vi.mocked(reviseWithAgentWork).mock.calls[0][1]).toMatchObject({ documentId: 'doc-filed', ifMatch: 'sha256:old' })
  })

  it('says in its refusal that a person changed the filed document, and writes over it only when asked', async () => {
    vi.mocked(readDraftFacts).mockResolvedValue(facts({ version: 3, filing: filedAt(1) }))
    vi.mocked(reviseWithAgentWork).mockRejectedValueOnce(
      new ConflictError('changed', { reason: 'changed-in-project', versionNumber: 2 }),
    )

    const failure = await fileConversationDraft(session, 'conv-1', { path: XLSX_PATH }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ status: 409, details: { reason: 'changed-in-project' } })

    await fileConversationDraft(session, 'conv-1', { path: XLSX_PATH, overChanges: true })
    expect(vi.mocked(reviseWithAgentWork).mock.calls[1][1]).toMatchObject({ overChanges: true })
  })

  it('files a filed draft as its own file under a reference of its own when the person chooses that', async () => {
    vi.mocked(readDraftFacts).mockResolvedValue(facts({ version: 2, filing: filedAt(1) }))

    await fileConversationDraft(session, 'conv-1', { path: XLSX_PATH, as: 'own', name: 'Flächen neu' })

    const ref = vi.mocked(fileAgentFileDraft).mock.calls[0][0].ref
    expect(ref).not.toBe(filingReference('conv-1', XLSX_PATH))
    expect(ref.startsWith(filingReference('conv-1', XLSX_PATH))).toBe(true)
    expect(reviseWithAgentWork).not.toHaveBeenCalled()
  })

  it('files the dialog’s name as the file name, umlauts and spaces kept', async () => {
    await fileConversationDraft(session, 'conv-1', { path: XLSX_PATH, name: 'Flächenaufstellung Haus B' })

    expect(vi.mocked(fileAgentFileDraft).mock.calls[0][0]).toMatchObject({
      filename: 'Flächenaufstellung Haus B.xlsx',
      title: 'Flächenaufstellung Haus B.xlsx',
    })
  })
})

describe('fileConversationDraft — a draft made from a project document', () => {
  const SOURCE = { documentId: 'doc-raumbuch', name: 'Raumbuch.xlsx' }

  beforeEach(() => {
    vi.mocked(readConversationDraftBytes).mockResolvedValue({
      path: 'drafts/Raumbuch.xlsx',
      filename: 'Raumbuch.xlsx',
      type: draftFileType('drafts/Raumbuch.xlsx'),
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      etag: '"abc"',
    })
    vi.mocked(fileAgentFileDraft).mockResolvedValue({
      documentId: DOC,
      version: { id: VERSION, state: 'draft', contentHash: 'sha256:new', versionNumber: 1 } as DocumentVersion,
      alreadyFiled: false,
      folderId: 'folder-source',
    })
    vi.mocked(reviseWithAgentWork).mockResolvedValue({
      document: { id: 'doc-raumbuch', folderId: 'folder-source', displayName: 'Raumbuch.xlsx', filename: 'Raumbuch.xlsx' } as never,
      version: { id: 'ver-4', state: 'draft', contentHash: 'sha256:v4', versionNumber: 4 } as DocumentVersion,
      forked: true,
    })
  })

  it('files as a separate file in the source’s folder unless the person chose a new Fassung', async () => {
    vi.mocked(readDraftFacts).mockResolvedValue(facts({ derivedFrom: SOURCE }))

    await fileConversationDraft(session, 'conv-1', { path: '/drafts/Raumbuch.xlsx' })

    expect(vi.mocked(fileAgentFileDraft).mock.calls[0][0]).toMatchObject({ folderId: 'folder-source' })
    expect(reviseWithAgentWork).not.toHaveBeenCalled()
  })

  it('files the next Fassung of the source, with the Änderungsvermerk, when the person chose it', async () => {
    vi.mocked(readDraftFacts).mockResolvedValue(facts({ derivedFrom: SOURCE }))

    const filed = await fileConversationDraft(session, 'conv-1', {
      path: '/drafts/Raumbuch.xlsx',
      as: 'revision',
      changeNote: 'Fläche Raum 2.04 korrigiert',
    })

    expect(filed).toMatchObject({ outcome: 'revised', versionNumber: 4, revisionOf: { documentId: 'doc-raumbuch' } })
    expect(vi.mocked(reviseWithAgentWork).mock.calls[0][1]).toMatchObject({
      documentId: 'doc-raumbuch',
      changeNote: 'Fläche Raum 2.04 korrigiert',
      agentFiledOnly: false,
    })
    expect(fileAgentFileDraft).not.toHaveBeenCalled()
  })

  it('refuses a new Fassung for a draft that came from no document', async () => {
    const failure = await fileConversationDraft(session, 'conv-1', { path: '/drafts/Raumbuch.xlsx', as: 'revision' }).catch(
      (error: unknown) => error,
    )
    expect(failure).toMatchObject({ status: 400, details: { reason: 'no-source-document' } })
  })
})
