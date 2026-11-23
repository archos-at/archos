import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import { FAKE_FRAME_WIDTH, fakePdfjsRuntime, fakeTextRun, selectRenderedText, type FakePdfState } from '@/test-utils/pdfjs-fake'
import { FilePreviewPane } from './file-preview-pane'
import { mockFile } from './file-preview-pane.fixtures'

const pdf = vi.hoisted(
  (): FakePdfState & { opened: string[] } => ({ fail: false, pages: [], destroyed: 0, opened: [] })
)

vi.mock('@/features/knowledge/lib/pdfjs-runtime', () => {
  const fake = fakePdfjsRuntime(pdf)
  return {
    ...fake,
    loadPdfjs: async () => {
      const runtime = await fake.loadPdfjs()
      return {
        getDocument: (params: { url: string }) => {
          pdf.opened.push(params.url)
          return runtime.getDocument()
        },
      }
    },
  }
})

const useInlineViewer = ({ intersecting = true }: { intersecting?: boolean } = {}) => {
  let restore = () => {}
  beforeEach(() => {
    pdf.fail = false
    pdf.pages = [{ items: [] }]
    pdf.opened = []
    restore = installLayoutObservers({ frameWidth: FAKE_FRAME_WIDTH, intersecting })
  })
  afterEach(() => restore())
}

describe('FilePreviewPane', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('a PDF, in the app\'s own viewer', () => {
    useInlineViewer()

    const presigned = () =>
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ url: 'https://example.test/plan.pdf' }),
      } as Response)

    it('renders the pages with pdf.js on the same-origin stream, not in a frame', async () => {
      presigned()
      const { container } = render(<FilePreviewPane file={mockFile} projectId="proj-1" />)

      await waitFor(() => expect(container.querySelectorAll('[data-page]')).toHaveLength(1))
      expect(pdf.opened).toEqual(['/api/documents/doc-1/file'])
      expect(container.querySelector('iframe')).toBeNull()
      expect(screen.getByRole('group', { name: 'plan.pdf' })).toBeInTheDocument()
    })

    it('opens one document at a time: the enlarged view borrows it from the pane', async () => {
      const user = userEvent.setup()
      presigned()
      render(<FilePreviewPane file={mockFile} projectId="proj-1" showMetadataPanel={false} />)
      await screen.findByRole('group', { name: 'plan.pdf' })

      await user.click(screen.getByRole('button', { name: /open large preview/i }))

      await screen.findByRole('link', { name: /open in new tab/i })
      await waitFor(() => expect(screen.getAllByTestId('pdf-scroll')).toHaveLength(1))
      expect(within(screen.getByRole('dialog')).getByTestId('pdf-scroll')).toBeInTheDocument()
    })

    it('asks for passages like a selection, and opens them beside the document', async () => {
      pdf.pages = [{ items: [fakeTextRun('Die Fluchttreppe wird als Außentreppe ausgeführt', 700, 300)] }]
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
        String(input) === '/api/passages/similar'
          ? new Response(JSON.stringify({ origin: 'embedded', projectsSearched: 0, groups: [] }), { status: 200 })
          : ({ ok: true, status: 200, json: async () => ({ url: 'https://example.test/plan.pdf' }) } as Response)
      )
      render(<FilePreviewPane file={mockFile} projectId="proj-1" />)
      await selectRenderedText('Die Fluchttreppe wird als Außentreppe ausgeführt')
      fireEvent.pointerUp(screen.getByTestId('pdf-scroll'))
      fireEvent.click(await screen.findByTestId('pdf-find-similar'))

      expect(await screen.findByText('Not handled in your office yet')).toBeInTheDocument()
      const call = fetchMock.mock.calls.find(([input]) => String(input) === '/api/passages/similar')
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        document: { kind: 'stored', documentId: 'doc-1' },
        passage: { text: 'Die Fluchttreppe wird als Außentreppe ausgeführt', page: 1, cited: false },
        projectId: 'proj-1',
      })
    })

    it('offers no similar passages in a document the agent has not read', async () => {
      pdf.pages = [{ items: [fakeTextRun('Die Fluchttreppe wird als Außentreppe ausgeführt', 700, 300)] }]
      presigned()
      render(<FilePreviewPane file={{ ...mockFile, status: 'processing' }} projectId="proj-1" />)
      await selectRenderedText('Die Fluchttreppe wird als Außentreppe ausgeführt')
      fireEvent.pointerUp(screen.getByTestId('pdf-scroll'))
      expect(screen.queryByTestId('pdf-find-similar')).toBeNull()
    })

    it('says it could not load, and retries, when the viewer cannot open the bytes', async () => {
      const user = userEvent.setup()
      presigned()
      pdf.fail = true
      const { container } = render(<FilePreviewPane file={mockFile} projectId="proj-1" />)

      expect(await screen.findByText(/preview couldn't be loaded/i)).toBeInTheDocument()
      expect(container.querySelector('iframe')).toBeNull()
      expect(screen.queryByRole('button', { name: /open large preview/i })).toBeNull()

      pdf.fail = false
      await user.click(screen.getByRole('button', { name: /try again/i }))
      await waitFor(() => expect(container.querySelectorAll('[data-page]')).toHaveLength(1))
    })
  })

  describe('a PDF in a well that is not on screen yet', () => {
    useInlineViewer({ intersecting: false })

    it('does not start pdf.js for a document nobody can see', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ url: 'https://example.test/plan.pdf' }),
      } as Response)
      render(<FilePreviewPane file={mockFile} projectId="proj-1" />)

      await screen.findByRole('button', { name: 'Open review' })
      expect(screen.queryByTestId('pdf-scroll')).toBeNull()
      expect(pdf.opened).toEqual([])
    })
  })

  describe('an office file, through its PDF rendition (ADR-0070)', () => {
    useInlineViewer()
    afterEach(() => vi.unstubAllGlobals())

    const docx = {
      ...mockFile,
      filename: 'Raumprogramm.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }
    const rendition = {
      ok: true,
      status: 200,
      json: async () => ({
        url: 'https://example.test/_render.pdf',
        contentType: 'application/pdf',
        rendition: true,
        sourceContentType: docx.contentType,
      }),
    }

    it('says the PDF is being made while the preview route converts', async () => {
      const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
      vi.stubGlobal('fetch', fetchMock)
      render(<FilePreviewPane file={docx} projectId="proj-1" />)

      expect(await screen.findByText('Creating PDF preview…')).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-1/preview', expect.anything())
    })

    it('shows the rendition in the PDF viewer, says so, and opens it as the review', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rendition))
      const { container } = render(<FilePreviewPane file={docx} projectId="proj-1" />)

      expect(await screen.findByRole('button', { name: 'Open review' })).toBeInTheDocument()
      await waitFor(() => expect(container.querySelectorAll('[data-page]')).toHaveLength(1))
      expect(pdf.opened).toEqual(['/api/documents/doc-1/file'])
      expect(container.querySelector('iframe')).toBeNull()
      expect(screen.getByTestId('file-preview-rendition-note')).toHaveTextContent(
        'PDF preview · Original: Raumprogramm.docx'
      )
      expect(screen.getAllByRole('button', { name: 'Download' }).length).toBeGreaterThan(0)
    })

    it('decides by the extension when the stored type is empty', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rendition))
      const { container } = render(
        <FilePreviewPane file={{ ...docx, contentType: null }} projectId="proj-1" />
      )

      await screen.findByRole('button', { name: 'Open review' })
      await waitFor(() => expect(container.querySelectorAll('[data-page]')).toHaveLength(1))
    })

    it.each([415, 502])(
      'falls back to "no inline preview" and the download on %i',
      async (status) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }))
        render(<FilePreviewPane file={docx} projectId="proj-1" />)

        expect(await screen.findByText(/no inline preview/i)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
        expect(screen.queryByRole('button', { name: /open large preview/i })).toBeNull()
        expect(screen.queryByTestId('file-preview-rendition-note')).toBeNull()
      }
    )

    it('never draws an answer that is not a PDF', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ url: 'https://example.test/raw.docx', contentType: docx.contentType }),
        })
      )
      render(<FilePreviewPane file={docx} projectId="proj-1" />)

      expect(await screen.findByText(/no inline preview/i)).toBeInTheDocument()
      expect(screen.queryByTestId('pdf-scroll')).toBeNull()
      expect(pdf.opened).toEqual([])
    })
  })
})
