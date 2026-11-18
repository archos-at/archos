import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@/test-utils'
import { PRODUCT_NAME } from '@/lib/brand'
import {
  clientOf,
  copy,
  facts,
  fakeClient,
  fileFixture,
  makeVersion,
  ref,
  renderOpen,
  renderSection,
  reviewed,
  reviewer,
  section,
  toggle,
  viewOnly,
} from './document-revisions.fixtures'

describe('DocumentRevisions — the header says where the newest Fassung stands', () => {
  it('gives a plain upload no state word and no track: nobody approved it, the agent answers from it', async () => {
    renderSection({
      viewer: reviewer,
      client: clientOf([makeVersion(1, 'published', { approvedBy: 'user_author', publishedBy: 'user_author' })]),
    })

    expect(await screen.findByTestId('revision-header-label')).toHaveTextContent('Fassung 1')
    expect(screen.queryByTestId('document-lifecycle-state')).toBeNull()
    expect(screen.queryByTestId('document-lifecycle-track')).toBeNull()
    expect(screen.getByTestId('revision-answer')).toHaveTextContent(`${PRODUCT_NAME} antwortet aus dieser Fassung.`)
    const act = screen.getByTestId('revision-header-act')
    expect(act).toHaveTextContent('Hochgeladen von Anna Berger · 01.09.2026')
    expect(screen.getByTestId('document-revisions')).not.toHaveTextContent('Veröffentlicht')
  })

  it('gives a Fassung that went through review its state and the four stages, named, the current one in ink', async () => {
    renderSection({
      viewer: reviewer,
      client: clientOf([reviewed(1, 'published', { approvedBy: 'user_markus', publishedBy: 'user_markus' })]),
    })

    expect(await screen.findByTestId('document-lifecycle-state')).toHaveTextContent('Veröffentlicht')
    const track = screen.getByTestId('document-lifecycle-track')
    expect([...track.querySelectorAll('[data-stage-label]')].map((label) => label.textContent)).toEqual([
      'Entwurf',
      'In Prüfung',
      'Freigegeben',
      'Veröffentlicht',
    ])
    expect(track.querySelector('[data-current]')).toHaveTextContent('Veröffentlicht')
    expect(screen.getByTestId('document-lifecycle-position')).toHaveTextContent('Schritt 4 von 4: Veröffentlicht')
  })

  it('describes the newest Fassung and names the older one the agent still answers from, so header and rows agree', async () => {
    await renderOpen({
      viewer: viewOnly,
      client: clientOf([
        reviewed(1, 'published', { approvedBy: 'user_markus', publishedBy: 'user_markus' }),
        reviewed(2, 'in_review'),
      ]),
    })

    const header = await screen.findByTestId('revision-header')
    expect(within(header).getByTestId('revision-header-label')).toHaveTextContent('Fassung 2')
    expect(within(header).getByTestId('document-lifecycle-state')).toHaveTextContent('In Prüfung')
    expect(within(header).getByTestId('revision-answer')).toHaveTextContent(`${PRODUCT_NAME} antwortet weiter aus Fassung 1.`)
    expect(header).not.toHaveTextContent('aktuell')

    const rows = screen.getAllByTestId('revision-timeline-row')
    expect(within(rows[0]).getByTestId('revision-row-label')).toHaveTextContent('Fassung 2')
    expect(within(rows[0]).queryByTestId('revision-row-current')).toBeNull()
    expect(within(rows[1]).getByTestId('revision-row-label')).toHaveTextContent('Fassung 1')
    expect(within(rows[1]).getByTestId('revision-row-current')).toHaveTextContent('aktuell')
    expect(rows[0]).not.toHaveTextContent('In Prüfung')
    expect(screen.getByTestId('document-revisions')).not.toHaveTextContent('Diese Fassung')
  })

  it('keeps naming the previous upload while a re-upload is still being read, and marks that one current', async () => {
    const upload = { approvedBy: 'user_author', publishedBy: 'user_author' }
    await renderOpen({
      viewer: viewOnly,
      file: fileFixture({ status: 'processing', authoredBy: 'user' }),
      client: clientOf([makeVersion(1, 'superseded', upload), makeVersion(2, 'published', upload)]),
    })

    const header = await screen.findByTestId('revision-header')
    expect(within(header).getByTestId('revision-answer')).toHaveTextContent(`${PRODUCT_NAME} antwortet weiter aus Fassung 1.`)
    const rows = screen.getAllByTestId('revision-timeline-row')
    expect(within(rows[0]).queryByTestId('revision-row-current')).toBeNull()
    expect(within(rows[1]).getByTestId('revision-row-current')).toHaveTextContent('aktuell')
  })

  it('says a first upload answers once it has been read', async () => {
    renderSection({
      viewer: viewOnly,
      file: fileFixture({ status: 'processing' }),
      client: clientOf([makeVersion(1, 'published', { approvedBy: 'user_author', publishedBy: 'user_author' })]),
    })

    expect(await screen.findByTestId('revision-answer')).toHaveTextContent(`${PRODUCT_NAME} antwortet daraus, sobald sie gelesen ist.`)
  })

  it('does not point at a published Fassung when there is none', async () => {
    renderSection({ viewer: viewOnly, client: clientOf([reviewed(1, 'in_review')]) })

    const answerLine = await screen.findByTestId('revision-answer')
    expect(answerLine).toHaveTextContent(`${PRODUCT_NAME} antwortet erst daraus, wenn sie freigegeben ist.`)
    expect(answerLine).not.toHaveTextContent('Fassung 1')
  })

  it('calls a replaced Fassung „Ersetzt", without a green track, and puts the newer one on top', async () => {
    const user = userEvent.setup()
    const onOpenDocument = vi.fn()
    renderSection({
      file: fileFixture({ revision: facts({ supersededBy: ref('doc_2', 'EG_Index_D_2026-09-30.pdf') }) }),
      viewer: reviewer,
      client: clientOf([reviewed(1, 'published', { approvedBy: 'user_markus', publishedBy: 'user_markus' })]),
      onOpenDocument,
    })

    expect(await screen.findByTestId('document-lifecycle-state')).toHaveTextContent('Ersetzt')
    expect(screen.queryByTestId('document-lifecycle-track')).toBeNull()
    expect(screen.getByTestId('revision-answer')).toHaveTextContent(`${PRODUCT_NAME} antwortet aus der neueren Fassung 2`)

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(rows[0]).toHaveAttribute('data-kind', 'newer')
    expect(within(rows[0]).getByTestId('revision-row-label')).toHaveTextContent('Fassung 2')
    expect(within(rows[0]).getByTestId('revision-row-tag')).toHaveTextContent('Index D')
    expect(within(rows[0]).getByTestId('revision-row-current')).toHaveTextContent('aktuell')
    expect(within(rows[1]).queryByTestId('revision-row-current')).toBeNull()

    await user.click(within(rows[0]).getByRole('button', { name: 'Öffnen' }))
    expect(onOpenDocument).toHaveBeenCalledWith('doc_2')
  })

  it('says a retired document is retired', async () => {
    renderSection({ viewer: reviewer, client: clientOf([reviewed(1, 'published')], {}, { lifecycle: 'archived' }) })

    expect(await screen.findByTestId('document-lifecycle-state')).toHaveTextContent('Stillgelegt')
    expect(screen.getByTestId('revision-answer')).toHaveTextContent(copy.lifecycle.meaning.archived)
  })
})

describe('DocumentRevisions — the next step names a person', () => {
  it('names the people the round was sent to', async () => {
    renderSection({
      viewer: reviewer,
      client: clientOf([reviewed(1, 'in_review')], {}, { reviewerUserIds: ['user_sabine'] }),
    })

    expect(await screen.findByTestId('revision-next-step')).toHaveTextContent('Nächster Schritt: Freigabe durch Sabine Gruber')
  })

  it('names two reviewers with „oder", and more as a count', async () => {
    const { unmount } = renderSection({
      viewer: reviewer,
      client: clientOf([reviewed(1, 'in_review')], {}, { reviewerUserIds: ['user_sabine', 'user_markus'] }),
    })
    expect(await screen.findByTestId('revision-next-step')).toHaveTextContent('Freigabe durch Sabine Gruber oder Markus Feld')
    unmount()

    renderSection({
      viewer: reviewer,
      client: clientOf([reviewed(1, 'in_review')], {}, { reviewerUserIds: ['user_sabine', 'user_markus', 'user_clara'] }),
    })
    expect(await screen.findByTestId('revision-next-step')).toHaveTextContent('Freigabe durch Sabine Gruber oder 2 weitere')
  })

  it('says it is the reader’s own approval when the round was sent to them', async () => {
    renderSection({
      viewer: reviewer,
      client: clientOf([reviewed(1, 'in_review')], {}, { reviewerUserIds: ['user_reviewer'] }),
    })

    expect(await screen.findByTestId('revision-next-step')).toHaveTextContent('Nächster Schritt: Ihre Freigabe')
  })

  it('sends changes back to whoever submitted, by name', async () => {
    renderSection({
      viewer: viewOnly,
      client: clientOf([reviewed(1, 'published'), reviewed(2, 'changes_requested', { reviewedBy: 'user_clara' })]),
    })

    expect(await screen.findByTestId('revision-next-step')).toHaveTextContent(
      'Nächster Schritt: Überarbeitung durch Anna Berger',
    )
  })

  it('takes names from the assignees and the reviewer candidates too', async () => {
    renderSection({
      viewer: viewOnly,
      names: { user_lena: 'Lena Wolf' },
      client: clientOf([reviewed(1, 'in_review', { submittedBy: 'user_lena' })], {}, { people: [], reviewerUserIds: [] }),
    })
    await userEvent.click(await toggle())

    expect(await screen.findByTestId('revision-timeline-row')).toHaveTextContent('Eingereicht von Lena Wolf')
  })

  it('says „ein Teammitglied" only when the name is truly unknown, and never „jemand"', async () => {
    await renderOpen({
      viewer: viewOnly,
      client: clientOf([reviewed(1, 'in_review', { submittedBy: 'user_ghost' })], {}, { reviewerUserIds: ['user_phantom'] }),
    })

    expect(screen.getByTestId('revision-next-step')).toHaveTextContent('Nächster Schritt: Freigabe durch ein Teammitglied')
    expect(screen.getByTestId('revision-timeline-row')).toHaveTextContent('Eingereicht von einem Teammitglied')
    const all = screen.getByTestId('document-revisions')
    expect(all).not.toHaveTextContent(/jemand/i)
    expect(all).not.toHaveTextContent('user_')
  })
})

describe('DocumentRevisions — shut at rest, open when it is the reader’s turn', () => {
  it('stays shut on a plain upload', async () => {
    renderSection({ viewer: reviewer, client: clientOf([makeVersion(1, 'published')]) })

    expect(await toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens itself on a version that wants a decision from this reader', async () => {
    renderSection({ viewer: reviewer, client: clientOf([reviewed(1, 'in_review')]) })

    await waitFor(async () => expect(await toggle()).toHaveAttribute('aria-expanded', 'true'))
    expect(await screen.findByRole('button', { name: 'Freigeben' })).toBeInTheDocument()
  })

  it('names what is still open on the pages in the approve confirm, with the way into the review', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    renderSection({ viewer: reviewer, client: clientOf([reviewed(1, 'in_review')]), openMarks: { status: 'counted', open: 4, proposed: 0, onOpen } })

    await user.click(await screen.findByRole('button', { name: 'Freigeben' }))
    expect(screen.getByTestId('document-review-approve-open-marks')).toHaveTextContent(
      '4 offene Anmerkungen – trotzdem freigeben?'
    )
    await user.click(screen.getByRole('button', { name: 'In der Prüfansicht öffnen' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('stays shut for a reader nothing is expected of, and still says what it waits for', async () => {
    renderSection({ viewer: viewOnly, client: clientOf([reviewed(1, 'in_review')]) })

    expect(await toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('document-lifecycle-state')).toHaveTextContent('In Prüfung')
    expect(screen.getByTestId('revision-next-step')).toHaveTextContent('Nächster Schritt: Freigabe')
  })

  it('stays closed once the reader has closed it, however often the round re-renders', async () => {
    const user = userEvent.setup()
    const { rerender } = renderSection({ viewer: reviewer, client: clientOf([reviewed(1, 'in_review')]) })
    await waitFor(async () => expect(await toggle()).toHaveAttribute('aria-expanded', 'true'))

    await user.click(await toggle())
    expect(await toggle()).toHaveAttribute('aria-expanded', 'false')

    rerender(section({ viewer: reviewer, client: clientOf([reviewed(1, 'in_review')]) }))
    expect(await toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens itself for the agent’s suggestion, which is waiting for an answer', async () => {
    renderSection({
      file: fileFixture({
        revision: facts({ suggestion: { of: ref('doc_0', 'Grundriss_B.pdf'), confidence: 0.9, reason: '', basis: 'name' } }),
      }),
      canManage: true,
    })

    expect(await toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('revision-suggestion')).toBeInTheDocument()
  })

  it('opens itself on an older Fassung, so the newer one is the first row read', async () => {
    renderSection({ file: fileFixture({ revision: facts({ supersededBy: ref('doc_2', 'Grundriss_D.pdf') }) }) })

    expect(await toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByTestId('revision-timeline-row')[0]).toHaveAttribute('data-kind', 'newer')
  })
})

describe('DocumentRevisions — controls only where the surface resolved permissions', () => {
  it('draws no section at all for a plain upload on a surface without permissions', () => {
    const { container } = renderSection({})

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the timeline and the suggestion, and no review controls, without a viewer', async () => {
    const client = clientOf([makeVersion(1, 'superseded'), reviewed(2, 'in_review')])
    renderSection({
      file: fileFixture({
        versionCount: 2,
        revision: facts({
          supersedes: [ref('doc_0', 'Grundriss_B.pdf')],
          history: [{ id: 'doc_0', filename: 'Grundriss_B.pdf', createdAt: '2026-07-01T00:00:00.000Z', changeSummary: null }],
          suggestion: { of: ref('doc_9', 'Grundriss_A.pdf'), confidence: 0.8, reason: '', basis: 'name' },
        }),
      }),
      client,
    })

    await waitFor(() => expect(screen.getAllByTestId('revision-timeline-row')).toHaveLength(3))
    expect(screen.getByTestId('revision-suggestion')).toBeInTheDocument()
    expect(screen.queryByTestId('document-review-controls')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Freigeben' })).toBeNull()
    expect(screen.queryByTestId('document-lifecycle-archive')).toBeNull()
  })

  it('does not read the versions of a single-upload document without a viewer', () => {
    const listVersions = vi.fn()
    renderSection({
      file: fileFixture({ revision: facts({ supersededBy: ref('doc_2', 'Grundriss_D.pdf') }) }),
      client: fakeClient({ listVersions }),
    })

    expect(listVersions).not.toHaveBeenCalled()
  })

  it('offers no decision to a reader who only holds project:view', async () => {
    renderSection({ viewer: viewOnly, client: clientOf([reviewed(1, 'in_review')]) })

    await screen.findByTestId('document-lifecycle-state')
    expect(screen.queryByTestId('document-review-controls')).toBeNull()
    expect(screen.queryByTestId('revision-approve-explain')).toBeNull()
  })
})
