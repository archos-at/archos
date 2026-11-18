import type { FC } from 'react'
import { CircleAlert, CircleCheck, FileCheck2, Loader2, MessageCircleQuestion, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Session } from '../../types'

export const SessionStatusIcon: FC<{ session: Session }> = ({ session }) => {
  const base = 'size-4 shrink-0'

  if (session.activity === 'waiting') {
    return <MessageCircleQuestion className={cn(base, 'text-accent-primary')} aria-hidden="true" />
  }

  if (session.activity === 'working' || session.hasActiveDeepResearch) {
    return <Loader2 className={cn(base, 'text-accent-primary animate-spin motion-reduce:animate-none')} aria-hidden="true" />
  }

  if (session.activity === 'answered') {
    return <CircleCheck className={cn(base, 'text-success')} aria-hidden="true" />
  }

  if (session.activity === 'failed') {
    return <CircleAlert className={cn(base, 'text-destructive')} aria-hidden="true" />
  }

  if (session.hasCompletedReport) {
    return <FileCheck2 className={cn(base, 'text-success')} aria-hidden="true" />
  }

  return <MessageSquare className={cn(base, 'text-muted-foreground')} aria-hidden="true" />
}
