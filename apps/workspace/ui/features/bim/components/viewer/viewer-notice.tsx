'use client'

import type { JSX } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { EmptyStateDisc } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

export interface ViewerNoticeProps {
  icon: LucideIcon
  title: string
  description?: string
  detail?: string
  action?: ReactNode
  className?: string
}

export function ViewerNotice({
  icon,
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
      <EmptyStateDisc icon={icon} className="mb-2" />
      <p className="text-section text-balance text-foreground">{title}</p>
      {description && (
        <p className="max-w-prose text-sm text-balance text-muted-foreground">{description}</p>
      )}
      {detail && <p className="max-w-prose text-xs text-muted-foreground">{detail}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
