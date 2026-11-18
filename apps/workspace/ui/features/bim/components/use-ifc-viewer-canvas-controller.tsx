import type { IfcViewerCanvasProps } from './ifc-viewer-canvas-contract'
import { useIfcViewerState } from '../hooks/use-ifc-viewer-state'
import { useIfcViewerFrame } from '../hooks/use-ifc-viewer-frame'
import { useIfcModelLoad } from '../hooks/use-ifc-model-load'
import { useIfcViewerScene } from '../hooks/use-ifc-viewer-scene'
import { useIfcViewerCamera } from '../hooks/use-ifc-viewer-camera'
import { useIfcViewerMeasure } from '../hooks/use-ifc-viewer-measure'
import { useIfcViewerInput } from '../hooks/use-ifc-viewer-input'

export type { IfcViewerCanvasProps, IfcViewerStatus } from './ifc-viewer-canvas-contract'

export function useIfcViewerCanvasController(props: IfcViewerCanvasProps) {
  const viewer = useIfcViewerState(props)
  const frame = useIfcViewerFrame(viewer)
  useIfcModelLoad({ ...viewer, ...frame })
  useIfcViewerScene({ ...viewer, ...frame })
  const camera = useIfcViewerCamera({ ...viewer, ...frame })
  const measure = useIfcViewerMeasure({ ...viewer, ...frame })
  const input = useIfcViewerInput({ ...viewer, ...frame, ...camera, ...measure })
  return { ...viewer, ...frame, ...camera, ...measure, ...input }
}

export type IfcViewerCanvasController = ReturnType<typeof useIfcViewerCanvasController>
