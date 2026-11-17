import { describe, expect, it } from 'vitest'
import { BIM_CAMERA_VIEWS, boundsCentre, DOUBLE_TAP_DISTANCE_PX, DOUBLE_TAP_MS, dragSlopFor, isDoubleTap, pointerDragged, clampCut, defaultCameraState, defaultCutForStorey, downloadWithProgress, encodeCameraState, impliesOrthographic, keyboardCameraStep, parseCameraState, rendererPreset, rendererSectionPlane, wheelZoomDelta, type BimViewerCameraState } from './viewer-camera'

const roundTrip = (state: BimViewerCameraState): BimViewerCameraState => {
  const params = new URLSearchParams()
  encodeCameraState(state, params)
  return parseCameraState(params)
}

describe('camera views', () => {
  it('looks AT the named facade, standing on that side', () => {
    expect(rendererPreset('north')).toBe('back')
    expect(rendererPreset('south')).toBe('front')
    expect(rendererPreset('east')).toBe('right')
    expect(rendererPreset('west')).toBe('left')
    expect(rendererPreset('top')).toBe('top')
  })

  it('has no renderer preset for the free view', () => {
    expect(rendererPreset('iso')).toBeNull()
  })

  it('maps every view it advertises', () => {
    for (const view of BIM_CAMERA_VIEWS) {
      if (view === 'iso') continue
      expect(rendererPreset(view)).not.toBeNull()
    }
  })

  it('draws every cardinal view in parallel projection', () => {
    for (const view of BIM_CAMERA_VIEWS) {
      expect(impliesOrthographic(view)).toBe(view !== 'iso')
    }
  })
})

describe('the Grundriss cut', () => {
  it('cuts a metre above the finished floor, not at it', () => {
    expect(defaultCutForStorey(0)).toBe(1)
    expect(defaultCutForStorey(3.2)).toBe(4.2)
    expect(defaultCutForStorey(-2.75)).toBe(-1.75)
  })

  it('refuses a storey that publishes no elevation', () => {
    expect(defaultCutForStorey(null)).toBeNull()
    expect(defaultCutForStorey(undefined)).toBeNull()
    expect(defaultCutForStorey(Number.NaN)).toBeNull()
  })

  it('keeps a cut inside the building', () => {
    const bounds = { minY: -0.5, maxY: 6.25 }
    expect(clampCut(3, bounds)).toBe(3)
    expect(clampCut(99, bounds)).toBe(6.25)
    expect(clampCut(-99, bounds)).toBe(-0.5)
    expect(clampCut(Number.NaN, bounds)).toBe(-0.5)
  })

  it('rounds to the centimetre', () => {
    expect(clampCut(2.60449, { minY: 0, maxY: 10 })).toBe(2.6)
  })
})

describe('the section plane the renderer is given', () => {
  const bounds = { minMetres: 0, maxMetres: 12 }

  it('cuts at the metre the slider says, in world units', () => {
    const plane = rendererSectionPlane({ atMetres: 3, flipped: false }, bounds)
    expect(plane.normal).toEqual([0, 1, 0])
    expect(plane.distance).toBe(3)
  })

  it('states the position as a PERCENTAGE of the model, not as metres', () => {
    expect(rendererSectionPlane({ atMetres: 3, flipped: false }, bounds).position).toBe(25)
    expect(rendererSectionPlane({ atMetres: 0, flipped: false }, bounds).position).toBe(0)
    expect(rendererSectionPlane({ atMetres: 12, flipped: false }, bounds).position).toBe(100)
  })

  it('agrees with itself: the percentage resolves back to the same plane', () => {
    const plane = rendererSectionPlane({ atMetres: 7.5, flipped: false }, bounds)
    const resolved =
      (plane.min ?? 0) + (plane.position / 100) * ((plane.max ?? 0) - (plane.min ?? 0))
    expect(resolved).toBeCloseTo(plane.distance ?? Number.NaN, 10)
  })

  it('handles a building that does not start at zero', () => {
    const withBasement = { minMetres: -3.5, maxMetres: 6.5 }
    const plane = rendererSectionPlane({ atMetres: 1.5, flipped: false }, withBasement)
    expect(plane.distance).toBe(1.5)
    expect(plane.position).toBe(50)
  })

  it('carries the direction of view through untouched', () => {
    expect(rendererSectionPlane({ atMetres: 2, flipped: true }, bounds).flipped).toBe(true)
    expect(rendererSectionPlane({ atMetres: 2, flipped: false }, bounds).flipped).toBe(false)
  })

  it('never emits NaN, whatever it is handed', () => {
    const degenerate = rendererSectionPlane({ atMetres: 2, flipped: false }, { minMetres: 4, maxMetres: 4 })
    expect(Number.isFinite(degenerate.position)).toBe(true)
    expect(Number.isFinite(degenerate.distance)).toBe(true)

    const noBounds = rendererSectionPlane({ atMetres: Number.NaN, flipped: false }, null)
    expect(Number.isFinite(noBounds.position)).toBe(true)
    expect(Number.isFinite(noBounds.distance)).toBe(true)
    expect(noBounds.min).toBeUndefined()
  })

  it('clamps a cut outside the model into the slider range', () => {
    expect(rendererSectionPlane({ atMetres: 99, flipped: false }, bounds).position).toBe(100)
    expect(rendererSectionPlane({ atMetres: -99, flipped: false }, bounds).position).toBe(0)
  })
})

describe('the camera state in a link', () => {
  it('encodes nothing for the default view', () => {
    const params = new URLSearchParams()
    encodeCameraState(defaultCameraState(), params)

    expect(params.toString()).toBe('')
  })

  it('round-trips a section seen from above', () => {
    const state: BimViewerCameraState = {
      view: 'top',
      section: { atMetres: 2.6, flipped: false },
      orthographic: true,
    }
    expect(roundTrip(state)).toEqual(state)
  })

  it('round-trips a section seen from below', () => {
    const state: BimViewerCameraState = {
      view: 'north',
      section: { atMetres: 2.6, flipped: true },
      orthographic: true,
    }
    const params = new URLSearchParams()
    encodeCameraState(state, params)

    expect(params.get('cut')).toBe('2.6')
    expect(params.get('cutup')).toBe('1')
    expect(roundTrip(state)).toEqual(state)
  })

  it('round-trips a cut BELOW the origin, which a basement has', () => {
    const state: BimViewerCameraState = {
      view: 'north',
      section: { atMetres: -1.4, flipped: false },
      orthographic: true,
    }
    const params = new URLSearchParams()
    encodeCameraState(state, params)

    expect(params.get('cut')).toBe('-1.4')
    expect(roundTrip(state)).toEqual(state)
  })

  it('round-trips a cut below the origin seen from below', () => {
    const state: BimViewerCameraState = {
      view: 'iso',
      section: { atMetres: -2.75, flipped: true },
      orthographic: false,
    }
    expect(roundTrip(state)).toEqual(state)
  })

  it('round-trips an upward cut at exactly zero', () => {
    const state: BimViewerCameraState = {
      view: 'iso',
      section: { atMetres: 0, flipped: true },
      orthographic: false,
    }
    expect(roundTrip(state)).toEqual(state)
  })

  it('never writes a negative zero, so one view has one link', () => {
    const params = new URLSearchParams()
    encodeCameraState(
      { view: 'iso', section: { atMetres: -0.002, flipped: false }, orthographic: false },
      params
    )
    expect(params.get('cut')).toBe('0')
  })
})

describe('a link written by the old encoding', () => {
  const read = (query: string) => parseCameraState(new URLSearchParams(query))

  it('reads a downward cut the same way', () => {
    expect(read('cut=2.6')).toMatchObject({ section: { atMetres: 2.6, flipped: false } })
  })

  it('still reads a negative cut as the upward cut it meant', () => {
    expect(read('cut=-2.6')).toMatchObject({ section: { atMetres: 2.6, flipped: true } })
  })

  it('reads the flipped-at-zero case both encodings agree on', () => {
    expect(read('cut=0&cutup=1')).toMatchObject({ section: { atMetres: 0, flipped: true } })
  })

  it('keeps perspective out of the URL when it is what the view implies', () => {
    const params = new URLSearchParams()
    encodeCameraState({ view: 'iso', section: null, orthographic: false }, params)
    expect(params.has('proj')).toBe(false)

    const plan = new URLSearchParams()
    encodeCameraState({ view: 'top', section: null, orthographic: true }, plan)
    expect(plan.has('proj')).toBe(false)
  })

  it('records a projection the reader chose against the view’s default', () => {
    const state: BimViewerCameraState = { view: 'top', section: null, orthographic: false }
    const params = new URLSearchParams()
    encodeCameraState(state, params)

    expect(params.get('proj')).toBe('persp')
    expect(roundTrip(state)).toEqual(state)
  })

  it('falls back to the free view rather than failing on a bad one', () => {
    expect(parseCameraState(new URLSearchParams('view=sideways')).view).toBe('iso')
  })

  it('drops a cut that is not a number', () => {
    expect(parseCameraState(new URLSearchParams('cut=deep')).section).toBeNull()
    expect(parseCameraState(new URLSearchParams('cut=')).section).toBeNull()
  })

  it('infers parallel projection for a cardinal view arriving without one', () => {
    expect(parseCameraState(new URLSearchParams('view=north')).orthographic).toBe(true)
    expect(parseCameraState(new URLSearchParams('')).orthographic).toBe(false)
  })
})

describe('wheelZoomDelta', () => {
  const cameraFactor = (delta: number): number =>
    1 + Math.sign(delta) * Math.min(Math.abs(delta) * 0.001, 0.1)

  it('turns one wheel notch into a step a person can see', () => {
    expect(wheelZoomDelta(100, 0, 800)).toBeCloseTo(50)
    expect(cameraFactor(wheelZoomDelta(100, 0, 800))).toBeCloseTo(1.05)
    expect(wheelZoomDelta(-100, 0, 800)).toBeCloseTo(-50)
  })

  it('leaves headroom above one notch rather than saturating on every event', () => {
    const notch = Math.abs(wheelZoomDelta(100, 0, 800)) * 0.001
    expect(notch).toBeLessThan(0.1)
    expect(Math.abs(wheelZoomDelta(400, 0, 800)) * 0.001).toBeGreaterThanOrEqual(0.1)
  })

  it('scales line-mode deltas, which Firefox reports instead of pixels', () => {
    expect(wheelZoomDelta(3, 1, 800)).toBeCloseTo(24)
    expect(wheelZoomDelta(3, 0, 800)).toBeCloseTo(1.5)
    expect(wheelZoomDelta(3, 1, 800)).toBeGreaterThan(wheelZoomDelta(3, 0, 800))
  })

  it('treats page-mode as one viewport, and survives a zero-height canvas', () => {
    expect(wheelZoomDelta(1, 2, 900)).toBeCloseTo(450)
    expect(wheelZoomDelta(1, 2, 0)).toBeCloseTo(0.5)
  })

  it('keeps direction, because the sign is what zooms in rather than out', () => {
    for (const mode of [0, 1, 2]) {
      expect(Math.sign(wheelZoomDelta(-5, mode, 800))).toBe(-1)
      expect(Math.sign(wheelZoomDelta(5, mode, 800))).toBe(1)
    }
  })
})

describe('pointerDragged', () => {
  it('calls a press that did not move a click', () => {
    expect(pointerDragged({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false)
    expect(pointerDragged({ x: 100, y: 100 }, { x: 101, y: 100 })).toBe(false)
  })

  it('calls a press that travelled a drag', () => {
    expect(pointerDragged({ x: 100, y: 100 }, { x: 110, y: 100 })).toBe(true)
    expect(pointerDragged({ x: 100, y: 100 }, { x: 98, y: 98 })).toBe(true)
  })

  it('sees a slow drag that never moved more than a pixel at a time', () => {
    const origin = { x: 400, y: 300 }
    let current = { ...origin }
    let trippedPerEvent = false
    for (let step = 0; step < 120; step += 1) {
      const next = { x: current.x + 1, y: current.y }
      trippedPerEvent ||= pointerDragged(current, next)
      current = next
    }
    expect(trippedPerEvent).toBe(false)
    expect(pointerDragged(origin, current)).toBe(true)
  })

  it('takes the slop as a parameter, in Manhattan pixels', () => {
    expect(pointerDragged({ x: 0, y: 0 }, { x: 3, y: 3 }, 10)).toBe(false)
    expect(pointerDragged({ x: 0, y: 0 }, { x: 6, y: 6 }, 10)).toBe(true)
  })
})

describe('dragSlopFor', () => {
  it('lets a fingertip roll further than a mouse before it is a drag', () => {
    expect(dragSlopFor('mouse')).toBe(2)
    expect(dragSlopFor('touch')).toBeGreaterThanOrEqual(8)
    expect(dragSlopFor('pen')).toBeGreaterThan(dragSlopFor('mouse'))
    expect(dragSlopFor('pen')).toBeLessThan(dragSlopFor('touch'))
  })

  it('treats a tap that rolled 6 px as a tap on touch and a drag with a mouse', () => {
    const origin = { x: 200, y: 400 }
    const rolled = { x: 204, y: 402 }
    expect(pointerDragged(origin, rolled, dragSlopFor('touch'))).toBe(false)
    expect(pointerDragged(origin, rolled, dragSlopFor('mouse'))).toBe(true)
  })

  it('still calls a deliberate swipe a drag on touch', () => {
    expect(pointerDragged({ x: 0, y: 0 }, { x: 30, y: 0 }, dragSlopFor('touch'))).toBe(true)
  })

  it('falls back to the mouse allowance for an unknown pointer type', () => {
    expect(dragSlopFor('')).toBe(2)
  })
})

describe('isDoubleTap', () => {
  const first = { at: 1000, x: 100, y: 200 }

  it('is the second tap of a close pair', () => {
    expect(isDoubleTap(first, { at: 1000 + DOUBLE_TAP_MS, x: 104, y: 203 })).toBe(true)
  })

  it('is not, with no tap before it', () => {
    expect(isDoubleTap(null, first)).toBe(false)
  })

  it('is not, when the second tap comes too late', () => {
    expect(isDoubleTap(first, { at: 1000 + DOUBLE_TAP_MS + 1, x: 100, y: 200 })).toBe(false)
  })

  it('is not, when the taps land on different things', () => {
    expect(isDoubleTap(first, { at: 1100, x: 100 + DOUBLE_TAP_DISTANCE_PX + 1, y: 200 })).toBe(false)
  })
})

describe('boundsCentre', () => {
  it('is the middle of the box, including through the origin', () => {
    expect(boundsCentre({ min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 2, z: 10 } })).toEqual({
      x: 2,
      y: 1,
      z: 5,
    })
    expect(boundsCentre({ min: { x: -6, y: -2, z: -1 }, max: { x: 2, y: 2, z: 3 } })).toEqual({
      x: -2,
      y: 0,
      z: 1,
    })
  })

  it('handles a degenerate box, which a zero-thickness element really has', () => {
    const point = { x: 3, y: 3, z: 3 }
    expect(boundsCentre({ min: point, max: point })).toEqual(point)
  })
})

describe('downloadWithProgress', () => {
  const streamed = (chunks: number[][], headers: Record<string, string> = {}) => ({
    headers: { get: (name: string) => headers[name] ?? null },
    body: {
      getReader: () => {
        let index = 0
        return {
          read: async () =>
            index < chunks.length
              ? { done: false, value: new Uint8Array(chunks[index++]) }
              : { done: true, value: undefined },
        }
      },
    },
    arrayBuffer: async () => new ArrayBuffer(0),
  })

  it('reassembles the chunks in order, byte for byte', async () => {
    const bytes = await downloadWithProgress(streamed([[1, 2], [3], [4, 5, 6]]), () => {})
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('reports real progress against Content-Length', async () => {
    const seen: Array<number | null> = []
    await downloadWithProgress(streamed([[1, 2], [3], [4, 5, 6]], { 'Content-Length': '6' }), (p) =>
      seen.push(p)
    )
    expect(seen).toEqual([33, 50, 100])
  })

  it('reports null rather than a wrong number when there is no length', async () => {
    const seen: Array<number | null> = []
    await downloadWithProgress(streamed([[1], [2]]), (p) => seen.push(p))
    expect(seen).toEqual([null])
  })

  it('reports a percentage only when it has actually changed', async () => {
    const chunks = Array.from({ length: 50 }, () => [1])
    const seen: Array<number | null> = []
    await downloadWithProgress(streamed(chunks, { 'Content-Length': '50' }), (p) => seen.push(p))
    expect(seen).toEqual([...new Set(seen)])
    expect(seen.at(-1)).toBe(100)
  })

  it('never exceeds 100 when the declared length disagrees with the bytes', async () => {
    const seen: Array<number | null> = []
    const bytes = await downloadWithProgress(streamed([[1, 2, 3, 4]], { 'Content-Length': '2' }), (p) =>
      seen.push(p)
    )
    expect(seen).toEqual([100])
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4])
  })

  it('writes into one buffer when the length is known, rather than copying twice', async () => {
    const bytes = await downloadWithProgress(
      streamed([[1, 2], [3], [4, 5, 6]], { 'Content-Length': '6' }),
      () => {}
    )
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5, 6])
    expect(bytes).toHaveLength(6)
  })

  it('returns only the bytes that arrived when the body is shorter than declared', async () => {
    const bytes = await downloadWithProgress(streamed([[1, 2, 3]], { 'Content-Length': '10' }), () => {})
    expect(Array.from(bytes)).toEqual([1, 2, 3])
  })

  it('falls back to a buffered read when the body cannot stream', async () => {
    const response = {
      headers: { get: () => null },
      body: null,
      arrayBuffer: async () => new Uint8Array([9, 9]).buffer,
    }
    const seen: Array<number | null> = []
    const bytes = await downloadWithProgress(response, (p) => seen.push(p))

    expect(Array.from(bytes)).toEqual([9, 9])
    expect(seen).toEqual([null])
  })
})

describe('downloadWithProgress reports bytes beside the percentage', () => {
  const streamed = (chunks: number[][], headers: Record<string, string> = {}) => ({
    headers: { get: (name: string) => headers[name] ?? null },
    body: {
      getReader: () => {
        let index = 0
        return {
          read: async () =>
            index < chunks.length
              ? { done: false, value: new Uint8Array(chunks[index++]) }
              : { done: true, value: undefined },
        }
      },
    },
    arrayBuffer: async () => new ArrayBuffer(0),
  })

  it('says how much has arrived of how much was declared', async () => {
    const seen: Array<{ loaded: number; total: number }> = []
    await downloadWithProgress(
      streamed([[1, 2], [3, 4], [5, 6, 7, 8]], { 'Content-Length': '8' }),
      (_percent, bytes) => seen.push(bytes)
    )
    expect(seen.at(-1)).toEqual({ loaded: 8, total: 8 })
    expect(seen.every((bytes) => bytes.total === 8)).toBe(true)
  })

  it('reports an unknown total as 0, never a guess', async () => {
    const seen: Array<{ loaded: number; total: number }> = []
    await downloadWithProgress(streamed([[1, 2, 3]]), (_percent, bytes) => seen.push(bytes))
    expect(seen.at(-1)).toEqual({ loaded: 3, total: 0 })
  })
})

describe('downloadWithProgress over a gzipped response', () => {
  const respond = (headers: Record<string, string>, chunks: number[][]) => ({
    headers: { get: (name: string) => headers[name] ?? null },
    body: {
      getReader: () => {
        let index = 0
        return {
          read: async () =>
            index < chunks.length
              ? { done: false, value: new Uint8Array(chunks[index++]) }
              : { done: true, value: undefined },
        }
      },
    },
    arrayBuffer: async () => new ArrayBuffer(0),
  })

  it('measures against the UNCOMPRESSED length, not the wire length', async () => {
    const seen: Array<number | null> = []
    await downloadWithProgress(
      respond(
        { 'Content-Encoding': 'gzip', 'Content-Length': '2', 'x-amz-meta-uncompressed-length': '10' },
        [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]
      ),
      (p) => seen.push(p)
    )
    expect(seen).toEqual([50, 100])
  })

  it('is indeterminate when gzipped with no uncompressed length to divide by', async () => {
    const seen: Array<number | null> = []
    await downloadWithProgress(
      respond({ 'Content-Encoding': 'gzip', 'Content-Length': '2' }, [[1, 2, 3, 4]]),
      (p) => seen.push(p)
    )
    expect(seen).toEqual([null])
  })

  it('still uses Content-Length for an uncompressed response', async () => {
    const seen: Array<number | null> = []
    await downloadWithProgress(respond({ 'Content-Length': '4' }, [[1, 2], [3, 4]]), (p) =>
      seen.push(p)
    )
    expect(seen).toEqual([50, 100])
  })
})

describe('keyboardCameraStep', () => {
  it('maps the arrows to screen-space moves, matching the drag they stand in for', () => {
    expect(keyboardCameraStep('ArrowLeft')).toEqual({ kind: 'move', x: -1, y: 0 })
    expect(keyboardCameraStep('ArrowRight')).toEqual({ kind: 'move', x: 1, y: 0 })
    expect(keyboardCameraStep('ArrowUp')).toEqual({ kind: 'move', x: 0, y: -1 })
    expect(keyboardCameraStep('ArrowDown')).toEqual({ kind: 'move', x: 0, y: 1 })
  })

  it('zooms IN on plus and OUT on minus', () => {
    const zoomIn = keyboardCameraStep('+')
    const zoomOut = keyboardCameraStep('-')
    expect(zoomIn).toMatchObject({ kind: 'zoom' })
    expect(zoomOut).toMatchObject({ kind: 'zoom' })
    expect((zoomIn as { amount: number }).amount).toBeLessThan(0)
    expect((zoomOut as { amount: number }).amount).toBeGreaterThan(0)
    expect(Math.abs((zoomIn as { amount: number }).amount) * 0.001).toBeGreaterThan(0.01)
  })

  it('accepts both faces of the same physical key', () => {
    expect(keyboardCameraStep('=')).toEqual(keyboardCameraStep('+'))
    expect(keyboardCameraStep('_')).toEqual(keyboardCameraStep('-'))
  })

  it('is null for everything else, so unrelated keys keep their default behaviour', () => {
    for (const key of ['Tab', 'Escape', 'a', 'Enter', ' ', 'F5']) {
      expect(keyboardCameraStep(key)).toBeNull()
    }
  })
})
