import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilePreviewPane } from './file-preview-pane'
import { mockFile } from './file-preview-pane.fixtures'

describe('FilePreviewPane', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('offers the expand affordance for an image once its preview URL has loaded (FB-15a)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://example.test/diagram.png' }),
    } as Response)

    render(
      <FilePreviewPane
        file={{ ...mockFile, filename: 'diagram.png', contentType: 'image/png' }}
        projectId="proj-1"
      />
    )

    await waitFor(() => expect(screen.getByAltText('diagram.png')).toBeDefined())
    expect(await screen.findByRole('button', { name: /open large preview/i })).toBeDefined()
  })

  it('falls back to the failed caption and a retry action when the preview image cannot load', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://example.test/expired.png' }),
    } as Response)

    render(
      <FilePreviewPane
        file={{ ...mockFile, filename: 'diagram.png', contentType: 'image/png' }}
        projectId="proj-1"
      />
    )

    fireEvent.error(await screen.findByAltText('diagram.png'))

    expect(await screen.findByText(/preview couldn't be loaded/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /try again/i })).toBeDefined()
  })

  it('opens the large preview dialog for an image when the expand affordance is clicked', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://example.test/diagram.png' }),
    } as Response)

    render(
      <FilePreviewPane file={{ ...mockFile, filename: 'diagram.png', contentType: 'image/png' }} projectId="proj-1" />
    )

    await user.click(await screen.findByRole('button', { name: /open large preview/i }))

    expect(await screen.findByRole('link', { name: /open in new tab/i })).toBeDefined()
  })

  it('does not offer the expand affordance for a non-previewable file', async () => {
    render(
      <FilePreviewPane
        file={{ ...mockFile, filename: 'notes.txt', contentType: 'text/plain' }}
        projectId="proj-1"
      />
    )

    expect(screen.queryByRole('button', { name: /open large preview/i })).toBeNull()
  })

  describe('a document that is not there any more', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('says so, and offers the one move left instead of a retry that cannot work', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
      render(<FilePreviewPane file={mockFile} projectId="proj-1" />)

      expect(await screen.findByText(/no longer available/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /stop asking about it/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
    })

    it('still offers the retry for a failure that might not repeat', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
      render(<FilePreviewPane file={mockFile} projectId="proj-1" />)

      expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
      expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument()
    })
  })

  it('never shows a previous document\'s late preview under the next one', async () => {
    const pending = new Map<string, (r: Response) => void>()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const url = String(input)
          pending.set(url, resolve)
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          )
        })
    )
    const answer = (url: string) =>
      ({ ok: true, status: 200, json: async () => ({ url }) }) as Response
    const image = { ...mockFile, filename: 'a.png', contentType: 'image/png' }

    const { rerender } = render(<FilePreviewPane file={image} projectId="proj-1" />)
    rerender(<FilePreviewPane file={{ ...image, id: 'doc-2', filename: 'b.png' }} projectId="proj-1" />)

    pending.get('/api/documents/doc-2/preview')?.(answer('https://example.test/b.png'))
    await waitFor(() =>
      expect(screen.getByAltText('b.png').getAttribute('src')).toBe('https://example.test/b.png')
    )
    pending.get('/api/documents/doc-1/preview')?.(answer('https://example.test/a.png'))
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.getByAltText('b.png').getAttribute('src')).toBe('https://example.test/b.png')
  })

  describe('a next file whose preview fails', () => {
    const image = { ...mockFile, filename: 'a.png', contentType: 'image/png' }
    const next = { ...image, id: 'doc-2', filename: 'b.png' }
    const serve = (second: Partial<Response>) =>
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
        String(input) === '/api/documents/doc-1/preview'
          ? ({ ok: true, status: 200, json: async () => ({ url: 'https://example.test/a.png' }) } as Response)
          : (second as Response)
      )

    it('shows no picture of the previous file, and offers the retry', async () => {
      serve({ ok: false, status: 500 })
      const { rerender } = render(<FilePreviewPane file={image} projectId="proj-1" />)
      await screen.findByAltText('a.png')

      rerender(<FilePreviewPane file={next} projectId="proj-1" />)

      expect(await screen.findByText(/preview couldn't be loaded/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
      expect(screen.queryByRole('img', { name: 'b.png' })).toBeNull()
      expect(document.querySelector('img[src="https://example.test/a.png"]')).toBeNull()
    })

    it('says a next file that is gone is gone', async () => {
      serve({ ok: false, status: 404 })
      const { rerender } = render(<FilePreviewPane file={image} projectId="proj-1" />)
      await screen.findByAltText('a.png')

      rerender(<FilePreviewPane file={next} projectId="proj-1" />)

      expect(await screen.findByText(/no longer available/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /stop asking about it/i })).toBeInTheDocument()
      expect(document.querySelector('img[src="https://example.test/a.png"]')).toBeNull()
    })
  })
})
