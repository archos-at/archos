import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, screen, waitFor } from '@/test-utils'
import { EMPTY_REVISION_LINKS } from '@/lib/documents/revision-links'
import { requestRevisionLink } from '../lib/revision-request'
import {
  answer,
  facts,
  fileFixture,
  openRowMenu,
  ref,
  renderOpen,
  renderSection,
  section,
} from './document-revisions.fixtures'

vi.mock('../lib/revision-request', () => ({
  requestRevisionLink: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(requestRevisionLink).mockReset()
})

describe('DocumentRevisions — links between documents', () => {
  const twoOlder = facts({
    supersedes: [ref('doc_0', 'Grundriss_A.pdf'), ref('doc_0b', 'Grundriss_B.pdf')],
  })

  it('lists the older Fassungen it replaces, this document first', async () => {
    await renderOpen({ file: fileFixture({ revision: twoOlder }) })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('aktuell'),
      expect.stringContaining('Grundriss_A.pdf'),
      expect.stringContaining('Grundriss_B.pdf'),
    ])
  })

  it('does not offer to unlink the newer file, which is the other document’s decision', async () => {
    renderSection({ file: fileFixture({ revision: facts({ supersededBy: ref('doc_2', 'Grundriss_D.pdf') }) }), canManage: true })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    await openRowMenu(rows[0])
    expect(screen.queryByTestId('revision-unlink')).toBeNull()
  })

  it('unlinks each older Fassung on its own, not only the first, and only where it is a direct predecessor', async () => {
    const user = userEvent.setup()
    const history = [
      { id: 'doc_b', filename: 'EG_Index_B_2026-07-02.pdf', createdAt: '2026-07-02T09:00:00Z', changeSummary: null },
      { id: 'doc_a', filename: 'EG_Index_A_2026-06-01.pdf', createdAt: '2026-06-01T09:00:00Z', changeSummary: null },
    ]
    vi.mocked(requestRevisionLink).mockResolvedValueOnce(answer(facts({ supersedes: [ref('doc_b', history[0].filename)] })))
    await renderOpen({
      file: fileFixture({ revision: facts({ supersedes: [ref('doc_b', history[0].filename)], history }) }),
      canManage: true,
    })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    await openRowMenu(rows[2])
    expect(screen.queryByTestId('revision-unlink')).toBeNull()
    await user.keyboard('{Escape}')

    await openRowMenu(rows[1])
    await user.click(await screen.findByTestId('revision-unlink'))
    expect(requestRevisionLink).toHaveBeenCalledWith('doc_1', 'doc_b', false)
  })

  it('hides the unlink from a reader who may not manage the folder', async () => {
    await renderOpen({ file: fileFixture({ revision: twoOlder }), canManage: false })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    await openRowMenu(rows[1])
    expect(screen.queryByTestId('revision-unlink')).toBeNull()
  })

  it('reports the facts of BOTH documents after an unlink, and goes quiet when nothing is left', async () => {
    const user = userEvent.setup()
    const onRevisionChanged = vi.fn()
    const olderFacts = facts({ supersededBy: null })
    vi.mocked(requestRevisionLink).mockResolvedValueOnce(answer(EMPTY_REVISION_LINKS, olderFacts))
    const { container } = await renderOpen({
      file: fileFixture({ revision: facts({ supersedes: [ref('doc_0', 'Grundriss_A.pdf')] }) }),
      canManage: true,
      onRevisionChanged,
    })

    await openRowMenu((await screen.findAllByTestId('revision-timeline-row'))[1])
    await user.click(await screen.findByTestId('revision-unlink'))

    await waitFor(() => expect(onRevisionChanged).toHaveBeenCalledWith('doc_1', EMPTY_REVISION_LINKS))
    expect(onRevisionChanged).toHaveBeenCalledWith('doc_0', olderFacts)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('drops a decision that answers after the rail moved to another file', async () => {
    const user = userEvent.setup()
    let resolve: (value: ReturnType<typeof answer>) => void = () => undefined
    vi.mocked(requestRevisionLink).mockReturnValueOnce(new Promise((res) => (resolve = res)))
    const { rerender } = await renderOpen({
      file: fileFixture({ revision: facts({ supersedes: [ref('doc_0', 'Grundriss_A.pdf')] }) }),
      canManage: true,
    })

    await openRowMenu((await screen.findAllByTestId('revision-timeline-row'))[1])
    await user.click(await screen.findByTestId('revision-unlink'))
    rerender(
      section({
        file: fileFixture({ id: 'doc_9', revision: facts({ supersededBy: ref('doc_8', 'Neu.pdf') }) }),
        canManage: true,
      }),
    )
    await act(async () => resolve(answer(facts({ supersedes: [ref('doc_x', 'Fremd.pdf')] }))))

    expect((await screen.findAllByTestId('revision-timeline-row'))[0]).toHaveTextContent('Neu.pdf')
    expect(screen.queryByText(/Fremd\.pdf/)).toBeNull()
  })

  it('shows the new file’s facts, not the decision made on the previous one', async () => {
    const { rerender } = await renderOpen({
      file: fileFixture({ revision: facts({ supersedes: [ref('doc_0', 'Grundriss_A.pdf')] }) }),
    })
    expect(await screen.findByTestId('revision-timeline')).toHaveTextContent('Grundriss_A.pdf')

    rerender(section({ file: fileFixture({ id: 'doc_9', revision: facts({ supersededBy: ref('doc_8', 'Schnitt_AB.pdf') }) }) }))

    const timeline = await screen.findByTestId('revision-timeline')
    expect(timeline).toHaveTextContent('Schnitt_AB.pdf')
    expect(timeline).not.toHaveTextContent('Grundriss_A.pdf')
  })
})
