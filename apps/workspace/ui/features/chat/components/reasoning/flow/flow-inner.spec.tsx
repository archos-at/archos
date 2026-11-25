import { describe, expect, test } from 'vitest'
import { render, screen } from '@/test-utils'
import { buildGraph } from './build-graph'
import { edgeEnds, FlowInner } from './flow-inner'
import { stepPath } from './flow-edges'
import { planFan } from './flow-layout'
import { DESKTOP_W, base, card, t } from './reasoning-flow.fixtures'

const graph = () => {
  const layout = planFan(DESKTOP_W, 2)
  return { layout, built: buildGraph({ ...base, answerConfidence: 'high' }, t, layout, [card('a'), card('b')]) }
}

describe('the Herleitung lays itself out before the first paint', () => {
  test('every row stands in the document flow with its nodes, nothing hidden while a library measures', () => {
    const { built, layout } = graph()
    render(<FlowInner built={built} layout={layout} live={false} />)
    const pane = screen.getByTestId('reasoning-flow')
    const rows = pane.querySelectorAll('[data-flow-row]')
    expect([...rows].map((row) => [...row.querySelectorAll('[data-flow-node]')].map((n) => n.getAttribute('data-id')))).toEqual(
      built.rows
    )
    for (const element of [pane, ...pane.querySelectorAll<HTMLElement>('*')]) {
      expect(element.style.opacity).not.toBe('0')
      expect(element.style.visibility).not.toBe('hidden')
      expect(element.style.height).toBe('')
    }
  })

  test('a node stands at the column its fan planned', () => {
    const { built, layout } = graph()
    render(<FlowInner built={built} layout={layout} live={false} />)
    const column = document.querySelector<HTMLElement>('[data-flow-node][data-id="col-1"]')!
    expect(column.style.marginLeft).toBe(`${built.nodes.find((n) => n.id === 'col-1')!.position.x}px`)
  })

  test('no part of the graph claims the finger scrolling past it', () => {
    const { built, layout } = graph()
    render(<FlowInner built={built} layout={layout} live />)
    const pane = screen.getByTestId('reasoning-flow')
    expect(pane.querySelector('.react-flow__pane')).toBeNull()
    for (const element of [pane, ...pane.querySelectorAll<HTMLElement>('*')]) {
      expect(element.style.touchAction).toBe('')
    }
  })
})

describe('a connector joins the boxes the browser laid out', () => {
  const { built } = graph()
  const nodes = new Map(built.nodes.map((n) => [n.id, n]))
  const boxes = new Map([
    ['framing', { left: 0, top: 0, width: 600, height: 80 }],
    ['col-1', { left: 320, top: 120, width: 200, height: 140 }],
    ['findings', { left: 0, top: 300, width: 600, height: 90 }],
  ])

  test('a split leaves the framing at its bottom centre and enters a column below its folder tab', () => {
    const split = built.edges.find((e) => e.source === 'framing' && e.target === 'col-1')!
    const inTop = (nodes.get('col-1')!.data as { inTop: number }).inTop
    expect(edgeEnds(split, nodes, boxes)).toEqual({ from: { x: 300, y: 80 }, to: { x: 420, y: 120 + inTop } })
  })

  test('a merge leaves a column at its bottom centre and enters the findings at their top centre', () => {
    const merge = built.edges.find((e) => e.source === 'col-1' && e.target === 'findings')!
    expect(edgeEnds(merge, nodes, boxes)).toEqual({ from: { x: 420, y: 260 }, to: { x: 300, y: 300 } })
  })

  test('the step turns half a row gap below a split and above a merge, with rounded bends', () => {
    expect(stepPath({ x: 300, y: 80 }, { x: 420, y: 130 }, 'split')).toBe(
      'M 300,80 L 300,88 Q 300,100 312,100 L 408,100 Q 420,100 420,112 L 420,130'
    )
    expect(stepPath({ x: 420, y: 260 }, { x: 300, y: 300 }, 'merge')).toBe(
      'M 420,260 L 420,268 Q 420,280 408,280 L 312,280 Q 300,280 300,292 L 300,300'
    )
    expect(stepPath({ x: 300, y: 80 }, { x: 300, y: 120 }, 'merge')).toBe('M 300,80 L 300,120')
  })
})
