import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Node, Parent } from 'unist'
import {
  CALLOUT_SLOT_INDEX,
  hasPlacedCalloutMarker,
  placedCardIndices,
  remarkCardMarkers,
  unplacedCardIndices,
} from './card-markers'
import { cardKey, reconcileCardInteractions } from './card-decision'
import { validateAnswerCards } from '@/shared/cards/schemas'
import { MarkdownRenderer } from '@/shared/components/MarkdownRenderer'
import {
  MARKDOWN_SLOT_TAG,
  MarkdownSlotProvider,
} from '@/shared/components/MarkdownRenderer/slot-context'

const parse = (markdown: string, count: number, callout = false): Node =>
  unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCardMarkers, { count, callout })
    .runSync(unified().use(remarkParse).use(remarkGfm).parse(markdown))

const isParent = (node: Node): node is Parent => Array.isArray((node as Parent).children)

const value = (node: Node): string => {
  const literal = (node as Node & { value?: unknown }).value
  return typeof literal === 'string' ? literal : ''
}

const text = (node: Node): string =>
  isParent(node) ? node.children.map(text).join('') : value(node)

const slots = (node: Node): number[] => {
  const data = (node as Node & { data?: { hName?: string; hProperties?: { index?: string } } }).data
  const here = data?.hName === MARKDOWN_SLOT_TAG ? [Number(data.hProperties?.index)] : []
  if (!isParent(node)) return here
  return [...here, ...node.children.flatMap(slots)]
}

const blocks = (node: Node): string[] =>
  (node as Parent).children.map((child) => {
    const data = (child as Node & { data?: { hName?: string } }).data
    return data?.hName === MARKDOWN_SLOT_TAG ? 'slot' : child.type
  })

describe('remarkCardMarkers', () => {
  test('splices a card in where the answer placed it', () => {
    const tree = parse('Die Steigung.\n\n[[card:1]]\n\nDie Auftrittstiefe.', 1)

    expect(blocks(tree)).toEqual(['paragraph', 'slot', 'paragraph'])
    expect(slots(tree)).toEqual([0])
    expect(text(tree)).toBe('Die Steigung.Die Auftrittstiefe.')
  })

  test('resolves the marker number to the array index', () => {
    expect(slots(parse('[[card:3]]', 3))).toEqual([2])
  })

  test('places several cards, each at its own marker', () => {
    const tree = parse('Eins.\n\n[[card:2]]\n\nZwei.\n\n[[card:1]]', 2)

    expect(blocks(tree)).toEqual(['paragraph', 'slot', 'paragraph', 'slot'])
    expect(slots(tree)).toEqual([1, 0])
  })

  test('splits a paragraph at a marker on a soft-broken line', () => {
    const tree = parse('Vor der Karte\n[[card:1]]\nNach der Karte', 1)

    expect(blocks(tree)).toEqual(['paragraph', 'slot', 'paragraph'])
    expect(text(tree)).toBe('Vor der KarteNach der Karte')
  })

  test('renders nothing for a card that has not arrived', () => {
    const tree = parse('Antwort.\n\n[[card:2]]', 1)

    expect(slots(tree)).toEqual([])
    expect(text(tree)).toBe('Antwort.')
  })

  test('strips a marker naming a card that does not exist at all', () => {
    expect(text(parse('Antwort.\n\n[[card:9]]\n\nEnde.', 2))).toBe('Antwort.Ende.')
    expect(slots(parse('Antwort.\n\n[[card:9]]\n\nEnde.', 2))).toEqual([])
  })

  test('strips a mid-sentence marker instead of splicing a block into it', () => {
    const tree = parse('Die Treppe [[card:1]] ist steil.', 1)

    expect(slots(tree)).toEqual([])
    expect(text(tree)).toBe('Die Treppe  ist steil.')
    expect(unplacedCardIndices('Die Treppe [[card:1]] ist steil.', 1)).toEqual([0])
  })

  test('leaves a marker inside a code fence alone', () => {
    const source = 'So platzierst du sie:\n\n```\n[[card:1]]\n```\n'
    const tree = parse(source, 1)

    expect(slots(tree)).toEqual([])
    expect(text(tree)).toContain('[[card:1]]')
    expect(unplacedCardIndices(source, 1)).toEqual([0])
  })

  test.each(['[[', '[[c', '[[card', '[[card:', '[[card:1', '[[card:1]'])(
    'hides the partial marker %j at the end of a streaming answer',
    (partial) => {
      expect(text(parse(`Die Treppe ist steil.\n\n${partial}`, 1))).toBe('Die Treppe ist steil.')
    }
  )

  test('leaves brackets in the middle of a finished answer alone', () => {
    expect(text(parse('Ein [[Wert]] und Text danach.', 1))).toBe('Ein [[Wert]] und Text danach.')
  })

  test('does not touch a document with no markers', () => {
    const source = 'Absatz eins.\n\n- Punkt\n- Punkt\n'
    expect(text(parse(source, 2))).toBe(text(parse(source, 0)))
  })

  test('while streaming, a marker whose card has not arrived keeps its slot (ADR-0066)', () => {
    const source = 'Vor.\n\n[[card:2]]\n\nNach.'
    const pending = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkCardMarkers, { count: 0, pending: true })
      .runSync(unified().use(remarkParse).use(remarkGfm).parse(source))
    expect(slots(pending)).toEqual([1])
    expect(text(pending)).toBe('Vor.Nach.')
    expect(slots(parse(source, 0))).toEqual([])
  })
})

describe('placedCardIndices', () => {
  test('reads the same placements the plugin makes', () => {
    expect([...placedCardIndices('Vor.\n\n[[card:2]]\n\nNach.', 2)]).toEqual([1])
  })

  test('ignores a marker inside a fenced block, so its card still shows', () => {
    expect([...placedCardIndices('```\n[[card:1]]\n```', 1)]).toEqual([])
  })

  test('ignores a marker for a card this answer does not carry', () => {
    expect([...placedCardIndices('[[card:4]]', 2)]).toEqual([])
  })

  test('leaves the unplaced cards in emission order', () => {
    expect(unplacedCardIndices('Text.\n\n[[card:2]]', 3)).toEqual([0, 2])
  })

  test('places nothing when the answer carries no cards', () => {
    expect([...placedCardIndices('[[card:1]]', 0)]).toEqual([])
  })
})

describe('a placed card, rendered', () => {
  const readable = (container: HTMLElement): string =>
    (container.textContent ?? '').replace(/\s+/g, ' ').trim()

  const renderAnswer = (content: string, count: number) =>
    render(
      <MarkdownSlotProvider render={(index) => <div data-testid={`card-${index}`}>Karte</div>}>
        <MarkdownRenderer content={content} remarkPlugins={[[remarkCardMarkers, { count }]]} />
      </MarkdownSlotProvider>
    )

  test('lands between the paragraphs it was placed between', () => {
    const { container } = renderAnswer('Die Steigung.\n\n[[card:1]]\n\nDer Auftritt.', 1)

    const card = screen.getByTestId('card-0')
    expect(card.closest('p')).toBeNull()
    expect(readable(container)).toBe('Die Steigung. Karte Der Auftritt.')
  })

  test('renders nothing where the card has not arrived', () => {
    const { container } = renderAnswer('Die Steigung.\n\n[[card:2]]', 1)

    expect(screen.queryByTestId('card-1')).toBeNull()
    expect(readable(container)).toBe('Die Steigung.')
  })

  test('never leaks the marker to the reader', () => {
    const { container } = renderAnswer('Die Treppe [[card:1]] ist steil, [[card:7]].', 1)

    expect(readable(container)).not.toContain('[[card')
  })

  test('the callout slot renders between its paragraphs like a card slot', () => {
    const { container } = render(
      <MarkdownSlotProvider
        render={(index) => (index === CALLOUT_SLOT_INDEX ? <div>Achtung-Block</div> : null)}
      >
        <MarkdownRenderer
          content={'Die Regel.\n\n[[callout]]\n\nDie Ausnahme.'}
          remarkPlugins={[[remarkCardMarkers, { count: 0, callout: true }]]}
        />
      </MarkdownSlotProvider>
    )

    expect(readable(container)).toBe('Die Regel. Achtung-Block Die Ausnahme.')
  })
})

describe('the [[callout]] marker', () => {
  test('splices the callout slot where the answer anchored it', () => {
    const tree = parse('Die Regel.\n\n[[callout]]\n\nDie Ausnahme.', 0, true)

    expect(blocks(tree)).toEqual(['paragraph', 'slot', 'paragraph'])
    expect(slots(tree)).toEqual([CALLOUT_SLOT_INDEX])
    expect(text(tree)).toBe('Die Regel.Die Ausnahme.')
  })

  test('a marker with no callout behind it is stripped, never shown', () => {
    const tree = parse('Die Regel.\n\n[[callout]]\n\nDie Ausnahme.', 0, false)

    expect(blocks(tree)).toEqual(['paragraph', 'paragraph'])
    expect(text(tree)).toBe('Die Regel.Die Ausnahme.')
  })

  test('a mid-sentence marker is stripped even when a callout exists', () => {
    const tree = parse('Die Regel [[callout]] mitten im Satz.', 0, true)

    expect(slots(tree)).toEqual([])
    expect(text(tree)).toBe('Die Regel  mitten im Satz.')
  })

  test('cards and the callout place independently in one answer', () => {
    const tree = parse('Eins.\n\n[[card:1]]\n\n[[callout]]\n\nZwei.', 1, true)

    expect(blocks(tree)).toEqual(['paragraph', 'slot', 'slot', 'paragraph'])
    expect(slots(tree)).toEqual([0, CALLOUT_SLOT_INDEX])
  })

  test('a partial [[callou tail mid-stream is hidden like a card tail', () => {
    const tree = parse('Die Antwort läuft noch [[callou', 0, true)
    expect(text(tree)).toBe('Die Antwort läuft noch ')
  })
})

describe('hasPlacedCalloutMarker', () => {
  test('sees an own-line marker and ignores a mid-sentence one', () => {
    expect(hasPlacedCalloutMarker('Absatz.\n\n[[callout]]\n\nEnde.')).toBe(true)
    expect(hasPlacedCalloutMarker('Ein Satz mit [[callout]] darin.')).toBe(false)
    expect(hasPlacedCalloutMarker('Kein Marker.')).toBe(false)
  })

  test('a marker inside a code fence is content, not placement', () => {
    expect(hasPlacedCalloutMarker('```\n[[callout]]\n```')).toBe(false)
  })
})

describe('a rejected card in the middle keeps every marker and decision bound', () => {
  const proposal = (content: string) => ({
    type: 'memory_proposal',
    title: 'Merken?',
    content,
    kind: 'preference',
    confidence: 'high',
  })
  const WIRE = [proposal('REI 90 prüfen'), { type: 'not_a_card_type' }, proposal('Fluchtniveau 9,80 m')]
  const BODY = 'Erstens.\n\n[[card:1]]\n\nZweitens.\n\n[[card:3]]\n\nDrittens.'

  const validated = () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      return validateAnswerCards(WIRE)
    } finally {
      warn.mockRestore()
    }
  }

  test('validation holds the wire positions with a hole', () => {
    const cards = validated()

    expect(cards).toHaveLength(3)
    expect(cards[0]).toMatchObject({ type: 'memory_proposal', content: 'REI 90 prüfen' })
    expect(cards[1]).toBeUndefined()
    expect(cards[2]).toMatchObject({ type: 'memory_proposal', content: 'Fluchtniveau 9,80 m' })
  })

  test('[[card:3]] still draws the third card, never the second', () => {
    const cards = validated()
    const count = cards.length

    expect([...placedCardIndices(BODY, count)]).toEqual([0, 2])
    expect(unplacedCardIndices(BODY, count)).toEqual([1])
    expect(slots(parse(BODY, count))).toEqual([0, 2])
    expect(cards[0]).toMatchObject({ content: 'REI 90 prüfen' })
    expect(cards[2]).toMatchObject({ content: 'Fluchtniveau 9,80 m' })
    expect(cards[1]).toBeUndefined()
  })

  test('a decision on the third card survives; one on the hole is dropped', () => {
    const cards = validated()
    const decided = (key: string, decision: 'savedProject' | 'accepted' = 'savedProject') => ({
      [key]: { decision, decidedAt: '2026-07-28T09:00:00.000Z' as const },
    })

    expect(cardKey({ type: 'memory_proposal' }, 2)).toBe('memory_proposal-2')
    expect(reconcileCardInteractions(decided('memory_proposal-2'), cards, validated())).toEqual(
      decided('memory_proposal-2'),
    )
    expect(reconcileCardInteractions(decided('memory_proposal-1'), cards, validated())).toBeUndefined()
  })
})
