'use client'

import { useState, type FC, type ReactNode } from 'react'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { cn } from '@/lib/utils'
import type { PagePlace } from '../lib/page-place'
import type { PageRegion } from '../lib/page-region'
import { PagePlaceDialog } from './page-place-dialog'
import { PageRegionThumbnail } from './page-region-thumbnail'

export interface PagePlaceButtonProps {
  place: PagePlace
  label: string
  color?: string
  thumbnailWidth?: number
  thumbnailMaxHeight?: number
  marks?: readonly PageRegion[]
  children?: ReactNode
  className?: string
  eager?: boolean
}

export const PagePlaceButton: FC<PagePlaceButtonProps> = ({
  place,
  label,
  color,
  thumbnailWidth,
  thumbnailMaxHeight,
  marks,
  children,
  className,
  eager,
}) => {
  const [open, setOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)

  return (
    <>
      <button
        type="button"
        data-testid="page-place-button"
        aria-label={label}
        disabled={denied}
        onClick={() => setOpen(true)}
        className={cn(
          'group/place flex min-w-0 flex-col gap-1.5 rounded-md p-1 text-left transition-colors duration-quick ease-out',
          'hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent',
          FOCUS_RING,
          'outline-none',
          className
        )}
      >
        <PageRegionThumbnail
          place={place}
          color={color}
          width={thumbnailWidth}
          maxHeight={thumbnailMaxHeight}
          clip={marks ? false : undefined}
          marks={marks}
          lazy={!eager}
          label={label}
          onDrawn={({ image }) => setImageUrl(image?.url ?? null)}
          onDenied={() => setDenied(true)}
        />
        {children}
      </button>
      {open && (
        <PagePlaceDialog place={place} open={open} onOpenChange={setOpen} color={color} imageUrl={imageUrl} regions={marks} />
      )}
    </>
  )
}
