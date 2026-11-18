import type { SectionPlane } from '@ifc-lite/renderer'

export const BIM_CAMERA_VIEWS = ['iso', 'top', 'north', 'south', 'east', 'west'] as const
export type BimCameraView = (typeof BIM_CAMERA_VIEWS)[number]

const VIEWS = new Set<string>(BIM_CAMERA_VIEWS)

const RENDERER_PRESET: Record<Exclude<BimCameraView, 'iso'>, 'top' | 'front' | 'back' | 'left' | 'right'> =
  {
    top: 'top',
    north: 'back',
    south: 'front',
    east: 'right',
    west: 'left',
  }

export function rendererPreset(view: BimCameraView): 'top' | 'front' | 'back' | 'left' | 'right' | null {
  return view === 'iso' ? null : RENDERER_PRESET[view]
}

export function impliesOrthographic(view: BimCameraView): boolean {
  return view !== 'iso'
}

export interface BimSection {
  atMetres: number
  flipped: boolean
}

export const FLOOR_PLAN_CUT_ABOVE_FLOOR_M = 1

export function defaultCutForStorey(elevationMetres: number | null | undefined): number | null {
  if (typeof elevationMetres !== 'number' || !Number.isFinite(elevationMetres)) return null
  return round(elevationMetres + FLOOR_PLAN_CUT_ABOVE_FLOOR_M)
}

function round(metres: number): number {
  return Math.round(metres * 100) / 100
}

export function clampCut(atMetres: number, bounds: { minY: number; maxY: number }): number {
  if (!Number.isFinite(atMetres)) return round(bounds.minY)
  return round(Math.min(Math.max(atMetres, bounds.minY), bounds.maxY))
}

export type RendererSectionPlane = SectionPlane

export function cutPercent(
  atMetres: number,
  bounds: { minMetres: number; maxMetres: number } | null
): number {
  if (!bounds) return 50
  const range = bounds.maxMetres - bounds.minMetres
  if (!Number.isFinite(range) || range <= 0) return 50
  const percent = ((atMetres - bounds.minMetres) / range) * 100
  if (!Number.isFinite(percent)) return 50
  return Math.min(100, Math.max(0, percent))
}

export function rendererSectionPlane(
  section: BimSection,
  bounds: { minMetres: number; maxMetres: number } | null
): RendererSectionPlane {
  const atMetres = Number.isFinite(section.atMetres) ? section.atMetres : (bounds?.minMetres ?? 0)
  return {
    axis: 'down',
    position: cutPercent(atMetres, bounds),
    enabled: true,
    flipped: section.flipped,
    normal: [0, 1, 0],
    distance: atMetres,
    ...(bounds ? { min: bounds.minMetres, max: bounds.maxMetres } : {}),
    showCap: true,
    showOutlines: true,
  }
}

export interface BimViewerCameraState {
  view: BimCameraView
  section: BimSection | null
  orthographic: boolean
}

export function defaultCameraState(): BimViewerCameraState {
  return { view: 'iso', section: null, orthographic: false }
}

export function encodeCameraState(state: BimViewerCameraState, params: URLSearchParams): void {
  if (state.view !== 'iso') params.set('view', state.view)
  if (state.section) {
    params.set('cut', String(round(state.section.atMetres) || 0))
    params.set('cutup', state.section.flipped ? '1' : '0')
  }
  if (state.orthographic !== impliesOrthographic(state.view)) {
    params.set('proj', state.orthographic ? 'ortho' : 'persp')
  }
}

export function parseCameraState(params: URLSearchParams): BimViewerCameraState {
  const rawView = params.get('view')?.trim()
  const view = rawView && VIEWS.has(rawView) ? (rawView as BimCameraView) : 'iso'

  let section: BimSection | null = null
  const rawCut = params.get('cut')
  if (rawCut !== null && rawCut.trim() !== '') {
    const cut = Number(rawCut)
    if (Number.isFinite(cut)) {
      const direction = params.get('cutup')
      section =
        direction === null
          ? // No direction parameter: a link from the encoding that put the
            { atMetres: round(Math.abs(cut)), flipped: cut < 0 }
          : { atMetres: round(cut), flipped: direction === '1' }
    }
  }

  const proj = params.get('proj')?.trim()
  const orthographic =
    proj === 'ortho' ? true : proj === 'persp' ? false : impliesOrthographic(view)

  return { view, section, orthographic }
}

export function wheelZoomDelta(
  deltaY: number,
  deltaMode: number,
  canvasHeight: number,
  scale = 0.5
): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(canvasHeight, 1) : 1
  return deltaY * unit * scale
}

export function pointerDragged(
  origin: { x: number; y: number },
  current: { x: number; y: number },
  slopPx = 2
): boolean {
  return Math.abs(current.x - origin.x) + Math.abs(current.y - origin.y) > slopPx
}

export function dragSlopFor(pointerType: string): number {
  if (pointerType === 'touch') return 10
  if (pointerType === 'pen') return 6
  return 2
}

export const DOUBLE_TAP_MS = 320
export const DOUBLE_TAP_DISTANCE_PX = 28

export function isDoubleTap(
  previous: { at: number; x: number; y: number } | null,
  current: { at: number; x: number; y: number }
): boolean {
  if (!previous) return false
  return (
    current.at - previous.at <= DOUBLE_TAP_MS &&
    Math.hypot(current.x - previous.x, current.y - previous.y) <= DOUBLE_TAP_DISTANCE_PX
  )
}

export type CameraKeyStep =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'zoom'; amount: number }

const KEY_ZOOM_STEP = 60

export function keyboardCameraStep(key: string): CameraKeyStep | null {
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'move', x: -1, y: 0 }
    case 'ArrowRight':
      return { kind: 'move', x: 1, y: 0 }
    case 'ArrowUp':
      return { kind: 'move', x: 0, y: -1 }
    case 'ArrowDown':
      return { kind: 'move', x: 0, y: 1 }
    case '+':
    case '=':
      return { kind: 'zoom', amount: -KEY_ZOOM_STEP }
    case '-':
    case '_':
      return { kind: 'zoom', amount: KEY_ZOOM_STEP }
    default:
      return null
  }
}

export function boundsCentre(box: {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}): { x: number; y: number; z: number } {
  return {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  }
}

export interface DownloadBytes {
  loaded: number
  total: number
}

export async function downloadWithProgress(
  response: { headers: { get(name: string): string | null }; body: unknown; arrayBuffer(): Promise<ArrayBuffer> },
  onProgress: (percent: number | null, bytes: DownloadBytes) => void
): Promise<Uint8Array> {
  const body = response.body as {
    getReader?: () => { read(): Promise<{ done: boolean; value?: Uint8Array }> }
  } | null
  const reader = body?.getReader?.()
  if (!reader) {
    const buffered = new Uint8Array(await response.arrayBuffer())
    onProgress(null, { loaded: buffered.length, total: 0 })
    return buffered
  }

  const encoded = (response.headers.get('Content-Encoding') ?? '').trim() !== ''
  const declaredRaw =
    response.headers.get('x-amz-meta-uncompressed-length') ??
    (encoded ? null : response.headers.get('Content-Length'))
  const declared = Number(declaredRaw ?? '')
  const total = Number.isFinite(declared) && declared > 0 ? declared : 0
  let single = total > 0 ? new Uint8Array(total) : null
  const chunks: Uint8Array[] = []
  let received = 0
  let reported = -1
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    if (single === null) {
      chunks.push(value)
    } else if (received + value.length <= single.length) {
      single.set(value, received)
    } else {
      chunks.push(single.subarray(0, received), value)
      single = null
    }
    received += value.length
    const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : -2
    if (percent === reported) continue
    reported = percent
    onProgress(percent === -2 ? null : percent, { loaded: received, total })
  }

  if (single !== null) return received === single.length ? single : single.subarray(0, received)

  const buffer = new Uint8Array(received)
  let at = 0
  for (const chunk of chunks) {
    buffer.set(chunk, at)
    at += chunk.length
  }
  return buffer
}
