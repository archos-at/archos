import { beforeEach, describe, expect, it } from 'vitest'
import { MeasureOverlay, measurementText, type Projector } from './measure-overlay'
import { completeMeasurement, type MeasureAnchor, type Measurement } from './viewer-measure'

const LABELS = { horizontal: 'horizontal', vertical: 'vertical', locale: 'en-GB' }

const at = (x: number, y: number, z: number, snap: MeasureAnchor['snap'] = 'vertex'): MeasureAnchor => ({
  point: { x, y, z },
  snap,
})

const flat: Projector = (point) => ({ x: point.x * 10, y: point.y * 10 })

const behind: Projector = () => null

function build(): {
  svg: SVGSVGElement
  labels: HTMLDivElement
  overlay: MeasureOverlay
} {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const labels = document.createElement('div')
  document.body.append(svg, labels)
  return { svg, labels, overlay: new MeasureOverlay(svg, labels, LABELS) }
}

const measurement = (from: MeasureAnchor, to: MeasureAnchor): Measurement => {
  const built = completeMeasurement(from, to)
  if (!built) throw new Error('the fixture is a zero-length measurement')
  return built
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('what the overlay draws', () => {
  it('puts the line where the camera projects the two picks', () => {
    const { svg, overlay } = build()
    overlay.setMeasurements([measurement(at(0, 0, 0), at(2, 3, 0))])
    overlay.update(flat)

    const [halo, line] = [...svg.querySelectorAll('line')]
    for (const element of [halo, line]) {
      expect(element.getAttribute('x1')).toBe('0')
      expect(element.getAttribute('y1')).toBe('0')
      expect(element.getAttribute('x2')).toBe('20')
      expect(element.getAttribute('y2')).toBe('30')
    }
    expect(halo.getAttribute('stroke')).toBe('var(--background)')
    expect(line.getAttribute('stroke')).toBe('var(--foreground)')
  })

  it('keeps a hairline readable over a facade of the same tone', () => {
    const { svg, overlay } = build()
    overlay.setMeasurements([measurement(at(0, 0, 0), at(1, 0, 0))])

    const [halo, line] = [...svg.querySelectorAll('line')]
    expect(Number(halo.getAttribute('stroke-width'))).toBeGreaterThan(
      Number(line.getAttribute('stroke-width'))
    )
  })

  it('follows the camera when it moves', () => {
    const { svg, overlay } = build()
    overlay.setMeasurements([measurement(at(0, 0, 0), at(1, 0, 0))])
    overlay.update(flat)
    overlay.update((point) => ({ x: point.x * 100, y: point.y * 100 }))

    expect(svg.querySelector('line')?.getAttribute('x2')).toBe('100')
  })

  it('marks each end with the shape of the thing it snapped to', () => {
    const { svg, overlay } = build()
    overlay.setMeasurements([measurement(at(0, 0, 0, 'vertex'), at(1, 0, 0, 'face'))])
    overlay.update(flat)

    const [from, to] = [...svg.querySelectorAll('path')]
    expect(from?.getAttribute('d')).toContain('H')
    expect(to?.getAttribute('d')).toContain('a')
  })

  it('writes the length beside the line', () => {
    const { labels, overlay } = build()
    overlay.setMeasurements([measurement(at(0, 0, 0), at(3, 4, 0))])
    overlay.update(flat)

    expect(labels.textContent).toContain('5.00 m')
  })

  it('places the label at the midpoint the camera projects', () => {
    const { labels, overlay } = build()
    overlay.setMeasurements([measurement(at(0, 0, 0), at(2, 0, 0))])
    overlay.update(flat)

    const label = labels.firstElementChild as HTMLElement
    expect(label.style.left).toBe('10px')
    expect(label.style.top).toBe('0px')
  })
})

describe('when a measurement is not on screen', () => {
  it('hides the whole thing rather than clamping it to an edge', () => {
    const { svg, labels, overlay } = build()
    overlay.setMeasurements([measurement(at(0, 0, 0), at(1, 0, 0))])
    overlay.update(behind)

    for (const line of svg.querySelectorAll('line')) expect(line.style.display).toBe('none')
    expect((labels.firstElementChild as HTMLElement).style.display).toBe('none')
  })

  it('comes back when the camera does', () => {
    const { svg, overlay } = build()
    overlay.setMeasurements([measurement(at(0, 0, 0), at(1, 0, 0))])
    overlay.update(behind)
    overlay.update(flat)

    for (const line of svg.querySelectorAll('line')) expect(line.style.display).toBe('')
  })
})

describe('the measurement in progress', () => {
  it('draws a dashed rubber band from the anchor to the cursor', () => {
    const { svg, overlay } = build()
    overlay.setPending(at(0, 0, 0), at(1, 1, 0, 'edge'))
    overlay.update(flat)

    const [halo, line] = [...svg.querySelectorAll('line')]
    expect(halo.getAttribute('stroke-dasharray')).toBe('4 3')
    expect(line.getAttribute('stroke-dasharray')).toBe('4 3')
    expect(line.getAttribute('x2')).toBe('10')
  })

  it('reads out the distance as the cursor moves', () => {
    const { labels, overlay } = build()
    overlay.setPending(at(0, 0, 0), at(3, 4, 0))
    overlay.update(flat)
    expect(labels.textContent).toContain('5.00 m')

    overlay.setPending(at(0, 0, 0), at(6, 8, 0))
    overlay.update(flat)
    expect(labels.textContent).toContain('10.00 m')
  })

  it('shows the snap target before a point is placed at all', () => {
    const { svg, overlay } = build()
    overlay.setPending(null, at(1, 1, 0, 'vertex'))
    overlay.update(flat)

    expect(svg.querySelectorAll('path')).toHaveLength(1)
  })

  it('takes the rubber band away when the measurement is cancelled', () => {
    const { svg, labels, overlay } = build()
    overlay.setPending(at(0, 0, 0), at(1, 1, 0))
    overlay.update(flat)
    overlay.setPending(null, null)
    overlay.update(flat)

    expect(svg.querySelectorAll('line')).toHaveLength(0)
    expect(labels.children).toHaveLength(0)
  })
})

describe('replacing the drawn set', () => {
  it('leaves nothing behind when the measurements are cleared', () => {
    const { svg, labels, overlay } = build()
    overlay.setMeasurements([
      measurement(at(0, 0, 0), at(1, 0, 0)),
      measurement(at(0, 0, 0), at(0, 2, 0)),
    ])
    overlay.update(flat)
    expect(labels.children).toHaveLength(2)

    overlay.setMeasurements([])
    expect(svg.children).toHaveLength(0)
    expect(labels.children).toHaveLength(0)
  })

  it('tears everything down on destroy', () => {
    const { svg, labels, overlay } = build()
    overlay.setMeasurements([measurement(at(0, 0, 0), at(1, 0, 0))])
    overlay.setPending(at(0, 0, 0), at(1, 1, 0))
    overlay.destroy()

    expect(svg.children).toHaveLength(0)
    expect(labels.children).toHaveLength(0)
  })
})

describe('the readout', () => {
  it('is one number when the measurement is square', () => {
    const square = measurement(at(0, 2, 0), at(2.4, 2, 0))
    expect(measurementText(square, LABELS)).toBe('2.40 m')
  })

  it('breaks a diagonal into run and rise, which is what answers the question', () => {
    const skew = measurement(at(0, 0, 0), at(3, 4, 0))
    expect(measurementText(skew, LABELS)).toBe('5.00 m · horizontal 3.00 m · vertical 4.00 m')
  })
})
