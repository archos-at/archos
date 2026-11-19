'use client'

import type { HTMLAttributes, JSX, ReactNode, RefObject } from 'react'
import { useEffect } from 'react'
import type { ExternalToast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { MOBILE_LAYOUT_QUERY } from '@/hooks/use-is-mobile'
import { cn } from '@/lib/utils'

export { FactLine, type FactTone } from '@/components/ui/fact-line'

/** The whole row is the label, so a finger anywhere on it ticks the box: 44px tall under a coarse pointer. */
export function CheckLine({
  checked,
  onCheckedChange,
  disabled,
  children,
  className,
  testId,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  children: ReactNode
  className?: string
  testId?: string
}): JSX.Element {
  return (
    <label
      className={cn(
        'hover:bg-hover -mx-2 flex cursor-pointer items-start gap-2 rounded-control px-2 py-1 text-xs leading-snug transition-colors duration-quick ease-out motion-reduce:transition-none',
        'pointer-coarse:min-h-11 pointer-coarse:items-center pointer-coarse:gap-3 pointer-coarse:py-2 pointer-coarse:text-sm',
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:hover:bg-transparent',
        className
      )}
      data-testid={testId ? `${testId}-row` : undefined}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        data-testid={testId}
        className="mt-px pointer-coarse:mt-0 pointer-coarse:size-5"
      />
      <span className="min-w-0">{children}</span>
    </label>
  )
}

export function PinnedBar({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      data-pinned-bar=""
      className={cn(
        'bg-sheet/95 supports-[backdrop-filter]:bg-sheet/80 sticky bottom-0 z-10 flex flex-col gap-2 px-4 pt-3 shadow-pinned-foot backdrop-blur sm:px-8',
        'pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6',
        className
      )}
      {...props}
    />
  )
}

export function QuietPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('border-edge flex flex-col gap-2 border-l-2 py-0.5 pl-3', className)} {...props} />
}

const LIFT = '--mail-toast-lift'

/** On a phone a mail's toast stands at the foot, over the decision bar, never over the subject at the top. */
export function mailToast<T extends ExternalToast>(options: T = {} as T): T {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || !window.matchMedia(MOBILE_LAYOUT_QUERY).matches) return options
  return { ...options, position: 'bottom-center', style: { ...options.style, bottom: `var(${LIFT}, 0px)` } }
}

/** Keeps the lift of a mail's toasts at the height of the bar pinned inside `scope`, while one is. */
export function useMailToastLift(scope: RefObject<HTMLElement | null>, key: unknown): void {
  useEffect(() => {
    const root = document.documentElement
    const bar = scope.current?.querySelector<HTMLElement>('[data-pinned-bar]') ?? null
    const lift = (): void => root.style.setProperty(LIFT, `${bar ? Math.round(bar.getBoundingClientRect().height) : 0}px`)
    lift()
    const observer = bar && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(lift) : null
    if (bar) observer?.observe(bar)
    return () => {
      observer?.disconnect()
      root.style.removeProperty(LIFT)
    }
  }, [scope, key])
}
