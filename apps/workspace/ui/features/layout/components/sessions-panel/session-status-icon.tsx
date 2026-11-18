import type { FC } from 'react'
import { FileCheck2, Loader2, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Session } from '../../types'

export const SessionStatusIcon: FC<{
  session: Session
  isSessionActive: boolean
}> = ({ session, isSessionActive }) => {
  const base = 'size-4 shrink-0'
  const isActive = isSessionActive || session.hasActiveDeepResearch

  if (isActive) {
    return <Loader2 className={cn(base, 'text-accent-primary animate-spin motion-reduce:animate-none')} aria-hidden="true" />
  }

  if (session.hasCompletedReport) {
    return <FileCheck2 className={cn(base, 'text-success')} aria-hidden="true" />
  }

  return <MessageSquare className={cn(base, 'text-muted-foreground')} aria-hidden="true" />
}
