import type { JSX } from 'react'
import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface SectionLabelProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'span' | 'h2' | 'h3' | 'h4' | 'p' | 'div' | 'dt'
  icon?: LucideIcon
  children: React.ReactNode
}

export function SectionLabel({
  as: Comp = 'span',
  icon: Icon,
  className,
  children,
  ...props
}: SectionLabelProps): JSX.Element {
  return (
    <Comp
      className={cn(
        'card-eyebrow text-muted-foreground',
        Icon && 'flex items-center gap-1.5',
        className,
      )}
      {...props}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {children}
    </Comp>
  )
}
