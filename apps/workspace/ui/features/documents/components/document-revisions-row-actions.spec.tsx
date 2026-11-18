import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@/test-utils'
import { NotComparableError } from './revision-compare/types'
import {
  clientOf,
  copy,
  facts,
  fileFixture,
  fill,
  makeVersion,
  openRowMenu,
  ref,
  renderOpen,
  reviewed,
  reviewer,
  viewOnly,
} from './document-revisions.fixtures'

const compareOpened = vi.hoisted(() => vi.fn())

vi.mock('./revision-compare', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./revision-compare')>()
  return {
    ...actual,
    useRevisionCompare: (...args: Parameters<typeof actual.useRevisionCompare>) => {
      const handle = actual.useRevisionCompare(...args)
      return {
        ...handle,
        openRevisionCompare: (...pair: Parameters<typeof handle.openRevisionCompare>) => {
          compareOpened(...pair)
          handle.openRevisionCompare(...pair)
        },
      }
    },
  }
})

describe('DocumentRevisions — one visible action per row, the rest behind ⋯', () => {
  it('shows Öffnen on an earlier upload and keeps Herunterladen behind its ⋯; the current one has no Öffnen', async () => {
    await renderOpen({
      file: fileFixture({ versionCount: 2 }),
      viewer: reviewer,
      client: clientOf([makeVersion(1, 'superseded'), makeVersion(2, 'published')]),
    })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(within(rows[0]).queryByTestId('revision-version-open')).toBeNull()
    expect(within(rows[1]).getByTestId('revision-version-open')).toHaveAttribute('href', '/api/documents/doc_1/file?versionId=ver_1')
    expect(screen.queryByTestId('revision-version-download')).toBeNull()

    await openRowMenu(rows[1])
    expect(await screen.findByTestId('revision-version-download')).toHaveAttribute(
      'href',
      '/api/documents/doc_1/file?versionId=ver_1&download=1',
    )
  })

  it('offers neither Öffnen, Herunterladen nor a comparison of an earlier upload this reader may not receive (ADR-0086)', async () => {
    await renderOpen({
      file: fileFixture({ versionCount: 2 }),
      viewer: reviewer,
      client: clientOf([makeVersion(1, 'superseded', { bytesReadable: false }), makeVersion(2, 'published')]),
    })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(rows).toHaveLength(2)
    expect(screen.queryByTestId('revision-version-open')).toBeNull()
    for (const row of rows) {
      if (!within(row).queryByTestId('revision-row-menu')) continue
      await openRowMenu(row)
      expect(screen.queryByTestId('revision-version-download')).toBeNull()
      expect(screen.queryByTestId('document-version-compare')).toBeNull()
      await userEvent.keyboard('{Escape}')
    }
  })

  it('shows a member Öffnen on the screened earlier upload and not on the one no verdict passed (migration 0131)', async () => {
    await renderOpen({
      file: fileFixture({ versionCount: 3 }),
      viewer: viewOnly,
      client: clientOf([
        makeVersion(1, 'superseded', { bytesReadable: true }),
        makeVersion(2, 'superseded', { bytesReadable: false }),
        makeVersion(3, 'published', { bytesReadable: true }),
      ]),
    })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[1]).queryByTestId('revision-version-open')).toBeNull()
    expect(within(rows[2]).getByTestId('revision-version-open')).toHaveAttribute('href', '/api/documents/doc_1/file?versionId=ver_1')
    await openRowMenu(rows[2])
    expect(await screen.findByTestId('revision-version-download')).toHaveAttribute(
      'href',
      '/api/documents/doc_1/file?versionId=ver_1&download=1',
    )
  })

  it('opens a version that was never published as text, and offers no download of it', async () => {
    await renderOpen({ viewer: reviewer, client: clientOf([makeVersion(1, 'published'), reviewed(2, 'draft')]) })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(within(rows[0]).getByTestId('revision-version-open')).toHaveAttribute('href', '/api/documents/doc_1/versions/ver_2/content')
    await openRowMenu(rows[0])
    expect(screen.queryByTestId('revision-version-download')).toBeNull()
    expect(screen.getByTestId('document-version-compare')).toBeInTheDocument()
  })

  it('compares the text with the one before, from the ⋯, and numbers both as the timeline does', async () => {
    const diff = vi.fn().mockResolvedValue({
      from: { version: makeVersion(1, 'superseded'), content: 'alte Fassung' },
      to: { version: makeVersion(2, 'published'), content: 'neue Fassung' },
    })
    const history = [{ id: 'doc_a', filename: 'EG_Index_A.pdf', createdAt: '2026-06-01T09:00:00Z', changeSummary: null }]
    await renderOpen({
      file: fileFixture({ versionCount: 2, revision: facts({ history }) }),
      viewer: reviewer,
      client: clientOf([makeVersion(1, 'superseded'), makeVersion(2, 'published')], { diff }),
    })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    await openRowMenu(rows[0])
    const compare = await screen.findByTestId('document-version-compare')
    expect(compare).toHaveTextContent(fill(copy.preview.revision.versions.compareText, { number: 2 }))
    await userEvent.click(compare)

    await waitFor(() => expect(diff).toHaveBeenCalledWith('doc_1', 'ver_1', 'ver_2'))
    const comparison = await within(rows[0]).findByTestId('document-version-comparison')
    expect(comparison).toHaveTextContent('Fassung 2 → Fassung 3')
    expect(comparison).toHaveTextContent('1 Zeile hinzugefügt')
    expect(
      within(comparison).getAllByTestId('document-version-diff-row').map((row) => row.getAttribute('data-kind')),
    ).toEqual(['removed', 'added'])
  })

  it('compares every upload with its TRUE predecessor, at any depth, and the oldest has none', async () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      makeVersion(index + 1, index === 59 ? 'published' : 'superseded', {
        createdAt: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
      }),
    )
    const diff = vi.fn().mockRejectedValue(new Error('nope'))
    await renderOpen({ file: fileFixture({ versionCount: 60 }), viewer: reviewer, client: clientOf(many, { diff }) })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(rows).toHaveLength(60)
    expect(rows[0]).toHaveAttribute('data-version', '60')
    expect(rows[59]).toHaveAttribute('data-version', '1')
    await openRowMenu(rows[0])
    await userEvent.click(await screen.findByTestId('document-version-compare'))
    expect(diff).toHaveBeenCalledWith('doc_1', 'ver_59', 'ver_60')
    expect(await within(rows[0]).findByTestId('document-version-compare-failed')).toBeInTheDocument()
    expect(screen.getAllByTestId('revision-timeline-row')).toHaveLength(60)
    await openRowMenu(rows[59])
    expect(screen.queryByTestId('document-version-compare')).toBeNull()
  })

  it('opens a linked document from its row', async () => {
    const user = userEvent.setup()
    const onOpenDocument = vi.fn()
    const history = [{ id: 'doc_a', filename: 'EG_Index_A_2026-06-01.pdf', createdAt: '2026-06-01T09:00:00Z', changeSummary: null }]
    await renderOpen({
      file: fileFixture({ revision: facts({ supersedes: [ref('doc_a', history[0].filename)], history }) }),
      onOpenDocument,
    })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    await user.click(within(rows[1]).getByRole('button', { name: 'Öffnen' }))
    expect(onOpenDocument).toHaveBeenCalledWith('doc_a')
  })

  it('opens the visual comparison with exactly that row’s document as the older Fassung and this one as the newer', async () => {
    const user = userEvent.setup()
    compareOpened.mockClear()
    const history = [
      { id: 'doc_b', filename: 'EG_Index_B_2026-07-02.pdf', createdAt: '2026-07-02T09:00:00Z', changeSummary: null },
      { id: 'doc_a', filename: 'EG_Index_A_2026-06-01.pdf', createdAt: '2026-06-01T09:00:00Z', changeSummary: null },
    ]
    await renderOpen({
      file: fileFixture({ filename: 'EG_Index_C_2026-08-14.pdf', revision: facts({ supersedes: [ref('doc_b', history[0].filename)], history }) }),
      compareSource: () => new Promise(() => undefined),
    })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    await openRowMenu(rows[2])
    await user.click(await screen.findByRole('menuitem', { name: 'Vergleichen' }))

    expect(compareOpened).toHaveBeenCalledTimes(1)
    expect(compareOpened).toHaveBeenCalledWith(
      { id: 'doc_a', filename: 'EG_Index_A_2026-06-01.pdf' },
      { id: 'doc_1', filename: 'EG_Index_C_2026-08-14.pdf' },
    )
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('turns two Fassungen that cannot be laid over each other into a text comparison under their row', async () => {
    const user = userEvent.setup()
    const texts: Record<string, string> = { doc_a: 'Fluchtweg 40 m', doc_1: 'Fluchtweg 35 m' }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const id = String(input).match(/documents\/([^/]+)\/text/)?.[1] ?? ''
      return new Response(JSON.stringify({ text: texts[id], truncated: false }), { status: 200 })
    })
    const history = [{ id: 'doc_a', filename: 'Brandschutz_Index_A.md', createdAt: '2026-06-01T09:00:00Z', changeSummary: null }]
    try {
      await renderOpen({
        file: fileFixture({ filename: 'Brandschutz_Index_B.md', revision: facts({ supersedes: [ref('doc_a', history[0].filename)], history }) }),
        compareSource: async () => {
          throw new NotComparableError()
        },
      })

      const rows = await screen.findAllByTestId('revision-timeline-row')
      await openRowMenu(rows[1])
      await user.click(await screen.findByRole('menuitem', { name: 'Vergleichen' }))
      const notice = await screen.findByTestId('compare-not-comparable', undefined, { timeout: 10_000 })
      await user.click(within(notice).getByRole('button', { name: copy.compare.openTextCompare }))

      expect(fetchSpy).toHaveBeenCalledWith('/api/documents/doc_a/text', undefined)
      expect(fetchSpy).toHaveBeenCalledWith('/api/documents/doc_1/text', undefined)
      const comparison = await within(rows[1]).findByTestId('document-version-comparison')
      expect(comparison).toHaveTextContent('Fassung 1 → Fassung 2')
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('offers no visual comparison on the current Fassung, which has nothing to compare with itself', async () => {
    const history = [{ id: 'doc_a', filename: 'EG_Index_A_2026-06-01.pdf', createdAt: '2026-06-01T09:00:00Z', changeSummary: null }]
    await renderOpen({ file: fileFixture({ revision: facts({ supersedes: [ref('doc_a', history[0].filename)], history }) }) })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(within(rows[0]).queryByTestId('revision-row-menu')).toBeNull()
  })
})
