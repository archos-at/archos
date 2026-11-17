import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { memo, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AnswerCard } from '@/shared/cards/schemas'
import { A2uiCard } from './A2uiCard'
import { ACTING_CARD_TYPES } from '@/features/cards/card-decision'
import { AnswerCardItem } from '@/features/cards/components/AnswerCards'
import { DrawnProvider, SURFACE_EXCLUDED_LEAVES, preflight, structuralRefusal } from './catalog'
import { surfaceLeaves } from './surface-messages'

const STEPS = [{ label: 'Fläche', operation: 'product', unit: 'm²', operands: [{ label: 'Länge', value: 40 }, { label: 'Breite', value: 30 }] }]

const BASIS = {
  type: 'calculation',
  title: 'Brandabschnitt 3.1.1',
  steps: STEPS,
  reference: { document: 'OIB-Richtlinie 2', section: 'Tabelle 1b' },
} as unknown as AnswerCard

const renderCard = (card: AnswerCard, leafId: string) => (
  <div data-testid={`card-${leafId}`} data-type={card.type}>
    {JSON.stringify(card)}
  </div>
)

const tabs = (children: [string, AnswerCard][]): AnswerCard =>
  ({
    type: 'surface',
    components: [
      { id: 'root', component: 'Tabs', tabs: children.map(([title], index) => ({ title, child: `c${index}` })) },
      ...children.map(([, card], index) => {
        const { type, ...props } = card as { type: string }
        return { id: `c${index}`, component: type, ...props }
      }),
    ],
  }) as unknown as AnswerCard

describe('a card through A2UI', () => {
  it('draws a stored card as a one-component surface, fields intact', async () => {
    render(<A2uiCard card={BASIS} surfaceKey="m1:0" render={renderCard} />)
    await waitFor(() => expect(document.querySelector('[data-a2ui-surface="m1:0"]')).not.toBeNull())
    const drawn = screen.getByTestId('card-root')
    expect(drawn).toHaveAttribute('data-type', 'calculation')
    expect(JSON.parse(drawn.textContent ?? '{}')).toMatchObject({
      title: 'Brandabschnitt 3.1.1',
      reference: { document: 'OIB-Richtlinie 2', section: 'Tabelle 1b' },
    })
  })

  it('draws a lone card the surface excludes through A2UI, without a refusal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const proposal = {
      type: 'memory_proposal',
      title: 'Diese Erkenntnis merken?',
      content: 'Das Büro setzt bei GK 4 durchgängig REI 90 an.',
      kind: 'preference',
      confidence: 'high',
    } as unknown as AnswerCard
    render(<A2uiCard card={proposal} surfaceKey="m1:lone" render={renderCard} />)
    await waitFor(() =>
      expect(document.querySelector('[data-a2ui-surface="m1:lone"] [data-a2ui-node="memory_proposal"]')).not.toBeNull()
    )
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('draws a Tabs surface one tab at a time', async () => {
    const other = { ...BASIS, title: '5.2' } as AnswerCard
    render(<A2uiCard card={tabs([['Variante A', BASIS], ['Variante B', other]])} surfaceKey="m1:1" render={renderCard} />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Variante A' })).toBeInTheDocument())
    expect(screen.getByTestId('card-c0')).toBeInTheDocument()
    expect(screen.queryByTestId('card-c1')).toBeNull()
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Variante B' }))
    expect(screen.getByTestId('card-c1').textContent).toContain('5.2')
  })

  it('fades a panel in only when the reader switched to it', async () => {
    const other = { ...BASIS, title: '5.2' } as AnswerCard
    render(<A2uiCard card={tabs([['Variante A', BASIS], ['Variante B', other]])} surfaceKey="m1:3" render={renderCard} />)
    await waitFor(() => expect(screen.getByRole('tabpanel')).toBeInTheDocument())
    expect(screen.getByRole('tabpanel')).not.toHaveClass('fade-in-0')
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Variante B' }))
    expect(screen.getByRole('tabpanel')).toHaveClass('fade-in-0')
  })

  it('draws every child of a Row', async () => {
    const card = {
      type: 'surface',
      components: [
        { id: 'root', component: 'Row', children: ['a', 'b'] },
        { id: 'a', component: 'calculation', title: 'x', steps: STEPS },
        { id: 'b', component: 'calculation', title: 'y', steps: STEPS },
      ],
    } as unknown as AnswerCard
    render(<A2uiCard card={card} surfaceKey="m1:2" render={renderCard} />)
    await waitFor(() => expect(screen.getByTestId('card-a')).toBeInTheDocument())
    expect(screen.getByTestId('card-b')).toBeInTheDocument()
  })

  it('falls back to the cards themselves when A2UI refuses the surface', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const refused = {
      type: 'surface',
      components: [
        { id: 'root', component: 'Carousel', children: ['a'] },
        { id: 'a', component: 'calculation', title: 'x', steps: STEPS },
      ],
    } as unknown as AnswerCard
    render(<A2uiCard card={refused} surfaceKey="m1:3" render={renderCard} />)
    await waitFor(() => expect(screen.getByTestId('card-a')).toHaveAttribute('data-type', 'calculation'))
    warn.mockRestore()
  })

  it('lists a surface’s cards in document order', () => {
    expect(surfaceLeaves(tabs([['A', BASIS], ['B', BASIS]])).map(({ id, leaf }) => [id, 'type' in leaf ? leaf.type : 'text'])).toEqual([
      ['c0', 'calculation'],
      ['c1', 'calculation'],
    ])
  })

  const TABLE = '| Kriterium | Status |\n|---|---|\n| Rauchabzug | offen |'
  const textTabs = {
    type: 'surface',
    components: [
      { id: 'root', component: 'Tabs', tabs: [{ title: 'Außentreppe', child: 'a' }, { title: 'Treppenhaus', child: 'b' }] },
      { id: 'a', component: 'Text', text: TABLE },
      { id: 'b', component: 'calculation', title: 'x', steps: STEPS },
    ],
  } as unknown as AnswerCard

  it('draws a Text tab as the answer’s own Markdown, a table included', async () => {
    render(<A2uiCard card={textTabs} surfaceKey="m1:4" render={renderCard} />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Außentreppe' })).toBeInTheDocument())
    const text = document.querySelector('[data-a2ui-surface] [data-a2ui-node="Text"]') as HTMLElement
    expect(text.querySelector('table')).not.toBeNull()
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Treppenhaus' }))
    expect(screen.getByTestId('card-b')).toBeInTheDocument()
  })

  it('keeps Text in the fallback when A2UI refuses the surface', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const refused = {
      type: 'surface',
      components: [
        { id: 'root', component: 'Carousel', children: ['a', 'b'] },
        { id: 'a', component: 'Text', text: TABLE },
        { id: 'b', component: 'calculation', title: 'x', steps: STEPS },
      ],
    } as unknown as AnswerCard
    render(<A2uiCard card={refused} surfaceKey="m1:5" render={renderCard} />)
    await waitFor(() => expect(screen.getByTestId('card-b')).toBeInTheDocument())
    expect(document.querySelector('[data-a2ui-node="Text"] table')).not.toBeNull()
    warn.mockRestore()
  })

  it('refuses a Text without text before A2UI can draw its error', () => {
    expect(preflight([{ id: 'root', component: 'Text', text: '  ' }])).toMatch(/Text/)
    expect(preflight([{ id: 'root', component: 'Text', text: 'ok' }])).toBeNull()
  })

  it('refuses a leaf the backend keeps out of a surface, an interactive card first', () => {
    const surface = [
      { id: 'root', component: 'Column', children: ['a', 'b'] },
      { id: 'a', component: 'Text', text: 'Davor.' },
      {
        id: 'b',
        component: 'memory_proposal',
        title: 'Diese Erkenntnis merken?',
        content: 'Das Büro setzt bei GK 4 durchgängig REI 90 an.',
        kind: 'preference',
        confidence: 'high',
      },
    ]
    expect(preflight(surface)).toMatch(/'b': a 'memory_proposal' cannot sit inside a surface/)
    expect(preflight([{ id: 's', component: 'surface', components: [] }])).toMatch(/surface/)
  })

  it('refuses what SurfaceCard refuses: a data-bound child list, a blank tab title', () => {
    const leaves = [
      { id: 'a', component: 'Text', text: 'A' },
      { id: 'b', component: 'Text', text: 'B' },
    ]
    const bound = [{ id: 'root', component: 'Column', children: { componentId: 'a', path: '/items' } }, ...leaves]
    const blank = [
      {
        id: 'root',
        component: 'Tabs',
        tabs: [
          { title: ' ', child: 'a' },
          { title: 'B', child: 'b' },
        ],
      },
      ...leaves,
    ]
    expect(preflight(bound)).not.toBeNull()
    expect(preflight(blank)).not.toBeNull()
  })

  it('keeps every interactive and live card type out of a surface', () => {
    for (const type of ACTING_CARD_TYPES) expect(SURFACE_EXCLUDED_LEAVES.has(type)).toBe(true)
  })

  const LEAF = { component: 'calculation', title: 'x', steps: STEPS }

  it('refuses a surface that is not one tree under root', () => {
    const column = (children: string[]) => ({ id: 'root', component: 'Column', children })
    expect(preflight([column(['a', 'missing']), { id: 'a', ...LEAF }])).toMatch(/'missing' does not exist/)
    expect(preflight([column(['a']), { id: 'a', component: 'Column', children: ['root'] }])).toMatch(/cycle/)
    expect(preflight([column(['a']), { id: 'a', ...LEAF }, { id: 'a', ...LEAF }])).toMatch(/used twice/)
    expect(preflight([{ id: 'a', ...LEAF }])).toMatch(/no 'root'/)
    expect(preflight([column(['a', 'a']), { id: 'a', ...LEAF }])).toMatch(/more than once/)
    expect(
      preflight([
        { id: 'root', component: 'Tabs', tabs: [{ title: 'A', child: 'a' }, { title: 'B', child: 'a' }] },
        { id: 'a', ...LEAF },
      ])
    ).toMatch(/more than once/)
    expect(preflight([column(['a']), { id: 'a', ...LEAF }, { id: 'b', ...LEAF }])).toMatch(/'b': not reachable/)
    expect(structuralRefusal([column(['a', 'b']), { id: 'a', ...LEAF }, { id: 'b', ...LEAF }])).toBeNull()
  })

  it('draws a surface with a dangling child as its cards, never a placeholder', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const dangling = {
      type: 'surface',
      components: [{ id: 'root', component: 'Column', children: ['a', 'missing'] }, { id: 'a', ...LEAF }],
    } as unknown as AnswerCard
    const { container } = render(<A2uiCard card={dangling} surfaceKey="m1:6" render={renderCard} />)
    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(screen.getByTestId('card-a')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Loading/)
    expect(container.querySelector('[data-a2ui-surface]')).toBeNull()
    warn.mockRestore()
  })

  it('does not bring a refused interactive leaf back through the fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const refused = {
      type: 'surface',
      components: [
        { id: 'root', component: 'Column', children: ['a', 'b'] },
        { id: 'a', ...LEAF },
        { id: 'b', component: 'memory_proposal', title: 'Merken?', content: 'REI 90.', kind: 'preference', confidence: 'high' },
      ],
    } as unknown as AnswerCard
    render(<A2uiCard card={refused} surfaceKey="m1:7" render={renderCard} />)
    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(screen.getByTestId('card-a')).toBeInTheDocument()
    expect(screen.queryByTestId('card-b')).toBeNull()
    expect(surfaceLeaves(refused).map(({ id }) => id)).toEqual(['a'])
    warn.mockRestore()
  })

  it('drops a malformed leaf from the fallback and draws its valid sibling', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const malformed = {
      type: 'surface',
      components: [
        { id: 'root', component: 'Row', children: ['a', 'b'] },
        { id: 'a', component: 'calculation', title: 'no steps here' },
        { id: 'b', component: 'calculation', title: 'fine', steps: STEPS },
      ],
    } as unknown as AnswerCard
    render(<AnswerCardItem card={malformed} index={0} messageId="m1" />)
    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(await screen.findByText('fine')).toBeInTheDocument()
    expect(surfaceLeaves(malformed).map(({ id }) => id)).toEqual(['b'])
    warn.mockRestore()
  })

  it('mounts a card once, A2UI’s drawing only, with no hidden copy beside it', async () => {
    let mounts = 0
    function Counted() {
      useEffect(() => {
        mounts += 1
      }, [])
      return <div data-testid="counted" />
    }
    const { container } = render(<A2uiCard card={BASIS} surfaceKey="m1:8" render={() => <Counted />} />)
    await waitFor(() => expect(document.querySelector('[data-a2ui-surface="m1:8"]:not([aria-hidden])')).not.toBeNull())
    expect(screen.getAllByTestId('counted')).toHaveLength(1)
    expect(mounts).toBe(1)
    expect(container.querySelectorAll('[data-a2ui-surface]')).toHaveLength(1)
    expect(container.querySelector('.invisible')).toBeNull()
    expect(container.querySelector('[data-slot="card-placeholder"]')).toBeNull()
    expect(container.textContent).not.toMatch(/Loading/)
  })

  it('tells whatever holds its place that it is on screen, once', async () => {
    const onScreen = vi.fn()
    render(
      <DrawnProvider value={onScreen}>
        <A2uiCard card={BASIS} surfaceKey="m1:10" render={renderCard} />
      </DrawnProvider>
    )
    await waitFor(() => expect(onScreen).toHaveBeenCalledTimes(1))
    expect(document.querySelector('[data-a2ui-surface="m1:10"]:not([aria-hidden])')).not.toBeNull()
  })

  it('tells it too when the card falls back to its direct drawing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const onScreen = vi.fn()
    const refused = {
      type: 'surface',
      components: [
        { id: 'root', component: 'Carousel', children: ['a'] },
        { id: 'a', ...LEAF },
      ],
    } as unknown as AnswerCard
    render(
      <DrawnProvider value={onScreen}>
        <A2uiCard card={refused} surfaceKey="m1:11" render={renderCard} />
      </DrawnProvider>
    )
    await waitFor(() => expect(onScreen).toHaveBeenCalled())
    expect(screen.getByTestId('card-a')).toBeInTheDocument()
    warn.mockRestore()
  })

  it('retries A2UI when a surface that failed changes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const first = { ...BASIS, title: '1' } as AnswerCard
    let failing = true
    const Leaf = memo(function Leaf({ card }: { card: AnswerCard }) {
      if (failing && card !== first) throw new Error('library bug')
      return <div data-testid="leaf">{(card as { title?: string }).title}</div>
    })
    const renderLeaf = (card: AnswerCard) => <Leaf card={card} />
    const { rerender } = render(<A2uiCard card={first} surfaceKey="m1:9" render={renderLeaf} />)
    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(screen.getByTestId('leaf')).toHaveTextContent('1')

    failing = false
    rerender(<A2uiCard card={{ ...BASIS, title: '2' } as AnswerCard} surfaceKey="m1:9" render={renderLeaf} />)
    await waitFor(() => expect(document.querySelector('[data-a2ui-surface="m1:9"]:not([aria-hidden])')).not.toBeNull())
    expect(screen.getByTestId('leaf')).toHaveTextContent('2')
    warn.mockRestore()
    error.mockRestore()
  })
})
