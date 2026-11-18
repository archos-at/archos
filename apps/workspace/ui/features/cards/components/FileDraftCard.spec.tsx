import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { FileDraftCard } from './FileDraftCard'

const setCardDecision = vi.fn()
const setComposerPrefill = vi.fn()

const storeState = () => ({
  projectId: 'proj-1',
  setCardDecision,
  setComposerPrefill,
  currentConversation: { id: 'conv-1', messages: [{ id: 'msg-1' }] },
  conversations: [],
})

vi.mock('@/features/chat/store', () => {
  const useChatStore = (selector: (s: unknown) => unknown) => selector(storeState())
  useChatStore.getState = () => storeState()
  return { useChatStore }
})

const openFiledDocument = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
vi.mock('@/features/documents/lib/open-filed-document', () => ({ openFiledDocument }))

vi.mock('@/hooks/use-seen-once', () => ({ useSeenOnce: () => [() => {}, true] }))

const thumbnail = vi.hoisted(() => ({ calls: [] as Array<string | null>, source: null as string | null }))
vi.mock('@/features/knowledge', () => ({
  useFileThumbnailState: (url: string | null) => {
    thumbnail.calls.push(url)
    return url && thumbnail.source ? { source: thumbnail.source, state: 'drawn' } : { source: null, state: url ? 'loading' : 'idle' }
  },
  PdfViewerDialog: ({ open, src, title, description }: { open: boolean; src: string; title: string; description: string }) =>
    open ? (
      <div role="dialog" aria-label={title} data-src={src}>
        {description}
      </div>
    ) : null,
}))

const XLSX = {
  title: 'Flächenaufstellung Top 4.xlsx',
  path: '/drafts/Flächenaufstellung Top 4.xlsx',
  bytes: 9412,
  version: 1,
  cardKey: 'document_draft-0',
  messageId: 'msg-1',
}

const filedResponse = (folderName = 'Berichte') =>
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({ documentId: 'doc-1', versionId: 'ver-1', state: 'draft', alreadyFiled: false, folderName }),
    }),
  )

describe('FileDraftCard — a file a script made', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    thumbnail.calls = []
    thumbnail.source = null
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['docx', 'word', 'Word document'],
    ['xlsx', 'excel', 'Excel workbook'],
    ['pptx', 'powerpoint', 'PowerPoint presentation'],
    ['pdf', 'pdf', 'PDF document'],
    ['png', 'image', 'Image'],
  ])('names a .%s by its kind, its name and its size', (extension, format, kind) => {
    render(<FileDraftCard {...XLSX} title={`Datei.${extension}`} path={`/drafts/Datei.${extension}`} />)

    const card = screen.getByTestId('file-draft-card')
    expect(card).toHaveAttribute('data-format', format)
    expect(card).toHaveAccessibleName(`${kind}: Datei.${extension}`)
    expect(screen.getByText(`Datei.${extension}`)).toBeInTheDocument()
    expect(screen.getByTestId('file-draft-facts')).toHaveTextContent(`${extension.toUpperCase()} · 9 kB`)
    expect(screen.getByText('Draft in this chat')).toBeInTheDocument()
    expect(screen.queryByTestId('document-draft-state')).not.toBeInTheDocument()
  })

  it('says a script made it, as every agent draft says', () => {
    render(<FileDraftCard {...XLSX} />)
    expect(screen.getByText(/^Created by /)).toBeInTheDocument()
  })

  it('downloads the original file from the conversation, under its own name', () => {
    render(<FileDraftCard {...XLSX} />)

    const link = screen.getByRole('link', { name: 'Download Flächenaufstellung Top 4.xlsx' })
    expect(link).toHaveAttribute(
      'href',
      '/api/conversations/conv-1/draft/download?path=%2Fdrafts%2FFl%C3%A4chenaufstellung%20Top%204.xlsx&v=1',
    )
    expect(link).toHaveAttribute('download', 'Flächenaufstellung Top 4.xlsx')
  })

  it('draws the first page of an Office file from its PDF rendition', async () => {
    thumbnail.source = 'data:image/png;base64,AAAA'
    render(<FileDraftCard {...XLSX} />)

    await waitFor(() => expect(screen.getByTestId('file-draft-thumbnail')).toHaveAttribute('data-drawn', 'true'))
    expect(thumbnail.calls.filter(Boolean).at(-1)).toContain('/draft/rendition?path=')
    expect(screen.getByAltText('First page of Flächenaufstellung Top 4.xlsx')).toBeInTheDocument()
  })

  it('shows an image as itself, from the download route', () => {
    render(<FileDraftCard {...XLSX} title="Schnitt.png" path="/drafts/Schnitt.png" />)

    const image = screen.getByAltText('Preview of Schnitt.png')
    expect(image.getAttribute('src')).toContain('/draft/download?path=%2Fdrafts%2FSchnitt.png')
    expect(thumbnail.calls.every((url) => url === null)).toBe(true)
  })

  it('keeps the format and its glyph when there is no page to show', () => {
    render(<FileDraftCard {...XLSX} title="Folien.pptx" path="/drafts/Folien.pptx" />)

    const sheet = screen.getByTestId('file-draft-thumbnail')
    expect(sheet).not.toHaveAttribute('data-drawn')
    expect(within(sheet).getByText('PPTX')).toBeInTheDocument()
  })

  it('opens the PDF of an Office file in the viewer, and says the download is the original', async () => {
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} />)

    await user.click(screen.getByRole('button', { name: 'Open' }))

    const viewer = screen.getByRole('dialog', { name: XLSX.title })
    expect(viewer.getAttribute('data-src')).toContain('/draft/rendition?path=')
    expect(viewer).toHaveTextContent('Download gives the original file (Excel workbook)')
  })

  it('opens from the thumbnail too, by keyboard', async () => {
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} />)

    screen.getByRole('button', { name: `Open ${XLSX.title}` }).focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('dialog', { name: XLSX.title })).toBeInTheDocument()
  })

  it('shows the version once the same path was written again, in one card', () => {
    render(<FileDraftCard {...XLSX} version={2} />)
    expect(screen.getAllByTestId('file-draft-card')).toHaveLength(1)
    expect(screen.getByTestId('file-draft-facts')).toHaveTextContent('XLSX · 9 kB · v2')
  })
})

describe('FileDraftCard — filing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    thumbnail.calls = []
  })
  afterEach(() => vi.unstubAllGlobals())

  it('files the file on one press, then says where it lies and offers the project', async () => {
    const fetchMock = filedResponse()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} />)

    await user.click(screen.getByRole('button', { name: 'File into the project' }))

    await waitFor(() => expect(screen.getByTestId('document-draft-state')).toHaveTextContent('Filed as a draft in “Berichte”'))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/conversations/conv-1/draft/file')
    expect(JSON.parse(String(init.body))).toEqual({ path: XLSX.path, title: XLSX.title, force: false })
    expect(setCardDecision).toHaveBeenCalled()
    expect(screen.getByText('In the project')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in the project' })).toHaveAttribute('href', expect.stringContaining('doc-1'))
    expect(screen.queryByRole('link', { name: /^Download/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'File into the project' })).not.toBeInTheDocument()
  })

  it('shows a card the agent filed as filed, with its review action', () => {
    render(<FileDraftCard {...XLSX} documentId="doc-1" versionId="ver-1" versionState="draft" />)

    expect(screen.getByTestId('document-draft-state')).toHaveTextContent('Filed in the project as a draft')
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument()
  })

  it('shows the review state once it was submitted', () => {
    render(<FileDraftCard {...XLSX} documentId="doc-1" versionId="ver-1" versionState="in_review" />)

    expect(screen.getByTestId('document-draft-state')).toHaveTextContent('In review')
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument()
  })

  it('opens a filed file in the project from its thumbnail', async () => {
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} documentId="doc-1" versionId="ver-1" versionState="draft" />)

    await user.click(screen.getByTestId('file-draft-thumbnail'))

    expect(openFiledDocument).toHaveBeenCalledWith({ documentId: 'doc-1', projectId: 'proj-1' })
  })

  it('says honestly when filing failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) })),
    )
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} />)

    await user.click(screen.getByRole('button', { name: 'File into the project' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Filing failed. Please try again.')
  })

  it('offers no filing for a CSV, says why, and asks for Excel instead', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const user = userEvent.setup()
    render(<FileDraftCard {...XLSX} title="Raumliste.csv" path="/drafts/Raumliste.csv" />)

    expect(screen.queryByRole('button', { name: 'File into the project' })).not.toBeInTheDocument()
    expect(screen.getByTestId('file-draft-refusal')).toHaveTextContent('A CSV cannot be filed into the project')
    expect(screen.getByRole('link', { name: 'Download Raumliste.csv' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ask for Excel' }))

    expect(setComposerPrefill).toHaveBeenCalledWith(expect.stringContaining('Raumliste as an Excel workbook'))
  })
})
