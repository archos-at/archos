import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { DocumentDraftCard } from './DocumentDraftCard'
import { filingBody, filingCalls, fileThroughDialog, stubFetch } from './draft-filing.fixtures'
import { PRODUCT_NAME } from '@/lib/brand'

const setCardDecision = vi.fn()

let stubbedCardInteractions: Record<string, { decision: string; decidedAt: string }> | undefined

const storeState = () => ({
  projectId: 'proj-1',
  setCardDecision,
  currentConversation: {
    id: 'conv-1',
    messages: [{ id: 'msg-1', cardInteractions: stubbedCardInteractions }],
  },
  conversations: [],
})

vi.mock('@/features/chat/store', () => {
  const useChatStore = (selector: (s: unknown) => unknown) => selector(storeState())
  useChatStore.getState = () => storeState()
  return { useChatStore }
})

const openFiledDocument = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
vi.mock('@/features/documents/lib/open-filed-document', () => ({ openFiledDocument }))

const DRAFT = {
  title: 'Aktenvermerk – Abweichung Fluchtweglänge',
  path: '/entwuerfe/aktenvermerk-fluchtweg.md',
  bytes: 4820,
  version: 3,
  cardKey: 'document_draft-0',
  messageId: 'msg-1',
}

const FILED = {
  ...DRAFT,
  documentId: 'doc-1',
  versionId: 'ver-1',
  versionState: 'draft' as const,
}

describe('DocumentDraftCard — the draft, before it is filed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reports the draft: title, path and stand — never a version number', () => {
    render(<DocumentDraftCard {...DRAFT} />)

    expect(screen.getByText(DRAFT.title)).toBeInTheDocument()
    expect(screen.getByText(DRAFT.path)).toBeInTheDocument()
    expect(screen.getByTestId('document-draft-state')).toHaveTextContent('Draft')
    expect(screen.queryByText('v3')).not.toBeInTheDocument()
    expect(screen.queryByText('5 kB')).not.toBeInTheDocument()
    expect(screen.queryByText(String(DRAFT.bytes))).not.toBeInTheDocument()
  })

  it('says who wrote it, in the Files feature’s own words', () => {
    render(<DocumentDraftCard {...DRAFT} />)
    expect(screen.getByText(`Created by ${PRODUCT_NAME}`)).toBeInTheDocument()
  })

  it('does not claim the draft is in the project', () => {
    render(<DocumentDraftCard {...DRAFT} />)

    expect(screen.queryByText('Filed in the project as a draft')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open in the project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument()
  })

  it('files the draft into the project on one press, and remembers that it did', async () => {
    stubFetch(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ documentId: 'doc-1', versionId: 'ver-1', state: 'draft', alreadyFiled: false }),
        }),
      )
    const user = userEvent.setup()
    render(<DocumentDraftCard {...DRAFT} />)

    await fileThroughDialog(user)

    expect(fetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1/draft/file',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(filingBody()).toEqual({
      path: DRAFT.path,
      title: DRAFT.title,
      force: false,
      folderId: null,
      name: `${DRAFT.title}.md`,
    })
    expect(await screen.findByRole('link', { name: 'Open in the project' })).toHaveAttribute(
      'href',
      expect.stringContaining('doc-1'),
    )
    await waitFor(() => expect(setCardDecision).toHaveBeenCalledWith('msg-1', 'document_draft-0', 'filed'))
  })

  it('says it is filing while the request is in flight', async () => {
    let resolveFile!: (response: Response) => void
    stubFetch(() => new Promise<Response>((resolve) => { resolveFile = resolve }))
    const user = userEvent.setup()
    render(<DocumentDraftCard {...DRAFT} />)

    const fileButton = screen.getByRole('button', { name: 'File into the project' })
    fileButton.focus()
    await user.keyboard('{Enter}')
    await screen.findByTestId('save-to-project')
    await waitFor(() => expect(screen.getByTestId('save-to-project-submit')).not.toHaveAttribute('aria-disabled'))
    await user.keyboard('{Enter}')

    const busy = screen.getByTestId('save-to-project-submit')
    await waitFor(() => expect(busy).toHaveAttribute('aria-busy', 'true'))
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    await user.click(busy)
    await user.keyboard('{Enter}')
    expect(filingCalls()).toHaveLength(1)
    resolveFile({
      ok: true,
      status: 201,
      json: async () => ({ documentId: 'doc-1', versionId: 'ver-1', state: 'draft', alreadyFiled: false }),
    } as Response)
    expect(await screen.findByRole('link', { name: 'Open in the project' })).toBeInTheDocument()
  })

  it('parks a same-name collision for an explicit confirmation, never a silent copy', async () => {
    stubFetch(() =>
        Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({
            error: 'A document with this title is already in the project.',
            code: 'CONFLICT',
            details: { reason: 'same-name', documentId: 'doc-9', displayName: 'Bestehender Bericht' },
          }),
        }),
      )
    const user = userEvent.setup()
    render(<DocumentDraftCard {...DRAFT} />)

    await fileThroughDialog(user)

    expect(await screen.findByTestId('document-draft-conflict')).toBeInTheDocument()
    expect(screen.getByText('A document with this name is already in the project.')).toBeInTheDocument()
    expect(screen.getByTestId('document-draft-conflict-open')).toHaveTextContent('Bestehender Bericht')
    expect(setCardDecision).not.toHaveBeenCalled()

    stubFetch(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ documentId: 'doc-2', versionId: 'ver-2', state: 'draft', alreadyFiled: false }),
        }),
      )
    await user.click(screen.getByRole('button', { name: 'File anyway' }))

    expect(filingBody()).toMatchObject({ force: true, folderId: null, name: `${DRAFT.title}.md` })
    expect(await screen.findByRole('link', { name: 'Open in the project' })).toHaveAttribute(
      'href',
      expect.stringContaining('doc-2'),
    )
    await waitFor(() => expect(setCardDecision).toHaveBeenCalledWith('msg-1', 'document_draft-0', 'filed'))
  })

  it('names the Files pane when the reference filed and moved on', async () => {
    stubFetch(() =>
        Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({
            error: 'This draft has already been filed and is no longer a draft',
            code: 'CONFLICT',
            details: { reason: 'already-submitted' },
          }),
        }),
      )
    const user = userEvent.setup()
    render(<DocumentDraftCard {...DRAFT} />)

    await fileThroughDialog(user)

    await waitFor(() => expect(screen.getByTestId('save-to-project-error')).toBeInTheDocument())
    expect(screen.getByText('This draft has already been filed. Continue in Files.')).toBeInTheDocument()
    expect(screen.queryByTestId('document-draft-conflict')).not.toBeInTheDocument()
    expect(setCardDecision).not.toHaveBeenCalled()
  })

  it('says why a thread that drew on a restricted folder cannot file here (ADR-0087)', async () => {
    const refusal =
      'This conversation draws on a folder with restricted access, so nothing from it can be filed there.'
    stubFetch(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({ error: refusal, code: 'CONVERSATION_CONFINED', details: { action: 'filing' } }),
        }),
      )
    const user = userEvent.setup()
    render(<DocumentDraftCard {...DRAFT} />)

    await fileThroughDialog(user)

    await waitFor(() => expect(screen.getByTestId('save-to-project-error')).toBeInTheDocument())
    expect(screen.getByText(refusal)).toBeInTheDocument()
    expect(screen.queryByText('Filing failed. Please try again.')).not.toBeInTheDocument()
    expect(setCardDecision).not.toHaveBeenCalled()
  })

  it('keeps the card pending when filing fails, with the retry still offered', async () => {
    stubFetch(() =>
        Promise.resolve({
          ok: false,
          status: 502,
          json: async () => ({ error: 'Upstream service error', code: 'UPSTREAM_ERROR' }),
        }),
      )
    const user = userEvent.setup()
    render(<DocumentDraftCard {...DRAFT} />)

    await fileThroughDialog(user)

    await waitFor(() => expect(screen.getByTestId('save-to-project-error')).toBeInTheDocument())
    expect(screen.getByText('Filing failed. Please try again.')).toBeInTheDocument()
    expect(setCardDecision).not.toHaveBeenCalled()
    expect(screen.getByTestId('save-to-project-submit')).toBeInTheDocument()

    stubFetch(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ documentId: 'doc-1', versionId: 'ver-1', state: 'draft', alreadyFiled: false }),
        }),
      )
    await user.click(screen.getByTestId('save-to-project-submit'))

    expect(await screen.findByRole('link', { name: 'Open in the project' })).toBeInTheDocument()
    await waitFor(() => expect(setCardDecision).toHaveBeenCalledWith('msg-1', 'document_draft-0', 'filed'))
  })

  it('takes no filing it could not keep', () => {
    render(<DocumentDraftCard {...DRAFT} messageId={undefined} decisionsMustPersist />)

    expect(screen.queryByRole('button', { name: 'File into the project' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View draft' })).toBeInTheDocument()
  })

  it('names the stand instead of numbering a first write', () => {
    render(
      <DocumentDraftCard title="Notiz.md" path="/entwuerfe/Notiz.md" bytes={0} version={1} cardKey="k" />,
    )

    expect(screen.getByTestId('document-draft-state')).toHaveTextContent('Draft')
    expect(screen.queryByText('v1')).not.toBeInTheDocument()
    expect(screen.queryByText('0 B')).not.toBeInTheDocument()
  })

  it('offers the draft for reading beside the file action, and fetches nothing until asked', () => {
    render(<DocumentDraftCard {...DRAFT} />)

    expect(screen.getByRole('button', { name: 'View draft' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'File into the project' })).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('opens the reading surface with the fetched markdown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            path: DRAFT.path,
            content: '# Aktenvermerk\n\nDer Text.',
            version: 3,
            bytes: 30,
          }),
        }),
      ),
    )
    const user = userEvent.setup()
    render(<DocumentDraftCard {...DRAFT} />)

    await user.click(screen.getByRole('button', { name: 'View draft' }))

    expect(await screen.findByTestId('document-draft-preview')).toBeInTheDocument()
    expect(screen.getByTestId('document-draft-preview-meta')).toHaveTextContent(DRAFT.path)
    expect(screen.getByTestId('document-draft-preview-meta')).toHaveTextContent('v3')
    expect(screen.getByTestId('document-draft-preview-meta')).toHaveTextContent('5 kB')
    expect(screen.getByTestId('document-draft-preview-content')).toHaveTextContent('Der Text.')
    expect(fetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1/draft?path=%2Fentwuerfe%2Faktenvermerk-fluchtweg.md',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('numbers nothing in the reading surface of a first write either — but keeps its size', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            path: '/entwuerfe/Notiz.md',
            content: '# Notiz\n\nDer Text.',
            version: 1,
            bytes: 0,
          }),
        }),
      ),
    )
    const user = userEvent.setup()
    render(
      <DocumentDraftCard title="Notiz.md" path="/entwuerfe/Notiz.md" bytes={0} version={1} cardKey="k" />,
    )

    await user.click(screen.getByRole('button', { name: 'View draft' }))

    expect(await screen.findByTestId('document-draft-preview')).toBeInTheDocument()
    const meta = screen.getByTestId('document-draft-preview-meta')
    expect(meta).toHaveTextContent('/entwuerfe/Notiz.md')
    expect(meta).not.toHaveTextContent('v1')
    expect(meta).toHaveTextContent('0 B')
    expect(screen.getByTestId('document-draft-preview-content')).toHaveTextContent('Der Text.')
  })

  it('retries a failed load from the surface, never as a bare error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Upstream service error', code: 'UPSTREAM_ERROR' }),
        }),
      ),
    )
    const user = userEvent.setup()
    render(<DocumentDraftCard {...DRAFT} />)

    await user.click(screen.getByRole('button', { name: 'View draft' }))

    expect(await screen.findByTestId('document-draft-preview-error')).toBeInTheDocument()
    expect(screen.getByText('The draft could not be loaded.')).toBeInTheDocument()

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            path: DRAFT.path,
            content: '# Aktenvermerk\n\nDer Text.',
            version: 3,
            bytes: 30,
          }),
        }),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('document-draft-preview-content')).toHaveTextContent(
      'Der Text.',
    )
  })
})

describe('DocumentDraftCard — filed by the reader, after a reload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubbedCardInteractions = {
      'document_draft-0': { decision: 'filed', decidedAt: '2026-09-11T10:00:00.000Z' },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ documentId: 'doc-1', versionId: 'ver-1', state: 'draft', alreadyFiled: true }),
        }),
      ),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    stubbedCardInteractions = undefined
  })

  it('keeps the open link without another press, through the idempotent door', async () => {
    render(<DocumentDraftCard {...DRAFT} />)

    expect(fetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1/draft/file',
      expect.objectContaining({ method: 'POST' }),
    )
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      path: DRAFT.path,
      title: DRAFT.title,
      force: false,
    })
    expect(screen.getByTestId('document-draft-state')).toHaveTextContent('Filed in the project as a draft')
    expect(await screen.findByRole('link', { name: 'Open in the project' })).toHaveAttribute(
      'href',
      expect.stringContaining('doc-1'),
    )
    expect(setCardDecision).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'File into the project' })).not.toBeInTheDocument()
  })

  it('names the Files pane when the reference filed and moved on before the reload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({
            error: 'This draft has already been filed and is no longer a draft',
            code: 'CONFLICT',
            details: { reason: 'already-submitted' },
          }),
        }),
      ),
    )
    render(<DocumentDraftCard {...DRAFT} />)

    await waitFor(() => expect(screen.getByTestId('document-draft-error')).toBeInTheDocument())
    expect(screen.getByText('This draft has already been filed. Continue in Files.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open in the project' })).not.toBeInTheDocument()
    expect(setCardDecision).not.toHaveBeenCalled()
  })

  it('re-offers the file action when the restore itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 502,
          json: async () => ({ error: 'Upstream service error', code: 'UPSTREAM_ERROR' }),
        }),
      ),
    )
    render(<DocumentDraftCard {...DRAFT} />)

    await waitFor(() => expect(screen.getByTestId('document-draft-error')).toBeInTheDocument())
    expect(screen.getByText('Filing failed. Please try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'File into the project' })).toBeInTheDocument()
  })

  it('files nothing on mount while the card is still undecided', async () => {
    stubbedCardInteractions = undefined
    render(<DocumentDraftCard {...DRAFT} />)

    expect(await screen.findByRole('button', { name: 'File into the project' })).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('DocumentDraftCard — filed, and still the reader’s to send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            version: {
              id: 'ver-1',
              documentId: 'doc-1',
              versionNumber: 1,
              state: 'in_review',
              contentType: 'text/markdown',
              fileSize: 10,
              contentHash: 'h1',
              submittedBy: 'user_1',
              submittedAt: '2026-09-10T00:00:00.000Z',
              reviewedBy: null,
              reviewedAt: null,
              approvedBy: null,
              approvedAt: null,
              publishedBy: null,
              publishedAt: null,
              reviewComment: null,
              createdBy: 'user_1',
              createdAt: '2026-09-10T00:00:00.000Z',
              updatedAt: '2026-09-10T00:00:00.000Z',
            },
          }),
        }),
      ),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('says the document is in the project, as a draft', () => {
    render(<DocumentDraftCard {...FILED} />)
    expect(screen.getByTestId('document-draft-state')).toHaveTextContent('Filed in the project as a draft')
    expect(screen.queryByText('v3')).not.toBeInTheDocument()
  })

  it('a filed card offers no draft preview — there is nothing unfiled left to read', () => {
    render(<DocumentDraftCard {...FILED} />)

    expect(screen.queryByRole('button', { name: 'View draft' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in the project' })).toBeInTheDocument()
  })

  it('offers the document beside the conversation rather than instead of it', async () => {
    const user = userEvent.setup()
    render(<DocumentDraftCard {...FILED} />)

    const open = screen.getByRole('link', { name: 'Open in the project' })
    expect(open).toHaveAttribute('href', expect.stringContaining('doc-1'))
    await user.click(open)
    expect(openFiledDocument).toHaveBeenCalledWith({ documentId: 'doc-1', projectId: 'proj-1' })
  })

  it('sends it for approval through the lifecycle client, and remembers that it did', async () => {
    const user = userEvent.setup()
    render(<DocumentDraftCard {...FILED} />)

    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))

    await waitFor(() => expect(setCardDecision).toHaveBeenCalledWith('msg-1', 'document_draft-0', 'submitted'))
    expect(fetch).toHaveBeenCalledWith(
      '/api/documents/doc-1/versions/ver-1/submit',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('keeps the card pending when the submit fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'conflict', code: 'CONFLICT' }) }),
      ),
    )
    const user = userEvent.setup()
    render(<DocumentDraftCard {...FILED} />)

    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))

    await waitFor(() => expect(screen.getByTestId('document-draft-error')).toBeInTheDocument())
    expect(setCardDecision).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument()
  })

  it('takes no answer it could not keep', () => {
    render(<DocumentDraftCard {...FILED} messageId={undefined} decisionsMustPersist />)

    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in the project' })).toBeInTheDocument()
  })
})

describe('DocumentDraftCard — already with a reviewer', () => {
  it('reports the state instead of offering a control that would be refused', () => {
    render(<DocumentDraftCard {...FILED} versionState="in_review" />)

    expect(screen.getByTestId('document-draft-state')).toHaveTextContent('In review')
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument()
  })

  it('never says an agent draft is approved just because a version state is', () => {
    render(<DocumentDraftCard {...FILED} versionState="approved" />)
    expect(screen.getByTestId('document-draft-state')).toHaveTextContent('Approved')
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument()
  })

  it('names a superseded version replaced, never published', () => {
    render(<DocumentDraftCard {...FILED} versionState="superseded" />)
    expect(screen.getByTestId('document-draft-state')).toHaveTextContent('Replaced')
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument()
  })

  it('offers the send again after a reviewer asked for changes', () => {
    render(<DocumentDraftCard {...FILED} versionState="changes_requested" />)
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument()
  })
})
