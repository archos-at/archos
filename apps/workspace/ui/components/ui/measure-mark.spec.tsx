import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MeasureEnd, MeasureLabel, MeasureLine } from './measure-mark'
import { MEASURE_STROKE, labelAnchor, measureMarkerPath, type MeasureMarkKind } from './measure-mark-recipe'

const inSvg = (node: React.ReactNode) => render(<svg>{node}</svg>).container

describe('the measuring line', () => {
  it('lays the hairline in ink over a wider halo, so it reads over any drawing or facade', () => {
    const svg = inSvg(<MeasureLine points={[[0, 0], [20, 30]]} />)
    const halo = svg.querySelector('[data-part="halo"]')!
    const line = svg.querySelector('[data-part="line"]')!
    expect(halo.tagName).toBe('polyline')
    expect(line.getAttribute('points')).toBe('0,0 20,30')
    expect(halo.getAttribute('stroke')).toBe('var(--background)')
    expect(line.getAttribute('stroke')).toBe('var(--foreground)')
    expect(Number(halo.getAttribute('stroke-width'))).toBeGreaterThan(Number(line.getAttribute('stroke-width')))
    expect(line.getAttribute('stroke-linecap')).toBe('round')
    expect(line.getAttribute('stroke-dasharray')).toBeNull()
  })

  it('is dashed while a point is still being placed', () => {
    const svg = inSvg(<MeasureLine points={[[0, 0], [10, 0]]} placing />)
    for (const part of svg.querySelectorAll('[data-part]')) {
      expect(part.getAttribute('stroke-dasharray')).toBe(MEASURE_STROKE.placingDash)
    }
  })

  it('closes an area into a polygon with a faint fill of the same ink', () => {
    const svg = inSvg(<MeasureLine points={[[0, 0], [10, 0], [10, 10]]} closed />)
    const line = svg.querySelector('[data-part="line"]')!
    expect(line.tagName).toBe('polygon')
    expect(line.getAttribute('fill')).toBe('var(--foreground)')
    expect(Number(line.getAttribute('fill-opacity'))).toBeLessThan(0.15)
    expect(svg.querySelector('[data-part="halo"]')!.getAttribute('fill')).toBe('none')
  })

  it('draws nothing for a single point', () => {
    expect(inSvg(<MeasureLine points={[[1, 1]]} />).querySelector('[data-slot="measure-line"]')).toBeNull()
  })
})

describe('the end markers', () => {
  const cases: Array<[MeasureMarkKind, string]> = [
    ['vertex', 'H'],
    ['edge', 'L'],
    ['face', 'a'],
    ['free', 'a'],
  ]
  it.each(cases)('marks a %s with its own shape', (kind, command) => {
    const svg = inSvg(<MeasureEnd at={[5, 7]} kind={kind} />)
    const end = svg.querySelector('[data-slot="measure-end"]')!
    expect(end.getAttribute('d')).toContain(command)
    expect(end.getAttribute('d')).toBe(measureMarkerPath(kind))
    expect(end.getAttribute('transform')).toBe('translate(5 7)')
  })

  it('tells a corner from a point on a line from a point on a face', () => {
    const shapes = new Set((['vertex', 'edge', 'face'] as const).map((kind) => measureMarkerPath(kind)))
    expect(shapes.size).toBe(3)
  })
})

describe('the label', () => {
  it('is a sheet pill at the anchor in tabular figures', () => {
    render(<MeasureLabel x={12} y={30}>5,00 m</MeasureLabel>)
    const label = screen.getByText('5,00 m')
    expect(label).toHaveClass('bg-sheet', 'rounded-full', 'text-meta', 'tabular-nums', 'text-foreground')
    expect(label).not.toHaveClass('font-mono')
    expect(label.style.left).toBe('12px')
    expect(label.style.top).toBe('30px')
  })

  it('reads as provisional in a muted tone and with ≈ before the value', () => {
    render(<MeasureLabel x={0} y={0} provisional>5,00 m</MeasureLabel>)
    const label = screen.getByText(/5,00 m/)
    expect(label.textContent).toBe('≈ 5,00 m')
    expect(label).toHaveClass('text-muted-foreground')
    expect(label).not.toHaveClass('text-foreground')
    expect(label).toHaveAttribute('data-provisional')
  })
})

describe('where the label hangs', () => {
  it('is the midpoint of a line', () => {
    expect(labelAnchor([[0, 0], [10, 20]])).toEqual([5, 10])
  })

  it('is halfway along a path, on the path', () => {
    expect(labelAnchor([[0, 0], [10, 0], [10, 30]])).toEqual([10, 10])
  })

  it('is the centroid of an area, not the mean of its corners', () => {
    const [x, y] = labelAnchor([[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]], true)
    expect(x).toBeCloseTo(1.357, 3)
    expect(y).toBeCloseTo(1.357, 3)
  })

  it('falls back to the corners mean for a flat area and to the point itself for one point', () => {
    expect(labelAnchor([[0, 0], [2, 0], [4, 0]], true)).toEqual([2, 0])
    expect(labelAnchor([[3, 4]])).toEqual([3, 4])
    expect(labelAnchor([])).toEqual([0, 0])
  })
})

describe('on a document page, which stays paper in both themes', () => {
  it('draws the same line in the paper ink, never the theme ink', () => {
    const svg = inSvg(
      <>
        <MeasureLine points={[[0, 0], [10, 0]]} surface="paper" />
        <MeasureEnd at={[0, 0]} kind="vertex" surface="paper" />
      </>
    )
    expect(svg.querySelector('[data-part="line"]')!.getAttribute('stroke')).toBe('var(--paper-ink)')
    expect(svg.querySelector('[data-part="halo"]')!.getAttribute('stroke')).toBe('var(--paper-ink-foreground)')
    const end = svg.querySelector('[data-slot="measure-end"]')!
    expect(end.getAttribute('stroke')).toBe('var(--paper-ink)')
    expect(end.getAttribute('fill')).toBe('var(--paper-ink-foreground)')
    expect(end.getAttribute('d')).toBe(measureMarkerPath('vertex'))
  })

  it('keeps the label shape and takes the paper pair, muted when provisional', () => {
    render(
      <>
        <MeasureLabel x={0} y={0} surface="paper">kept</MeasureLabel>
        <MeasureLabel x={0} y={0} surface="paper" provisional>live</MeasureLabel>
      </>
    )
    const kept = screen.getByText('kept')
    expect(kept).toHaveClass('bg-paper-ink-foreground', 'text-paper-ink', 'rounded-full', 'text-meta', 'shadow-xs')
    expect(kept).not.toHaveClass('bg-sheet', 'text-foreground')
    const live = screen.getByText(/live/)
    expect(live).toHaveClass('bg-paper-ink-foreground', 'text-paper-ink/65')
    expect(live).not.toHaveClass('text-muted-foreground')
  })
})
