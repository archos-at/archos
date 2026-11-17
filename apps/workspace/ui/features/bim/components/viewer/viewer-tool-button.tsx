'use client'

import { forwardRef, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ViewerToolButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'title' | 'children'
> {
  label: string
  caption?: string
  icon: ComponentType<{ className?: string }>
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  marked?: boolean
  adornment?: ReactNode
  className?: string
}

export const ViewerToolButton = forwardRef<HTMLButtonElement, ViewerToolButtonProps>(
  function ViewerToolButton(
    {
      label,
      caption,
      icon: Icon,
      onClick,
      active,
      disabled,
      marked = false,
      adornment,
      className,
      ...rest
    },
    ref
  ) {
    return (
      <Button
        ref={ref}
        type="button"
        {...(active === undefined ? {} : { 'aria-pressed': active })}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        variant={active ? 'default' : 'ghost'}
        data-slot="viewer-tool-button"
        className={cn(
          'pointer-coarse:h-14 pointer-coarse:min-w-0 h-14 min-w-0 flex-1 flex-col gap-0.5 rounded-xl px-0 py-1.5 text-[11px] leading-none',
          className
        )}
        {...rest}
      >
        <span className="relative">
          <Icon className="size-5" aria-hidden="true" />
          {marked && (
            <span
              aria-hidden="true"
              data-slot="viewer-tool-mark"
              className="bg-foreground ring-card absolute -right-1 -top-0.5 size-2 rounded-full ring-2"
            />
          )}
        </span>
        <span className="flex max-w-full items-center gap-0.5">
          <span className="truncate">{caption ?? label}</span>
          {adornment}
        </span>
      </Button>
    )
  }
)
