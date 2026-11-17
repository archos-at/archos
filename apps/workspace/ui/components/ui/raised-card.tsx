'use client'

import type { JSX } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { motion, springPress, usePrefersReducedMotion } from '@/components/motion'
import { cn } from '@/lib/utils'

export interface RaisedCardProps extends Omit<ComponentProps<'div'>, 'ref'> {
  interactive?: boolean
  children: ReactNode
}

export function RaisedCard({
  interactive = false,
  className,
  children,
  ...rest
}: RaisedCardProps): JSX.Element {
  const reduced = usePrefersReducedMotion()
  const card = (
    <div
      className={cn(
        'bg-desk shadow-sm relative flex h-full min-w-0 flex-col overflow-hidden rounded-surface',
        'transition-colors duration-quick ease-out motion-reduce:transition-none',
        interactive && 'group/raised hover:bg-selected',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )

  if (!interactive) return card
  return (
    <motion.div
      className="h-full min-w-0 will-change-transform"
      style={{ transform: 'scale(1)' }}
      whileTap={reduced ? undefined : { transform: 'scale(0.98)' }}
      transition={springPress}
    >
      {card}
    </motion.div>
  )
}

export function RaisedCardMedia({
  className,
  children,
  ...rest
}: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      className={cn('relative w-full overflow-hidden border-b bg-card', className)}
      {...rest}
    >
      {children}
    </div>
  )
}

export function RaisedCardBody({
  className,
  children,
  ...rest
}: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      className={cn(
        'bg-card w-full overflow-hidden rounded-surface px-4 pb-3 pt-3.5',
        'transition-colors duration-quick ease-out group-hover/raised:bg-sheet-hover motion-reduce:transition-none',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export function RaisedCardFooter({
  className,
  children,
  ...rest
}: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      className={cn(
        'text-muted-foreground mt-auto flex w-full items-center gap-2 px-4 py-2.5 text-xs',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
