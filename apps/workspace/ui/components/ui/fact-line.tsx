import type { HTMLAttributes, JSX, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type FactTone = 'muted' | 'default' | 'warning' | 'danger'

const FACT_TONE: Record<FactTone, string> = {
  muted: 'text-muted-foreground',
  default: 'text-foreground',
  warning: 'text-foreground font-medium [&>svg]:text-warning',
  danger: 'text-foreground font-medium [&>svg]:text-error',
}

export function FactLine({
  icon: Icon,
  tone = 'muted',
  children,
  className,
  testId,
  ...props
}: Omit<HTMLAttributes<HTMLParagraphElement>, 'children'> & {
  icon: LucideIcon
  tone?: FactTone
  children: ReactNode
  testId?: string
}): JSX.Element {
  return (
    <p
      className={cn(
        'flex min-w-0 items-start gap-1.5 text-xs leading-snug',
        FACT_TONE[tone],
        className
      )}
      data-slot="fact-line"
      data-testid={testId}
      data-tone={tone}
      {...props}
    >
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  )
}
