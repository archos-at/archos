'use client'

import type { JSX } from 'react'
import { type ComponentType, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ViewerNoticeProps {
  icon: ComponentType<{ className?: string }>
  title: string
  description?: string
  detail?: string
  action?: ReactNode
  className?: string
}

export function ViewerNotice({
  icon: Icon,
  title,
  description,
  detail,
  action,
  className,
}: ViewerNoticeProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex size-full flex-col items-center justify-center gap-2 p-8 text-center',
        'animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none',
        className
      )}
    >
      <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-prose text-sm text-balance text-muted-foreground">{description}</p>
      )}
      {detail && <p className="max-w-prose text-xs text-muted-foreground">{detail}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
