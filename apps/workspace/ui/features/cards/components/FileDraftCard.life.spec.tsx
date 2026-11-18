import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { FileDraftCard } from './FileDraftCard'
import { filingBody, openSaveDialog, SAVE_FOLDERS, stubFetch } from './draft-filing.fixtures'
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

const FILED = { documentId: 'doc-1', versionId: 'ver-1', filedDraftVersion: 1 } as const

const card = (version: number, extra: Record<string, unknown> = {}) => ({
  type: 'document_draft',
  title: 'Raumbuch.xlsx',
  path: PATH,
  bytes: 9412,
  version,
  ...extra,
})

const json = (status: number, body: unknown) => () => Promise.resolve({ ok: status < 400, status, json: async () => body })

const updated = (state: string) =>
  json(201, {
    documentId: 'doc-1',
    versionId: 'ver-2',
    state,
    alreadyFiled: true,
    outcome: 'updated',
    draftVersion: 2,
    versionNumber: 2,
  })

const calls = (part: string) =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes(part)) as Array<[string, RequestInit]>

beforeEach(() => {
  vi.clearAllMocks()
  chat.messages = [{ id: 'msg-1' }]
  useDraftLifeStore.setState({ removed: {} })
})
afterEach(() => vi.unstubAllGlobals())

describe('FileDraftCard — after it was filed and changed', () => {
  it('says the draft changed since filing, offers the update and holds back the submit of stale bytes', async () => {
    stubFetch(updated('draft'))
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} {...FILED} versionState="draft" />)

    expect(screen.getByTestId('document-draft-state')).toHaveTextContent('Changed since it was filed')
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update in the project' }))

    await waitFor(() => expect(screen.getByTestId('document-draft-state')).toHaveTextContent('Updated, in the project as a draft'))
    expect(filingBody()).toEqual({ path: PATH, title: 'Raumbuch.xlsx', force: false })
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))
    expect(submit).toHaveBeenCalledWith('doc-1', 'ver-2')
  })

  it('offers the submit again once an approved document got its new draft revision', async () => {
    stubFetch(updated('draft'))
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} {...FILED} versionState="approved" />)

    await user.click(screen.getByRole('button', { name: 'Update in the project' }))

    expect(await screen.findByRole('button', { name: 'Submit for approval' })).toBeInTheDocument()
  })

  it('names a person’s change, hides the update while it is open, and lets the person choose', async () => {
    let filing = 0
    stubFetch((url) => {
      if (!String(url).includes('/draft/file')) return json(200, {})()
      filing += 1
      return filing === 1
        ? json(409, { code: 'CONFLICT', error: 'changed', details: { reason: 'changed-in-project', versionNumber: 3 } })()
        : updated('draft')()
    })
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} {...FILED} versionState="draft" />)

    await user.click(screen.getByRole('button', { name: 'Update in the project' }))

    expect(await screen.findByTestId('draft-project-change')).toHaveTextContent(
      'Someone changed “Raumbuch.xlsx” in the project since it was filed; it is now revision 3.',
    )
    expect(screen.queryByRole('button', { name: 'Update in the project' })).not.toBeInTheDocument()
    await user.click(screen.getByTestId('draft-as-own-file'))
    expect(await screen.findByTestId('save-to-project')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('draft-over-changes'))
    expect(filingBody(1)).toMatchObject({ overChanges: true })
  })

  it('files a separate file through the save dialog after a person’s change', async () => {
    stubFetch(json(409, { code: 'CONFLICT', error: 'changed', details: { reason: 'changed-in-project', versionNumber: 3 } }))
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} {...FILED} versionState="draft" />)
    await user.click(screen.getByRole('button', { name: 'Update in the project' }))
    await user.click(await screen.findByTestId('draft-as-own-file'))
    await waitFor(() => expect(screen.getByTestId('save-to-project-submit')).not.toHaveAttribute('aria-disabled'))

    await user.click(screen.getByTestId('save-to-project-submit'))

    expect(filingBody(1)).toMatchObject({ as: 'own', name: 'Raumbuch.xlsx' })
  })
})

describe('FileDraftCard — an earlier card and a deleted draft', () => {
  it('says an earlier card was revised since and offers nothing that would serve the newer bytes', () => {
    chat.messages = [
      { id: 'msg-1', cards: [card(2)] },
      { id: 'msg-2', cards: [card(3)] },
    ]
    vi.stubGlobal('fetch', vi.fn())
    render(<FileDraftCard {...XLSX} />)

    expect(screen.getByTestId('file-draft-superseded')).toHaveTextContent(/^Revised since$/)
    expect(screen.queryByRole('link', { name: /Download/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'File into the project' })).not.toBeInTheDocument()
  })

  it('says so when the agent deleted the draft, and mentions the project only when something was filed', () => {
    vi.stubGlobal('fetch', vi.fn())
    const { unmount } = render(<FileDraftCard {...XLSX} removed />)
    expect(screen.getByTestId('file-draft-removed')).toHaveTextContent(/^This draft was deleted from this chat\.$/)
    unmount()

    render(<FileDraftCard {...XLSX} {...FILED} versionState="draft" removed />)
    expect(screen.getByTestId('file-draft-removed')).toHaveTextContent('What was filed from it stays in the project.')
    expect(screen.getByRole('link', { name: 'Open in the project' })).toHaveAttribute('href', expect.stringContaining('doc-1'))
  })

  it('deletes a draft after the person confirmed, then puts the focus on the card', async () => {
    stubFetch(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ path: PATH, deleted: true }) }))
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} />)

    await user.click(screen.getByTestId('draft-menu'))
    await user.click(await screen.findByTestId('draft-delete'))
    expect(screen.getByRole('dialog', { name: 'Delete draft “Raumbuch.xlsx”?' })).toBeInTheDocument()
    expect(calls('/draft?path=')).toHaveLength(0)
    await user.click(screen.getByTestId('draft-delete-confirm'))

    await waitFor(() => expect(screen.getByTestId('file-draft-card')).toHaveAttribute('data-removed', 'true'))
    expect(calls('/draft?path=')[0]).toEqual([`/api/conversations/conv-1/draft?path=${encodeURIComponent(PATH)}`, { method: 'DELETE' }])
    expect(screen.getByTestId('file-draft-card')).toHaveFocus()
  })

  it('shows a failed delete in the dialog that is still open', async () => {
    stubFetch(() => Promise.resolve({ ok: false, status: 502, json: async () => ({}) }))
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} />)

    await user.click(screen.getByTestId('draft-menu'))
    await user.click(await screen.findByTestId('draft-delete'))
    await user.click(screen.getByTestId('draft-delete-confirm'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('draft-delete-error')).toBeInTheDocument()
  })
})

describe('FileDraftCard — a draft made from a project document', () => {
  const revised = json(201, {
    documentId: 'doc-raumbuch',
    versionId: 'ver-4',
    state: 'draft',
    alreadyFiled: false,
    outcome: 'revised',
    versionNumber: 4,
    revisionOf: { documentId: 'doc-raumbuch', name: 'Raumbuch.xlsx' },
  })

  it('offers both ways, a separate file by default, and files the new revision with its change note when chosen', async () => {
    stubFetch((url) =>
      String(url).startsWith('/api/documents/') ? json(200, { document: { id: 'doc-raumbuch', folderId: null } })() : revised(),
    )
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} derivedFromDocumentId="doc-raumbuch" derivedFromName="Raumbuch.xlsx" />)

    await openSaveDialog(user)
    expect(screen.getByTestId('save-to-project-mode-own')).toHaveAttribute('data-state', 'checked')
    await user.click(screen.getByTestId('save-to-project-mode-revision'))
    expect(within(screen.getByTestId('save-to-project')).queryByText(/Choose the folder/)).not.toBeInTheDocument()
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

  it('keeps what the person typed when the source folder arrives late, and opens there', async () => {
    let answerFolder: (value: unknown) => void = () => {}
    const late = new Promise((resolve) => {
      answerFolder = resolve
    })
    stubFetch((url) =>
      String(url).startsWith('/api/documents/')
        ? late.then(() => ({ ok: true, status: 200, json: async () => ({ document: { folderId: SAVE_FOLDERS[0].id } }) }))
        : revised(),
    )
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} derivedFromDocumentId="doc-raumbuch" derivedFromName="Raumbuch.xlsx" />)

    await user.click(screen.getByRole('button', { name: 'File into the project' }))
    await screen.findByTestId('save-to-project')
    await user.click(screen.getByTestId('save-to-project-mode-revision'))
    await user.type(screen.getByTestId('save-to-project-change-note'), 'Notiz')
    await user.click(screen.getByTestId('save-to-project-mode-own'))
    await user.clear(screen.getByTestId('save-to-project-name'))
    await user.type(screen.getByTestId('save-to-project-name'), 'Eigener Name')
    answerFolder(null)

    await waitFor(() => expect(screen.getByTestId('save-to-project-here')).toHaveTextContent(SAVE_FOLDERS[0].name))
    expect(screen.getByTestId('save-to-project-name')).toHaveValue('Eigener Name')
    expect(screen.getByTestId('save-to-project-mode-own')).toHaveAttribute('data-state', 'checked')
  })
})
