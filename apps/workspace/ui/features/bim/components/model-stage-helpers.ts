

import { type BimViewerElement, type ViewerVisibility } from '../lib/model-index'
import { type BimModelView } from '../lib/model-link'

import { useModelViewport } from '../hooks/use-model-viewport'

export const NO_ELEMENTS: readonly BimViewerElement[] = []

export const STAGE_HISTORY_DEPTH = 40

export interface StageStep {
  view: BimModelView | null
  visibility: ViewerVisibility | null
}

export const DOCK_ABOVE_OFFSET: Record<0 | 1 | 2, string> = {
  0: 'bottom-20 sm:bottom-24',
  1: 'bottom-36 sm:bottom-40',
  2: 'bottom-52 sm:bottom-56',
}

export function visibilityActions(
  viewport: ReturnType<typeof useModelViewport>,
  clearSelection: () => void,
  focusViewport: () => void,
  asOneStep: (gesture: () => void) => void
): { onHide?: () => void; onIsolate?: () => void; isolated?: boolean } {
  const elementId = viewport.selectedElementExpressId
  if (elementId === null || viewport.visibility.hidden.has(elementId)) return {}
  const isolated = viewport.visibility.isolated
  const actions = {
    isolated: isolated !== null && isolated.size === 1 && isolated.has(elementId),
    onIsolate: () => viewport.visibility.isolate([elementId]),
  }

  const expressId = viewport.selectedExpressId
  if (expressId === null) return actions
  return {
    ...actions,
    onHide: () => {
      asOneStep(() => {
        viewport.visibility.hide(expressId)
        clearSelection()
      })
      focusViewport()
    },
  }
}
