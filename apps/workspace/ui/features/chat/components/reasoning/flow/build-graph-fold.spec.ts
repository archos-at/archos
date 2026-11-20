import { describe, test, expect } from 'vitest'
import { buildGraph } from './build-graph'
import { defaultFoldedRounds, type SpineFolding } from './round-kind'
import { planFan } from './flow-layout'
import type { CitedDocument } from '../../../lib/citations'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { createTranslator } from '@/i18n/translate'
import type { Translator } from '@/i18n'
import { DESKTOP_W, base, card, de, en, retrievalStep, t, toolHit } from './reasoning-flow.fixtures'

describe('a checkpoint layer folds its own fan (ledger 19)', () => {
  const spine = (n: number, folding?: SpineFolding) => {
    const steps: StoredThinkingStep[] = []
    for (let i = 0; i < n; i++) {
      steps.push(retrievalStep(i, `query ${i}`, `Folgerung ${i}`))
      steps.push(toolHit(`h${i}`, `s${i}`, i))
    }
    const cards = Array.from({ length: n }, (_, i) => card(`s${i}`))
    return buildGraph(
      { ...base, steps, answerConfidence: 'high' },
      t,
      planFan(DESKTOP_W, 1),
      cards,
      folding
    )
  }

  const roundData = (g: ReturnType<typeof buildGraph>, i: number) =>
    g.nodes.find((n) => n.id === `round-${i}`)!.data as unknown as {
      foldable: boolean
      folded: boolean
      foldSummary: string
      toggleLabel: string
      onToggle: () => void
    }

  test('two rounds arrive open — folding half of a comparison hides the comparison', () => {
    expect([...defaultFoldedRounds(2)]).toEqual([])
    const g = spine(2, { folded: defaultFoldedRounds(2), onToggle: () => {} })
    expect(g.nodes.map((n) => n.id)).toEqual([
      'framing',
      'round-0',
      'r0-col-0',
      'round-1',
      'r1-col-0',
      'findings',
    ])
    expect(roundData(g, 0).folded).toBe(false)
    expect(roundData(g, 1).folded).toBe(false)
  })

  test('three rounds arrive open — evidence hidden by default reads as no evidence', () => {
    expect([...defaultFoldedRounds(3)]).toEqual([])
    expect([...defaultFoldedRounds(4)]).toEqual([])
    const g = spine(3, { folded: defaultFoldedRounds(3), onToggle: () => {} })
    expect(g.nodes.map((n) => n.id)).toEqual([
      'framing',
      'round-0',
      'r0-col-0',
      'round-1',
      'r1-col-0',
      'round-2',
      'r2-col-0',
      'findings',
    ])
    expect(g.rows).toEqual([
      ['framing'],
      ['round-0'],
      ['r0-col-0'],
      ['round-1'],
      ['r1-col-0'],
      ['round-2'],
      ['r2-col-0'],
      ['findings'],
    ])
  })

  test('a folded checkpoint wires straight into the next one', () => {
    const g = spine(3, { folded: new Set([0, 1]), onToggle: () => {} })
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'round-0', target: 'round-1' }))
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'round-1', target: 'round-2' }))
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'round-2', target: 'r2-col-0' }))
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'r2-col-0', target: 'findings' }))
    const ids = new Set(g.nodes.map((n) => n.id))
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true)
      expect(ids.has(e.target)).toBe(true)
    }
  })

  test('the fold summary carries scent — count plus the top filenames, never the query', () => {
    const steps = [
      retrievalStep(0, 'Fluchtweglänge GK4', 'Zuerst die Grundregel.'),
      toolHit('a', 'OIB-RL_2', 0),
      toolHit('b', 'Brandschutzkonzept', 0),
      toolHit('c', 'Grundriss_EG', 0),
      retrievalStep(1, 'Treppenraum Entrauchung', 'Offen ist der Treppenraum.'),
      toolHit('d', 'Bauordnung', 1),
    ]
    const cards = [card('OIB-RL_2'), card('Brandschutzkonzept'), card('Grundriss_EG'), card('Bauordnung')]
    for (const dictionary of [de, en]) {
      const translator = createTranslator(dictionary, 'chat') as Translator
      const g = buildGraph(
        { ...base, steps, answerConfidence: 'high' },
        translator,
        planFan(DESKTOP_W, 4),
        cards,
        { folded: new Set([0]), onToggle: () => {} }
      )
      const folded = roundData(g, 0)
      expect(folded.foldSummary).toContain('3')
      expect(folded.foldSummary).toContain('OIB-RL_2')
      expect(folded.foldSummary).toContain(dictionary === de ? 'u.a.' : 'and others')
      expect(folded.foldSummary).not.toContain('Fluchtweg')
    }
    const g = buildGraph(
      { ...base, steps, answerConfidence: 'high' },
      createTranslator(de, 'chat') as Translator,
      planFan(DESKTOP_W, 4),
      cards,
      { folded: new Set([0]), onToggle: () => {} }
    )
    expect(roundData(g, 0).toggleLabel).toBe('Schritt 1 aufklappen')
    expect(roundData(g, 1).toggleLabel).toBe('Schritt 2 zuklappen')
  })

  test('the singular is spelled, in both locales', () => {
    for (const dictionary of [de, en]) {
      const translator = createTranslator(dictionary, 'chat') as Translator
      const paged: CitedDocument = {
        ...card('a'),
        loci: [{ key: 'p3', page: 3, isCited: true }],
      }
      const g = buildGraph(
        {
          ...base,
          steps: [
            retrievalStep(0, 'q0'),
            toolHit('a', 'a', 0),
            retrievalStep(1, 'q1'),
            toolHit('b', 'b', 1),
          ],
          answerConfidence: 'high',
        },
        translator,
        planFan(DESKTOP_W, 2),
        [paged, card('b')],
        { folded: new Set([0]), onToggle: () => {} }
      )
      expect(roundData(g, 0).foldSummary.replace(/\u00A0/g, ' ')).toBe(
        dictionary === de ? 'a · S. 3' : 'a · p. 3'
      )
    }
  })

  test('two files name both, with no count at all', () => {
    const translator = createTranslator(de, 'chat') as Translator
    const g = buildGraph(
      {
        ...base,
        steps: [
          retrievalStep(0, 'q0', 'Zwei Treffer.'),
          toolHit('a', 'OIB-RL_2', 0),
          toolHit('b', 'Brandschutzkonzept', 0),
          retrievalStep(1, 'q1'),
        ],
        answerConfidence: 'high',
      },
      translator,
      planFan(DESKTOP_W, 2),
      [card('OIB-RL_2'), card('Brandschutzkonzept')],
      { folded: new Set([0]), onToggle: () => {} }
    )
    const summary = roundData(g, 0).foldSummary
    expect(summary).toContain('OIB-RL_2')
    expect(summary).toContain('Brandschutzkonzept')
    expect(summary).not.toContain('2 Dateien')
  })

  test('a document the answer never cited folds to its bare name — no borrowed locus', () => {
    for (const dictionary of [de, en]) {
      const translator = createTranslator(dictionary, 'chat') as Translator
      const retrieved: CitedDocument = {
        ...card('a'),
        loci: [{ key: 'p3', page: 3, isCited: false }],
      }
      const g = buildGraph(
        {
          ...base,
          steps: [
            retrievalStep(0, 'q0', 'Zuerst die Grundregel.'),
            toolHit('a', 'a', 0),
            retrievalStep(1, 'q1'),
          ],
          answerConfidence: 'high',
        },
        translator,
        planFan(DESKTOP_W, 1),
        [retrieved],
        { folded: new Set([0]), onToggle: () => {} }
      )
      expect(roundData(g, 0).foldSummary).toBe('a')
    }
  })

  test('a checkpoint that fetched nothing offers no fold — a control that removes nothing', () => {
    const g = buildGraph(
      { ...base, steps: [retrievalStep(0, 'q0'), retrievalStep(1, 'q1')], answerConfidence: 'high' },
      t,
      planFan(DESKTOP_W, 2),
      [card('a'), card('b')],
      { folded: new Set(), onToggle: () => {} }
    )
    expect(roundData(g, 0).foldable).toBe(false)
    expect(roundData(g, 1).foldable).toBe(false)
  })

  test('the toggle reports which layer it belongs to', () => {
    const seen: number[] = []
    const g = spine(3, { folded: defaultFoldedRounds(3), onToggle: (i) => seen.push(i) })
    roundData(g, 0).onToggle()
    roundData(g, 2).onToggle()
    expect(seen).toEqual([0, 2])
  })

  test('one retrieval is not a spine and gains no fold control', () => {
    const g = buildGraph(
      { ...base, steps: [retrievalStep(0, 'q0')], answerConfidence: 'high' },
      t,
      planFan(DESKTOP_W, 1),
      [card('a')]
    )
    expect(g.nodes.filter((n) => n.type === 'round')).toHaveLength(0)
  })
})
