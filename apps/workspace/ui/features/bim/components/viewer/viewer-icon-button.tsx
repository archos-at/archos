'use client'

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentType,
  type ReactNode,
} from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
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
  shortcut?: string
  className?: string
}

export const ViewerIconButtonBase = forwardRef<HTMLButtonElement, ViewerIconButtonProps>(
  function ViewerIconButtonBase(
    { label, icon: Icon, onClick, active, disabled, side: _side, adornment, shortcut, className, ...rest },
    ref
  ) {
    return (
      <Button
        ref={ref}
        type="button"
        {...(active === undefined ? {} : { 'aria-pressed': active })}
        aria-label={label}
        aria-keyshortcuts={shortcut}
        title={label}
        disabled={disabled}
        onClick={onClick}
        variant="ghost"
        size="icon"
        className={cn(
          'text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground size-9 rounded-control',
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
          {props.shortcut && <Kbd className="ml-1">{props.shortcut}</Kbd>}
        </TooltipContent>
      </Tooltip>
    )
  }
)
