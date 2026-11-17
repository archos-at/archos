'use client'

import type { HTMLAttributes, JSX, ReactNode } from 'react'
import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export { FactLine, type FactTone } from '@/components/ui/fact-line'

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
  const id = useId()
  return (
    <div className={cn('flex items-start gap-2 text-xs pointer-coarse:min-h-11 pointer-coarse:items-center', className)}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        data-testid={testId}
        className="mt-px pointer-coarse:mt-0"
      />
      <Label htmlFor={id} className="cursor-pointer text-xs leading-snug font-normal">
        {children}
      </Label>
    </div>
  )
}

export function PinnedBar({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
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
