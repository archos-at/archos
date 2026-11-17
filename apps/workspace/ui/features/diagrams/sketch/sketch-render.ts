import './excalidraw-assets'
import { convertToExcalidrawElements, exportToSvg, serializeAsJSON } from '@excalidraw/excalidraw'
import type { SceneSkeleton } from '@/lib/diagrams/sketch-fence'
import { fileableSketchSvg } from './sketch-svg'

type Skeletons = Parameters<typeof convertToExcalidrawElements>[0]

export interface RenderedSketch {
  svg: string
  scene: string
}

export async function renderSketch(skeletons: readonly SceneSkeleton[]): Promise<RenderedSketch> {
  const elements = convertToExcalidrawElements(skeletons as unknown as Skeletons)
  const appState = { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false }
  const svg = await exportToSvg({ elements, appState, files: null, exportPadding: 16, skipInliningFonts: true })
  return {
    svg: fileableSketchSvg(svg),
    scene: serializeAsJSON(elements, appState, {}, 'local'),
  }
}
