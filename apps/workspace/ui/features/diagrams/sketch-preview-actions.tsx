'use client'

/**
 * The diagrams feature's parts in the Files preview: a Skizze's stage in its
 * review (its Excalidraw canvas where a PDF's pages would be, ADR-0148), and
 * „Skizze auf dieser Seite beginnen“ in a PDF review's page menu (S6). Mounted
 * by the app shell (`app/app/layout.tsx`) through the documents feature's
 * slots, so the preview needs no import of the editor
 * (`features/documents/preview-actions.tsx` says why).
 */

import type { ReactNode } from 'react'
import { PreviewSlotsProvider } from '@/features/documents/preview-actions'
import { SketchOnPageItem } from './sketch/sketch-on-page-item'
import { SketchStage } from './sketch/sketch-stage'

export function SketchPreviewActions({ children }: { children: ReactNode }) {
  return (
    <PreviewSlotsProvider stage={SketchStage} pageAction={SketchOnPageItem}>
      {children}
    </PreviewSlotsProvider>
  )
}
