'use client'

import Image from 'next/image'
import type { JSX } from 'react'
import { COMMENT_PIN_ON_POINT, CommentPin } from '@/components/ui/comment-pin'
import { isOptimizerEligible } from '@/lib/images/optimizable'
import { cn } from '@/lib/utils'
import { placeStyle, type CanvasSetItem, type MarkState } from '../../lib/canvas-activity'

export function PageSilhouette({
  item,
  state,
  thumbnail,
  aspect,
  onAspect,
}: {
  item: CanvasSetItem
  state: MarkState
  thumbnail: string | null
  aspect: number
  onAspect: (aspect: number) => void
}): JSX.Element {
  const proposed = state === 'proposed'
  const done = state === 'resolved' || state === 'dismissed' || state === 'gone'
  const place = placeStyle(item)
  return (
    <span aria-hidden className="relative block w-20 shrink-0 self-start" style={{ aspectRatio: String(aspect) }}>
      <span className="border-border bg-background absolute inset-0 overflow-hidden rounded-[2px] border">
        {thumbnail && (
          <Image
            src={thumbnail}
            alt=""
            fill
            sizes="80px"
            unoptimized={!isOptimizerEligible(thumbnail)}
            className="object-fill opacity-80"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget
              if (naturalWidth > 0 && naturalHeight > 0) onAspect(naturalWidth / naturalHeight)
            }}
          />
        )}
        {place.width && (
          <span
            data-testid="canvas-activity-region"
            className={cn(
              'border-foreground absolute rounded-[1px] border-[1.5px]',
              proposed && 'border-dashed',
              done && 'opacity-40'
            )}
            style={place}
          />
        )}
      </span>
      <span className={cn('absolute z-10', COMMENT_PIN_ON_POINT)} style={{ left: place.left, top: place.top }}>
        <CommentPin
          as="span"
          number={item.number}
          proposed={proposed}
          done={done}
          className="origin-bottom-left scale-75"
        />
      </span>
    </span>
  )
}
