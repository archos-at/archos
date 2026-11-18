import { describe, test, expect } from 'vitest'
import { buildGraph } from './build-graph'
import { planFan } from './flow-layout'
import type { ReasoningFlowProps } from './reasoning-flow-props'
import { DESKTOP_W, base, card, framingHandles, t, targetHandles, technicalStep } from './reasoning-flow.fixtures'

describe('buildGraph — the fan splits from one line and merges back into one', () => {
  test('every column edge shares the framing exit and the assessment entry point', () => {
    const fan = planFan(DESKTOP_W, 3)
    const g = buildGraph({ ...base, answerConfidence: 'high' }, t, fan, [card('a'), card('b'), card('c')])

    expect(framingHandles(g)).toEqual(['c-bottom'])
    expect(targetHandles(g, 'findings')).toEqual(['c-top'])

    const out = g.edges.filter((e) => e.source === 'framing')
    const back = g.edges.filter((e) => e.target === 'findings')
    expect(out).toHaveLength(3)
    expect(back).toHaveLength(3)
    expect(new Set(out.map((e) => e.sourceHandle))).toEqual(new Set(['c-bottom']))
    expect(new Set(back.map((e) => e.targetHandle))).toEqual(new Set(['c-top']))

    expect(framingHandles(g)).toEqual(['c-bottom'])
    for (const id of ['framing', 'findings']) {
      expect(g.nodes.find((n) => n.id === id)!.position.x).toBe(0)
    }
  })
})

describe('buildGraph — the fan-in shares one centred anchor (P1-5)', () => {
  test('every column merges into the assessment on its single centre handle', () => {
    const g = buildGraph({ ...base, answerConfidence: 'medium' }, t, planFan(DESKTOP_W, 2), [card('a'), card('b')])

    expect(targetHandles(g, 'findings')).toEqual(['c-top'])
    for (const col of ['col-0', 'col-1']) {
      expect(g.edges).toContainEqual(
        expect.objectContaining({ source: col, target: 'findings', targetHandle: 'c-top' })
      )
    }
  })

  test('a HITL choice is not drawn in the graph: its one home is the prompt card', () => {
    const g = buildGraph({ ...base, answerConfidence: 'medium' }, t, planFan(DESKTOP_W, 2), [card('a'), card('b')])
    expect(g.nodes.map((n) => n.type)).not.toContain('branches')
  })
})

describe('buildGraph — only the handles a layout needs (P2-8)', () => {
  test('no sources: framing feeds the converge node from a single centre handle', () => {
    const g = buildGraph(
      {
        ...base,
        answerConfidence: 'low',
        steps: [
          technicalStep('degraded', {
            degraded: true,
            agent: 'deep',
            reasons: ['no_valid_citations'],
          }),
        ],
      },
      t,
      planFan(DESKTOP_W, 0),
      []
    )
    expect(framingHandles(g)).toEqual(['c-bottom'])
    expect(targetHandles(g, 'findings')).toEqual(['c-top'])
    expect(g.edges).toContainEqual(
      expect.objectContaining({ source: 'framing', target: 'findings', sourceHandle: 'c-bottom' })
    )
  })

  test('every node declares its full handle set, whatever the turn is missing', () => {
    const bare = buildGraph({ ...base, live: true }, t, planFan(DESKTOP_W, 0), [])
    expect(framingHandles(bare)).toEqual(['c-bottom'])

    const streamed = buildGraph({ ...base, live: true }, t, planFan(DESKTOP_W, 1), [card('a')])
    expect(framingHandles(streamed)).toEqual(framingHandles(bare))

    const settled = buildGraph({ ...base, answerConfidence: 'high' }, t, planFan(DESKTOP_W, 1), [card('a')])
    const bottomHandle = (g: ReturnType<typeof buildGraph>) =>
      (g.nodes.find((n) => n.id === 'findings')!.data as { source: { id: string; left: string } }).source
    expect(bottomHandle(settled)).toEqual({ id: 'out', left: '50%' })
  })

  test('every edge lands on a handle its node actually declares', () => {
    const declared = (g: ReturnType<typeof buildGraph>, id: string) => {
      const d = g.nodes.find((n) => n.id === id)!.data as {
        sources?: Array<{ id: string }>
        targets?: Array<{ id: string }>
        source?: { id: string }
      }
      return new Set([
        ...(d.sources ?? []).map((h) => h.id),
        ...(d.targets ?? []).map((h) => h.id),
        ...(d.source ? [d.source.id] : []),
        ...(id.startsWith('col-') ? ['in', 'out'] : []),
      ])
    }
    const shapes: ReasoningFlowProps[] = [
      { ...base, live: true },
      { ...base, live: true },
      { ...base, answerConfidence: 'high' },
    ]
    for (const props of shapes) {
      for (const n of [0, 1, 5]) {
        const cards = Array.from({ length: n }, (_, i) => card(`s${i}`))
        const g = buildGraph(props, t, planFan(DESKTOP_W, n), cards)
        for (const e of g.edges) {
          expect(declared(g, e.source)).toContain(e.sourceHandle!)
          expect(declared(g, e.target)).toContain(e.targetHandle!)
        }
      }
    }
  })
})
