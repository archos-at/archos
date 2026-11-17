import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { FilePreviewPane } from './file-preview-pane'

describe('FilePreviewPane', () => {
  describe('text-shaped documents', () => {
    const textFile = (contentType: string, filename: string) => ({
      id: 'doc-text',
      filename,
      displayName: null,
      fileSize: 2048,
      contentType,
      status: 'ready',
      folderId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      errorMessage: null,
      summary: null,
      pageCount: null,
      chunkCount: null,
      contentTypes: null,
      tags: null,
      topics: null,
      capture: null,
    })

    it('renders a Markdown document instead of the no-preview mock', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ text: '# Fluchtwege\n\nZwei je Nutzungseinheit.', truncated: false }),
      } as Response)

      render(<FilePreviewPane file={textFile('text/markdown', 'notiz.md')} projectId="proj-1" />)

      expect(await screen.findByRole('heading', { name: 'Fluchtwege' })).toBeDefined()
      expect(screen.queryByText(/no inline preview/i)).toBeNull()
    })

    it('reads a CSV as a table, sniffing the semicolon a German export uses', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          text: 'Bauteil;U-Wert\nAußenwand;0,20\n',
          truncated: false,
        }),
      } as Response)

      render(<FilePreviewPane file={textFile('text/csv', 'katalog.csv')} projectId="proj-1" />)

      expect(await screen.findByRole('columnheader', { name: 'Bauteil' })).toBeDefined()
      expect(screen.getByRole('columnheader', { name: 'U-Wert' })).toBeDefined()
      expect(screen.getByRole('cell', { name: 'Außenwand' })).toBeDefined()
    })

    it('says so when only the beginning of a file is shown', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ text: 'Zeile eins\nZeile zwei', truncated: true }),
      } as Response)

      render(<FilePreviewPane file={textFile('text/plain', 'protokoll.txt')} projectId="proj-1" />)

      expect(await screen.findByText(/only the beginning of this file is shown/i)).toBeDefined()
    })

    it('asks the text route, not the presign route', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ text: 'x', truncated: false }),
      } as Response)

      render(<FilePreviewPane file={textFile('text/plain', 'a.txt')} projectId="proj-1" />)

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
      const asked = fetchSpy.mock.calls.map((call) => String(call[0]))
      expect(asked.some((url) => url.endsWith('/api/documents/doc-text/text'))).toBe(true)
      expect(asked.some((url) => url.endsWith('/preview'))).toBe(false)
    })

    it('offers a retry when the text fetch fails, the same way the URL path does', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response)

      render(<FilePreviewPane file={textFile('text/plain', 'a.txt')} projectId="proj-1" />)

      expect(await screen.findByRole('button', { name: /try again/i })).toBeDefined()
    })
  })
})
