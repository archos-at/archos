import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import {
  FAKE_FRAME_WIDTH,
  fakePdfjsRuntime,
  fakeTextRun as run,
  type FakePdfState,
} from '@/test-utils/pdfjs-fake'
import { PdfDocumentView } from './pdf-document-view'
import { capturePosthog } from '@/lib/analytics/posthog'

vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))

const state = vi.hoisted((): FakePdfState => ({ fail: false, pages: [], destroyed: 0 }))

vi.mock('../lib/pdfjs-runtime', () => fakePdfjsRuntime(state))

const restoreObservers = { current: () => {} }

beforeEach(() => {
  vi.mocked(capturePosthog).mockClear()
  state.fail = false
  state.destroyed = 0
  state.pages = []
  state.password = undefined
  restoreObservers.current = installLayoutObservers({ frameWidth: FAKE_FRAME_WIDTH })
})

afterEach(() => {
  restoreObservers.current()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PdfDocumentView', () => {
  describe('finding words in the document', () => {
    beforeEach(() => {
      state.pages = [
        { items: [run('Zwei Fluchtwege je Nutzungseinheit', 700, 220)] },
        { items: [run('Brandabschnitte und Trennwände', 700, 200)] },
        { items: [run('Der zweite FLUCHTWEG führt über das Fenster', 700, 260)] },
      ]
    })

    it('opens on Cmd+F inside the viewer, counts every hit and walks them', async () => {
      render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
      await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(3))

      fireEvent.keyDown(screen.getByTestId('pdf-scroll'), { key: 'f', metaKey: true })
      const field = await screen.findByRole('searchbox', { name: 'Search term' })
      fireEvent.change(field, { target: { value: 'fluchtweg' } })

      await waitFor(() => expect(screen.getByTestId('pdf-search-count')).toHaveTextContent('1 of 2'))
      expect(screen.getAllByTestId('search-mark')).toHaveLength(2)
      expect(document.querySelectorAll('[data-testid="search-mark"][data-active]')).toHaveLength(1)

      fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
      expect(screen.getByTestId('pdf-search-count')).toHaveTextContent('2 of 2')
      fireEvent.keyDown(field, { key: 'Enter' })
      expect(screen.getByTestId('pdf-search-count')).toHaveTextContent('1 of 2')

      fireEvent.keyDown(field, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByTestId('pdf-search-bar')).toBeNull())
      expect(screen.queryAllByTestId('search-mark')).toHaveLength(0)
    })

    it('says so when nothing matches', async () => {
      render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
      fireEvent.click(await screen.findByRole('button', { name: 'Find in document' }))
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search term' }), {
        target: { value: 'Stellplatz' },
      })
      await waitFor(() => expect(screen.getByTestId('pdf-search-count')).toHaveTextContent('No matches'))
    })
  })
})
