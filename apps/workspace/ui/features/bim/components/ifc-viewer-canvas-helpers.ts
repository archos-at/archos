

import type { Camera, Renderer, SceneContents } from '@ifc-lite/renderer'
import { capturePosthogException } from '@/lib/analytics/posthog'

export type RendererLike = Pick<
  Renderer,
  | 'init'
  | 'addMeshes'
  | 'fitToView'
  | 'render'
  | 'resize'
  | 'destroy'
  | 'pick'
  | 'raycastScene'
  | 'onDeviceLost'
  | 'getModelBounds'
  | 'getGPUDevice'
  | 'getPipeline'
  | 'captureScreenshot'
  | 'enableQuantizedBatches'
> & {
  getCamera(): CameraLike
  getScene(): SceneLike
}

export type CameraLike = Pick<
  Camera,
  | 'orbit'
  | 'pan'
  | 'zoom'
  | 'update'
  | 'setOrbitCenter'
  | 'setAspect'
  | 'frameBounds'
  | 'zoomExtent'
  | 'setPresetView'
  | 'setProjectionMode'
  | 'fitBoundsAdaptive'
  | 'stopInertia'
  | 'setSceneBounds'
  | 'projectToScreen'
  | 'getPosition'
  | 'getFOV'
  | 'enableFirstPersonMode'
  | 'moveFirstPerson'
>

export type SceneLike = Pick<
  SceneContents,
  | 'setColorOverrides'
  | 'clearColorOverrides'
  | 'getEntityBoundingBox'
  | 'setLodBuildsEnabled'
  | 'finalizeStreamingAsync'
>

export const HOVER_BUDGET_MS = 24

export const KEY_ORBIT_PX = 24
export const KEY_PAN_PX = 32

export function modelBoundsMetres(
  renderer: RendererLike | null
): { minMetres: number; maxMetres: number } | null {
  const bounds = renderer?.getModelBounds()
  if (!bounds) return null
  if (!Number.isFinite(bounds.min.y) || !Number.isFinite(bounds.max.y)) return null
  return { minMetres: bounds.min.y, maxMetres: bounds.max.y }
}

export function guardedKernel() {
  let kernel: { dispose(): void } | null = null
  return {
    hold<T extends { dispose(): void }>(next: T): T {
      kernel = next
      return next
    },
    release() {
      const held = kernel
      kernel = null
      try {
        held?.dispose()
      } catch (error) {
        capturePosthogException(error, { source: 'ifc-viewer-dispose' })
      }
    },
  }
}
