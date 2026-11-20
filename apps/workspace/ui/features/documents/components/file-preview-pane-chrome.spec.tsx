import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilePreviewPane } from './file-preview-pane'
import { CurrentProjectProvider } from '@/features/projects/lib/current-project'
import { PRODUCT_NAME } from '@/lib/brand'
import { mockFile } from './file-preview-pane.fixtures'

describe('FilePreviewPane', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('puts what its opener knows about the file first in the details column', () => {
    render(<FilePreviewPane file={mockFile} projectId="proj-1" detailsLead={<p>Ausgabe 2023-02-01</p>} />)
    expect(within(screen.getByTestId('file-preview-details-lead')).getByText('Ausgabe 2023-02-01')).toBeDefined()
  })

  it('renders file metadata', () => {
    render(<FilePreviewPane file={mockFile} projectId="proj-1" />)
    expect(screen.getByText('plan.pdf')).toBeDefined()
    expect(screen.getByText(/1 MB/i)).toBeDefined()
  })

  it("names a closed project's file as such, under its name (ADR-0090)", () => {
    const closed = { id: 'proj-1', name: 'Seestadt D12', status: 'closed' as const, closedAt: null, readsBecauseClosed: false }
    const { unmount } = render(
      <CurrentProjectProvider value={closed}>
        <FilePreviewPane file={mockFile} projectId="proj-1" />
      </CurrentProjectProvider>
    )
    expect(screen.getByText('Seestadt D12 · closed')).toBeDefined()
    unmount()

    render(
      <CurrentProjectProvider value={{ ...closed, status: 'active' }}>
        <FilePreviewPane file={mockFile} projectId="proj-1" />
      </CurrentProjectProvider>
    )
    expect(screen.queryByText('Seestadt D12 · closed')).toBeNull()
  })

  it("does not mark an Archiv file previewed inside a closed project", () => {
    render(
      <CurrentProjectProvider value={{ id: 'proj-1', name: 'Seestadt D12', status: 'closed', closedAt: null, readsBecauseClosed: false }}>
        <FilePreviewPane file={mockFile} scope="officeShelf" />
      </CurrentProjectProvider>
    )
    expect(screen.queryByText('Seestadt D12 · closed')).toBeNull()
  })

  it('keeps what acts on the file in the header, and what the agent made of it in the rail', () => {
    render(
      <FilePreviewPane
        file={{ ...mockFile, tags: ['Grundriss'] }}
        projectId="proj-1"
        canCollaborate
        onClose={() => undefined}
      />
    )

    const header = screen.getByRole('heading', { name: 'plan.pdf' }).parentElement?.parentElement
    expect(header).not.toBeNull()
    const chrome = within(header!)

    expect(chrome.getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(chrome.getByTestId('document-actions-trigger')).toBeInTheDocument()
    expect(chrome.getByRole('button', { name: 'Close preview' })).toBeInTheDocument()
    expect(chrome.queryByText('Floor plan')).toBeNull()
    expect(screen.queryByText('Citable')).toBeNull()

    expect(chrome.queryByRole('button', { name: `Discuss with ${PRODUCT_NAME}` })).toBeNull()
    expect(chrome.queryByRole('button', { name: 'Ask a colleague' })).toBeNull()
    expect(chrome.queryByText('Responsible')).toBeNull()
    expect(screen.getByRole('button', { name: `Discuss with ${PRODUCT_NAME}` })).toBeInTheDocument()
    expect(screen.getByText('Responsible')).toBeInTheDocument()
  })

  it('shows the status chip only when the agent cannot quote the document', () => {
    const { unmount } = render(<FilePreviewPane file={mockFile} projectId="proj-1" />)
    expect(screen.queryByText('Citable')).toBeNull()
    unmount()

    render(<FilePreviewPane file={{ ...mockFile, status: 'processing' }} projectId="proj-1" />)
    expect(screen.getAllByText('Reading')).toHaveLength(1)
  })

  it('states the status and the category once each', () => {
    render(<FilePreviewPane file={{ ...mockFile, status: 'failed', tags: ['Grundriss'] }} projectId="proj-1" />)

    expect(screen.getAllByText('Failed')).toHaveLength(1)
    expect(screen.queryByText('Status')).toBeNull()
    expect(screen.queryByText('Document type')).toBeNull()
  })

  it('says the previous version is still searched when a new version failed', () => {
    const failed = { ...mockFile, status: 'failed', errorMessage: 'PDF is encrypted' }
    const { unmount } = render(
      <FilePreviewPane file={{ ...failed, versionState: 'published', versionCount: 2 }} projectId="proj-1" />
    )
    expect(screen.getByText(`${PRODUCT_NAME} couldn't read this document, so search can't find it.`)).toBeInTheDocument()
    expect(screen.getByText(/still use the previous revision/)).toBeInTheDocument()
    unmount()

    render(<FilePreviewPane file={{ ...failed, versionState: 'published', versionCount: 1 }} projectId="proj-1" />)
    expect(screen.queryByText(/still use the previous revision/)).toBeNull()
  })

  it('offers the review for a PDF once its preview URL has loaded, in place of the enlarged viewer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://example.test/plan.pdf' }),
    } as Response)

    render(<FilePreviewPane file={mockFile} projectId="proj-1" />)

    expect(await screen.findByRole('button', { name: 'Open review' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /open large preview/i })).toBeNull()
  })

  it('names the format in the facts line under the name and keeps the MIME type in its tooltip', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, json: async () => ({}) } as Response)

    render(
      <FilePreviewPane
        file={{ ...mockFile, filename: 'Vertrag.docx', contentType: docx }}
        projectId="proj-1"
      />
    )

    const facts = screen.getByTestId('file-preview-facts')
    expect(facts).toHaveTextContent('Word document')
    expect(facts.getAttribute('title')).toBe(docx)
    expect(screen.queryByText(docx)).toBeNull()
  })

  describe('where the document stands, in the header', () => {
    it('says the state beside the name once the document has a history', () => {
      render(<FilePreviewPane file={{ ...mockFile, versionState: 'in_review', versionCount: 2 }} />)

      expect(screen.getByTestId('file-preview-lifecycle-badge')).toHaveTextContent('In review')
    })

    it('stays silent on an ordinary upload', () => {
      render(<FilePreviewPane file={{ ...mockFile, versionState: 'published', versionCount: 1 }} />)

      expect(screen.queryByTestId('file-preview-lifecycle-badge')).not.toBeInTheDocument()
    })

    it('says so when the file has been taken out of the working set', () => {
      render(
        <FilePreviewPane
          file={{ ...mockFile, versionState: 'published', versionCount: 1, lifecycle: 'archived' }}
        />,
      )

      expect(screen.getByTestId('file-preview-lifecycle-badge')).toHaveTextContent('Retired')
    })
  })

  it('surfaces the failure reason and a retry-ingestion affordance for failed documents', async () => {
    const user = userEvent.setup()
    render(
      <FilePreviewPane
        file={{ ...mockFile, status: 'failed', errorMessage: 'Ingestion could not be started' }}
        projectId="proj-1"
      />
    )
    expect(screen.getByText('Reading failed')).toBeDefined()
    expect(screen.getByText("Reading couldn't be started. Try again.")).toBeDefined()
    expect(screen.getByRole('button', { name: /read again/i })).toBeDefined()

    expect(screen.queryByText('Ingestion could not be started')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByTestId('preview-ingest-failure-raw')).toHaveTextContent('Ingestion could not be started')
  })

  it('says a missing vision model is a configuration problem, not the file', () => {
    render(
      <FilePreviewPane
        file={{
          ...mockFile,
          status: 'failed',
          errorMessage: 'vlm_not_configured: image ingestion requires VLM_API_KEY',
        }}
        projectId="proj-1"
      />
    )
    expect(screen.getByText(/need a vision model, and none is set up/)).toBeDefined()
    expect(screen.queryByText(/VLM_API_KEY/)).toBeNull()
  })

  describe('the file operations', () => {
    it('puts them in the header, beside Download, and not in the metadata rail', async () => {
      const user = userEvent.setup()
      render(<FilePreviewPane file={mockFile} projectId="proj-1" />)

      expect(screen.queryByRole('button', { name: /delete document/i })).toBeNull()
      await user.click(screen.getByTestId('document-actions-trigger'))

      expect(await screen.findByRole('menuitem', { name: /rename/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /download/i })).toBeNull()
    })

    it('shows the rename, and keeps the file name reachable on the title', () => {
      render(
        <FilePreviewPane
          file={{ ...mockFile, displayName: 'Einreichplan EG.pdf' }}
          projectId="proj-1"
        />
      )

      const heading = screen.getByRole('heading', { name: 'Einreichplan EG.pdf' })
      expect(heading).toHaveAttribute('title', expect.stringContaining('plan.pdf'))
    })

    it('closes itself once the document it describes has been deleted', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }))
      const onClose = vi.fn()
      const onDeleted = vi.fn()
      const user = userEvent.setup()
      render(
        <FilePreviewPane
          file={mockFile}
          projectId="proj-1"
          onClose={onClose}
          onDeleted={onDeleted}
        />
      )

      await user.click(screen.getByTestId('document-actions-trigger'))
      await user.click(await screen.findByRole('menuitem', { name: /delete/i }))
      await user.click(await screen.findByTestId('document-delete-confirm'))

      await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('doc-1'))
      expect(onClose).toHaveBeenCalled()
    })

    it('offers a read-only viewer nothing that mutates', () => {
      render(<FilePreviewPane file={mockFile} projectId="proj-1" canManage={false} />)
      expect(screen.queryByTestId('document-actions-trigger')).toBeNull()
    })
  })

  it('offers Besprechen while the file is still being read', () => {
    render(<FilePreviewPane file={{ ...mockFile, status: 'processing' }} projectId="proj-1" />)
    expect(screen.getByRole('button', { name: `Discuss with ${PRODUCT_NAME}` })).toBeEnabled()
  })

  it('offers Besprechen once ingest has reconciled, too', () => {
    render(<FilePreviewPane file={{ ...mockFile, status: 'completed' }} projectId="proj-1" />)
    expect(screen.getByRole('button', { name: `Discuss with ${PRODUCT_NAME}` })).toBeEnabled()
  })
})
