/**
 * The look card (ADR-0128): per place a thumbnail with the box marked and the
 * page and the place in words; folded under them, what Piloti looked for and,
 * marked as such, what it read there; pressing a place, with the mouse or the keyboard, opens
 * the document at that page with the box on it. pdf.js is the shared fake.
 */
import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import { fakePdfjsRuntime, type FakePdfState } from '@/test-utils/pdfjs-fake'
import { lookCardSchema } from '@/shared/cards/generated'
import { placeFileUrl } from '@/features/knowledge/lib/page-place'
import { LookCard, lookItemColor, lookItemPlace } from './LookCard'
import { PRODUCT_NAME } from '@/lib/brand'

const state = vi.hoisted((): FakePdfState => ({ fail: false, pages: [], destroyed: 0 }))
vi.mock('@/features/knowledge/lib/pdfjs-runtime', () => fakePdfjsRuntime(state))

const DOCUMENT = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Grundriss EG.pdf', shelf: 'stored' as const }
/** Items as the card arrives: parsed by the generated schema, defaults filled in. */
const parsed = (items: Record<string, unknown>[]) => lookCardSchema.parse({ document: DOCUMENT, items }).items
const ITEMS = parsed([
  {
    origin: 'look' as const,
    page: 2,
    frame: 'page' as const,
    scope: 'region' as const,
    region: [0.62, 0.04, 0.34, 0.22],
    where: 'oben rechts',
    question: 'Maßstab im Plankopf?',
    reading: 'M 1:100',
  },
  {
    origin: 'reference' as const,
    page: 2,
    frame: 'page' as const,
    scope: 'region' as const,
    region: [0.58, 0.34, 0.14, 0.22],
    where: 'in der Seitenmitte',
    label: 'Laufbreite 1,10 m',
  },
])

let restore: () => void = () => undefined
beforeEach(() => {
  state.fail = false
  state.pages = [{ items: [] }, { items: [] }, { items: [] }]
})
afterEach(() => restore())

describe('LookCard', () => {
  test('names each place, and a reference’s label on it', () => {
    render(<LookCard document={DOCUMENT} items={ITEMS} />)
    const card = screen.getByTestId('look-card')
    expect(within(card).getByText('Grundriss EG.pdf')).toBeInTheDocument()
    const [look, reference] = screen.getAllByTestId('look-item')
    expect(look).toHaveTextContent('p. 2 · oben rechts')
    expect(reference).toHaveAttribute('data-origin', 'reference')
    expect(reference).toHaveTextContent('Shown on p. 2 · in der Seitenmitte')
    expect(reference).toHaveTextContent('Laufbreite 1,10 m')
  })

  // Notion #38, topic 10: the section mark is the word alone, no icon beside it.
  test('marks its section with the word, not an icon', () => {
    render(<LookCard document={DOCUMENT} items={ITEMS} />)
    const mark = screen.getByText('Looked at')
    expect(mark).toHaveClass('card-eyebrow')
    expect(mark.querySelector('svg')).toBeNull()
  })

  // Notion #38, topic 10: the question and the readings are folded until asked
  // for; the places stay on screen.
  test('folds the explanation, and opens it on a press: the question, the reading, marked as read', async () => {
    const user = userEvent.setup()
    render(<LookCard document={DOCUMENT} items={ITEMS} />)
    const trigger = screen.getByRole('button', { name: 'Explanation' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Maßstab im Plankopf?')).toBeNull()
    expect(screen.queryByTestId('look-reading')).toBeNull()
    expect(screen.queryByTestId('look-reading-note')).toBeNull()
    expect(screen.getAllByTestId('look-item')).toHaveLength(2)

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByTestId('look-explanation')
    expect(trigger).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveTextContent('p. 2 · oben rechts')
    expect(panel).toHaveTextContent('Maßstab im Plankopf?')
    expect(within(panel).getByTestId('look-reading')).toHaveTextContent('Read: M 1:100')
    expect(within(panel).getByTestId('look-reading')).toHaveAttribute('title', `Read off the page by ${PRODUCT_NAME}, not measured.`)
    expect(within(panel).getByTestId('look-reading-note')).toHaveTextContent('not measured')
    // A reference explains nothing here: its label is on its place.
    expect(panel).not.toHaveTextContent('Laufbreite')
  })

  test('opens and closes the explanation from the keyboard', async () => {
    const user = userEvent.setup()
    render(<LookCard document={DOCUMENT} items={ITEMS} />)
    const trigger = screen.getByRole('button', { name: 'Explanation' })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Maßstab im Plankopf?')).toBeInTheDocument()
    await user.keyboard(' ')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  test('without a question or a reading, nothing to unfold and no note about readings', () => {
    render(<LookCard document={DOCUMENT} items={parsed([{ page: 1, scope: 'overview' }])} />)
    expect(screen.getByTestId('look-item')).toHaveTextContent('p. 1 · whole page')
    expect(screen.queryByRole('button', { name: 'Explanation' })).toBeNull()
    expect(screen.queryByTestId('look-reading-note')).toBeNull()
  })

  test('one place: the explanation does not repeat its address', async () => {
    const user = userEvent.setup()
    render(<LookCard document={DOCUMENT} items={[ITEMS[0]!]} />)
    await user.click(screen.getByRole('button', { name: 'Explanation' }))
    expect(screen.getByTestId('look-explanation')).not.toHaveTextContent('oben rechts')
  })

  test('an item is an address: the place, its tint, a reference’s label on its box', () => {
    expect(lookItemPlace(DOCUMENT, ITEMS[1]!)).toEqual({
      document: { id: DOCUMENT.id, name: 'Grundriss EG.pdf', shelf: 'stored' },
      page: 2,
      frame: 'page',
      region: [0.58, 0.34, 0.14, 0.22],
      point: null,
      imageIndex: null,
      revisionId: null,
      label: 'Laufbreite 1,10 m',
    })
    expect(lookItemColor('base', 'look')).toBe('var(--source-law)')
    expect(lookItemColor('stored', 'look')).toBe('var(--source-project)')
    expect(lookItemColor('stored', 'reference')).toBe('var(--paper-ink)')
  })

  test('an item that names its Fassung is drawn from that Fassung, not the current one', () => {
    const [item] = parsed([{ page: 1, scope: 'overview', revision_id: 'version-7' }])
    expect(placeFileUrl(lookItemPlace(DOCUMENT, item!))).toBe(`/api/documents/${DOCUMENT.id}/file?versionId=version-7`)
    const [current] = parsed([{ page: 1, scope: 'overview' }])
    expect(placeFileUrl(lookItemPlace(DOCUMENT, current!))).toBe(`/api/documents/${DOCUMENT.id}/file`)
  })

  test('draws each place on screen and opens the document at it, with the box, by keyboard', async () => {
    restore = installLayoutObservers({ frameWidth: 320 })
    const user = userEvent.setup()
    render(<LookCard document={DOCUMENT} items={ITEMS} />)
    await waitFor(() => expect(screen.getAllByTestId('region-mark')).toHaveLength(2))

    const [first] = screen.getAllByRole('button', { name: 'Open Grundriss EG.pdf at p. 2' })
    first!.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByTestId('pdf-viewer-dialog')
    expect(within(dialog).getByText('Grundriss EG.pdf')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getAllByTestId('region-mark').length).toBeGreaterThan(0))
  })
})
