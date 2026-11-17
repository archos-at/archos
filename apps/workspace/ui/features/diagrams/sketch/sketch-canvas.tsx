'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import './excalidraw-assets'
import {
  convertToExcalidrawElements,
  Excalidraw,
  exportToSvg,
  MainMenu,
  serializeAsJSON,
} from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { DIAGRAM_SOURCE_FACTS } from '@/lib/diagrams/diagram-sources'
import { SKETCH_FONT_FAMILY, SKETCH_FONT_SIZE } from './sketch-from-model'
import { fileableSketchSvg } from './sketch-svg'

type ExcalidrawApi = Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['excalidrawAPI']>>[0]

export interface SketchCanvasHandle {
  prepare: () => Promise<{ source: string; svg: string }>
}

export interface SketchCanvasProps {
  initialElements: readonly object[]
  theme: 'light' | 'dark'
  langCode: string
  onReady: (handle: SketchCanvasHandle) => void
  onDirtyChange: (dirty: boolean) => void
  readOnly?: boolean
}

function sceneVersion(elements: readonly { version: number; isDeleted?: boolean }[]): number {
  return elements.reduce((sum, element) => sum + element.version + (element.isDeleted ? 1 : 0), 0)
}

const MAX_SCENE_BYTES = DIAGRAM_SOURCE_FACTS.excalidraw.maxSourceBytes

export class SketchTooLargeError extends Error {
  constructor() {
    super('the sketch is larger than an Excalidraw source may be')
    this.name = 'SketchTooLargeError'
  }
}

export default function SketchCanvas({
  initialElements,
  theme,
  langCode,
  onReady,
  onDirtyChange,
  readOnly = false,
}: SketchCanvasProps) {
  const apiRef = useRef<ExcalidrawApi | null>(null)
  const baseline = useRef<number | null>(null)
  const dirty = useRef(false)

  const elements = useMemo(
    () => convertToExcalidrawElements(initialElements as unknown as Parameters<typeof convertToExcalidrawElements>[0]),
    [initialElements]
  )

  const prepare = useCallback(async () => {
    const api = apiRef.current
    if (!api) throw new Error('the canvas is not ready')
    const scene = api.getSceneElements()
    const appState = api.getAppState()
    const files = api.getFiles()
    const source = serializeAsJSON(scene, appState, files, 'local')
    if (new TextEncoder().encode(source).length > MAX_SCENE_BYTES) throw new SketchTooLargeError()
    const svg = await exportToSvg({
      elements: scene,
      appState: { ...appState, exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
      files,
      exportPadding: 16,
      skipInliningFonts: true,
    })
    return { source, svg: fileableSketchSvg(svg) }
  }, [])

  useEffect(() => {
    onReady({ prepare })
  }, [onReady, prepare])

  return (
    <div className="h-full w-full [&_.default-sidebar-trigger]:hidden!" data-testid="sketch-canvas">
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api
        }}
        initialData={{
          elements,
          appState: {
            viewBackgroundColor: '#ffffff',
            currentItemFontFamily: SKETCH_FONT_FAMILY,
            currentItemFontSize: SKETCH_FONT_SIZE,
            currentItemRoughness: 1,
            currentItemStrokeWidth: 1,
          },
          scrollToContent: true,
        }}
        onChange={(sceneElements) => {
          const version = sceneVersion(sceneElements)
          if (baseline.current === null) {
            baseline.current = version
            requestAnimationFrame(() =>
              apiRef.current?.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.75 })
            )
            return
          }
          if (!dirty.current && version !== baseline.current) {
            dirty.current = true
            onDirtyChange(true)
          }
        }}
        theme={theme}
        viewModeEnabled={readOnly}
        langCode={langCode}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: false,
            export: false,
            toggleTheme: false,
            changeViewBackgroundColor: false,
          },
          tools: { image: false },
        }}
        validateEmbeddable={() => false}
      >
        <MainMenu>
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
    </div>
  )
}
