import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, screen, waitFor } from '@/test-utils'
import { toast } from 'sonner'
import { EMPTY_REVISION_LINKS } from '@/lib/documents/revision-links'
import { requestRevisionLink } from '../lib/revision-request'
import { answer, copy, facts, fileFixture, fill, ref, renderSection } from './document-revisions.fixtures'

vi.mock('../lib/revision-request', () => ({
  requestRevisionLink: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(requestRevisionLink).mockReset()
  vi.mocked(toast.error).mockClear()
})

describe('DocumentRevisions — the agent’s suggestion', () => {
  const suggested = (basis: 'name' | 'content' | 'title_block', reason = '') =>
    fileFixture({
      revision: facts({ suggestion: { of: ref('doc_0', 'Grundriss_B.pdf'), confidence: 0.9, reason, basis } }),
    })
  const confirmLabel = copy.preview.revision.confirm
  const dismissLabel = copy.preview.revision.dismiss

  it('names the older document and says what the suggestion rests on', async () => {
    const { unmount } = renderSection({ file: suggested('name') })
    const card = await screen.findByTestId('revision-suggestion')
    expect(card).toHaveTextContent(fill(copy.preview.revision.suggestion, { name: 'Grundriss_B.pdf' }))
    expect(card).toHaveTextContent(copy.preview.revision.basisName)
    unmount()

    renderSection({ file: suggested('title_block') })
    expect(await screen.findByTestId('revision-suggestion')).toHaveTextContent(copy.preview.revision.basisTitleBlock)
  })

  it('says the agent read both documents when the basis is the content, and adds its reason', async () => {
    renderSection({ file: suggested('content', 'Gleicher Grundriss, neue Maße.') })

    const card = await screen.findByTestId('revision-suggestion')
    expect(card).toHaveTextContent(`${copy.preview.revision.basisContent} Gleicher Grundriss, neue Maße.`)
    expect(card).not.toHaveTextContent(copy.preview.revision.basisName)
  })

  it('confirms through requestRevisionLink with linked=true, shows the facts it returns, and reports both sides', async () => {
    const user = userEvent.setup()
    const returned = facts({ supersedes: [ref('doc_0', 'Grundriss_B.pdf')] })
    const olderFacts = facts({ supersededBy: ref('doc_1', 'Grundriss_C.pdf') })
    vi.mocked(requestRevisionLink).mockResolvedValueOnce(answer(returned, olderFacts))
    const onRevisionChanged = vi.fn()
    renderSection({ file: suggested('name'), canManage: true, onRevisionChanged })

    await user.click(await screen.findByRole('button', { name: confirmLabel }))

    expect(requestRevisionLink).toHaveBeenCalledWith('doc_1', 'doc_0', true)
    await waitFor(() => expect(screen.getByTestId('revision-timeline')).toHaveTextContent('Grundriss_B.pdf'))
    expect(screen.queryByTestId('revision-suggestion')).toBeNull()
    expect(onRevisionChanged).toHaveBeenCalledWith('doc_1', returned)
    expect(onRevisionChanged).toHaveBeenCalledWith('doc_0', olderFacts)
  })

  it('dismisses with linked=false and takes the section away when nothing else is left', async () => {
    const user = userEvent.setup()
    vi.mocked(requestRevisionLink).mockResolvedValueOnce(answer(EMPTY_REVISION_LINKS))
    const { container } = renderSection({ file: suggested('name'), canManage: true })

    await user.click(await screen.findByRole('button', { name: dismissLabel }))

    expect(requestRevisionLink).toHaveBeenCalledWith('doc_1', 'doc_0', false)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('disables both answers while the request is in flight', async () => {
    const user = userEvent.setup()
    const pending = deferred<ReturnType<typeof answer>>()
    vi.mocked(requestRevisionLink).mockReturnValueOnce(pending.promise)
    renderSection({ file: suggested('name'), canManage: true })

    await user.click(await screen.findByRole('button', { name: confirmLabel }))

    expect(screen.getByRole('button', { name: confirmLabel })).toBeDisabled()
    expect(screen.getByRole('button', { name: dismissLabel })).toBeDisabled()
    await act(async () => pending.resolve(answer(EMPTY_REVISION_LINKS)))
  })

  it('reports a refused request with a toast and keeps the suggestion for another try', async () => {
    const user = userEvent.setup()
    vi.mocked(requestRevisionLink).mockRejectedValueOnce(new Error('409 conflict'))
    renderSection({ file: suggested('name'), canManage: true })

    await user.click(await screen.findByRole('button', { name: confirmLabel }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(copy.preview.revision.saveError))
    expect(screen.getByTestId('revision-suggestion')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: confirmLabel })).toBeEnabled()
  })

  it('shows neither answer, but says who may answer, to a reader who may not manage the folder', async () => {
    renderSection({ file: suggested('name'), canManage: false })

    await screen.findByTestId('revision-suggestion')
    expect(screen.queryByRole('button', { name: confirmLabel })).toBeNull()
    expect(screen.queryByRole('button', { name: dismissLabel })).toBeNull()
    expect(screen.getByText(copy.preview.revision.askEditor)).toBeInTheDocument()
  })
})
