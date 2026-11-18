/**
 * @vitest-environment node
 */
import { describe, test, expect } from 'vitest'
import { animateFrontier, buildGraph, keepEdgeIdentity } from './flow/build-graph'
import type { SpineFolding } from './flow/round-kind'
import { planFan } from './flow/flow-layout'
import type { ReasoningFlowProps } from './flow/reasoning-flow-props'
import type { CitedDocument } from '../../lib/citations'
import type { RetrievalLedger } from '@/lib/conversations/message-retrieval-ledger'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { storedStep } from '@/test-utils/wire-v2-steps'
import { createTranslator } from '@/i18n/translate'
import type { Translator } from '@/i18n'
import {
  DESKTOP_W,
  PHONE_W,
  base,
  card,
  columnCards,
  columnToColumnEdges,
  de,
  en,
  fanSlots,
  framingHandles,
  retrievalStep,
  t,
  toolHit,
} from './flow/reasoning-flow.fixtures'

describe('buildGraph — parallel wiring (P1-4)', () => {
  test('framing fans out to every column, each column converges — never a chain', () => {
    const cards = [card('a'), card('b'), card('c')]
    const g = buildGraph({ ...base, answerConfidence: 'high' }, t, planFan(DESKTOP_W, 3), cards)

    expect(columnCards(g)).toEqual([['a'], ['b'], ['c']])
    expect(framingHandles(g)).toEqual(['c-bottom'])
    for (const cid of ['col-0', 'col-1', 'col-2']) {
      expect(g.edges).toContainEqual(expect.objectContaining({ source: 'framing', target: cid }))
      expect(g.edges).toContainEqual(expect.objectContaining({ source: cid, target: 'findings' }))
    }
    expect(columnToColumnEdges(g)).toHaveLength(0)
  })

  test('one retrieval round keeps the old fan — no round nodes', () => {
    const steps = [retrievalStep(0, 'Fluchtweg GK4')]
    const cards = [card('a'), card('b')]
    const g = buildGraph(
      { ...base, steps, answerConfidence: 'high' },
      t,
      planFan(DESKTOP_W, 2),
      cards
    )
    expect(g.nodes.filter((n) => n.type === 'round')).toHaveLength(0)
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'framing', target: 'col-0' }))
  })

  test('two retrieval rounds become a spine, then the fan', () => {
    const steps = [retrievalStep(0, 'OIB 3 Pkt. 3.4.2'), retrievalStep(1, 'Überhang Dachrand')]
    const cards = [card('a'), card('b')]
    const g = buildGraph(
      { ...base, steps, answerConfidence: 'high' },
      t,
      planFan(DESKTOP_W, 2),
      cards
    )
    expect(g.nodes.map((n) => n.id)).toEqual(['framing', 'round-0', 'round-1', 'findings'])
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'framing', target: 'round-0' }))
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'round-0', target: 'round-1' }))
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'round-1', target: 'findings' }))
    expect(g.nodes.filter((n) => n.type === 'sourceColumn')).toHaveLength(0)
    expect(g.edges.filter((e) => e.source === 'framing' && e.target.includes('col-'))).toHaveLength(0)
    expect(columnToColumnEdges(g)).toHaveLength(0)
    expect(g.rows).toEqual([['framing'], ['round-0'], ['round-1'], ['findings']])
  })

  test('each checkpoint hangs the files THAT fetch returned', () => {
    const steps = [
      retrievalStep(0, 'OIB 2'),
      toolHit('oib', 'a', 0),
      retrievalStep(1, 'Grundriss', 'Die Richtlinie staffelt nach GK — der Plan fehlt.'),
      toolHit('plan', 'b', 1),
    ]
    const g = buildGraph(
      { ...base, steps, answerConfidence: 'high' },
      t,
      planFan(DESKTOP_W, 2),
      [card('a'), card('b')]
    )
    expect(columnCards(g)).toEqual([['a'], ['b']])
    expect(g.nodes.map((n) => n.id)).toEqual([
      'framing',
      'round-0',
      'r0-col-0',
      'round-1',
      'r1-col-0',
      'findings',
    ])
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'round-0', target: 'r0-col-0' }))
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'r0-col-0', target: 'round-1' }))
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'round-1', target: 'r1-col-0' }))
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'r1-col-0', target: 'findings' }))
    const round0 = g.nodes.find((n) => n.id === 'round-0')!.data as { actions: string[] }
    const round1 = g.nodes.find((n) => n.id === 'round-1')!.data as { text: string; actions: string[] }
    expect(round0.actions).toEqual(['thinking.stepName.corpus'])
    expect(round1.text).toContain('der Plan fehlt')
    expect(g.rows).toEqual([
      ['framing'],
      ['round-0'],
      ['r0-col-0'],
      ['round-1'],
      ['r1-col-0'],
      ['findings'],
    ])
  })

  test('a merged knowledge_search step still hangs each fetch\'s files on its checkpoint', () => {
    const merged = storedStep({
      id: 'sources:merged',
      kind: 'sources',
      tool: 'knowledge_search',
      lanes: [
        { key: 'building_law_oib', label: 'OIB-Richtlinie', kind: 'building_law', hit_count: 1, sources: [{ name: 'a.pdf', round: 0 }] },
        { key: 'project', label: 'Projektwissen', kind: 'project', hit_count: 1, sources: [{ name: 'b.pdf', round: 1 }] },
      ],
    })
    const g = buildGraph(
      {
        ...base,
        steps: [retrievalStep(0, 'OIB 2'), retrievalStep(1, 'Grundriss'), merged],
        answerConfidence: 'high',
      },
      t,
      planFan(DESKTOP_W, 2),
      [card('a'), card('b')]
    )
    expect(columnCards(g)).toEqual([['a'], ['b']])
  })

  test('the spine speaks the checkpoint, never the search query (PF-12)', () => {
    const steps = [
      retrievalStep(0, 'OIB 3 Pkt. 3.4.2'),
      retrievalStep(
        1,
        'Überhang Dachrand',
        'OIB 3 Pkt. 3.4.2 verweist auf den lichten Einfallswinkel — messe den Überhang.'
      ),
    ]
    const g = buildGraph(
      { ...base, steps, answerConfidence: 'high' },
      t,
      planFan(DESKTOP_W, 2),
      [card('a'), card('b')]
    )
    const round0 = g.nodes.find((n) => n.id === 'round-0')!.data as {
      label: string
      sub: string
      text: string
    }
    const round1 = g.nodes.find((n) => n.id === 'round-1')!.data as {
      label: string
      sub: string
      text: string
    }
    expect(round0.text).toBe('')
    expect(round0.label).toBe('thinking.node.stepTab')
    expect(round1.label).toBe('thinking.node.stepTab')
    expect(round0.sub).toBe('thinking.node.stepKindSearch')
    expect(round1.sub).toBe('thinking.node.stepKindConclusion')
    expect(round1.text).toBe(
      'OIB 3 Pkt. 3.4.2 verweist auf den lichten Einfallswinkel — messe den Überhang.'
    )
    expect(round0.text).not.toContain('OIB 3 Pkt. 3.4.2')
    expect(round1.text).not.toContain('Überhang Dachrand')
  })

  test('the typed sublabel reads reason × files off the round', () => {
    const steps = [
      retrievalStep(0, 'q0', 'Die Grundregel steht.'),
      toolHit('a', 'a', 0),
      retrievalStep(1, 'q1'),
      toolHit('b', 'b', 1),
    ]
    const g = buildGraph(
      { ...base, steps, answerConfidence: 'high' },
      t,
      planFan(DESKTOP_W, 2),
      [card('a'), card('b')]
    )
    const sub = (i: number) =>
      (g.nodes.find((n) => n.id === `round-${i}`)!.data as { sub: string }).sub
    expect(sub(0)).toBe('thinking.node.stepKindFinding')
    expect(sub(1)).toBe('thinking.node.stepKindRead')
  })

  test.each(['de', 'en'])('%s numbers every layer Schritt N / Step N, with the kind beside it', (locale) => {
    const dictionary = locale === 'de' ? de : en
    const translator = createTranslator(dictionary, 'chat') as Translator
    const steps = [
      retrievalStep(0, 'q0', 'Zuerst die Grundregel.'),
      toolHit('a', 'a', 0),
      retrievalStep(1, 'q1'),
    ]
    const g = buildGraph(
      { ...base, steps, answerConfidence: 'high' },
      translator,
      planFan(DESKTOP_W, 1),
      [card('a')]
    )
    const layer = (i: number) =>
      g.nodes.find((n) => n.id === `round-${i}`)!.data as { label: string; sub: string }
    expect(layer(0).label).toContain('1')
    expect(layer(1).label).toContain('2')
    for (const i of [0, 1]) {
      expect(layer(i).label).not.toContain('thinking.')
      expect(layer(i).sub).not.toContain('thinking.')
      expect(layer(i).sub.trim().length).toBeGreaterThan(0)
    }
    expect(layer(0).label).not.toEqual(layer(1).label)
  })

  test('stacked columns keep exactly two straight edges each — nothing pierces a card', () => {
    const cards = Array.from({ length: 8 }, (_, i) => card(`s${i}`))
    const fan = planFan(DESKTOP_W, 8)
    const g = buildGraph({ ...base, answerConfidence: 'high' }, t, fan, cards)

    const columnIds = g.nodes.filter((n) => n.type === 'sourceColumn').map((n) => n.id)
    expect(columnIds.length).toBe(fan.columns.length)
    expect(g.edges.filter((e) => e.target.startsWith('col-'))).toHaveLength(columnIds.length)
    expect(g.edges.filter((e) => e.source.startsWith('col-'))).toHaveLength(columnIds.length)
    expect(columnToColumnEdges(g)).toHaveLength(0)
    expect(columnCards(g).flat().sort()).toEqual(cards.map((c) => c.id).sort())
  })

  test('phone: the single grouped column takes one centred edge in and one out', () => {
    const g = buildGraph({ ...base, answerConfidence: 'high' }, t, planFan(PHONE_W, 2), [card('a'), card('b')])

    expect(g.nodes.map((n) => n.id)).toEqual(['framing', 'col-0', 'findings'])
    expect((g.nodes.find((n) => n.id === 'col-0')!.data as unknown as { grouped: boolean }).grouped).toBe(true)
    expect(framingHandles(g)).toEqual(['c-bottom'])
    expect(g.edges).toHaveLength(2)
    expect(g.edges).toContainEqual(
      expect.objectContaining({ source: 'framing', sourceHandle: 'c-bottom', target: 'col-0', targetHandle: 'in' })
    )
    expect(g.edges).toContainEqual(
      expect.objectContaining({ source: 'col-0', sourceHandle: 'out', target: 'findings', targetHandle: 'c-top' })
    )
    expect(g.rows).toEqual([['framing'], ['col-0'], ['findings']])
  })
})

describe('the live frontier: only the connectors into the newest row march', () => {
  const liveSpine = (): ReasoningFlowProps => ({
    ...base,
    live: true,
    steps: [
      retrievalStep(0, 'q0', 'Grundregel steht.'),
      toolHit('h0', 'a', 0),
      retrievalStep(1, 'q1', 'Treppenraum offen.'),
      toolHit('h1', 'b', 1),
    ],
  })

  test('while live, exactly the edges into the newest row are animated', () => {
    const cards = [card('a'), card('b')]
    const g = buildGraph(liveSpine(), t, planFan(DESKTOP_W, 2), cards)
    const newest = g.rows.at(-1)!
    const edges = animateFrontier(g.edges, newest)
    const into = edges.filter((e) => newest.includes(e.target))
    expect(into.length).toBeGreaterThan(0)
    for (const e of into) expect(e.animated).toBe(true)
    for (const e of edges.filter((e) => !newest.includes(e.target))) expect(e.animated).toBeUndefined()
  })

  test('a settled graph has no animated edge', () => {
    const cards = [card('a'), card('b')]
    const g = buildGraph({ ...liveSpine(), live: false, answerConfidence: 'high' }, t, planFan(DESKTOP_W, 2), cards)
    expect(g.edges.length).toBeGreaterThan(0)
    expect(animateFrontier(g.edges, []).some((e) => e.animated)).toBe(false)
    expect(g.edges.some((e) => e.animated)).toBe(false)
  })

  test('an unchanged edge keeps its object across a rebuild', () => {
    const cards = [card('a'), card('b')]
    const first = buildGraph(liveSpine(), t, planFan(DESKTOP_W, 2), cards).edges
    const again = keepEdgeIdentity(first, buildGraph(liveSpine(), t, planFan(DESKTOP_W, 2), cards).edges)
    expect(again).toBe(first)
  })
})

describe('a ledger round draws its own fan', () => {
  const steps: StoredThinkingStep[] = [
    retrievalStep(0, 'Fluchtweglänge GK4'),
    toolHit('a0', 'a', 0),
    toolHit('b0', 'b', 0),
    retrievalStep(1, 'Treppenraum', 'Die Grundregel steht.', ['read_passage']),
    toolHit('a1', 'a', 1),
    toolHit('b1', 'b', 1),
    retrievalStep(2, 'Treppenraum', 'Ich lese die Punkte selbst.', ['read_passage']),
    toolHit('a2', 'a', 2),
  ]

  const entry = (
    index: number,
    docs: RetrievalLedger[number]['docs'],
    newDocs: string[],
    tools: string[]
  ): RetrievalLedger[number] => ({
    index,
    key: 'status.retrieval.withQuery',
    tools,
    corpora: ['knowledge'],
    docs,
    newDocs,
    hits: docs.length,
    documents: new Set(docs.map((d) => d.name.toLowerCase())).size,
  })

  const ledger: RetrievalLedger = [
    entry(0, [{ name: 'a.pdf' }, { name: 'b.pdf' }], ['a.pdf', 'b.pdf'], ['knowledge_search']),
    entry(
      1,
      [
        { name: 'a.pdf', detail: 'S. 12' },
        { name: 'b.pdf', detail: 'S. 3' },
      ],
      ['a.pdf', 'b.pdf'],
      ['read_passage']
    ),
    entry(
      2,
      [
        { name: 'a.pdf', detail: 'Pkt. 3.1' },
        { name: 'a.pdf', detail: 'Pkt. 3.2' },
      ],
      [],
      ['read_passage']
    ),
  ]

  const build = (retrievalLedger?: RetrievalLedger) =>
    buildGraph(
      { ...base, steps, answerConfidence: 'high', ...(retrievalLedger ? { retrievalLedger } : {}) },
      t,
      planFan(DESKTOP_W, 2),
      [card('a'), card('b')]
    )

  test('each slot is the same turn-level card, at the loci THAT round read', () => {
    const g = build(ledger)
    expect(fanSlots(g, 1).map((s) => s.card?.id)).toEqual(['a', 'b'])
    expect(fanSlots(g, 1).map((s) => s.loci?.map((l) => l.detail))).toEqual([['S. 12'], ['S. 3']])
    expect(fanSlots(g, 0).map((s) => s.loci?.map((l) => l.detail))).toEqual([[undefined], [undefined]])
  })

  test('one document opened at two clauses is ONE slot carrying both', () => {
    const g = build(ledger)
    const slots = fanSlots(g, 2)
    expect(slots.map((s) => s.card?.id)).toEqual(['a'])
    expect(slots[0]!.loci?.map((l) => l.detail)).toEqual(['Pkt. 3.1', 'Pkt. 3.2'])
  })

  test('a file an earlier round OPENED is marked; one a search only ranked is not', () => {
    const g = build(ledger)
    expect(fanSlots(g, 0).map((s) => s.loci?.map((l) => l.repeat))).toEqual([[false], [false]])
    expect(fanSlots(g, 1).map((s) => s.loci?.map((l) => l.repeat))).toEqual([[false], [false]])
    expect(fanSlots(g, 2).map((s) => s.loci?.map((l) => l.repeat))).toEqual([[true, true]])
  })

  test('a ledger doc the card model has no card for keeps its slot, bare', () => {
    const g = build([
      ledger[0]!,
      entry(1, [{ name: 'a.pdf', detail: 'S. 12' }, { name: 'Reparatur.pdf', detail: 'S. 1' }], [], [
        'read_passage',
      ]),
    ])
    const slots = fanSlots(g, 1)
    expect(slots.map((s) => s.card?.id)).toEqual(['a', undefined])
    expect(slots[1]!.name).toBe('Reparatur.pdf')
    expect(slots[1]!.loci).toEqual([{ detail: 'S. 1', repeat: true }])
  })

  test('no ledger: the fan is the filename match, exactly as before', () => {
    const g = build()
    expect(columnCards(g)).toEqual([['a'], ['b'], ['a'], ['b'], ['a']])
    for (const i of [0, 1]) expect(fanSlots(g, i).map((s) => s.loci)).toEqual([undefined, undefined])
  })

  test('a round the ledger does not have falls back on its own', () => {
    const g = build([ledger[0]!])
    expect(fanSlots(g, 0).map((s) => s.loci?.map((l) => l.repeat))).toEqual([[false], [false]])
    expect(fanSlots(g, 1).map((s) => s.loci)).toEqual([undefined, undefined])
    expect(columnCards(g)).toEqual([['a'], ['b'], ['a'], ['b'], ['a']])
  })

  test('a round that only opened passages is an Öffnen layer, not a search', () => {
    const g = build(ledger)
    const sub = (i: number) => (g.nodes.find((n) => n.id === `round-${i}`)!.data as { sub: string }).sub
    expect(sub(0)).toBe('thinking.node.stepKindRead')
    expect(sub(1)).toBe('thinking.node.stepKindOpen')
  })

  test('a ledger round that returned nothing is a miss, not a search', () => {
    const empty: RetrievalLedger = [entry(0, [], [], ['knowledge_search']), ledger[1]!, ledger[2]!]
    const g = build(empty)
    const sub = (i: number) => (g.nodes.find((n) => n.id === `round-${i}`)!.data as { sub: string }).sub
    expect(sub(0)).toBe('thinking.node.stepKindNoHits')
    const concluded: RetrievalLedger = [entry(0, [], [], ['knowledge_search']), ledger[1]!, ledger[2]!]
    const withThought = buildGraph(
      {
        ...base,
        steps: [retrievalStep(0, 'Fluchtweg', 'Die Regel steht nicht im Bestand.'), ...steps.slice(1)],
        answerConfidence: 'high',
        retrievalLedger: concluded,
      },
      t,
      planFan(DESKTOP_W, 2),
      [card('a'), card('b')]
    )
    expect((withThought.nodes.find((n) => n.id === 'round-0')!.data as { sub: string }).sub).toBe(
      'thinking.node.stepKindNoHits'
    )
    const legacy = build(undefined)
    expect(
      (legacy.nodes.find((n) => n.id === 'round-0')!.data as { sub: string }).sub
    ).not.toBe('thinking.node.stepKindNoHits')
  })

  test.each(['de', 'en'])('%s spells the Öffnen layer', (locale) => {
    const translator = createTranslator(locale === 'de' ? de : en, 'chat') as Translator
    const g = buildGraph(
      { ...base, steps, answerConfidence: 'high', retrievalLedger: ledger },
      translator,
      planFan(DESKTOP_W, 2),
      [card('a'), card('b')]
    )
    const sub = (g.nodes.find((n) => n.id === 'round-1')!.data as { sub: string }).sub
    expect(sub).toBe(locale === 'de' ? 'Öffnen' : 'Open')
  })

  test('a folded ledger round folds to the locus IT read, never the turn aggregate', () => {
    const cited: CitedDocument = {
      ...card('a'),
      loci: [{ key: 'p:4', page: 4, isCited: true, number: 1 }],
    }
    const folding: SpineFolding = { folded: new Set([1]), onToggle: () => {} }
    const g = buildGraph(
      {
        ...base,
        steps,
        answerConfidence: 'high',
        retrievalLedger: [
          ledger[0]!,
          entry(1, [{ name: 'a.pdf', detail: 'S. 12' }], [], ['read_passage']),
        ],
      },
      createTranslator(de, 'chat') as Translator,
      planFan(DESKTOP_W, 2),
      [cited],
      folding
    )
    const round1 = g.nodes.find((n) => n.id === 'round-1')!.data as { foldSummary: string }
    expect(round1.foldSummary).toContain('S. 12')
    expect(round1.foldSummary).not.toContain('S. 4')
  })
})
