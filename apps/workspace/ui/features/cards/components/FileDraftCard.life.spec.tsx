import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { FileDraftCard } from './FileDraftCard'
import { filingBody, openSaveDialog, stubFetch } from './draft-filing.fixtures'
import { useDraftLifeStore } from '../lib/draft-life'

const setCardDecision = vi.fn()

const chat = vi.hoisted(() => ({ messages: [] as Array<{ id: string; cards?: unknown[] }> }))

const storeState = () => ({
  projectId: 'proj-1',
  setCardDecision,
  setComposerPrefill: vi.fn(),
  currentConversation: { id: 'conv-1', messages: chat.messages },
  conversations: [],
})

vi.mock('@/features/chat/store', () => {
  const useChatStore = (selector: (s: unknown) => unknown) => selector(storeState())
  useChatStore.getState = () => storeState()
  return { useChatStore }
})

const submit = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
vi.mock('@/lib/documents/lifecycle-client', () => ({ documentLifecycleClient: { submit } }))
vi.mock('@/features/documents/lib/open-filed-document', () => ({ openFiledDocument: vi.fn(() => Promise.resolve(true)) }))
vi.mock('@/hooks/use-seen-once', () => ({ useSeenOnce: () => [() => {}, true] }))
vi.mock('@/features/knowledge/file-preview', () => ({
  useFileThumbnailState: () => ({ source: null, state: 'idle' }),
  PdfViewerDialog: () => null,
}))

const PATH = '/drafts/Raumbuch.xlsx'

const XLSX = {
  title: 'Raumbuch.xlsx',
  path: PATH,
  bytes: 9412,
  version: 2,
  cardKey: 'document_draft-0',
  messageId: 'msg-1',
}

const card = (version: number, extra: Record<string, unknown> = {}) => ({
  type: 'document_draft',
  title: 'Raumbuch.xlsx',
  path: PATH,
  bytes: 9412,
  version,
  ...extra,
})

const json = (status: number, body: unknown) => () => Promise.resolve({ ok: status < 400, status, json: async () => body })

const calls = (part: string) =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes(part)) as Array<[string, RequestInit]>

describe('FileDraftCard — after it was filed and changed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chat.messages = [{ id: 'msg-1' }]
    useDraftLifeStore.setState({ changes: {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('says the draft changed since filing, offers the update and holds back the submit of stale bytes', async () => {
    stubFetch(
      json(201, {
        documentId: 'doc-1',
        versionId: 'ver-2',
        state: 'draft',
        alreadyFiled: true,
        outcome: 'updated',
        draftVersion: 2,
        versionNumber: 2,
      }),
    )
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} documentId="doc-1" versionId="ver-1" versionState="draft" filedDraftVersion={1} />)

    expect(screen.getByTestId('document-draft-state')).toHaveTextContent('Changed since it was filed')
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update in the project' }))

    await waitFor(() => expect(screen.getByTestId('document-draft-state')).toHaveTextContent('Updated in the project'))
    expect(filingBody()).toEqual({ path: PATH, title: 'Raumbuch.xlsx', force: false })
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))
    expect(submit).toHaveBeenCalledWith('doc-1', 'ver-2')
  })

  it('names a person’s change in the project and lets the person choose', async () => {
    stubFetch(
      json(409, { code: 'CONFLICT', error: 'changed', details: { reason: 'changed-in-project', versionNumber: 3 } }),
    )
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} documentId="doc-1" versionId="ver-1" versionState="draft" filedDraftVersion={1} />)

    await user.click(screen.getByRole('button', { name: 'Update in the project' }))

    expect(await screen.findByTestId('draft-project-change')).toHaveTextContent(
      'Someone changed “Raumbuch.xlsx” in the project since it was filed; it is now revision 3.',
    )
    await user.click(screen.getByTestId('draft-over-changes'))
    expect(filingBody(1)).toMatchObject({ overChanges: true })
    await user.click(screen.getByTestId('draft-as-own-file'))
    expect(filingBody(2)).toMatchObject({ as: 'own' })
  })
})

describe('FileDraftCard — an earlier version, a restore and a delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDraftLifeStore.setState({ changes: {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('says an earlier card was revised since and restores the previous version from it', async () => {
    chat.messages = [
      { id: 'msg-1', cards: [card(2)] },
      { id: 'msg-2', cards: [card(3, { previous_version: 2 })] },
    ]
    stubFetch(json(200, { path: PATH, version: 4 }))
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} />)

    expect(screen.getByTestId('file-draft-superseded')).toHaveTextContent('Revised since (revision 3)')
    expect(screen.queryByRole('button', { name: 'File into the project' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Download/ })).toHaveAttribute('href', expect.stringContaining('v=2'))

    await user.click(screen.getByTestId('file-draft-restore'))

    await waitFor(() => expect(calls('/draft/restore')).toHaveLength(1))
    expect(calls('/draft/restore')[0][1]).toMatchObject({ method: 'POST' })
    await waitFor(() => expect(screen.getByTestId('file-draft-superseded')).toHaveTextContent('revision 4'))
  })

  it('says so when the agent deleted the draft', () => {
    chat.messages = [{ id: 'msg-1' }]
    render(<FileDraftCard {...XLSX} removed />)

    expect(screen.getByTestId('file-draft-card')).toHaveAttribute('data-removed', 'true')
    expect(screen.getByTestId('file-draft-removed')).toHaveTextContent('This draft was deleted from the chat')
  })

  it('deletes a draft from its menu after the person confirmed', async () => {
    chat.messages = [{ id: 'msg-1' }]
    stubFetch(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ path: PATH, deleted: true }) }))
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} />)

    await user.click(screen.getByTestId('draft-menu'))
    await user.click(await screen.findByTestId('draft-delete'))
    expect(calls('/draft?path=')).toHaveLength(0)
    await user.click(await screen.findByTestId('draft-delete-confirm'))

    await waitFor(() => expect(screen.getByTestId('file-draft-card')).toHaveAttribute('data-removed', 'true'))
    expect(calls('/draft?path=')[0]).toEqual([
      `/api/conversations/conv-1/draft?path=${encodeURIComponent(PATH)}`,
      { method: 'DELETE' },
    ])
  })
})

describe('FileDraftCard — a draft made from a project document', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chat.messages = [{ id: 'msg-1' }]
    useDraftLifeStore.setState({ changes: {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('offers both ways, a separate file by default, and files the new revision with its change note when chosen', async () => {
    stubFetch((url) =>
      String(url).startsWith('/api/documents/')
        ? json(200, { document: { id: 'doc-raumbuch', folderId: null } })()
        : json(201, {
            documentId: 'doc-raumbuch',
            versionId: 'ver-4',
            state: 'draft',
            alreadyFiled: false,
            outcome: 'revised',
            versionNumber: 4,
            revisionOf: { documentId: 'doc-raumbuch', name: 'Raumbuch.xlsx' },
          })(),
    )
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} derivedFromDocumentId="doc-raumbuch" derivedFromName="Raumbuch.xlsx" />)

    await openSaveDialog(user)
    expect(screen.getByTestId('save-to-project-mode-own')).toHaveAttribute('data-state', 'checked')
    await user.click(screen.getByTestId('save-to-project-mode-revision'))
    await user.type(screen.getByTestId('save-to-project-change-note'), 'Fläche Raum 2.04 korrigiert')
    await user.click(screen.getByTestId('save-to-project-submit'))

    await waitFor(() => expect(screen.getByTestId('document-draft-state')).toHaveTextContent('revision 4 of “Raumbuch.xlsx”'))
    expect(filingBody()).toEqual({
      path: PATH,
      title: 'Raumbuch.xlsx',
      force: false,
      as: 'revision',
      changeNote: 'Fläche Raum 2.04 korrigiert',
    })
  })
})
