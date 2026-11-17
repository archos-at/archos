import type { JSX, ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function AsksYouChip({
  children,
  onPress,
  className,
  testId,
}: {
  children: ReactNode
  onPress: () => void
  className?: string
  testId?: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        'bg-sheet shadow-press text-foreground hover:shadow-xs focus-visible:ring-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-full pl-2.5 pr-1.5 text-xs font-medium tabular-nums transition-shadow duration-quick ease-out focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none relative after:absolute after:inset-x-0 after:-inset-y-2',
        className
      )}
      data-slot="asks-you-chip"
      data-testid={testId}
    >
      {children}
      <ChevronRight className="size-3.5" aria-hidden />
    </button>
  )
}
