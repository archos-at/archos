'use client'

import type { JSX } from 'react'

import { useIfcViewerCanvasController, type IfcViewerCanvasProps } from './use-ifc-viewer-canvas-controller'
import { IfcViewerCanvasView } from './ifc-viewer-canvas-view'
export type { IfcViewerCanvasProps, IfcViewerStatus } from './use-ifc-viewer-canvas-controller'

export function IfcViewerCanvas(props: IfcViewerCanvasProps): JSX.Element {
  const controller = useIfcViewerCanvasController(props)
  return <IfcViewerCanvasView controller={controller} />
}

export default IfcViewerCanvas
