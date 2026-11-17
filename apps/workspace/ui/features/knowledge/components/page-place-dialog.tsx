'use client'

import type { FC } from 'react'
import { PdfViewerDialog } from './pdf-viewer-dialog'
import type { PageRegion } from '../lib/page-region'
import { placeFileUrl, placeRegions, type PagePlace } from '../lib/page-place'

export interface PagePlaceDialogProps {
  place: PagePlace
  open: boolean
  onOpenChange: (open: boolean) => void
  color?: string
  imageUrl?: string | null
  regions?: readonly PageRegion[]
}

export const PagePlaceDialog: FC<PagePlaceDialogProps> = ({ place, open, onOpenChange, color, imageUrl, regions }) => {
  const src = imageUrl ?? placeFileUrl(place) ?? undefined
  return (
    <PdfViewerDialog
      open={open}
      onOpenChange={onOpenChange}
      fileName={place.document.name}
      title={place.document.name}
      src={src}
      page={place.page}
      isImage={Boolean(imageUrl)}
      regions={regions ?? placeRegions(place)}
      highlightColor={color}
    />
  )
}
