'use client'

import type { FC } from 'react'
import { CircleCheck, CircleHelp, CircleX, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import type { DimStatus } from '@/shared/cards/schemas'
import { statusLabel } from '../lib/dimension-status'

export const STATUS_ICON: Record<DimStatus, LucideIcon> = {
  pass: CircleCheck,
  fail: CircleX,
  warning: TriangleAlert,
  needs_input: CircleHelp,
}

const STATUS_BADGE_CLASS: Record<DimStatus, string> = {
  pass: 'bg-success-subtle text-success',
  fail: 'bg-danger-subtle text-error',
  warning: 'bg-warning-subtle text-warning',
  needs_input: 'bg-muted text-muted-foreground',
}

interface StatusBadgeProps {
  status: DimStatus
}

export const StatusBadge: FC<StatusBadgeProps> = ({ status }) => {
  const t = useTranslations(chatCopy)
  const Icon = STATUS_ICON[status]
  return (
    <span
      className={cn(
        'card-meta inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5',
        STATUS_BADGE_CLASS[status]
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {statusLabel(status, t)}
    </span>
  )
}
