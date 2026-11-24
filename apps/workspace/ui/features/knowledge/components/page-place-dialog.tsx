'use client'

import { useMemo, type FC, type ReactNode } from 'react'
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
  zoomToRegion?: boolean
  overlay?: ReactNode
}

export const PagePlaceDialog: FC<PagePlaceDialogProps> = ({
  place,
  open,
  onOpenChange,
  color,
  imageUrl,
  regions,
  zoomToRegion,
  overlay,
}) => {
  const src = imageUrl ?? placeFileUrl(place) ?? undefined
  const shown = useMemo(() => regions ?? placeRegions(place), [regions, place])
  return (
    <PdfViewerDialog
      open={open}
      onOpenChange={onOpenChange}
      fileName={place.document.name}
      title={place.document.name}
      src={src}
      page={place.page}
      isImage={Boolean(imageUrl)}
      regions={shown}
      zoomToRegion={zoomToRegion}
      pageOverlay={overlay ? (page) => (page === place.page ? overlay : null) : undefined}
      highlightColor={color}
    />
  )
}
