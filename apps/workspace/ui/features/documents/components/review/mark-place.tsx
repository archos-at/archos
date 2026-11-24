'use client'

import type { JSX } from 'react'
import { annotationBox, regionAround, type AnnotationView } from '@/lib/annotations/types'
import { PageRegionThumbnail, type PagePlace } from '@/features/knowledge'

export function markRegion(mark: Pick<AnnotationView, 'page' | 'x' | 'y' | 'w' | 'h' | 'points'>): [number, number, number, number] {
  const [x0, y0, x1, y1] = annotationBox(mark)
  if (x1 > x0 && y1 > y0) return [x0, y0, x1 - x0, y1 - y0]
  const around = regionAround(mark)
  return [around.x, around.y, around.w, around.h]
}

export function MarkPlace({
  mark,
  documentName,
  label,
  maxHeight,
  className,
}: {
  mark: AnnotationView
  documentName: string
  label: string
  maxHeight: number
  className?: string
}): JSX.Element {
  const place: PagePlace = {
    document: { id: mark.documentId, name: documentName, shelf: 'stored' },
    page: mark.page,
    frame: 'page',
    region: markRegion(mark),
  }
  return <PageRegionThumbnail place={place} lazy={false} maxHeight={maxHeight} label={label} fallback="none" className={className} />
}
