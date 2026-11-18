import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen, within } from '@/test-utils'
import type { FileItem } from '../file-types'
import {
  clientOf,
  copy,
  facts,
  fileFixture,
  fill,
  makeVersion,
  ref,
  renderOpen,
  reviewed,
  reviewer,
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

describe('DocumentRevisions — one numbered timeline', () => {
  const history = [
    { id: 'doc_b', filename: 'EG_Index_B_2026-07-02.pdf', createdAt: '2026-07-02T09:00:00Z', changeSummary: '- Stiege verschoben' },
    { id: 'doc_a', filename: 'EG_Index_A_2026-06-01.pdf', createdAt: '2026-06-01T09:00:00Z', changeSummary: null },
  ]
  const linked = facts({ supersedes: [ref('doc_b', history[0].filename)], history })

  it('lists uploads and linked documents interleaved by date and numbers them Fassung 4, 3, 2, 1', async () => {
    await renderOpen({
      file: fileFixture({ filename: 'EG_Index_C_2026-08-01.pdf', versionCount: 2, revision: linked }),
      viewer: reviewer,
      client: clientOf([
        makeVersion(1, 'superseded', { createdAt: '2026-06-20T08:00:00.000Z' }),
        makeVersion(2, 'published', { createdAt: '2026-08-01T08:00:00.000Z' }),
      ]),
    })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(rows.map((row) => [row.dataset.version ?? row.dataset.id, row.textContent?.match(/Fassung \d/)?.[0]])).toEqual([
      ['2', 'Fassung 4'],
      ['doc_b', 'Fassung 3'],
      ['1', 'Fassung 2'],
      ['doc_a', 'Fassung 1'],
    ])
    expect(screen.getByTestId('revision-header-label')).toHaveTextContent('Fassung 4')
  })

  it('compares with the previous Fassung in one tap from its row, not only from its ⋯', async () => {
    compareOpened.mockClear()
    await renderOpen({ file: fileFixture({ filename: 'EG_Index_C_2026-08-14.pdf', revision: linked }), canManage: true })
    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(screen.getAllByTestId('revision-compare-previous')).toHaveLength(1)
    await userEvent.click(within(rows[1]).getByTestId('revision-compare-previous'))
    expect(compareOpened).toHaveBeenCalledTimes(1)
    expect(compareOpened.mock.calls[0]?.[1]).toMatchObject({ filename: 'EG_Index_C_2026-08-14.pdf' })
  })

  it('tags rows with their index, says „aktuell" only on the one the agent answers from, and never „Ersetzt"', async () => {
    await renderOpen({ file: fileFixture({ filename: 'EG_Index_C_2026-08-14.pdf', revision: linked }), canManage: true })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByTestId('revision-row-tag')).toHaveTextContent('Index C')
    expect(within(rows[0]).getByTestId('revision-row-current')).toHaveTextContent('aktuell')
    expect(within(rows[1]).getByTestId('revision-row-tag')).toHaveTextContent('Index B')
    expect(rows[1]).toHaveTextContent('Stiege verschoben')
    expect(within(rows[2]).getByTestId('revision-row-tag')).toHaveTextContent('Index A')
    expect(screen.getAllByTestId('revision-row-current')).toHaveLength(1)
    expect(screen.getByTestId('revision-timeline')).not.toHaveTextContent('Ersetzt')
  })

  it('prefers the index the title block printed to the one in the name', async () => {
    await renderOpen({
      file: { ...fileFixture({ filename: 'scan_0042.pdf', revision: linked }), revisionFacts: { revision: 'C' } } as FileItem,
    })

    expect(within((await screen.findAllByTestId('revision-timeline-row'))[0]).getByTestId('revision-row-tag')).toHaveTextContent(
      'Index C',
    )
  })

  it('cuts a long file name in the middle, so its index and extension survive', async () => {
    const long = 'Wohnanlage-Schlosspark_Bauteil-B_Grundriss_1OG_Einreichung_Index-C_2026-06-30.pdf'
    await renderOpen({
      file: fileFixture({
        revision: facts({ history: [{ id: 'doc_l', filename: long, createdAt: '2026-06-30T08:00:00Z', changeSummary: null }] }),
      }),
    })

    const row = (await screen.findAllByTestId('revision-timeline-row'))[1]
    const name = within(row).getByTitle(long)
    expect(name.lastElementChild).toHaveTextContent('Index-C_2026-06-30.pdf')
    expect(name.lastElementChild).toHaveAttribute('data-part', 'tail')
  })

  it('says each date once, on the act line, with the person', async () => {
    await renderOpen({
      file: fileFixture({ versionCount: 2 }),
      viewer: reviewer,
      client: clientOf([makeVersion(1, 'superseded', { createdBy: 'user_reviewer' }), makeVersion(2, 'published')]),
    })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(rows[0]).toHaveTextContent('Hochgeladen von Anna Berger · 02.09.2026')
    expect(rows[0].textContent?.match(/02\.09\.2026/g)).toHaveLength(1)
    expect(rows[1]).toHaveTextContent('Hochgeladen von Ihnen · 01.09.2026')
    expect(screen.getByTestId('revision-timeline')).not.toHaveTextContent('user_')
  })

  it('names the reviewer’s words and every act on the newest, the refusal included', async () => {
    await renderOpen({
      viewer: reviewer,
      client: clientOf([
        reviewed(1, 'published'),
        reviewed(2, 'changes_requested', {
          submittedAt: '2026-09-02T09:00:00.000Z',
          reviewedBy: 'user_clara',
          reviewedAt: '2026-09-03T10:00:00.000Z',
          reviewComment: 'Bitte die Fluchtweglänge ergänzen.',
        }),
      ]),
    })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(rows[0]).toHaveTextContent('Eingereicht von Anna Berger · 02.09.2026')
    expect(rows[0]).toHaveTextContent(`${copy.lifecycle.versions.changesRequested} von Clara Schmid · 03.09.2026`)
    expect(within(rows[0]).getByTestId('document-version-comment')).toHaveTextContent('Bitte die Fluchtweglänge ergänzen.')
  })

  it('never reads an approval as a refusal', async () => {
    await renderOpen({
      viewer: reviewer,
      client: clientOf([
        makeVersion(1, 'superseded'),
        reviewed(2, 'approved', {
          reviewedBy: 'user_clara',
          reviewedAt: '2026-09-03T10:00:00.000Z',
          approvedBy: 'user_clara',
          approvedAt: '2026-09-03T10:00:00.000Z',
        }),
      ]),
    })

    const rows = await screen.findAllByTestId('revision-timeline-row')
    expect(rows[0]).toHaveTextContent('Freigegeben von Clara Schmid')
    expect(rows[0]).not.toHaveTextContent(copy.lifecycle.versions.changesRequested)
    expect(rows[0]).not.toHaveTextContent('Abgelehnt von')
  })

  it('shows a lone upload as no timeline: the header already says all of it', async () => {
    await renderOpen({ viewer: reviewer, client: clientOf([makeVersion(1, 'published')]) })

    await screen.findByTestId('revision-header')
    expect(screen.queryByTestId('revision-timeline')).toBeNull()
  })

  it('shows the reviewer’s words on a lone version they are about', async () => {
    await renderOpen({
      viewer: reviewer,
      client: clientOf([reviewed(1, 'rejected', { reviewComment: 'Außerhalb des Auftrags.' })]),
    })

    expect(await screen.findByTestId('document-version-comment')).toHaveTextContent('Außerhalb des Auftrags.')
  })

  it('says what changed against the Fassung it replaced, by number, with the agent’s caveat attached once', async () => {
    await renderOpen({
      file: fileFixture({
        revision: facts({
          supersedes: [ref('doc_b', history[0].filename)],
          history,
          changeSummary: { text: '- Dachhöhe: 12 m → 14 m\n• Fenster: Typ A → Typ B\n\n2) Attika neu', basis: 'previous' },
        }),
      }),
    })

    const [change] = await screen.findAllByTestId('revision-change')
    expect(change).toHaveTextContent('Geändert gegenüber Fassung 2:')
    expect(within(change).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Dachhöhe: 12 m → 14 m',
      'Fenster: Typ A → Typ B',
      'Attika neu',
    ])
    expect(screen.getAllByTestId('revision-change-hint')).toHaveLength(1)
    expect(within(change).getByTestId('revision-change-hint')).toHaveTextContent(copy.preview.revision.changeHint)
  })

  it('names the basis by its file when it is not in the timeline', async () => {
    await renderOpen({
      file: fileFixture({ revision: facts({ changeSummary: { text: '- Attika neu', basis: ref('doc_0', 'Grundriss_A.pdf') } }) }),
    })

    expect(await screen.findByTestId('revision-change')).toHaveTextContent(
      fill(copy.preview.revision.changedSince, { name: 'Grundriss_A.pdf' }),
    )
  })
})
