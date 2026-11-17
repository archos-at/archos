'use client'

import { useCallback, useState } from 'react'
import { DiagramFilingError, fileDiagram } from '@/adapters/api/diagrams-client'
import { useTranslations } from '@/i18n'
import { diagramsCopy } from '@/i18n/namespaces/diagrams'
import { diagramRunId, useDiagramFilingTarget, type DiagramFilingTarget } from './diagram-filing-context'

export type DiagramFilingState =
  | { kind: 'idle' }
  | { kind: 'filing' }
  | { kind: 'filed'; documentId: string }
  | { kind: 'partial'; documentId: string }
  | { kind: 'failed'; message: string }

export interface DiagramFiling {
  state: DiagramFilingState
  target: DiagramFilingTarget | null
  documentId: string | null
  canFile: boolean
  file: () => Promise<void>
}

export function titleFromSource(source: string): string | null {
  const lines = source.split('\n')
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (lines[i]?.trim() !== '---') return null
  let title: string | null = null
  for (i++; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('---')) return title
    if (title === null && line.startsWith('title:')) title = line.slice('title:'.length).trim().slice(0, 200) || null
  }
  return null
}

export interface DiagramFilingOptions {
  source: string
  fileSvg: string | null
  renderFileSvg?: () => Promise<string>
  title?: string | null
  prepareSketch?: () => Promise<{ source: string; svg: string }>
  edited?: boolean
}

export function useDiagramFiling({
  source,
  fileSvg,
  renderFileSvg,
  title,
  prepareSketch,
  edited = true,
}: DiagramFilingOptions): DiagramFiling {
  const t = useTranslations(diagramsCopy)
  const target = useDiagramFilingTarget()
  const [state, setState] = useState<DiagramFilingState>({ kind: 'idle' })

  const file = useCallback(async () => {
    if (!target || (!fileSvg && !renderFileSvg && !prepareSketch)) return
    setState({ kind: 'filing' })
    try {
      const sketch = prepareSketch ? await prepareSketch() : null
      const svg = sketch?.svg ?? fileSvg ?? (await renderFileSvg?.())
      if (!svg) throw new Error('no paper copy to file')
      const filedSource = sketch?.source ?? source
      const filed = await fileDiagram(target.projectId, {
        runId: diagramRunId(target.answerId, sketch && edited ? filedSource : source),
        title:
          title?.trim() ||
          titleFromSource(source) ||
          target.title ||
          (sketch ? t('sketch.defaultTitle') : t('defaultTitle')),
        sourceKind: sketch ? 'excalidraw' : 'mermaid',
        source: filedSource,
        svg,
        answerId: target.answerId,
        ...(sketch && edited ? { edited: true } : {}),
        ...(target.conversationId ? { conversationId: target.conversationId } : {}),
      })
      setState({ kind: filed.pdfFiled ? 'filed' : 'partial', documentId: filed.svgDocumentId })
    } catch (error) {
      console.debug('[diagrams] filing failed', error)
      const message = error instanceof DiagramFilingError && error.serverMessage !== null ? error.serverMessage : t('file.failed')
      setState({ kind: 'failed', message })
    }
  }, [target, fileSvg, renderFileSvg, prepareSketch, edited, source, title, t])

  return {
    state,
    target,
    documentId: state.kind === 'filed' || state.kind === 'partial' ? state.documentId : null,
    canFile: Boolean(target && (fileSvg || renderFileSvg || prepareSketch)),
    file,
  }
}
