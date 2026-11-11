/**
 * The tape in the review view (ADR-0182, slice 8): the three tools, the page
 * layer that takes their clicks, and the hook between them, with the route and
 * the review's `create` faked at their seams.
 *
 * What it holds: the tools exist only where the tape is offered; a click is
 * snapped by the route before it counts; two clicks of the distance tool make
 * ONE measuring call, with the page and the points as shares of the page as
 * the engine tied them; the reading is shown as a person reads it (the value
 * with a tolerance, one line on what it rests on) while "keep" is ONE create
 * with the shape and its points and no number; a refusal is one sentence in
 * the reader's language chosen by the engine's code, never the engine's own
 * words; a click the engine ties nowhere says why and offers the corners in
 * reach.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test-utils'
import type { AnnotationView } from '@/lib/annotations/types'
import { TapeRequestError } from '@/lib/drawing-tape/client'
import { TAPE_CODES, type MeasureRequest, type MeasureResponse } from '@/lib/drawing-tape/wire'
import { files as de } from '@/i18n/dictionaries/de/files'
import { files as en } from '@/i18n/dictionaries/en/files'
import { useSheetTape, type TapePlace } from '../../../hooks/use-sheet-tape'
import { MeasureLayer } from './measure-layer'
import { MeasureReadingCard } from './measure-reading'
import { MeasureTools, tapeHint } from './measure-tools'
import { middleOf } from './sheet-shape'

const measure = vi.fn<(documentId: string, body: MeasureRequest) => Promise<MeasureResponse>>()
const keepMark = vi.fn<(body: string, place: TapePlace) => Promise<unknown>>()
const setReviewTool = vi.fn()

/** The engine ties a click to the nearest hundredth of the page: a corner the test can name. */
const snapTo = (value: number) => Math.round(value * 100) / 100
const snapped = (body: MeasureRequest): MeasureResponse => ({
  snap: body.points.map(([x, y]) => ({ snapped: [snapTo(x), snapTo(y)], movedPt: 1.2, code: null, detail: null, candidates: [] })),
})

/** The engine's exact numbers: more digits than a person is shown. */
const READING = {
  quantity: 'distance',
  value: 7.385123,
  unit: 'm' as const,
  low: 7.348123,
  high: 7.422123,
  provenance: 'vector_estimated' as const,
  scaleState: 'estimated' as const,
  scaleRatio: 100,
  printed: null,
  verdict: null,
  reasons: [],
  points: [],
}

/** What the engine says in its own words: none of it may reach a person's card. */
const ENGINE_REASON = 'this region has no usable scale (no hint)'
const ENGINE_REMEDY = 'ask a person to confirm the scale of this region (a calibration), then measure again'

function Harness({
  available = true,
  annotations = [],
  reviewTool = 'select',
  canAnnotate = true,
}: {
  available?: boolean
  annotations?: AnnotationView[]
  reviewTool?: string
  canAnnotate?: boolean
}) {
  const tape = useSheetTape({ documentId: 'doc_1', available, reviewTool, setReviewTool, keepMark, measure })
  return (
    <div>
      <MeasureTools tape={tape} />
      <div style={{ position: 'relative', width: 1000, height: 500 }}>
        <MeasureLayer
          review={{ annotations, selectedId: null, select: vi.fn(), tape, canAnnotate, setTool: setReviewTool }}
          page={2}
        />
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

/** Two clicks of the distance tool, each waited for. */
async function measureADistance() {
  fireEvent.click(screen.getByRole('button', { name: 'Measure a distance' }))
  clickAt(0.21, 0.4)
  await waitFor(() => expect(screen.getAllByTestId('measure-point')).toHaveLength(1))
  clickAt(0.36, 0.4)
}

const calls = (operation: string) => measure.mock.calls.filter(([, body]) => body.operation === operation)

beforeEach(() => {
  vi.clearAllMocks()
  measure.mockImplementation(async (_id, body) => (body.operation === 'snap' ? snapped(body) : { measurement: READING }))
  keepMark.mockResolvedValue({ id: 'ann_9' })
})
afterEach(() => vi.restoreAllMocks())

describe('the tape’s tools', () => {
  it('are not there where the tape is not offered, and take no key', () => {
    render(<Harness available={false} />)

    expect(screen.queryByTestId('measure-tools')).toBeNull()
    fireEvent.keyDown(document, { key: 'd' })
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
    fireEvent.click(screen.getByRole('button', { name: 'Measure an area' })
    )
    expect(screen.queryByTestId('measure-capture-2')).toBeNull()
  })

  it('are taken up by D, W and F, and not while the reader types', () => {
    render(
      <>
        <Harness />
        <input aria-label="note" />
      </>
    )

    fireEvent.keyDown(document, { key: 'd' })
    expect(screen.getByRole('button', { name: 'Measure a distance' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(document, { key: 'W' })
    expect(screen.getByRole('button', { name: 'Measure a path' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(screen.getByLabelText('note'), { key: 'f' })
    expect(screen.getByRole('button', { name: 'Measure an area' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.keyDown(document, { key: 'f' })
    expect(screen.getByRole('button', { name: 'Measure an area' })).toHaveAttribute('aria-pressed', 'true')
    for (const [name, key] of [['Measure a distance', 'D'], ['Measure a path', 'W'], ['Measure an area', 'F']]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-keyshortcuts', key)
    }
  })

  it('say what the tool in hand does next, for the line at the top of the canvas', () => {
    const t = (key: string) => key
    expect(tapeHint(t, { tool: null }, false)).toBeNull()
    expect(tapeHint(t, { tool: 'area' }, false)).toBe('review.measure.hint.area')
    expect(tapeHint(t, { tool: 'path' }, true)).toBe('review.measure.hintTouch.path')
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

  it('are withdrawn for a file the route says it does not read', async () => {
    measure.mockRejectedValue(new TapeRequestError(422, 'UNPROCESSABLE', 'Only a PDF drawing is measured.'))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Measure a distance' }))
    clickAt(0.2, 0.4)

    await waitFor(() => expect(screen.queryByTestId('measure-tools')).toBeNull())
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

  it('reads as a value with its tolerance and one line on what it rests on', async () => {
    render(<Harness />)
    await measureADistance()

    expect(await screen.findByTestId('measure-reading-value')).toHaveTextContent('7.39 m ± 4 cm')
    expect(screen.getByTestId('measure-reading-basis')).toHaveTextContent('Scale 1:100, estimated, not confirmed yet')
    // No range, no engine vocabulary, no talk of requirements on a person's own tape.
    const card = screen.getByTestId('measure-reading').textContent ?? ''
    expect(card).not.toMatch(/7\.348|7\.422|7\.385|linework|vector|requirement|provenance/i)
  })

  it('offers to calibrate an estimated scale, which puts the calibrate tool in hand', async () => {
    render(<Harness />)
    await measureADistance()

    fireEvent.click(await screen.findByRole('button', { name: 'Calibrate the scale' }))
    expect(setReviewTool).toHaveBeenCalledWith('calibrate')
  })

  it('does not offer to calibrate to a reader who may not write the document', async () => {
    render(<Harness canAnnotate={false} />)
    await measureADistance()

    await screen.findByTestId('measure-reading-value')
    expect(screen.queryByRole('button', { name: 'Calibrate the scale' })).toBeNull()
  })

  it('is kept with one create: the line, its two points, placed at the first, and no number', async () => {
    render(<Harness />)
    await measureADistance()
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

  it('says a refusal in one sentence of its own, with one thing to do, and offers nothing to keep', async () => {
    measure.mockImplementation(async (_id, body) =>
      body.operation === 'snap'
        ? snapped(body)
        : { noNumber: { code: 'uncalibrated', reason: ENGINE_REASON, remedy: ENGINE_REMEDY, scaleState: 'uncalibrated', candidates: [] } }
    )
    render(<Harness />)
    await measureADistance()

    const refusal = await screen.findByTestId('measure-refusal')
    expect(refusal).toHaveTextContent('No scale is confirmed for this part of the drawing.')
    expect(refusal).toHaveAttribute('data-code', 'uncalibrated')
    // The engine's words are for support, on the sentence's tooltip; they are not the card's text.
    expect(screen.getByTestId('measure-reading').textContent).not.toContain('usable scale')
    expect(refusal.getAttribute('title')).toContain(ENGINE_REASON)
    expect(screen.queryByRole('button', { name: 'Keep on the sheet' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Calibrate the scale' }))
    expect(setReviewTool).toHaveBeenCalledWith('calibrate')
    expect(keepMark).not.toHaveBeenCalled()
  })

  it('does not take a click the engine ties nowhere: it says why and offers the corners in reach', async () => {
    measure.mockImplementationOnce(async () => ({
      snap: [{ snapped: null, movedPt: null, code: 'several_in_reach', detail: '2 line ends within reach', candidates: [[0.3, 0.4], [0.31, 0.4]] }],
    }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Measure a distance' }))
    clickAt(0.305, 0.4)

    const miss = await screen.findByTestId('measure-miss')
    expect(miss).toHaveAttribute('data-code', 'several_in_reach')
    expect(miss).toHaveTextContent('Several corners are in reach. Pick one of the marked ones.')
    expect(screen.queryByTestId('measure-point')).toBeNull()
    // Picking a corner places the point there, through the route again.
    fireEvent.click(screen.getByRole('button', { name: 'Use corner 2' }))
    await waitFor(() => expect(screen.getAllByTestId('measure-point')).toHaveLength(1))
    expect(calls('snap')[1][1].points).toEqual([[0.31, 0.4]])
    expect(screen.queryByTestId('measure-miss')).toBeNull()
  })

  it('says a scan is a scan where the click was', async () => {
    measure.mockImplementationOnce(async () => ({
      snap: [{ snapped: null, movedPt: null, code: 'scan', detail: 'no line end or intersection within reach of the point', candidates: [] }],
    }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Measure a distance' }))
    clickAt(0.3, 0.4)

    expect(await screen.findByTestId('measure-miss')).toHaveTextContent('This page is a scan without lines. It cannot be measured.')
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

describe('what a reading rests on, in the office’s words', () => {
  const base = { value: 4.25, unit: 'm' as const, low: 4.245, high: 4.255 }

  it.each([
    [{ ...base, provenance: 'vector_verified' as const, scaleState: 'verified' as const, scaleRatio: 50 }, 'Scale 1:50, confirmed'],
    [{ ...base, provenance: 'vector_verified' as const, scaleState: 'verified' as const }, 'Scale confirmed'],
    [{ ...base, provenance: 'vector_estimated' as const, scaleState: 'estimated' as const }, 'Scale estimated, not confirmed yet'],
    [
      { ...base, provenance: 'printed_figure' as const, scaleState: 'uncalibrated' as const, printed: '4,25' },
      'Read off the printed dimension 4,25',
    ],
    [{ ...base, provenance: 'printed_figure' as const, scaleState: 'uncalibrated' as const }, 'Read off the printed dimension'],
  ])('%o says %s', (reading, line) => {
    render(<MeasureReadingCard reading={reading} onCalibrate={vi.fn()} />)

    expect(screen.getByTestId('measure-reading-basis')).toHaveTextContent(line)
    // A measured value carries its tolerance; a printed dimension is shown as the sheet prints it.
    expect(screen.getByTestId('measure-reading-value')).toHaveTextContent(
      reading.provenance === 'printed_figure' ? /^4\.25 m$/ : /^4\.25 m ± 1 cm$/
    )
    // Only a scale nobody confirmed asks to be calibrated.
    expect(Boolean(screen.queryByRole('button', { name: 'Calibrate the scale' }))).toBe(reading.provenance === 'vector_estimated')
  })
})

describe('a refusal, for every code the engine has', () => {
  it.each(TAPE_CODES)('%s is one sentence of the dictionary, and no word of the engine’s', (code) => {
    render(<MeasureReadingCard refusal={{ code, reason: ENGINE_REASON, remedy: ENGINE_REMEDY }} onCalibrate={vi.fn()} onDiscard={vi.fn()} />)

    const card = screen.getByTestId('measure-reading')
    expect(screen.getByTestId('measure-refusal')).toHaveTextContent(en.review.measure.refused[code])
    expect(card.textContent).not.toContain(ENGINE_REASON)
    expect(card.textContent).not.toContain(ENGINE_REMEDY)
    expect(card.textContent).not.toMatch(/no number|keine zahl/i)
    // At most one thing to do about it, besides putting the measurement away.
    const actions = screen.getAllByRole('button').filter((button) => button.textContent !== 'Discard')
    expect(actions.map((button) => button.textContent)).toEqual(code === 'uncalibrated' ? ['Calibrate the scale'] : [])
  })

  it('has a German sentence for each, different from the English one', () => {
    for (const code of TAPE_CODES) {
      expect(de.review.measure.refused[code], code).toBeTruthy()
      expect(de.review.measure.refused[code]).not.toBe(en.review.measure.refused[code])
    }
    expect(Object.keys(de.review.measure.refused).sort()).toEqual([...TAPE_CODES].sort())
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
      measurement: { value: 3.2534, unit: 'm', low: 3.2374, high: 3.2694, provenance: 'vector_verified', scaleState: 'verified' },
      status: 'open',
      onCurrentRevision: true,
      ...extra,
    }) as Partial<AnnotationView> as AnnotationView

  it('is drawn on its page with its value rounded, and no tolerance on the label', () => {
    render(<Harness annotations={[kept({}), kept({ id: 'ann_2', page: 3 }), kept({ id: 'ann_3', onCurrentRevision: false })]} />)

    expect(screen.getByTestId('measure-kept-ann_1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Annotation 4, measurement: 3.25 m' })).toHaveTextContent(/^3\.25 m$/)
    // Another page's, and one measured on an earlier version, are not drawn over this sheet.
    expect(screen.queryByTestId('measure-kept-ann_2')).toBeNull()
    expect(screen.queryByTestId('measure-kept-ann_3')).toBeNull()
  })

  it('labels a path on the path, halfway along it, and an area inside it', () => {
    expect(middleOf([[0.1, 0.8], [0.1, 0.5], [0.3, 0.5]])).toEqual([0.1, 0.55])
    expect(middleOf([[0.2, 0.4], [0.5, 0.4]])).toEqual([0.35, 0.4])
    expect(middleOf([[0, 0], [1, 0], [1, 1], [0, 1]], true)).toEqual([0.5, 0.5])
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
