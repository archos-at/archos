import type { ReactNode } from 'react'

import type { PageRegion } from '../lib/page-region'

export interface PdfDocumentViewProps {
  src: string
  title: string
  page?: number | null
  highlight?: string | null
  highlightColor?: string
  regions?: readonly PageRegion[] | null
  quoteFormat?: (quote: { text: string; page: number }) => string
  onFindSimilar?: (passage: { text: string; page: number }) => void
  onLoadError?: () => void
  ground?: 'stage' | 'host'
  bleed?: boolean
  pageOverlay?: (page: number) => ReactNode
  toolbarLead?: ReactNode
  focus?: { page: number; y: number; key: string | number; instant?: boolean } | null
  onViewport?: (viewport: { page: number; y: number }) => void
  className?: string
}
