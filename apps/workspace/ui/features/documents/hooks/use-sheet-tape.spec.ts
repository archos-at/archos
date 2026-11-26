import { useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TapeRequestError } from '@/lib/drawing-tape/client'
import type { MeasureRequest, MeasureResponse, TapeMeasurement } from '@/lib/drawing-tape/wire'
import type { SnapTargets } from '@/lib/drawing-tape/snap-wire'
import { useSheetTape, type TapeMeasure, type TapePlace, type TapeTargets } from './use-sheet-tape'

const SIZE = { width: 1000, height: 1000 }

const TARGETS: SnapTargets = {
  documentId: 'doc_1',
  versionId: 'ver_1',
  page: 1,
  widthPt: 1000,
  heightPt: 1000,
  widthMm: 420,
  heightMm: 297,
  rotation: 0,
  scan: false,
  vertices: [0.5, 0.5, 0.2, 0.2],
  segments: [0.1, 0.8, 0.9, 0.8],
  totalSegments: 1,
  truncated: false,
  scales: [
    {
      region: null,
      state: 'verified',
      source: 'calibration',
      metresPerShare: [10, 10],
      ratio: 100,
    },
  ],
}

const reading = (overrides: Partial<TapeMeasurement> = {}): TapeMeasurement => ({
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
  ...overrides,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function setup({
  measure = vi.fn<TapeMeasure>(async () => ({ measurement: reading() })),
  targets = vi.fn<TapeTargets>(async () => TARGETS),
  active = true,
  available = true,
}: { measure?: TapeMeasure; targets?: TapeTargets; active?: boolean; available?: boolean } = {}) {
  const placed: Array<TapePlace | null> = []
  const hook = renderHook(
    ({ active: on }) => {
      const [draft, setDraft] = useState<TapePlace | null>(null)
      const tape = useSheetTape({
        documentId: 'doc_1',
        available,
        active: on,
        draftOpen: Boolean(draft?.points),
        placeDraft: (place) => {
          placed.push(place)
          setDraft(place)
        },
        measure,
        targets,
      })
      return { tape, draft, setDraft }
    },
    { initialProps: { active } }
  )
  const tape = () => hook.result.current.tape
  const loadPage = async (page = 1) => {
    act(() => tape().pointer(page, [0.01, 0.01], SIZE))
    await waitFor(() => expect(tape().scaleOf(page)).not.toBeNull())
  }
  const click = (at: [number, number], page = 1) => act(() => tape().add(page, at, SIZE))
  return { hook, tape, placed, measure, targets, loadPage, click }
}

describe('the tape snapping points on a sheet', () => {
  it('asks the page for its snap targets once, and places the first point free until they are there', async () => {
    const t = setup()
    t.click([0.505, 0.505])
    expect(t.tape().points).toEqual([[0.505, 0.505]])
    expect(t.tape().kinds).toEqual(['free'])
    await waitFor(() => expect(t.tape().scaleOf(1)).not.toBeNull())
    act(() => t.tape().pointer(1, [0.3, 0.3], SIZE))
    expect(t.targets).toHaveBeenCalledTimes(1)
    expect(t.targets).toHaveBeenCalledWith('doc_1', 1)
  })

  it('snaps to a corner within reach, then to an edge, and leaves a point far from both free', async () => {
    const t = setup({ measure: vi.fn<TapeMeasure>(() => new Promise(() => {})) })
    await t.loadPage()
    act(() => t.tape().setMode('path'))
    t.click([0.505, 0.506])
    t.click([0.4, 0.805])
    t.click([0.7, 0.4])
    expect(t.tape().points[0]).toEqual([0.5, 0.5])
    expect(t.tape().points[1][0]).toBeCloseTo(0.4)
    expect(t.tape().points[1][1]).toBeCloseTo(0.8)
    expect(t.tape().points[2]).toEqual([0.7, 0.4])
    expect(t.tape().kinds).toEqual(['vertex', 'edge', 'free'])
  })

  it('places a point exactly where it is put when the snap is overridden, hover included', async () => {
    const t = setup({ measure: vi.fn<TapeMeasure>(() => new Promise(() => {})) })
    await t.loadPage()
    act(() => t.tape().setMode('path'))
    act(() => t.tape().pointer(1, [0.198, 0.203], SIZE, true))
    expect(t.tape().hover).toEqual({ page: 1, at: [0.198, 0.203], kind: 'free' })
    act(() => t.tape().add(1, [0.198, 0.203], SIZE, true))
    expect(t.tape().points).toEqual([[0.198, 0.203]])
    expect(t.tape().kinds).toEqual(['free'])
  })

  it('shows the hover snapped, and drops it when the pointer leaves', async () => {
    const t = setup()
    await t.loadPage()
    act(() => t.tape().pointer(1, [0.198, 0.203], SIZE))
    expect(t.tape().hover).toEqual({ page: 1, at: [0.2, 0.2], kind: 'vertex' })
    act(() => t.tape().pointer(1, null, SIZE))
    expect(t.tape().hover).toBeNull()
  })

  it('ignores clicks while the tool is not in hand', async () => {
    const t = setup({ active: false })
    t.click([0.3, 0.3])
    expect(t.tape().points).toEqual([])
    expect(t.tape().active).toBe(false)
  })

  it('is never active where measuring is not offered', () => {
    const t = setup({ available: false })
    expect(t.tape().available).toBe(false)
    expect(t.tape().active).toBe(false)
  })
})

describe('measuring a distance', () => {
  it('asks the engine at the second point and places a draft with the points', async () => {
    const t = setup()
    await t.loadPage()
    t.click([0.2, 0.2])
    t.click([0.5, 0.5])
    expect(t.tape().phase).toBe('measuring')
    await waitFor(() => expect(t.tape().phase).toBe('measured'))
    expect(t.measure).toHaveBeenCalledWith('doc_1', {
      page: 1,
      operation: 'distance',
      points: [
        [0.2, 0.2],
        [0.5, 0.5],
      ],
    })
    expect(t.tape().reading).toEqual(reading())
    expect(t.placed.at(-1)).toEqual({
      page: 1,
      shape: 'line',
      x: 0.2,
      y: 0.2,
      w: null,
      h: null,
      points: [
        [0.2, 0.2],
        [0.5, 0.5],
      ],
    })
  })

  it('shows a provisional length from the page scale while placing, never once measured', async () => {
    const pending = deferred<MeasureResponse>()
    const t = setup({ measure: vi.fn<TapeMeasure>(() => pending.promise) })
    await t.loadPage()
    t.click([0.1, 0.1])
    act(() => t.tape().pointer(1, [0.4, 0.1], SIZE))
    expect(t.tape().provisional?.unit).toBe('m')
    expect(t.tape().provisional?.value).toBeCloseTo(3)
    t.click([0.4, 0.1])
    expect(t.tape().provisional).toBeNull()
    await act(async () => pending.resolve({ measurement: reading() }))
    expect(t.tape().provisional).toBeNull()
  })

  it('has no provisional length when the page has no scale', async () => {
    const t = setup({ targets: vi.fn<TapeTargets>(async () => ({ ...TARGETS, scales: [] })) })
    await t.loadPage()
    t.click([0.1, 0.1])
    act(() => t.tape().pointer(1, [0.4, 0.1], SIZE))
    expect(t.tape().provisional).toBeNull()
  })

  it('keeps the engine refusal and places no draft', async () => {
    const noNumber = {
      code: 'uncalibrated' as const,
      reason: 'Kein Maßstab',
      remedy: 'Maßstab setzen',
      scaleState: null,
      candidates: [],
    }
    const t = setup({ measure: vi.fn<TapeMeasure>(async () => ({ noNumber })) })
    await t.loadPage()
    t.click([0.2, 0.2])
    t.click([0.5, 0.5])
    await waitFor(() => expect(t.tape().phase).toBe('refused'))
    expect(t.tape().refusal).toEqual(noNumber)
    expect(t.tape().reading).toBeNull()
    expect(t.placed).toEqual([])
  })

  it('reads a 422 as a refusal and any other failure as failed', async () => {
    const refusing = setup({
      measure: vi.fn<TapeMeasure>(async () => Promise.reject(new TapeRequestError(422, 'X', 'no'))),
    })
    refusing.click([0.2, 0.2])
    refusing.click([0.5, 0.5])
    await waitFor(() => expect(refusing.tape().phase).toBe('refused'))
    expect(refusing.tape().refusal).toBeNull()

    const broken = setup({
      measure: vi.fn<TapeMeasure>(async () => Promise.reject(new TypeError('network'))),
    })
    broken.click([0.2, 0.2])
    broken.click([0.5, 0.5])
    await waitFor(() => expect(broken.tape().phase).toBe('failed'))
    expect(broken.placed).toEqual([])
  })

  it('drops an answer that comes back after the mode changed', async () => {
    const pending = deferred<MeasureResponse>()
    const t = setup({ measure: vi.fn<TapeMeasure>(() => pending.promise) })
    t.click([0.2, 0.2])
    t.click([0.5, 0.5])
    act(() => t.tape().setMode('area'))
    await act(async () => pending.resolve({ measurement: reading() }))
    expect(t.tape().phase).toBe('placing')
    expect(t.tape().reading).toBeNull()
    expect(t.tape().mode).toBe('area')
    expect(t.placed.filter(Boolean)).toEqual([])
  })

  it('starts a new tape with the next click after a measurement, closing the old draft', async () => {
    const t = setup()
    await t.loadPage()
    t.click([0.2, 0.2])
    t.click([0.5, 0.5])
    await waitFor(() => expect(t.tape().phase).toBe('measured'))
    t.click([0.7, 0.4])
    expect(t.placed.at(-1)).toBeNull()
    expect(t.tape().phase).toBe('placing')
    expect(t.tape().points).toEqual([[0.7, 0.4]])
  })

  it('clears when the draft card closes', async () => {
    const t = setup()
    t.click([0.2, 0.2])
    t.click([0.5, 0.5])
    await waitFor(() => expect(t.tape().phase).toBe('measured'))
    act(() => t.hook.result.current.setDraft(null))
    expect(t.tape().phase).toBe('placing')
    expect(t.tape().points).toEqual([])
    expect(t.tape().reading).toBeNull()
  })

  it('clears when the tool is put down', () => {
    const t = setup()
    t.click([0.2, 0.2])
    t.hook.rerender({ active: false })
    expect(t.tape().points).toEqual([])
  })
})

describe('measuring a path and an area', () => {
  it('collects path points until finish, and skips a click on the last point', async () => {
    const measure = vi.fn<TapeMeasure>(async () => ({ measurement: reading({ value: 6 }) }))
    const t = setup({ measure })
    await t.loadPage()
    act(() => t.tape().setMode('path'))
    t.click([0.1, 0.1])
    expect(t.tape().canFinish).toBe(false)
    t.click([0.3, 0.1])
    t.click([0.3001, 0.1])
    t.click([0.3, 0.4])
    expect(t.tape().points).toHaveLength(3)
    expect(measure).not.toHaveBeenCalled()
    expect(t.tape().canFinish).toBe(true)
    expect(t.tape().provisional?.value).toBeCloseTo(5)
    act(() => t.tape().finish())
    await waitFor(() => expect(t.tape().phase).toBe('measured'))
    expect(measure.mock.calls[0][1]).toEqual<MeasureRequest>({
      page: 1,
      operation: 'path',
      points: [
        [0.1, 0.1],
        [0.3, 0.1],
        [0.3, 0.4],
      ],
    })
    expect(t.placed.at(-1)?.shape).toBe('path')
  })

  it('closes an area by clicking near its first point, and reads a provisional area before', async () => {
    const measure = vi.fn<TapeMeasure>(async () => ({
      measurement: reading({ unit: 'm2', value: 9 }),
    }))
    const t = setup({ measure })
    await t.loadPage()
    act(() => t.tape().setMode('area'))
    t.click([0.6, 0.1])
    t.click([0.9, 0.1])
    expect(t.tape().canFinish).toBe(false)
    t.click([0.9, 0.4])
    expect(t.tape().provisional).toEqual({ value: expect.closeTo(4.5), unit: 'm2' })
    expect(t.tape().canFinish).toBe(true)
    t.click([0.604, 0.103])
    await waitFor(() => expect(t.tape().phase).toBe('measured'))
    expect(measure.mock.calls[0][1]).toEqual({
      page: 1,
      operation: 'area',
      points: [
        [0.6, 0.1],
        [0.9, 0.1],
        [0.9, 0.4],
      ],
    })
    expect(t.placed.at(-1)).toMatchObject({ shape: 'polygon', x: 0.6, y: 0.1 })
  })

  it('starts over on another page instead of joining the two', async () => {
    const t = setup()
    act(() => t.tape().setMode('path'))
    t.click([0.1, 0.1])
    t.click([0.3, 0.3], 2)
    expect(t.tape().page).toBe(2)
    expect(t.tape().points).toEqual([[0.3, 0.3]])
  })
})

describe('taking points back', () => {
  it('takes back the last point, and the shape once none are left', () => {
    const t = setup()
    act(() => t.tape().setMode('path'))
    t.click([0.1, 0.1])
    t.click([0.3, 0.3])
    act(() => t.tape().undo())
    expect(t.tape().points).toEqual([[0.1, 0.1]])
    act(() => t.tape().undo())
    expect(t.tape().points).toEqual([])
    expect(t.tape().page).toBeNull()
  })

  it('undoes a whole measurement, closing its draft', async () => {
    const t = setup()
    t.click([0.2, 0.2])
    t.click([0.5, 0.5])
    await waitFor(() => expect(t.tape().phase).toBe('measured'))
    act(() => t.tape().undo())
    expect(t.placed.at(-1)).toBeNull()
    expect(t.tape().points).toEqual([])
    expect(t.tape().phase).toBe('placing')
  })

  it('clears the points when the mode changes', () => {
    const t = setup()
    act(() => t.tape().setMode('path'))
    t.click([0.1, 0.1])
    act(() => t.tape().setMode('distance'))
    expect(t.tape().points).toEqual([])
    expect(t.tape().mode).toBe('distance')
  })
})

describe('the tape on a page without a scale, and taking a discarded measurement back', () => {
  it('places no point on a page that has no scale, and says so', async () => {
    const t = setup({ targets: vi.fn<TapeTargets>(async () => ({ ...TARGETS, scales: [] })) })
    await t.loadPage()
    expect(t.tape().unscaled(1)).toBe(true)
    t.click([0.5, 0.5])
    expect(t.tape().points).toEqual([])
  })

  it('reads the page again once a scale is set, so measuring opens up without a reload', async () => {
    const targets = vi.fn<TapeTargets>(async () => ({ ...TARGETS, scales: [] }))
    const t = setup({ targets })
    await t.loadPage()
    expect(t.tape().unscaled(1)).toBe(true)
    targets.mockImplementation(async () => TARGETS)
    act(() => t.tape().refresh())
    await waitFor(() => expect(t.tape().unscaled(1)).toBe(false))
  })

  it('measures the same points again and opens the draft once more', async () => {
    const t = setup()
    act(() =>
      t.tape().again({
        page: 2,
        shape: 'polygon',
        points: [
          [0.1, 0.1],
          [0.5, 0.1],
          [0.5, 0.5],
        ],
      })
    )
    await waitFor(() => expect(t.tape().phase).toBe('measured'))
    expect(t.tape().mode).toBe('area')
    expect(t.measure).toHaveBeenCalledWith('doc_1', {
      page: 2,
      operation: 'area',
      points: [
        [0.1, 0.1],
        [0.5, 0.1],
        [0.5, 0.5],
      ],
    })
    expect(t.placed.at(-1)).toMatchObject({ page: 2, shape: 'polygon' })
  })
})
