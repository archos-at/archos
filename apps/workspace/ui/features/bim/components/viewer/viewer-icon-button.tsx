'use client'

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentType,
  type ReactNode,
} from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface ViewerIconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'title' | 'children'> {
  label: string
  icon: ComponentType<{ className?: string }>
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  side?: 'top' | 'bottom' | 'left' | 'right'
  adornment?: ReactNode
  className?: string
}

export const ViewerIconButtonBase = forwardRef<HTMLButtonElement, ViewerIconButtonProps>(
  function ViewerIconButtonBase(
    { label, icon: Icon, onClick, active, disabled, side: _side, adornment, className, ...rest },
    ref
  ) {
    return (
      <Button
        ref={ref}
        type="button"
        {...(active === undefined ? {} : { 'aria-pressed': active })}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={onClick}
        variant={active ? 'default' : 'ghost'}
        size="icon"
        className={cn(
          'size-9 rounded-md',
          adornment && 'w-auto gap-1 px-2',
          className
        )}
        {...rest}
      >
        <Icon className="size-4" aria-hidden="true" />
        {adornment}
      </Button>
    )
  }
)

export const ViewerIconButton = forwardRef<HTMLButtonElement, ViewerIconButtonProps>(
  function ViewerIconButton({ side = 'top', ...props }, ref) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <ViewerIconButtonBase ref={ref} {...props} />
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={8}>
          {props.label}
        </TooltipContent>
      </Tooltip>
    )
  }
)
