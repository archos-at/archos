import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { FilePreviewPane } from './file-preview-pane'
import { PRODUCT_NAME } from '@/lib/brand'
import { useFilePreviewStore } from '../stores/file-preview-store'
import { mockFile } from './file-preview-pane.fixtures'

describe('FilePreviewPane', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('peek presentation', () => {
    const markdownFile = {
      ...mockFile,
      id: 'doc-text',
      filename: 'notiz.md',
      contentType: 'text/markdown',
    }

    const TALL_MARKDOWN = [
      '# Fluchtwege',
      ...Array.from(
        { length: 60 },
        (_, i) => `Absatz ${i + 1}: zwei voneinander unabhängige Fluchtwege je Nutzungseinheit.`
      ),
    ].join('\n\n')

    const mockText = (text: string) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ text, truncated: false }),
      } as Response)
    }

    const renderPeekMarkdown = async (text: string) => {
      mockText(text)
      render(<FilePreviewPane file={markdownFile} presentation="peek" />)
      await screen.findByRole('heading', { name: 'Fluchtwege' })
      return screen.getByTestId('file-preview-well')
    }

    it('gives a tall markdown its own vertical scroll instead of clipping it', async () => {
      const well = await renderPeekMarkdown(TALL_MARKDOWN)

      expect(well.classList.contains('overflow-y-auto')).toBe(true)
      expect(well.classList.contains('overflow-hidden')).toBe(false)
      expect(well.classList.contains('scroll-fade-bottom')).toBe(true)
    })

    it('keeps a short document centred in the peek well', async () => {
      const well = await renderPeekMarkdown('# Fluchtwege\n\nKurz.')

      expect(well.classList.contains('justify-center')).toBe(true)
      expect(well.classList.contains('[&>*]:my-auto')).toBe(true)
      expect(well.classList.contains('items-center')).toBe(false)
    })

    it('shows the document alone: no tab row, and what was read sits in the details behind ⓘ', async () => {
      useFilePreviewStore.setState({ peekDetails: false })
      mockText('# Fluchtwege\n\nKurz.')
      render(<FilePreviewPane file={{ ...markdownFile, summary: 'Fluchtwegkonzept des Erdgeschosses.' }} presentation="peek" />)
      await screen.findByRole('heading', { name: 'Fluchtwege' })

      expect(screen.queryByRole('tablist')).toBeNull()
      expect(screen.queryByRole('tab')).toBeNull()
      expect(screen.getByTestId('file-peek-document')).toBeVisible()
      expect(screen.getByTestId('file-peek-details')).not.toBeVisible()
      expect(screen.queryByTestId('file-peek-summary')).toBeNull()

      act(() => useFilePreviewStore.getState().setPeekDetails(true))

      const details = screen.getByTestId('file-peek-details')
      expect(details).toBeVisible()
      expect(screen.getByTestId('file-peek-document')).not.toBeVisible()
      expect(within(details).getByText(`Read by ${PRODUCT_NAME}`)).toBeInTheDocument()
      expect(within(details).getByText('Fluchtwegkonzept des Erdgeschosses.')).toBeInTheDocument()
      act(() => useFilePreviewStore.getState().setPeekDetails(false))
    })

    it('leaves the modal/stacked well alone', async () => {
      mockText(TALL_MARKDOWN)
      render(<FilePreviewPane file={markdownFile} projectId="proj-1" />)

      await screen.findByRole('heading', { name: 'Fluchtwege' })
      const well = screen.getByTestId('file-preview-well')

      expect(well.classList.contains('overflow-y-auto')).toBe(false)
      expect(well.classList.contains('overflow-hidden')).toBe(true)
      expect(well.classList.contains('h-[50dvh]')).toBe(true)
    })
  })
})
