import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilePreviewPane } from './file-preview-pane'
import { mockFile } from './file-preview-pane.fixtures'

describe('FilePreviewPane', () => {
  describe('a file held back by the content check (ADR-0086)', () => {
    const HELD = {
      ...mockFile,
      status: 'quarantined',
      errorMessage:
        'quarantined:{"reasons":[{"kind":"term","term":"Lohnzettel","count":2,"pages":[2,5]}],"checked":"full"}',
    }

    const stubHeld = (access: { canReview: boolean; canAskForReview: boolean }) => {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/documents/doc-1/quarantine') return Response.json(access)
        if (url === '/api/documents/doc-1/quarantine/release' && init?.method === 'POST') {
          return Response.json({ id: 'doc-1', status: 'uploaded', jobId: 'job-1' })
        }
        if (url === '/api/documents/doc-1/quarantine/request-release' && init?.method === 'POST') {
          return Response.json({ id: 'doc-1', notified: 2 })
        }
        if (url === '/api/documents/doc-1' && init?.method === 'DELETE') return new Response(null, { status: 204 })
        return new Response(null, { status: 404 })
      })
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }
    const called = (fetchMock: ReturnType<typeof stubHeld>, url: string, method: string): boolean =>
      fetchMock.mock.calls.some(([calledUrl, init]) => calledUrl === url && init?.method === method)

    afterEach(() => vi.unstubAllGlobals())

    it('offers a reviewer „Zulassen", asks first, and shows the file being read once allowed', async () => {
      const fetchMock = stubHeld({ canReview: true, canAskForReview: false })
      const onReingested = vi.fn()
      const user = userEvent.setup()
      render(<FilePreviewPane file={HELD} projectId="proj-1" onReingested={onReingested} />)

      await user.click(await screen.findByTestId('preview-held-release'))
      expect(screen.getByRole('dialog')).toHaveTextContent(/language models see its content/)
      expect(called(fetchMock, '/api/documents/doc-1/quarantine/release', 'POST')).toBe(false)
      expect(screen.queryByTestId('preview-held-request-review')).toBeNull()

      await user.click(screen.getByTestId('preview-held-release-confirm'))
      await waitFor(() => expect(onReingested).toHaveBeenCalledWith('doc-1', 'uploaded'))
      expect(called(fetchMock, '/api/documents/doc-1/quarantine/release', 'POST')).toBe(true)
    })

    it("lets a reviewer delete it with the document's own delete question, and closes", async () => {
      const fetchMock = stubHeld({ canReview: true, canAskForReview: false })
      const onDeleted = vi.fn()
      const onClose = vi.fn()
      const user = userEvent.setup()
      render(<FilePreviewPane file={HELD} projectId="proj-1" onDeleted={onDeleted} onClose={onClose} />)

      await user.click(await screen.findByTestId('preview-held-delete'))
      await user.click(await screen.findByTestId('document-delete-confirm'))

      await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('doc-1'))
      expect(onClose).toHaveBeenCalled()
      expect(called(fetchMock, '/api/documents/doc-1', 'DELETE')).toBe(true)
    })

    it('offers the uploader who may not decide „Prüfung anfragen" instead', async () => {
      const fetchMock = stubHeld({ canReview: false, canAskForReview: true })
      const user = userEvent.setup()
      render(<FilePreviewPane file={HELD} projectId="proj-1" />)

      const ask = await screen.findByTestId('preview-held-request-review')
      expect(ask).toHaveTextContent('Ask for a review')
      expect(screen.queryByTestId('preview-held-release')).toBeNull()
      expect(screen.queryByTestId('preview-held-delete')).toBeNull()

      await user.click(ask)
      await waitFor(() => expect(ask).toHaveTextContent('Review requested'))
      expect(called(fetchMock, '/api/documents/doc-1/quarantine/request-release', 'POST')).toBe(true)
    })

    it('offers nothing to a reader who may do neither, and still says what was found', async () => {
      const fetchMock = stubHeld({ canReview: false, canAskForReview: false })
      render(<FilePreviewPane file={HELD} projectId="proj-1" />)

      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([url]) => url === '/api/documents/doc-1/quarantine')).toBe(true)
      )
      expect(within(screen.getByTestId('preview-held')).getByTestId('preview-held-findings')).toBeInTheDocument()
      expect(screen.queryByTestId('preview-held-review')).toBeNull()
      expect(screen.queryByTestId('preview-held-request-review')).toBeNull()
    })
  })
})
