import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const countPillVariants = cva(
  'inline-flex min-w-5 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] leading-none tabular-nums',
  {
    variants: {
      tone: {
        muted: 'bg-muted font-medium text-foreground/70',
        attention: 'bg-primary font-semibold text-primary-foreground',
      },
    },
    defaultVariants: {
      tone: 'muted',
    },
  }
)

export const COUNT_PILL_MAX = 99

type CountPillBaseProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> &
  VariantProps<typeof countPillVariants>

interface CountPillCountProps extends CountPillBaseProps {
  count: number
  max?: number
  children?: never
}

interface CountPillTextProps extends CountPillBaseProps {
  count?: never
  max?: never
  children: React.ReactNode
}

export type CountPillProps = CountPillCountProps | CountPillTextProps

const wholeCount = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0)

const CountPill = React.forwardRef<HTMLSpanElement, CountPillProps>(
  ({ className, tone, count, max = COUNT_PILL_MAX, children, title, ...props }, ref) => {
    const exact = count === undefined ? null : wholeCount(count)
    const capped = exact !== null && exact > max
    return (
      <span
        ref={ref}
        data-slot="count-pill"
        data-count={exact ?? undefined}
        title={capped ? (title ?? String(exact)) : title}
        className={cn(countPillVariants({ tone }), className)}
        {...props}
      >
        {exact === null ? (
          children
        ) : capped ? (
          <>
            {/* The visible cap is shorthand; a screen reader gets the figure. */}
            <span aria-hidden>{`${max}+`}</span>
            <span className="sr-only">{exact}</span>
          </>
        ) : (
          exact
        )}
      </span>
    )
  }
)
CountPill.displayName = 'CountPill'

export { CountPill, countPillVariants }
