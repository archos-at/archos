import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { capturePosthogException } from '@/lib/analytics/posthog'
import { IfcViewerCanvas } from './ifc-viewer-canvas'
import type { BimViewerElement } from '../lib/model-index'
import type { Measurement } from '../lib/viewer-measure'

interface RecordedRender {
  sectionPlane?: {
    axis: string
    position: number
    enabled: boolean
    flipped?: boolean
    normal?: [number, number, number]
    distance?: number
    min?: number
    max?: number
  }
  ghostExceptIds?: Set<number> | null
  isolatedIds?: Set<number> | null
  hiddenIds?: Set<number>
  selectedId?: number | null
  contributionCull?: { pixelRadius: number } | undefined
  lod?: { screenPx: number } | undefined
  restoreEvictedForCapture?: boolean
  isStreaming?: boolean
  isInteracting?: boolean
}

const BOUNDS = { min: { x: -10, y: -3, z: -10 }, max: { x: 10, y: 9, z: 10 } }

const renders: RecordedRender[] = []
const disposed = { renderer: 0, geometry: 0 }
const kernel: {
  booting: Promise<void> | null
  hold: Promise<void> | null
  failWith: Error | null
  wedged: boolean
} = {
  booting: null,
  hold: null,
  failWith: null,
  wedged: false,
}

const gpu: { failWith: Error | null; finalizing: Promise<void> | null } = {
  failWith: null,
  finalizing: null,
}

const loadOrder: string[] = []
let capturedFrame = -1

const raycasts: ({ point: { x: number; y: number; z: number }; snap?: string } | null)[] = []

const camera = {
  orbit: vi.fn(),
  pan: vi.fn(),
  zoom: vi.fn(),
  update: vi.fn(() => false),
  setOrbitCenter: vi.fn(),
  setAspect: vi.fn(),
  zoomExtent: vi.fn(async () => {}),
  frameBounds: vi.fn(async () => {}),
  setPresetView: vi.fn(),
  setProjectionMode: vi.fn(),
  fitBoundsAdaptive: vi.fn(),
  setSceneBounds: vi.fn(),
  projectToScreen: vi.fn((point: { x: number; y: number }) => ({
    x: point.x * 10,
    y: point.y * 10,
  })),
}

vi.mock('@ifc-lite/renderer', () => ({
  Renderer: class {
    async init(): Promise<void> {
      if (gpu.failWith) throw gpu.failWith
    }
    addMeshes(): void {
      loadOrder.push('addMeshes')
    }
    async enableQuantizedBatches(): Promise<boolean> {
      loadOrder.push('enableQuantizedBatches')
      return true
    }
    async captureScreenshot(): Promise<string> {
      loadOrder.push('captureScreenshot')
      capturedFrame = renders.length - 1
      return 'data:image/png;base64,AAA'
    }
    fitToView(): void {}
    resize(): void {}
    render(options: RecordedRender): void {
      renders.push(options)
    }
    destroy(): void {
      disposed.renderer += 1
    }
    async pick(): Promise<null> {
      return null
    }
    raycastScene() {
      const next = raycasts.shift()
      if (!next) return null
      return {
        intersection: { point: next.point, expressId: 21 },
        ...(next.snap ? { snap: { type: next.snap, position: next.point, expressId: 21 } } : {}),
      }
    }
    getCamera() {
      return camera
    }
    getModelBounds() {
      return BOUNDS
    }
    getScene() {
      return {
        setColorOverrides: vi.fn(),
        clearColorOverrides: vi.fn(),
        getEntityBoundingBox: () => null,
        setLodBuildsEnabled: () => loadOrder.push('setLodBuildsEnabled'),
        finalizeStreamingAsync: async () => {
          loadOrder.push('finalizeStreaming')
          if (gpu.finalizing) await gpu.finalizing
        },
      }
    }
    getGPUDevice() {
      return {}
    }
    getPipeline() {
      return {}
    }
    onDeviceLost() {
      return () => {}
    }
  },
}))

vi.mock('@/lib/analytics/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics/posthog')>()),
  capturePosthog: vi.fn(),
  capturePosthogException: vi.fn(),
}))

vi.mock('@ifc-lite/geometry', () => ({
  GeometryProcessor: class {
    async init(): Promise<void> {
      loadOrder.push('geometry.init')
      if (kernel.booting) await kernel.booting
      loadOrder.push('geometry.ready')
    }
    async *processAdaptive(): AsyncGenerator<{ type: string; meshes: unknown[] }> {
      if (kernel.hold) await kernel.hold
      if (kernel.failWith) {
        kernel.wedged = true
        throw kernel.failWith
      }
      yield { type: 'batch', meshes: [{}, {}] }
    }
    dispose(): void {
      if (kernel.wedged) {
        throw new Error('attempted to take ownership of Rust value while it was borrowed')
      }
      loadOrder.push('geometry.dispose')
      disposed.geometry += 1
    }
  },
}))

const ELEMENTS: BimViewerElement[] = [
  { globalId: 'g-w1', expressId: 21, ifcType: 'IfcWall', name: 'Aussenwand', storeyName: 'EG' },
]

const lastRender = (): RecordedRender => {
  const latest = renders.at(-1)
  if (!latest) throw new Error('nothing was rendered')
  return latest
}

beforeEach(() => {
  renders.length = 0
  raycasts.length = 0
  loadOrder.length = 0
  capturedFrame = -1
  disposed.renderer = 0
  disposed.geometry = 0
  kernel.booting = null
  gpu.failWith = null
  gpu.finalizing = null
  kernel.hold = null
  kernel.failWith = null
  kernel.wedged = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(8),
    }))
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubCanvasHost(): void {
  const canvas = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
  Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true })
  Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true })
  canvas.setPointerCapture = () => {}
  canvas.releasePointerCapture = () => {}
  canvas.hasPointerCapture = () => false
}

async function mountLoaded(props: Partial<Parameters<typeof IfcViewerCanvas>[0]> = {}) {
  const result = render(
    <IfcViewerCanvas sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} {...props} />
  )
  await waitFor(() => expect(renders.length).toBeGreaterThan(0))
  return result
}

function clickCanvas(canvas: Element, at: { clientX: number; clientY: number }): void {
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, ...at })
  fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, ...at })
}

describe('session replay', () => {
  it('blocks the model canvas from the recorder: it has no text to mask', async () => {
    const view = await mountLoaded()

    expect(view.container.querySelector('canvas')?.parentElement).toHaveClass('ph-no-capture')
  })
})

describe('the cut the renderer is actually given', () => {
  it('cuts at the height the reader asked for, in world metres', async () => {
    await mountLoaded({ section: { atMetres: 3, flipped: false } })

    await waitFor(() => expect(lastRender().sectionPlane).toBeDefined())
    const plane = lastRender().sectionPlane
    expect(plane?.normal).toEqual([0, 1, 0])
    expect(plane?.distance).toBe(3)
    expect(plane?.enabled).toBe(true)
  })

  it('states the cardinal position as a percentage of THIS building', async () => {
    await mountLoaded({ section: { atMetres: 3, flipped: false } })

    await waitFor(() => expect(lastRender().sectionPlane).toBeDefined())
    const plane = lastRender().sectionPlane
    expect(plane?.position).toBe(50)
    expect(plane?.min).toBe(-3)
    expect(plane?.max).toBe(9)
  })

  it('moves the plane when the slider moves', async () => {
    const { rerender } = await mountLoaded({ section: { atMetres: 0, flipped: false } })
    await waitFor(() => expect(lastRender().sectionPlane?.distance).toBe(0))

    rerender(
      <IfcViewerCanvas
        sourceUrl="https://example.test/model.ifc"
        elements={ELEMENTS}
        section={{ atMetres: 6, flipped: false }}
      />
    )

    await waitFor(() => expect(lastRender().sectionPlane?.distance).toBe(6))
  })

  it('passes no plane at all when the cut is off', async () => {
    await mountLoaded()
    expect(lastRender().sectionPlane).toBeUndefined()
  })

  it('carries the looking-up direction through', async () => {
    await mountLoaded({ section: { atMetres: 2, flipped: true } })
    await waitFor(() => expect(lastRender().sectionPlane?.flipped).toBe(true))
  })
})

describe('the viewport reports the building it loaded', () => {
  it('hands the cut slider this model own vertical extent', async () => {
    const onBounds = vi.fn()
    await mountLoaded({ onBounds })

    await waitFor(() => expect(onBounds).toHaveBeenCalledWith({ minMetres: -3, maxMetres: 9 }))
  })

  it('walks the load through downloading, parsing and ready', async () => {
    const onStatus = vi.fn()
    await mountLoaded({ onStatus })

    await waitFor(() =>
      expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ phase: 'ready' }))
    )
    const phases = onStatus.mock.calls.map(([status]) => status.phase)
    expect(phases[0]).toBe('downloading')
    expect(phases).toContain('parsing')
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ phase: 'ready', meshCount: 2 }))
  })
})

describe('the x-ray set', () => {
  it('is only sent when something is actually kept solid', async () => {
    await mountLoaded({ xrayKeepIds: new Set<number>() })
    expect(lastRender().ghostExceptIds).toBeNull()
  })

  it('reaches the renderer under the key the renderer reads', async () => {
    await mountLoaded({ xrayKeepIds: new Set([21]) })
    await waitFor(() => expect(lastRender().ghostExceptIds).toEqual(new Set([21])))
  })
})

describe('measuring', () => {
  beforeEach(() => {
    stubCanvasHost()
  })

  it('closes a measurement on the second click, not the first', async () => {
    const onMeasure = vi.fn()
    raycasts.push(
      { point: { x: 0, y: 0, z: 0 }, snap: 'vertex' },
      { point: { x: 3, y: 0, z: 4 }, snap: 'vertex' }
    )
    const { container } = await mountLoaded({ measuring: true, onMeasure })
    const canvas = container.querySelector('canvas')!

    clickCanvas(canvas, { clientX: 10, clientY: 10 })
    expect(onMeasure).not.toHaveBeenCalled()

    clickCanvas(canvas, { clientX: 90, clientY: 10 })
    await waitFor(() => expect(onMeasure).toHaveBeenCalledTimes(1))
    const measured = onMeasure.mock.calls[0][0] as Measurement
    expect(measured.from.point).toEqual({ x: 0, y: 0, z: 0 })
    expect(measured.to.point).toEqual({ x: 3, y: 0, z: 4 })
  })

  it('does not select the element it measured', async () => {
    const onSelect = vi.fn()
    raycasts.push({ point: { x: 0, y: 0, z: 0 }, snap: 'vertex' })
    const { container } = await mountLoaded({ measuring: true, onSelect })

    clickCanvas(container.querySelector('canvas')!, { clientX: 10, clientY: 10 })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('still selects when the tool is off', async () => {
    const onSelect = vi.fn()
    const { container } = await mountLoaded({ onSelect })

    clickCanvas(container.querySelector('canvas')!, { clientX: 10, clientY: 10 })
    await waitFor(() => expect(onSelect).toHaveBeenCalled())
  })

  it('says when a first point is down, so the chrome can say what to click next', async () => {
    const onMeasurePending = vi.fn()
    raycasts.push(
      { point: { x: 0, y: 0, z: 0 }, snap: 'vertex' },
      { point: { x: 1, y: 0, z: 0 }, snap: 'vertex' }
    )
    const { container } = await mountLoaded({ measuring: true, onMeasurePending })
    const canvas = container.querySelector('canvas')!

    clickCanvas(canvas, { clientX: 10, clientY: 10 })
    expect(onMeasurePending).toHaveBeenLastCalledWith(true)

    clickCanvas(canvas, { clientX: 40, clientY: 10 })
    await waitFor(() => expect(onMeasurePending).toHaveBeenLastCalledWith(false))
  })

  it('drops a half-placed measurement when the tool is switched off', async () => {
    const onMeasure = vi.fn()
    raycasts.push(
      { point: { x: 0, y: 0, z: 0 }, snap: 'vertex' },
      { point: { x: 1, y: 0, z: 0 }, snap: 'vertex' }
    )
    const { container, rerender } = await mountLoaded({ measuring: true, onMeasure })
    const canvas = container.querySelector('canvas')!
    clickCanvas(canvas, { clientX: 10, clientY: 10 })

    rerender(
      <IfcViewerCanvas
        sourceUrl="https://example.test/model.ifc"
        elements={ELEMENTS}
        measuring={false}
        onMeasure={onMeasure}
      />
    )
    rerender(
      <IfcViewerCanvas
        sourceUrl="https://example.test/model.ifc"
        elements={ELEMENTS}
        measuring
        onMeasure={onMeasure}
      />
    )
    clickCanvas(canvas, { clientX: 40, clientY: 10 })

    expect(onMeasure).not.toHaveBeenCalled()
  })

  it('draws the finished measurement over the model', async () => {
    const { container } = await mountLoaded({
      measuring: true,
      measurements: [
        {
          id: 'a',
          from: { point: { x: 0, y: 0, z: 0 }, snap: 'vertex' },
          to: { point: { x: 2, y: 1, z: 0 }, snap: 'vertex' },
        },
      ],
    })

    await waitFor(() => {
      const line = container.querySelector('svg line')
      expect(line?.getAttribute('x2')).toBe('20')
      expect(line?.getAttribute('y2')).toBe('10')
    })
    expect(container.textContent).toContain('2.24 m')
  })

  it('leaves every gesture reaching the canvas underneath', async () => {
    const { container } = await mountLoaded({ measurements: [] })
    const svg = container.querySelector('svg')!
    const labels = svg.nextElementSibling as HTMLElement
    expect(svg.getAttribute('class')).toContain('pointer-events-none')
    expect(labels.className).toContain('pointer-events-none')
  })
})

describe('two fingers on a tablet', () => {
  beforeEach(() => {
    stubCanvasHost()
  })

  it('pinches to zoom', async () => {
    const { container } = await mountLoaded()
    const canvas = container.querySelector('canvas')!
    camera.zoom.mockClear()

    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerDown(canvas, { pointerId: 2, button: 0, clientX: 200, clientY: 100 })
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 300, clientY: 100 })

    expect(camera.zoom).toHaveBeenCalled()
  })

  it('keeps orbiting with the finger that is still on the glass', async () => {
    const { container } = await mountLoaded()
    const canvas = container.querySelector('canvas')!

    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerDown(canvas, { pointerId: 2, button: 0, clientX: 200, clientY: 100 })
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 260, clientY: 100 })
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 260, clientY: 100 })

    camera.orbit.mockClear()
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 140, clientY: 130 })
    expect(camera.orbit).toHaveBeenCalledWith(40, 30, true)
  })

  it('does not select whatever the surviving finger is lifted over', async () => {
    const onSelect = vi.fn()
    const { container } = await mountLoaded({ onSelect })
    const canvas = container.querySelector('canvas')!

    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerDown(canvas, { pointerId: 2, button: 0, clientX: 200, clientY: 100 })
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 200, clientY: 100 })
    fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })

    await waitFor(() => expect(renders.length).toBeGreaterThan(0))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('taking elements out of the way', () => {
  it('sends the hidden set under the key the renderer reads', async () => {
    await mountLoaded({ hiddenExpressIds: new Set([21, 22]) })
    await waitFor(() => expect(lastRender().hiddenIds).toEqual(new Set([21, 22])))
  })

  it('sends nothing at all when nothing is hidden', async () => {
    await mountLoaded({ hiddenExpressIds: new Set() })
    expect(lastRender().hiddenIds).toBeUndefined()

    await mountLoaded()
    expect(lastRender().hiddenIds).toBeUndefined()
  })

  it('keeps hiding separate from isolating', async () => {
    await mountLoaded({
      hiddenExpressIds: new Set([21]),
      isolatedExpressIds: new Set([22, 24]),
    })
    await waitFor(() => {
      expect(lastRender().hiddenIds).toEqual(new Set([21]))
      expect(lastRender().isolatedIds).toEqual(new Set([22, 24]))
    })
  })
})

describe('surviving a real building', () => {
  it('switches on quantized vertices and LOD builds BEFORE any geometry lands', async () => {
    await mountLoaded()
    const quantized = loadOrder.indexOf('enableQuantizedBatches')
    const lod = loadOrder.indexOf('setLodBuildsEnabled')
    const firstMesh = loadOrder.indexOf('addMeshes')

    expect(quantized).toBeGreaterThanOrEqual(0)
    expect(lod).toBeGreaterThanOrEqual(0)
    expect(firstMesh).toBeGreaterThan(quantized)
    expect(firstMesh).toBeGreaterThan(lod)
  })

  it('culls sub-pixel batches on the interactive frame', async () => {
    await mountLoaded()
    expect(lastRender().contributionCull?.pixelRadius).toBeGreaterThan(0)
    expect(lastRender().lod?.screenPx).toBeGreaterThan(0)
  })
})

describe('capturing the view', () => {
  it('draws an exhaustive frame and captures THAT', async () => {
    const onCapture = vi.fn()
    const { rerender } = await mountLoaded({ captureNonce: 0, onCapture })

    rerender(
      <IfcViewerCanvas
        sourceUrl="https://example.test/model.ifc"
        elements={ELEMENTS}
        captureNonce={1}
        onCapture={onCapture}
      />
    )

    await waitFor(() => expect(onCapture).toHaveBeenCalledWith('data:image/png;base64,AAA'))
    expect(capturedFrame).toBeGreaterThanOrEqual(0)
    const captured = renders[capturedFrame]
    expect(captured.contributionCull).toBeUndefined()
    expect(captured.lod).toBeUndefined()
    expect(captured.restoreEvictedForCapture).toBe(true)
    expect(captured.isStreaming).toBe(false)
  })

  it('does not capture itself on mount', async () => {
    const onCapture = vi.fn()
    await mountLoaded({ onCapture })
    expect(onCapture).not.toHaveBeenCalled()
  })

  it('reports a failed capture rather than doing nothing', async () => {
    const onCapture = vi.fn()
    const { rerender } = await mountLoaded({ onCapture })
    const renderer = (await import('@ifc-lite/renderer')) as unknown as {
      Renderer: { prototype: { captureScreenshot: () => Promise<string | null> } }
    }
    const original = renderer.Renderer.prototype.captureScreenshot
    renderer.Renderer.prototype.captureScreenshot = async () => null

    rerender(
      <IfcViewerCanvas
        sourceUrl="https://example.test/model.ifc"
        elements={ELEMENTS}
        captureNonce={7}
        onCapture={onCapture}
      />
    )
    await waitFor(() => expect(onCapture).toHaveBeenCalledWith(null))
    renderer.Renderer.prototype.captureScreenshot = original
  })
})

describe('lifecycle', () => {
  it('frees the geometry kernel once the model has streamed, and the renderer on unmount', async () => {
    let finish = () => {}
    gpu.finalizing = new Promise((resolve) => {
      finish = resolve
    })
    const { unmount } = render(
      <IfcViewerCanvas sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />
    )
    await waitFor(() => expect(loadOrder).toContain('finalizeStreaming'))
    expect(disposed.geometry).toBe(1)
    finish()
    await waitFor(() => expect(renders.length).toBeGreaterThan(0))
    expect(disposed.geometry).toBe(1)
    expect(disposed.renderer).toBe(0)
    unmount()
    expect(disposed.renderer).toBe(1)
    expect(disposed.geometry).toBe(1)
  })

  it('frees the geometry kernel on unmount while the model is still streaming, and only once', async () => {
    let release = () => {}
    kernel.hold = new Promise((resolve) => {
      release = resolve
    })
    const { unmount } = render(
      <IfcViewerCanvas sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />
    )
    await waitFor(() => expect(loadOrder).toContain('enableQuantizedBatches'))

    unmount()
    expect(disposed.renderer).toBe(1)
    expect(disposed.geometry).toBe(1)
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(disposed.geometry).toBe(1)
  })

  it('frees a kernel that finishes booting after the reader left, and only once', async () => {
    let boot = () => {}
    kernel.booting = new Promise((resolve) => {
      boot = resolve
    })
    const { unmount } = render(
      <IfcViewerCanvas sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />
    )
    await waitFor(() => expect(loadOrder).toContain('geometry.init'))

    unmount()
    boot()
    await waitFor(() => expect(disposed.geometry).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(loadOrder.filter((step) => step.startsWith('geometry.'))).toEqual([
      'geometry.init',
      'geometry.ready',
      'geometry.dispose',
    ])
    expect(capturePosthogException).not.toHaveBeenCalled()
  })

  it('frees a kernel that finishes booting after the renderer already failed', async () => {
    let boot = () => {}
    kernel.booting = new Promise((resolve) => {
      boot = resolve
    })
    const noAdapter = new Error('no GPU adapter')
    gpu.failWith = noAdapter
    const onStatus = vi.fn()
    render(
      <IfcViewerCanvas
        sourceUrl="https://example.test/model.ifc"
        elements={ELEMENTS}
        onStatus={onStatus}
      />
    )
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ phase: 'error' })))
    expect(disposed.geometry).toBe(0)

    boot()
    await waitFor(() => expect(disposed.geometry).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(disposed.geometry).toBe(1)
    expect(capturePosthogException).toHaveBeenCalledTimes(1)
    expect(capturePosthogException).toHaveBeenCalledWith(noAdapter, { source: 'ifc-viewer-load' })
  })

  it('does not take the page down when the reader leaves while a wedged kernel is still streaming', async () => {
    let release = () => {}
    kernel.hold = new Promise((resolve) => {
      release = resolve
    })
    const { unmount } = render(
      <IfcViewerCanvas sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />
    )
    await waitFor(() => expect(loadOrder).toContain('enableQuantizedBatches'))
    kernel.wedged = true
    kernel.failWith = new Error('null pointer passed to rust')

    expect(() => unmount()).not.toThrow()
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(disposed.geometry).toBe(0)
    expect(capturePosthogException).toHaveBeenCalledTimes(1)
    expect(capturePosthogException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('while it was borrowed') }),
      { source: 'ifc-viewer-dispose' }
    )
  })

  it('does not take the page down when the reader leaves a model whose kernel call failed', async () => {
    const trap = new Error('unreachable')
    kernel.failWith = trap
    const onStatus = vi.fn()
    const { unmount } = render(
      <IfcViewerCanvas
        sourceUrl="https://example.test/model.ifc"
        elements={ELEMENTS}
        onStatus={onStatus}
      />
    )
    await waitFor(() =>
      expect(capturePosthogException).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('while it was borrowed') }),
        { source: 'ifc-viewer-dispose' }
      )
    )
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ phase: 'error' }))

    expect(() => unmount()).not.toThrow()
    expect(disposed.renderer).toBe(1)
    expect(capturePosthogException).toHaveBeenCalledTimes(2)
    expect(capturePosthogException).toHaveBeenCalledWith(trap, { source: 'ifc-viewer-load' })
  })

  it('reports a failed download as an error rather than an empty canvas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        headers: { get: () => null },
        body: null,
        arrayBuffer: async () => new ArrayBuffer(0),
      }))
    )
    const onStatus = vi.fn()
    render(
      <IfcViewerCanvas
        sourceUrl="https://example.test/expired.ifc"
        elements={ELEMENTS}
        onStatus={onStatus}
      />
    )

    await waitFor(() =>
      expect(onStatus).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'error', message: expect.stringContaining('403') })
      )
    )
  })
})
