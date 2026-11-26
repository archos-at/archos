import type { JSX } from 'react'
import { Clock } from 'lucide-react'

import { Chip } from '@/components/ui/chip'
import { cn } from '@/lib/utils'
import type { InboxDue } from '../lib/inbox-due'

export function InboxDuePill({ due, testId }: { due: InboxDue; testId: string }): JSX.Element {
  const pressing = due.urgency !== 'date'
  return (
    <Chip
      size="sm"
      variant="muted"
      className={cn(pressing && 'text-foreground')}
      data-testid={testId}
      data-urgency={due.urgency}
    >
      <Clock aria-hidden className={cn(pressing && 'text-warning')} />
      {due.label}
    </Chip>
  )
}
