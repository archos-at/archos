import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilePreviewPane } from './file-preview-pane'
import { PRODUCT_NAME } from '@/lib/brand'
import { mockFile } from './file-preview-pane.fixtures'

describe('FilePreviewPane', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('the "Read by" panel', () => {
    it('renders the AI summary and the reading facts inside the panel when present', () => {
      render(
        <FilePreviewPane
          file={{
            ...mockFile,
            summary: 'A ground-floor plan of the east wing.',
            pageCount: 4,
            chunkCount: 12,
            contentTypes: ['text', 'table'],
            tags: ['Grundriss'],
          }}
          projectId="proj-1"
        />
      )
      const panel = within(screen.getByRole('region', { name: `Read by ${PRODUCT_NAME}` }))
      expect(panel.getByText('A ground-floor plan of the east wing.')).toBeInTheDocument()
      expect(panel.getByText('4 pages read · Text, Tables')).toBeInTheDocument()
      expect(panel.getByText(`${PRODUCT_NAME} reads this as`)).toBeInTheDocument()
      expect(panel.getByText('Floor plan')).toBeInTheDocument()
      expect(panel.queryByText('Pages')).toBeNull()
      expect(panel.queryByText('Passages')).toBeNull()
      expect(panel.queryByText('Contents')).toBeNull()
    })

    it('shows the reading in the panel for a citable document that has no summary', () => {
      render(<FilePreviewPane file={{ ...mockFile, tags: ['Grundriss'] }} projectId="proj-1" />)

      const panel = within(screen.getByRole('region', { name: `Read by ${PRODUCT_NAME}` }))
      expect(panel.getByText(`${PRODUCT_NAME} reads this as`)).toBeInTheDocument()
      expect(panel.getByText('Floor plan')).toBeInTheDocument()
    })

    it('carries no Project, Type, Size or Updated row, and no caption under the reading', () => {
      render(<FilePreviewPane file={mockFile} projectId="proj-1" projectName="Stadthaus Linz" />)
      for (const label of ['Project', 'Type', 'Size', 'Updated']) {
        expect(screen.queryByText(label)).toBeNull()
      }
      expect(screen.queryByText(/your corrections improve future answers/i)).toBeNull()
    })

    it('shows the detected category only from real metadata', () => {
      render(
        <FilePreviewPane
          file={{ ...mockFile, tags: ['Grundriss', 'Brandschutz'] }}
          projectId="proj-1"
          projectName="Stadthaus Linz"
        />
      )
      expect(screen.queryByText('Document type')).toBeNull()
      expect(screen.getAllByText('Floor plan')).toHaveLength(1)
    })

    it('omits the project row and the category chip without the metadata', () => {
      render(<FilePreviewPane file={mockFile} projectId="proj-1" />)
      expect(screen.queryByText('Floor plan')).toBeNull()
      expect(screen.queryByText('Project')).toBeNull()
      expect(screen.queryByText('Pages')).toBeNull()
      expect(screen.queryByText('Passages')).toBeNull()
    })

    it('hides the whole panel when the metadata panel is off (peek), keeping type and size', () => {
      render(
        <FilePreviewPane
          file={{
            ...mockFile,
            summary: 'A ground-floor plan of the east wing.',
            pageCount: 4,
            chunkCount: 12,
            contentTypes: ['text', 'table'],
          }}
          projectId="proj-1"
          showMetadataPanel={false}
        />
      )
      expect(screen.queryByText(`Read by ${PRODUCT_NAME}`)).toBeNull()
      expect(screen.queryByText('A ground-floor plan of the east wing.')).toBeNull()
      expect(screen.queryByText('Pages')).toBeNull()
      expect(screen.queryByText('Passages')).toBeNull()
      expect(screen.queryByText('Contents')).toBeNull()
      expect(screen.queryByText('Citable')).toBeNull()
      expect(screen.queryByText('Status')).toBeNull()
      expect(screen.getByTestId('file-preview-facts')).toHaveTextContent(/1 MB/i)
    })

    it('counts the content kinds in the facts line only when the document holds more than plain text', () => {
      const { rerender } = render(
        <FilePreviewPane file={{ ...mockFile, pageCount: 4, contentTypes: ['text'] }} projectId="proj-1" />
      )
      expect(screen.getByText('4 pages read')).toBeInTheDocument()
      expect(screen.queryByText('Text')).toBeNull()

      rerender(
        <FilePreviewPane
          file={{ ...mockFile, pageCount: 4, contentTypes: ['text', 'table'] }}
          projectId="proj-1"
        />
      )
      expect(screen.getByText('4 pages read · Text, Tables')).toBeInTheDocument()
      expect(screen.queryByText('Contents')).toBeNull()
    })
  })

  describe('the reading and its correction', () => {
    it('shows the reading as static chips, with no × and no input, until Correct is pressed', async () => {
      render(<FilePreviewPane file={{ ...mockFile, tags: ['Grundriss', 'Brandschutz'] }} projectId="proj-1" />)

      const panel = within(screen.getByRole('region', { name: `Read by ${PRODUCT_NAME}` }))
      expect(panel.getByText('Floor plan')).toBeInTheDocument()
      expect(panel.getByText('Fire safety')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Remove tag Floor plan' })).toBeNull()
      expect(screen.queryByRole('textbox', { name: /add tag/i })).toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'Correct' }))

      expect(screen.getByRole('button', { name: 'Remove tag Floor plan' })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: /add tag/i })).toBeInTheDocument()
    })

    it('saves a tag through the editor Correct opens, and hands the saved tags back to its parent', async () => {
      const user = userEvent.setup()
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
      const onTagsUpdated = vi.fn()
      const { rerender } = render(
        <FilePreviewPane file={{ ...mockFile, tags: ['Grundriss'] }} projectId="proj-1" onTagsUpdated={onTagsUpdated} />
      )

      await user.click(screen.getByRole('button', { name: 'Correct' }))
      await user.type(screen.getByRole('textbox', { name: /add tag/i }), 'Brandschutz{Enter}')

      await waitFor(() =>
        expect(onTagsUpdated).toHaveBeenCalledWith('doc-1', ['Grundriss', 'Brandschutz'])
      )
      const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/documents/doc-1/tags')
      expect(call![1]).toMatchObject({ method: 'PATCH' })
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
        tags: ['Grundriss', 'Brandschutz'],
      })

      rerender(
        <FilePreviewPane
          file={{ ...mockFile, tags: ['Grundriss', 'Brandschutz'] }}
          projectId="proj-1"
          onTagsUpdated={onTagsUpdated}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Done' }))

      expect(screen.queryByRole('textbox', { name: /add tag/i })).toBeNull()
      expect(within(screen.getByRole('region', { name: `Read by ${PRODUCT_NAME}` })).getByText('Fire safety')).toBeInTheDocument()
    })

    it('shows a read-only viewer the reading, with no Correct and no editor', () => {
      render(
        <FilePreviewPane file={{ ...mockFile, tags: ['Grundriss'] }} projectId="proj-1" canManage={false} />
      )

      expect(within(screen.getByRole('region', { name: `Read by ${PRODUCT_NAME}` })).getByText('Floor plan')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Correct' })).toBeNull()
      expect(screen.queryByRole('textbox', { name: /add tag/i })).toBeNull()
    })

    it('says the agent did not recognise a type, and offers Assign to a manager', async () => {
      render(<FilePreviewPane file={{ ...mockFile, tags: [] }} projectId="proj-1" />)

      const panel = within(screen.getByRole('region', { name: `Read by ${PRODUCT_NAME}` }))
      expect(panel.getByText(`${PRODUCT_NAME} did not recognize a document type.`)).toBeInTheDocument()

      await userEvent.click(panel.getByRole('button', { name: 'Assign' }))

      expect(screen.getByRole('textbox', { name: /add tag/i })).toBeInTheDocument()
    })

    it('offers a read-only viewer of an untagged document no Assign', () => {
      render(<FilePreviewPane file={{ ...mockFile, tags: [] }} projectId="proj-1" canManage={false} />)

      expect(screen.getByText(`${PRODUCT_NAME} did not recognize a document type.`)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull()
    })

    it('hides the reading and its tags entirely when the metadata panel is off (peek)', () => {
      render(
        <FilePreviewPane
          file={{ ...mockFile, tags: ['Grundriss', 'Brandschutz'] }}
          projectId="proj-1"
          showMetadataPanel={false}
        />
      )
      expect(screen.queryByRole('region', { name: `Read by ${PRODUCT_NAME}` })).toBeNull()
      expect(screen.queryByText('Floor plan')).toBeNull()
      expect(screen.queryByText('Fire safety')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Correct' })).toBeNull()
    })
  })

  describe('the indexed summary', () => {
    const LONG_SUMMARY =
      'Brandschutzkonzept für den Wohnbau Nord (Gebäudeklasse 4) nach OIB-Richtlinie 2. ' +
      'Zwei voneinander unabhängige Fluchtwege je Nutzungseinheit, maximale Gehweglänge 34 m, ' +
      'Brandabschnitte REI 90, Rauchableitung über die RWA im Treppenhaus.'

    const stubOverflow = (overflows: boolean) => {
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(overflows ? 200 : 100)
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
    }

    it('offers no toggle when the whole summary already fits', () => {
      stubOverflow(false)
      render(<FilePreviewPane file={{ ...mockFile, summary: 'Kurz.' }} projectId="proj-1" />)

      expect(screen.getByText('Kurz.')).toBeDefined()
      expect(screen.queryByRole('button', { name: /full summary/i })).toBeNull()
    })

    it('clamps a long summary so the properties below it stay reachable', () => {
      stubOverflow(true)
      render(<FilePreviewPane file={{ ...mockFile, summary: LONG_SUMMARY }} projectId="proj-1" />)

      expect(screen.getByText(LONG_SUMMARY).className).toContain('line-clamp-5')
      expect(screen.getByRole('button', { name: /full summary/i })).toBeDefined()
      expect(screen.getByTestId('agent-reading')).toBeInTheDocument()
    })

    it('expands and collapses on request', async () => {
      stubOverflow(true)
      const user = userEvent.setup()
      render(<FilePreviewPane file={{ ...mockFile, summary: LONG_SUMMARY }} projectId="proj-1" />)

      await user.click(screen.getByRole('button', { name: /full summary/i }))
      expect(screen.getByText(LONG_SUMMARY).className).not.toContain('line-clamp-5')

      await user.click(screen.getByRole('button', { name: /show less/i }))
      expect(screen.getByText(LONG_SUMMARY).className).toContain('line-clamp-5')
    })
  })

  describe('while the open document finishes indexing', () => {
    const detailsResponse = (details: unknown[]) =>
      ({ ok: true, json: async () => ({ details }) }) as Response
    const previewResponse = { ok: true, json: async () => ({ url: 'https://example.test/plan.pdf' }) } as Response

    it('asks for the visual descriptions again once the status moves, instead of keeping an early empty answer', async () => {
      let detailsCalls = 0
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input).includes('/visual-details')) {
          detailsCalls += 1
          return detailsCalls === 1
            ? detailsResponse([])
            : detailsResponse([{ page: 2, contentType: 'drawing', text: 'Ein Grundriss.' }])
        }
        return previewResponse
      })
      const reading = { ...mockFile, status: 'processing', contentTypes: ['text', 'drawing'] }
      const { rerender } = render(<FilePreviewPane file={reading} projectId="proj-1" />)

      await waitFor(() => expect(detailsCalls).toBe(1))
      expect(screen.queryByTestId('page-readings')).toBeNull()

      rerender(<FilePreviewPane file={{ ...reading, status: 'ready' }} projectId="proj-1" />)

      expect(await screen.findByText('Ein Grundriss.')).toBeInTheDocument()
      expect(detailsCalls).toBe(2)
    })

    it('says a failed read of the descriptions failed, and asks again on retry', async () => {
      let detailsCalls = 0
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input).includes('/visual-details')) {
          detailsCalls += 1
          return detailsCalls === 1
            ? ({ ok: false, status: 500, json: async () => ({}) } as Response)
            : detailsResponse([{ page: 1, contentType: 'drawing', text: 'Ein Schnitt.' }])
        }
        return previewResponse
      })
      render(<FilePreviewPane file={{ ...mockFile, contentTypes: ['drawing'] }} projectId="proj-1" />)

      expect(await screen.findByText('The descriptions could not be loaded.')).toBeInTheDocument()
      expect(screen.getByTestId('page-readings')).toBeInTheDocument()

      const details = screen.getByText('The descriptions could not be loaded.').parentElement!
      await userEvent.click(within(details).getByRole('button', { name: 'Try again' }))

      expect(await screen.findByText('Ein Schnitt.')).toBeInTheDocument()
      expect(detailsCalls).toBe(2)
    })

    it('adopts tags that arrive after the file was opened', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(previewResponse)
      const { rerender } = render(
        <FilePreviewPane file={{ ...mockFile, status: 'processing', tags: null }} projectId="proj-1" />
      )
      expect(screen.queryByText('Fire safety')).toBeNull()

      rerender(
        <FilePreviewPane file={{ ...mockFile, status: 'ready', tags: ['Brandschutz'] }} projectId="proj-1" />
      )

      expect(within(screen.getByRole('region', { name: `Read by ${PRODUCT_NAME}` })).getByText('Fire safety')).toBeInTheDocument()
    })

    it('says the document is still being read instead of an empty "Read by" panel', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(previewResponse)
      render(<FilePreviewPane file={{ ...mockFile, status: 'processing' }} projectId="proj-1" />)

      expect(screen.getByText(/still reading this document/i)).toBeInTheDocument()
      expect(screen.queryByText(/automatically detected on upload/i)).toBeNull()
    })

    it('shows no indexed heading or caption under a failed document', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(previewResponse)
      render(<FilePreviewPane file={{ ...mockFile, status: 'failed' }} projectId="proj-1" />)

      expect(screen.queryByRole('region', { name: `Read by ${PRODUCT_NAME}` })).toBeNull()
      expect(screen.queryByText(/still reading this document/i)).toBeNull()
      expect(screen.queryByText(/automatically detected on upload/i)).toBeNull()
    })

    it('replaces the pending line with the summary once it arrives', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(previewResponse)
      const { rerender } = render(
        <FilePreviewPane file={{ ...mockFile, status: 'processing' }} projectId="proj-1" />
      )
      rerender(
        <FilePreviewPane
          file={{ ...mockFile, status: 'ready', summary: 'Ein Brandschutzkonzept.' }}
          projectId="proj-1"
        />
      )

      expect(screen.getByText('Ein Brandschutzkonzept.')).toBeInTheDocument()
      expect(screen.queryByText(/still reading this document/i)).toBeNull()
      expect(screen.getByText(`${PRODUCT_NAME} did not recognize a document type.`)).toBeInTheDocument()
    })
  })
})
