'use client'

import { useEffect, useState } from 'react'
import { parseDiagramSvg, serializeDiagramSvg } from '@/lib/diagrams/svg'
import { diagramThemeVariables } from './diagram-palette'
import { canvasTextMeasure, mapSvg } from './map-svg'
import type { DiagramModel } from './model'
import { diagramRendererFor } from './render-diagram'
import { useDiagramTheme } from './use-diagram-theme'

export interface RenderedDiagram {
  svg: string | null
  fileSvg: string | null
  failed: boolean
}

function freshId(): string {
  return `mermaid-${Math.random().toString(36).slice(2)}`
}

export async function renderPaperDiagram(source: string, model?: DiagramModel | null): Promise<string> {
  if (model?.kind === 'map') {
    const paper = diagramThemeVariables('light')
    if (paper) {
      const ink = { ink: String(paper.primaryTextColor), line: String(paper.lineColor), fill: String(paper.mainBkg) }
      return serializeDiagramSvg(parseDiagramSvg(mapSvg(model, ink, canvasTextMeasure())).root)
    }
  }
  const renderer = diagramRendererFor('mermaid')
  if (!renderer) throw new Error('no mermaid renderer')
  return renderer({ source, id: freshId(), theme: 'light' })
}

export function useRenderedDiagram(source: string, enabled = true): RenderedDiagram {
  const theme = useDiagramTheme()
  const [svg, setSvg] = useState<string | null>(null)
  const [fileSvg, setFileSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const renderer = diagramRendererFor('mermaid')
    if (!renderer) return
    let cancelled = false

    const draw = async (): Promise<void> => {
      const screen = await renderer({ source, id: freshId(), theme })
      if (cancelled) return
      setSvg(screen)
      setFailed(false)
      if (theme === 'light') {
        setFileSvg(screen)
        return
      }
      const paper = await renderer({ source, id: freshId(), theme: 'light' })
      if (cancelled) return
      setFileSvg(paper)
    }

    void draw().catch((error: unknown) => {
      if (cancelled) return
      console.debug('[diagrams] mermaid did not render', error)
      setSvg(null)
      setFileSvg(null)
      setFailed(true)
    })

    return () => {
      cancelled = true
    }
  }, [source, enabled, theme])

  return { svg, fileSvg, failed }
}
