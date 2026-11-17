'use client'

import type { JSX } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { motion, springPress } from '@/components/motion'
import { cn } from '@/lib/utils'

export interface FileTileShellProps extends Omit<ComponentProps<'div'>, 'ref'> {
  interactive?: boolean
  children: ReactNode
}

const OFF_SCREEN_SKIP = '[content-visibility:auto] [contain-intrinsic-block-size:auto_240px]'

export function TileShell({ interactive = true, className, children, ...rest }: FileTileShellProps): JSX.Element {
  const shell = (
    <div
      className={cn(
        'relative flex h-full min-w-0 flex-col rounded-surface p-1.5',
        OFF_SCREEN_SKIP,
        'transition-colors duration-quick ease-out motion-reduce:transition-none',
        interactive && 'group/tile',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )

  if (!interactive) return shell
  return (
    <motion.div className="h-full min-w-0 will-change-transform" whileTap={{ scale: 0.99, transition: springPress }}>
      {shell}
    </motion.div>
  )
}

export function FileTileMedia({ className, children, ...rest }: ComponentProps<'div'>): JSX.Element {
  return (
    <div className={cn('bg-sheet shadow-sm relative w-full overflow-hidden rounded-surface transition-shadow duration-quick ease-out group-hover/tile:shadow-sheet-pointer motion-reduce:transition-none', className)} {...rest}>
      {children}
    </div>
  )
}

export function FileTileBody({ className, children, ...rest }: ComponentProps<'div'>): JSX.Element {
  return (
    <div className={cn('w-full overflow-hidden', className)} {...rest}>
      {children}
    </div>
  )
}

export function FileTileFooter({ className, children, ...rest }: ComponentProps<'div'>): JSX.Element {
  return (
    <div className={cn('text-muted-foreground mt-auto flex w-full items-center gap-1.5 pt-1.5 text-xs', className)} {...rest}>
      {children}
    </div>
  )
}
