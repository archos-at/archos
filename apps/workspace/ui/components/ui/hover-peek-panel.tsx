'use client'

import type { FC, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import type { HoverPopover } from '@/hooks/use-hover-popover'

const VIEWPORT_GUTTER_PX = 12

export const HoverPeekPanel: FC<{
  peek: HoverPopover
  className?: string
  align?: 'start' | 'center' | 'end'
  children: ReactNode
}> = ({ peek, className, align = 'start', children }) => {
  if (!peek.engaged) return null
  return (
    <Popover open={peek.open} onOpenChange={peek.onOpenChange}>
      <PopoverAnchor virtualRef={peek.anchorRef} />
      <PopoverContent
        align={align}
        collisionPadding={VIEWPORT_GUTTER_PX}
        className={cn(
          'max-w-[calc(100vw-24px)]',
          className,
          peek.skipExit && 'data-[state=closed]:animate-none!'
        )}
        {...peek.contentProps}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
