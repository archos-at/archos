/**
 * The tape in the review view (ADR-0182, slice 8): the three tools, the page
 * layer that takes their clicks, and the hook between them, with the route and
 * the review's `create` faked at their seams.
 *
 * What it holds: the tools exist only where the tape is offered; a click is
 * snapped by the route before it counts; two clicks of the distance tool make
 * ONE measuring call, with the page and the points as shares of the page as
 * the engine tied them; the reading shown is the route's, digit for digit;
 * "keep" is ONE create with the shape and its points and no number; a refusal
 * shows its reason and remedy and offers nothing to keep; a click the engine
 * ties nowhere says why and offers the corners in reach.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test-utils'
import type { AnnotationView } from '@/lib/annotations/types'
import type { MeasureRequest, MeasureResponse } from '@/lib/drawing-tape/wire'
import { useSheetTape, type TapePlace } from '../../../hooks/use-sheet-tape'
import { MeasureLayer } from './measure-layer'
import { MeasureTools } from './measure-tools'

const measure = vi.fn<(documentId: string, body: MeasureRequest) => Promise<MeasureResponse>>()
const keepMark = vi.fn<(body: string, place: TapePlace) => Promise<unknown>>()
const setReviewTool = vi.fn()

/** The engine ties a click to the nearest hundredth of the page: a corner the test can name. */
const snapTo = (value: number) => Math.round(value * 100) / 100
const snapped = (body: MeasureRequest): MeasureResponse => ({
  snap: body.points.map(([x, y]) => ({ snapped: [snapTo(x), snapTo(y)], movedPt: 1.2, reason: null, detail: null, candidates: [] })),
})

const READING = {
  quantity: 'distance',
  value: 4.000123,
  unit: 'm' as const,
  low: 3.980123,
  high: 4.020123,
  provenance: 'vector_estimated' as const,
  scaleState: 'estimated' as const,
  scaleRatio: 100,
  verdict: null,
  reasons: [],
  points: [],
}

function Harness({
  available = true,
  annotations = [],
  reviewTool = 'select',
}: {
  available?: boolean
  annotations?: AnnotationView[]
  reviewTool?: string
}) {
  const tape = useSheetTape({ documentId: 'doc_1', available, reviewTool, setReviewTool, keepMark, measure })
  return (
    <div>
      <MeasureTools tape={tape} />
      <div style={{ position: 'relative', width: 1000, height: 500 }}>
        <MeasureLayer review={{ annotations, selectedId: null, select: vi.fn(), tape }} page={2} />
      </div>
    </div>
  )
}

/** A click at a share of the page: jsdom lays nothing out, so the surface is given the page's box. */
function clickAt(x: number, y: number) {
  const surface = screen.getByTestId('measure-capture-2')
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}) })
  fireEvent.click(surface, { clientX: x * 1000, clientY: y * 500 })
}

const calls = (operation: string) => measure.mock.calls.filter(([, body]) => body.operation === operation)

beforeEach(() => {
  vi.clearAllMocks()
  measure.mockImplementation(async (_id, body) => (body.operation === 'snap' ? snapped(body) : { measurement: READING }))
  keepMark.mockResolvedValue({ id: 'ann_9' })
})
afterEach(() => vi.restoreAllMocks())

describe('the tape’s tools', () => {
  it('are not there where the tape is not offered: no entitlement, or no PDF', () => {
    render(<Harness available={false} />)

    expect(screen.queryByTestId('measure-tools')).toBeNull()
    expect(screen.queryByTestId('measure-capture-2')).toBeNull()
  })

  it('offer distance, path and area, one in hand at a time, and take the review’s own tool out of the hand', () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Measure a distance' }))
    expect(screen.getByRole('button', { name: 'Measure a distance' })).toHaveAttribute('aria-pressed', 'true')
    expect(setReviewTool).toHaveBeenCalledWith('select')
    expect(screen.getByTestId('measure-capture-2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Measure an area' }))
    expect(screen.getByRole('button', { name: 'Measure a distance' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Measure an area' })).toHaveAttribute('aria-pressed', 'true')

    // Picked again, it is put down.
    fireEvent.click(screen.getByRole('button', { name: 'Measure an area' }))
    expect(screen.queryByTestId('measure-capture-2')).toBeNull()
  })

  it('is put down when a review tool is taken up, and by Escape', async () => {
    const { rerender } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Measure a path' }))
    rerender(<Harness reviewTool="point" />)
    await waitFor(() => expect(screen.queryByTestId('measure-capture-2')).toBeNull())

    rerender(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Measure a path' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('measure-capture-2')).toBeNull()
  })
})

describe('a distance', () => {
  it('is one measuring call for two clicks, with the page and the points as the engine tied them', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Measure a distance' }))

    clickAt(0.2104, 0.4012)
    await waitFor(() => expect(screen.getAllByTestId('measure-point')).toHaveLength(1))
    expect(calls('distance')).toHaveLength(0)
    clickAt(0.3596, 0.3991)
    await screen.findByTestId('measure-reading-value')

    // Each click was snapped through the route, as shares of the page.
    expect(calls('snap').map(([id, body]) => [id, body.page, body.points])).toEqual([
      ['doc_1', 2, [[0.2104, 0.4012]]],
      ['doc_1', 2, [[0.3596, 0.3991]]],
    ])
    // One measurement, of the snapped points.
    expect(calls('distance')).toEqual([['doc_1', { page: 2, operation: 'distance', points: [[0.21, 0.4], [0.36, 0.4]] }]])
  })

  it('shows the route’s value, interval, provenance and scale state, and computes none of them', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Measure a distance' }))
    clickAt(0.21, 0.4)
    await waitFor(() => expect(screen.getAllByTestId('measure-point')).toHaveLength(1))
    clickAt(0.36, 0.4)

    expect(await screen.findByTestId('measure-reading-value')).toHaveTextContent('4.000 m')
    expect(screen.getByTestId('measure-reading-interval')).toHaveTextContent('3.980 m to 4.020 m')
    expect(screen.getByTestId('measure-reading-provenance')).toHaveAttribute('data-provenance', 'vector_estimated')
    expect(screen.getByTestId('measure-reading-scale')).toHaveAttribute('data-scale-state', 'estimated')
    expect(screen.getByTestId('measure-reading-scale')).toHaveTextContent('Scale 1:100, estimated')
  })

  it('is kept with one create: the line, its two points, placed at the first, and no number', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Measure a distance' }))
    clickAt(0.21, 0.4)
    await waitFor(() => expect(screen.getAllByTestId('measure-point')).toHaveLength(1))
    clickAt(0.36, 0.4)
    fireEvent.click(await screen.findByRole('button', { name: 'Keep on the sheet' }))

    await waitFor(() => expect(keepMark).toHaveBeenCalledTimes(1))
    expect(keepMark).toHaveBeenCalledWith('Distance', {
      page: 2,
      shape: 'line',
      x: 0.21,
      y: 0.4,
      w: null,
      h: null,
      points: [[0.21, 0.4], [0.36, 0.4]],
    })
    // Kept: the tape is put down and nothing of it is left on the page.
    await waitFor(() => expect(screen.queryByTestId('measure-capture-2')).toBeNull())
    expect(screen.queryByTestId('measure-reading')).toBeNull()
  })

  it('shows a refusal with its reason and remedy, and offers nothing to keep', async () => {
    measure.mockImplementation(async (_id, body) =>
      body.operation === 'snap'
        ? snapped(body)
        : { noNumber: { reason: 'this region has no usable scale (no hint)', remedy: 'ask a person to confirm the scale of this region', scaleState: 'uncalibrated', candidates: [] } }
    )
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Measure a distance' }))
    clickAt(0.21, 0.4)
    await waitFor(() => expect(screen.getAllByTestId('measure-point')).toHaveLength(1))
    clickAt(0.36, 0.4)

    expect(await screen.findByTestId('measure-refusal-reason')).toHaveTextContent('this region has no usable scale (no hint)')
    expect(screen.getByTestId('measure-refusal-remedy')).toHaveTextContent('ask a person to confirm the scale of this region')
    expect(screen.queryByRole('button', { name: 'Keep on the sheet' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByTestId('measure-reading')).toBeNull()
    expect(keepMark).not.toHaveBeenCalled()
  })

  it('does not take a click the engine ties nowhere: it says why and offers the corners in reach', async () => {
    measure.mockImplementationOnce(async () => ({
      snap: [{ snapped: null, movedPt: null, reason: 'several', detail: '2 line ends within reach', candidates: [[0.3, 0.4], [0.31, 0.4]] }],
    }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Measure a distance' }))
    clickAt(0.305, 0.4)

    expect(await screen.findByTestId('measure-miss')).toHaveAttribute('data-reason', 'several')
    expect(screen.queryByTestId('measure-point')).toBeNull()
    // Picking a corner places the point there, through the route again.
    fireEvent.click(screen.getByRole('button', { name: 'Use corner 2' }))
    await waitFor(() => expect(screen.getAllByTestId('measure-point')).toHaveLength(1))
    expect(calls('snap')[1][1].points).toEqual([[0.31, 0.4]])
    expect(screen.queryByTestId('measure-miss')).toBeNull()
  })

  it('says so when the route fails, and keeps what was placed', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Measure a distance' }))
    clickAt(0.21, 0.4)
    await waitFor(() => expect(screen.getAllByTestId('measure-point')).toHaveLength(1))
    measure.mockRejectedValueOnce(new Error('offline'))
    clickAt(0.36, 0.4)

    expect(await screen.findByTestId('measure-failed')).toBeInTheDocument()
    expect(screen.getAllByTestId('measure-point')).toHaveLength(1)
  })
})

describe('a path and an area', () => {
  it('measure again with every corner added: a path from the second, an area from the third', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Measure an area' }))
    for (const [index, [x, y]] of [[0.1, 0.1], [0.3, 0.1], [0.3, 0.4]].entries()) {
      clickAt(x, y)
      await waitFor(() => expect(screen.getAllByTestId('measure-point')).toHaveLength(index + 1))
    }
    await screen.findByTestId('measure-reading-value')

    expect(calls('area')).toEqual([['doc_1', { page: 2, operation: 'area', points: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.4]] }]])

    fireEvent.click(screen.getByRole('button', { name: 'Keep on the sheet' }))
    await waitFor(() => expect(keepMark).toHaveBeenCalledTimes(1))
    expect(keepMark.mock.calls[0][1]).toMatchObject({ shape: 'polygon', x: 0.1, y: 0.1, points: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.4]] })
  })
})

describe('a measurement kept on the sheet', () => {
  const kept = (extra: Partial<AnnotationView>): AnnotationView =>
    ({
      id: 'ann_1',
      number: 4,
      page: 2,
      shape: 'line',
      x: 0.2,
      y: 0.4,
      w: null,
      h: null,
      points: [[0.2, 0.4], [0.5, 0.4]],
      measurement: { value: 3.25, unit: 'm', low: 3.234, high: 3.266, provenance: 'vector_verified', scaleState: 'verified' },
      status: 'open',
      onCurrentRevision: true,
      ...extra,
    }) as Partial<AnnotationView> as AnnotationView

  it('is drawn on its page with its value, the engine’s as it was kept', () => {
    render(<Harness annotations={[kept({}), kept({ id: 'ann_2', page: 3 }), kept({ id: 'ann_3', onCurrentRevision: false })]} />)

    expect(screen.getByTestId('measure-kept-ann_1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Annotation 4, measurement: 3.250 m' })).toHaveTextContent('3.250 m')
    // Another page's, and one measured on an earlier version, are not drawn over this sheet.
    expect(screen.queryByTestId('measure-kept-ann_2')).toBeNull()
    expect(screen.queryByTestId('measure-kept-ann_3')).toBeNull()
  })

  it('opens its mark when its value is pressed', () => {
    const select = vi.fn()
    const Layer = () => {
      const tape = useSheetTape({ documentId: 'doc_1', available: true, reviewTool: 'select', setReviewTool, keepMark, measure })
      return <MeasureLayer review={{ annotations: [kept({})], selectedId: null, select, tape }} page={2} />
    }
    render(<Layer />)

    act(() => screen.getByTestId('measure-kept-value-ann_1').click())
    expect(select).toHaveBeenCalledWith('ann_1')
  })
})
