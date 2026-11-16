'use client'

import { useEffect, type FC } from 'react'
import { PdfViewerDialog, type PdfViewerDialogProps } from '@/features/knowledge/components/pdf-viewer-dialog'
import { SourceSignalChip } from '@/features/layout/components/SourceSignalChip'
import type { SimilarPassagesRequest } from '@/lib/similar-passages/types'
import {
  stageOf,
  useSimilarPassagesViewer,
  type DocumentSrcOf,
  type OpenedPassage,
  type SimilarPassagesLoader,
} from '../lib/use-similar-passages'
import { SimilarPassagesPanel } from './similar-passages-panel'

const signalOf = (opened: OpenedPassage): 'office' | 'project' => (opened.groupKind === 'office_shelf' ? 'office' : 'project')

export function openedPassageView(
  opened: OpenedPassage,
  srcOf?: DocumentSrcOf
): Pick<
  PdfViewerDialogProps,
  'fileName' | 'src' | 'title' | 'isImage' | 'page' | 'highlight' | 'highlightColor' | 'headerChip'
> {
  const stage = stageOf(opened, srcOf)
  return {
    fileName: stage.fileName,
    src: stage.src,
    title: stage.title,
    isImage: stage.isImage,
    page: stage.page,
    highlight: stage.highlight,
    highlightColor: `var(--source-${signalOf(opened)})`,
    headerChip: <SourceSignalChip signal={signalOf(opened)}>{opened.groupLabel}</SourceSignalChip>,
  }
}

export interface SimilarPassagesDialogProps {
  request: SimilarPassagesRequest | null
  source: { src: string; fileName: string; title: string }
  onClose: () => void
  load?: SimilarPassagesLoader
  srcOf?: DocumentSrcOf
}

export const SimilarPassagesDialog: FC<SimilarPassagesDialogProps> = ({ request, source, onClose, load, srcOf }) => {
  const similar = useSimilarPassagesViewer()
  const { start, close } = similar

  useEffect(() => {
    if (request) start(request)
    else close()
  }, [request, start, close])

  const shown = similar.request ?? request
  if (!shown) return null
  const view = similar.opened
    ? openedPassageView(similar.opened, srcOf)
    : {
        fileName: source.fileName,
        src: source.src,
        title: source.title,
        page: shown.passage.page ?? null,
        highlight: shown.passage.text,
        highlightColor: 'var(--source-project)',
      }

  return (
    <PdfViewerDialog
      open={request !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      {...view}
      onFindSimilar={
        similar.opened ? undefined : ({ text, page }) => start({ ...shown, passage: { text, page, cited: false } })
      }
      aside={
        <SimilarPassagesPanel
          request={shown}
          opened={similar.opened}
          onOpen={similar.open}
          onBackToSource={similar.backToSource}
          onClose={onClose}
          load={load}
        />
      }
    />
  )
}
