import type { CSSProperties, JSX } from 'react'

import { artImage, type ArtId } from '@/lib/art'
import { cn } from '@/lib/utils'

export function RisoPrint({ id, className }: { id: ArtId; className?: string }): JSX.Element {
  const img = artImage(id)
  const style = {
    '--art-w': `${img.width}px`,
    '--art-w-half': `${img.width / 2}px`,
  } as CSSProperties
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a halftone must reach the screen unresampled; next/image re-encodes and resizes
    <img
      src={img.src}
      srcSet={img.srcSet}
      sizes={`(min-width: 640px) ${img.width}px, ${img.width / 2}px`}
      width={img.width}
      height={img.height}
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
      style={style}
      className={cn(
        'w-(--art-w-half) sm:w-(--art-w) block h-auto max-w-none shrink-0 select-none rounded-md',
        'dark:shadow-sm dark:brightness-[0.92]',
        className
      )}
    />
  )
}
