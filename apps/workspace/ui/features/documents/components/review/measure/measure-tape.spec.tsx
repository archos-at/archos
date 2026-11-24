import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { fireEvent, render as renderPlain, screen, waitFor } from '@/test-utils'
import { I18nProvider } from '@/i18n'
import type { TapeMeasurement } from '@/lib/drawing-tape/wire'
import type { DocumentReview, ReviewDraft } from '../../../hooks/use-document-review'
import { IDLE_TAPE, type SheetTape } from '../../../hooks/use-sheet-tape'
import { view } from '../review.fixtures'
import { DraftCard } from '../thread-card'
import { measureKey, tapeInHand } from './measure-keys'
import { MeasureLayer, type MeasureLayerReview } from './measure-layer'
import { MeasureModeStrip } from './measure-mode-strip'
import { MeasureDraftBody, MeasureReadingLines, type ShownReading } from './measure-reading'
import { MeasureStack } from './measure-stack'

const SIZE = { width: 1000, height: 1000 }

const german = (ui: ReactElement) => (
  <I18nProvider initialLocale="de" fixedLocale>
    {ui}
  </I18nProvider>
)
const render = (ui: ReactElement) => {
  const result = renderPlain(german(ui))
  return { ...result, rerender: (next: ReactElement) => result.rerender(german(next)) }
}

const READING: TapeMeasurement = {
  quantity: 'length',
  value: 3,
  unit: 'm',
  low: 2.98,
  high: 3.02,
  provenance: 'vector_verified',
  scaleState: 'verified',
  scaleRatio: 100,
  printed: null,
  verdict: null,
  reasons: [],
  points: [],
}

const tapeWith = (overrides: Partial<SheetTape> = {}): SheetTape => ({
  ...IDLE_TAPE,
  available: true,
  active: true,
  setMode: vi.fn(),
  pointer: vi.fn(),
  add: vi.fn(),
  undo: vi.fn(),
  finish: vi.fn(),
  ...overrides,
})

const KEPT = view({
  id: 'ann_m',
  number: 4,
  shape: 'line',
  kind: 'hint',
  points: [
    [0.1, 0.1],
    [0.4, 0.1],
  ],
  reading: {
    value: 3,
    unit: 'm',
    low: 2.98,
    high: 3.02,
    provenance: 'vector_verified',
    scaleState: 'verified',
    scaleRatio: 100,
    printed: null,
  },
})

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 1000,
    right: 1000,
    bottom: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})
afterEach(() => vi.restoreAllMocks())

describe('measureKey', () => {
  const review = (tool: DocumentReview['tool'], tape: SheetTape) => ({
    tool,
    setTool: vi.fn(),
    tape,
  })

  it('toggles the tool with m only where measuring is offered', () => {
    const off = review('select', tapeWith({ available: false }))
    expect(measureKey('m', off)).toBe(false)
    expect(off.setTool).not.toHaveBeenCalled()
    const on = review('select', tapeWith())
    expect(measureKey('m', on)).toBe(true)
    expect(on.setTool).toHaveBeenCalledWith('measure')
    const back = review('measure', tapeWith())
    measureKey('m', back)
    expect(back.setTool).toHaveBeenCalledWith('select')
  })

  it('picks a mode with d, w and f, but only with the tool in hand', () => {
    const tape = tapeWith()
    expect(measureKey('d', review('select', tape))).toBe(false)
    for (const [key, mode] of [
      ['d', 'distance'],
      ['w', 'path'],
      ['f', 'area'],
    ] as const) {
      expect(measureKey(key, review('measure', tape))).toBe(true)
      expect(tape.setMode).toHaveBeenLastCalledWith(mode)
    }
  })

  it('finishes with Enter when it can, and takes back a point with Backspace only when there is one', () => {
    const idle = tapeWith()
    expect(measureKey('enter', review('measure', idle))).toBe(false)
    expect(measureKey('backspace', review('measure', idle))).toBe(false)
    expect(idle.undo).not.toHaveBeenCalled()
    const placing = tapeWith({ canFinish: true, points: [[0.1, 0.1]] })
    expect(measureKey('enter', review('measure', placing))).toBe(true)
    expect(placing.finish).toHaveBeenCalled()
    expect(measureKey('backspace', review('measure', placing))).toBe(true)
    expect(placing.undo).toHaveBeenCalled()
  })

  it('holds the tape in hand while points are down or an answer is shown', () => {
    expect(tapeInHand({ tool: 'measure', tape: tapeWith() })).toBe(false)
    expect(tapeInHand({ tool: 'measure', tape: tapeWith({ points: [[0.1, 0.1]] }) })).toBe(true)
    expect(tapeInHand({ tool: 'measure', tape: tapeWith({ phase: 'refused' }) })).toBe(true)
    expect(tapeInHand({ tool: 'select', tape: tapeWith({ phase: 'refused' }) })).toBe(false)
  })
})

describe('the mode strip', () => {
  it('names the three modes with their keys and switches on a click', async () => {
    const tape = tapeWith()
    render(<MeasureModeStrip tape={tape} onExit={() => undefined} scale={<span>scale</span>} />)
    expect(screen.getByTestId('measure-mode-distance')).toHaveTextContent('Strecke')
    expect(screen.getByTestId('measure-mode-path')).toHaveAttribute('aria-keyshortcuts', 'W')
    await userEvent.click(screen.getByTestId('measure-mode-area'))
    expect(tape.setMode).toHaveBeenCalledWith('area')
    expect(screen.getByTestId('measure-undo-point')).toBeDisabled()
  })

  it('says what each mode measures, and leaves measuring from the strip', async () => {
    const onExit = vi.fn()
    render(<MeasureModeStrip tape={tapeWith()} onExit={onExit} scale={null} />)
    await userEvent.hover(screen.getByTestId('measure-mode-path'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Länge über mehrere Punkte')
    await userEvent.click(screen.getByRole('button', { name: 'Messen beenden' }))
    expect(onExit).toHaveBeenCalled()
  })

  it('offers undo while placing and Fertig for a path once it can finish', async () => {
    const tape = tapeWith({ mode: 'path', points: [[0.1, 0.1]], canFinish: false })
    const { rerender } = render(
      <MeasureModeStrip tape={tape} onExit={() => undefined} scale={null} />
    )
    expect(screen.getByTestId('measure-finish')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Letzten Punkt zurücknehmen' }))
    expect(tape.undo).toHaveBeenCalled()
    const ready = { ...tape, canFinish: true }
    rerender(<MeasureModeStrip tape={ready} onExit={() => undefined} scale={null} />)
    await userEvent.click(screen.getByTestId('measure-finish'))
    expect(ready.finish).toHaveBeenCalled()
  })

  it('has no Fertig for a distance, which finishes on its own', () => {
    render(
      <MeasureModeStrip
        tape={tapeWith({ points: [[0.1, 0.1]] })}
        onExit={() => undefined}
        scale={null}
      />
    )
    expect(screen.getByTestId('measure-undo-point')).toBeInTheDocument()
    expect(screen.queryByTestId('measure-finish')).toBeNull()
  })
})

describe('the measure stack', () => {
  const stack = (tape: SheetTape, tool: DocumentReview['tool'] = 'measure', touch = false) =>
    render(<MeasureStack review={{ tool, setTool: vi.fn(), tape }} page={1} touch={touch} />)
  const hint = () => screen.getByTestId('review-tool-hint')

  it('shows nothing unless the tool is in hand and offered', () => {
    stack(tapeWith(), 'select')
    stack(tapeWith({ available: false }))
    expect(screen.queryByTestId('measure-mode-strip')).toBeNull()
  })

  it('says the next step as points are placed, in touch words on a touch screen', () => {
    const { rerender } = stack(tapeWith({ mode: 'area' }))
    expect(hint()).toHaveTextContent('Klicken Sie auf eine Ecke der Fläche · Esc bricht ab')
    expect(hint()).toHaveAttribute('role', 'status')
    const at = (count: number) =>
      Array.from({ length: count }, (_, i): [number, number] => [0.1 * (i + 1), 0.1])
    rerender(
      <MeasureStack
        review={{
          tool: 'measure',
          setTool: vi.fn(),
          tape: tapeWith({ mode: 'area', page: 1, points: at(1) }),
        }}
        page={1}
        touch={false}
      />
    )
    expect(hint()).toHaveTextContent('Die nächste Ecke anklicken, der Reihe nach')
    rerender(
      <MeasureStack
        review={{
          tool: 'measure',
          setTool: vi.fn(),
          tape: tapeWith({ mode: 'area', page: 1, points: at(3) }),
        }}
        page={1}
        touch={false}
      />
    )
    expect(hint()).toHaveTextContent(
      'ein Klick auf die erste Ecke oder „Fertig“ schließt die Fläche'
    )
    rerender(
      <MeasureStack
        review={{ tool: 'measure', setTool: vi.fn(), tape: tapeWith({ mode: 'distance' }) }}
        page={1}
        touch
      />
    )
    expect(hint()).toHaveTextContent(
      'Tippen Sie auf den Anfang der Strecke · Zum genauen Messen mit zwei Fingern hineinzoomen'
    )
  })

  it('says before the first click that the page has no scale yet', () => {
    stack(tapeWith({ unscaled: () => true }))
    expect(hint()).toHaveTextContent('Für diese Seite ist kein Maßstab bekannt.')
    expect(hint()).toHaveAttribute('role', 'alert')
  })

  it('says it is measuring, then says nothing over a reading', () => {
    const { rerender } = stack(tapeWith({ phase: 'measuring' }))
    expect(hint()).toHaveTextContent('Wird gemessen …')
    rerender(
      <MeasureStack
        review={{ tool: 'measure', setTool: vi.fn(), tape: tapeWith({ phase: 'measured' }) }}
        page={1}
        touch={false}
      />
    )
    expect(screen.queryByTestId('review-tool-hint')).toBeNull()
  })

  it('reads a refusal out as an alert, with the engine reason and remedy as its title', () => {
    const refusal = {
      code: 'scan' as const,
      reason: 'Kein Vektor.',
      remedy: 'Vektor-PDF hochladen.',
      scaleState: null,
      candidates: [],
    }
    stack(tapeWith({ phase: 'refused', refusal }))
    expect(hint()).toHaveTextContent(
      'Diese Seite ist ein Scan ohne Linien. Darauf lässt sich nicht messen.'
    )
    expect(hint()).toHaveAttribute('role', 'alert')
    expect(hint()).toHaveAttribute('data-code', 'scan')
    expect(hint()).toHaveAttribute('title', 'Kein Vektor. Vektor-PDF hochladen.')
  })

  it('falls back to the general refusal, and says a failure plainly', () => {
    const { rerender } = stack(tapeWith({ phase: 'refused' }))
    expect(hint()).toHaveTextContent('Das lässt sich hier nicht messen.')
    rerender(
      <MeasureStack
        review={{ tool: 'measure', setTool: vi.fn(), tape: tapeWith({ phase: 'failed' }) }}
        page={1}
        touch={false}
      />
    )
    expect(hint()).toHaveTextContent('Das hat nicht geklappt. Bitte noch einmal versuchen.')
  })

  it('labels the scale of the page being measured', () => {
    const scaleOf = vi.fn(() => [
      {
        region: null,
        state: 'verified' as const,
        source: 'calibration' as const,
        metresPerShare: [1, 1] as [number, number],
        ratio: 50,
      },
    ])
    stack(tapeWith({ page: 3, scaleOf }))
    expect(screen.getByTestId('measure-scale')).toHaveTextContent('Maßstab 1:50')
    expect(scaleOf).toHaveBeenCalledWith(3)
  })
})

describe('the measure layer', () => {
  const layer = (
    tape: SheetTape,
    { focused = true, annotations = [KEPT], selectedId = null as string | null } = {}
  ) => {
    const review: MeasureLayerReview = { annotations, selectedId, select: vi.fn(), tape }
    return {
      review,
      ...render(<MeasureLayer review={review} page={1} focused={focused} size={SIZE} />),
    }
  }

  it('captures the page only while the tool is active and the page focused', () => {
    layer(tapeWith(), { focused: false })
    expect(screen.queryByTestId('measure-capture-1')).toBeNull()
    layer(tapeWith({ active: false }))
    expect(screen.queryByTestId('measure-capture-1')).toBeNull()
  })

  it('turns pointer moves and clicks into page shares, clearing the selection', () => {
    const tape = tapeWith()
    const { review } = layer(tape)
    const capture = screen.getByTestId('measure-capture-1')
    fireEvent.pointerMove(capture, { clientX: 250, clientY: 500 })
    expect(tape.pointer).toHaveBeenCalledWith(1, [0.25, 0.5], SIZE)
    fireEvent.click(capture, { clientX: 100, clientY: 200 })
    expect(review.select).toHaveBeenCalledWith(null)
    expect(tape.add).toHaveBeenCalledWith(1, [0.1, 0.2], SIZE)
    fireEvent.pointerLeave(capture)
    expect(tape.pointer).toHaveBeenLastCalledWith(1, null, SIZE)
    fireEvent.doubleClick(capture)
    expect(tape.finish).toHaveBeenCalled()
  })

  it('labels a kept measure with its name and rounded value, and selects it on a click', async () => {
    const { review } = layer(tapeWith({ active: false }))
    const label = screen.getByTestId('measure-kept-ann_m')
    expect(label).toHaveTextContent('Tür ohne Feuerwiderstandskl… · 3,00 m')
    expect(label).toHaveAccessibleName('Anmerkung 4, Messung: Tür ohne Feuerwiderstandskl… · 3,00 m')
    await userEvent.click(label)
    expect(review.select).toHaveBeenCalledWith('ann_m')
  })

  it('lets a click on a kept label through to the drawing while measuring', () => {
    layer(tapeWith({ active: true }))
    expect(screen.getByTestId('measure-kept-ann_m')).toHaveClass('pointer-events-none')
  })

  it('says the area closes when the pointer is back on the first corner', () => {
    const points: [number, number][] = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]]
    layer(tapeWith({ active: true, mode: 'area', page: 1, points, hover: { page: 1, at: [0.1, 0.1], kind: 'vertex' } }))
    expect(screen.getByTestId('measure-snap-tag')).toHaveTextContent('Fläche schließen')
  })

  it('unselects a selected kept measure on a second click', async () => {
    const { review } = layer(tapeWith({ active: false }), { selectedId: 'ann_m' })
    expect(screen.getByTestId('measure-kept-ann_m')).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByTestId('measure-kept-ann_m'))
    expect(review.select).toHaveBeenCalledWith(null)
  })

  it('leaves out measures from other pages, earlier revisions and closed ones', () => {
    const others = [
      { ...KEPT, id: 'a', page: 2 },
      { ...KEPT, id: 'b', onCurrentRevision: false },
      { ...KEPT, id: 'c', status: 'resolved' as const },
      { ...KEPT, id: 'd', shape: 'point' as const },
    ]
    const { container } = layer(tapeWith({ active: false }), { annotations: others })
    expect(container.querySelector('[data-testid^="measure-kept-"]')).toBeNull()
  })

  it('shows the provisional length with ≈ while placing', () => {
    const tape = tapeWith({
      page: 1,
      points: [[0.1, 0.1]],
      kinds: ['vertex'],
      hover: { page: 1, at: [0.4, 0.1], kind: 'edge' },
      provisional: { value: 3, unit: 'm' },
    })
    layer(tape, { annotations: [] })
    const label = screen.getByTestId('measure-provisional')
    expect(label).toHaveTextContent('≈ 3,00 m')
    expect(label).toHaveAccessibleName('Vorläufig 3,00 m, wird beim Abschluss gemessen')
    expect(screen.getAllByTestId('measure-point')).toHaveLength(1)
    expect(screen.getByTestId('measure-hover')).toBeInTheDocument()
  })

  it('shows the engine value once measured, without ≈ or hover', () => {
    const tape = tapeWith({
      page: 1,
      points: [
        [0.1, 0.1],
        [0.4, 0.1],
      ],
      kinds: ['vertex', 'vertex'],
      phase: 'measured',
      reading: { ...READING, value: 3.004, low: 3.002, high: 3.006 },
    })
    layer(tape, { annotations: [] })
    expect(screen.queryByTestId('measure-provisional')).toBeNull()
    expect(screen.getByTestId('measure-value')).toHaveTextContent(/^3,004 m$/)
    expect(screen.queryByTestId('measure-hover')).toBeNull()
  })

  it('draws nothing of the tape on a page it is not on', () => {
    layer(
      tapeWith({
        page: 2,
        points: [
          [0.1, 0.1],
          [0.4, 0.1],
        ],
        provisional: { value: 3, unit: 'm' },
      }),
      { annotations: [] }
    )
    expect(screen.queryByTestId('measure-in-hand')).toBeNull()
    expect(screen.queryByTestId('measure-provisional')).toBeNull()
  })
})

describe('the reading', () => {
  const lines = (reading: ShownReading, onSetScale?: () => void) =>
    render(<MeasureReadingLines reading={reading} onSetScale={onSetScale} />)

  it('gives a vector reading with its tolerance and the confirmed scale', () => {
    lines(READING)
    expect(screen.getByTestId('measure-reading-value')).toHaveTextContent('3,00 m ± 2 cm')
    expect(screen.getByTestId('measure-reading-basis')).toHaveTextContent(
      'Maßstab 1:100, bestätigt'
    )
  })

  it('offers to set the scale under an estimated one', async () => {
    const onSetScale = vi.fn()
    lines({ ...READING, provenance: 'vector_estimated', scaleRatio: null }, onSetScale)
    expect(screen.getByTestId('measure-reading-basis')).toHaveTextContent('Maßstab aus der Zeichnung gelesen, nicht bestätigt')
    await userEvent.click(screen.getByTestId('measure-set-scale'))
    expect(onSetScale).toHaveBeenCalled()
  })

  it('reads a printed figure without a tolerance, and never offers a scale for it', () => {
    const { rerender } = lines(
      { ...READING, provenance: 'printed_figure', printed: '3,00' },
      vi.fn()
    )
    expect(screen.getByTestId('measure-reading-value')).toHaveTextContent(/^3,00 m$/)
    expect(screen.getByTestId('measure-reading-basis')).toHaveTextContent(
      'Abgelesen von der Maßzahl 3,00'
    )
    expect(screen.queryByTestId('measure-set-scale')).toBeNull()
    rerender(
      <MeasureReadingLines reading={{ ...READING, provenance: 'printed_figure', printed: null }} />
    )
    expect(screen.getByTestId('measure-reading-basis')).toHaveTextContent(
      'Abgelesen von der gedruckten Maßzahl'
    )
  })
})

describe('the measurement draft', () => {
  const body = (onKeep = vi.fn(async () => undefined), onDiscard = vi.fn()) => {
    render(<MeasureDraftBody reading={READING} onKeep={onKeep} onDiscard={onDiscard} />)
    return { onKeep, onDiscard, note: screen.getByPlaceholderText('Name auf dem Blatt (optional), z. B. Flurbreite') }
  }

  it('keeps with the trimmed note on Behalten', async () => {
    const { onKeep, note } = body()
    await userEvent.type(note, '  Flurbreite  ')
    await userEvent.click(screen.getByRole('button', { name: 'Behalten' }))
    expect(onKeep).toHaveBeenCalledWith('Flurbreite')
  })

  it('keeps on Enter and discards on Escape', async () => {
    const { onKeep, onDiscard, note } = body()
    await userEvent.type(note, 'Tür{Enter}')
    expect(onKeep).toHaveBeenCalledWith('Tür')
    await userEvent.type(note, '{Escape}')
    expect(onDiscard).toHaveBeenCalled()
  })

  it('discards on Verwerfen', async () => {
    const { onDiscard } = body()
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))
    expect(onDiscard).toHaveBeenCalled()
  })

  it('says so when keeping fails, and keeps the note', async () => {
    const { note } = body(vi.fn(async () => Promise.reject(new Error('nope'))))
    await userEvent.type(note, 'Flur')
    await userEvent.click(screen.getByRole('button', { name: 'Behalten' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Das hat nicht geklappt. Bitte noch einmal versuchen.'
    )
    expect(note).toHaveValue('Flur')
  })
})

describe('the draft card for a measurement', () => {
  const draft: ReviewDraft = {
    page: 1,
    shape: 'path',
    x: 0.1,
    y: 0.1,
    w: null,
    h: null,
    points: [
      [0.1, 0.1],
      [0.4, 0.1],
    ],
  }

  it('holds the reading and keeps it as a hint, named by its shape when no note is given', async () => {
    const create = vi.fn(async () => undefined)
    const setDraft = vi.fn()
    const review = {
      tape: tapeWith({ reading: READING, phase: 'measured' }),
      create,
      setDraft,
    } as unknown as DocumentReview
    render(<DraftCard review={review} draft={draft} placement="docked" canPickAssignee={false} />)
    expect(screen.getByTestId('review-draft')).toBeInTheDocument()
    expect(screen.getByTestId('measure-reading-value')).toHaveTextContent('3,00 m ± 2 cm')
    await userEvent.click(screen.getByRole('button', { name: 'Behalten' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ kind: 'hint', body: 'Weglänge' }))
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))
    expect(setDraft).toHaveBeenCalledWith(null)
  })
})
