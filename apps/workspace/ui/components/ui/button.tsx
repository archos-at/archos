'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'
import { CONTROL_HEIGHT } from '@/components/ui/control-height'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { Spinner } from '@/components/ui/spinner'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium select-none [-webkit-touch-callout:none] transition-[color,background-color,opacity,scale] [transition-duration:var(--motion-quick),var(--motion-quick),var(--motion-quick),var(--motion-snap)] ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 outline-none pointer-coarse:min-w-11 aria-invalid:ring-destructive/20 aria-invalid:border-destructive " +
    FOCUS_RING,
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-interaction-primary-hover',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/40',
        secondary:
          'bg-sheet text-foreground shadow-press hover:bg-sheet-hover active:bg-pressed dark:bg-transparent dark:hover:bg-hover dark:active:bg-foreground/[0.1]',
        ghost: 'hover:bg-hover hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline active:scale-100',
        inline:
          'font-medium text-foreground underline decoration-foreground/40 underline-offset-[3px] hover:decoration-foreground active:scale-100',
      },
      size: {
        default: `${CONTROL_HEIGHT.default} px-5 py-2`,
        sm: `${CONTROL_HEIGHT.sm} px-3.5 text-xs`,
        lg: 'h-11 px-6 text-base',
        icon: 'size-9 pointer-coarse:size-11',
      },
    },
    compoundVariants: [
      {
        variant: 'inline',
        className: 'h-auto p-0 align-baseline text-[length:inherit] leading-[inherit] pointer-coarse:h-auto pointer-coarse:min-w-0',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  'data-attr'?: string
  'data-testid'?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled,
      children,
      onClick,
      'aria-disabled': ariaDisabled,
      'aria-busy': ariaBusy,
      'data-attr': dataAttr,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button'
    const showSpinner = loading && !asChild
    const content = showSpinner ? (
      <>
        <span
          data-slot="button-label"
          className="peer/label inline-flex items-center justify-center gap-[inherit] [&>svg:first-of-type]:hidden [&:not(:has(>svg))]:opacity-0"
        >
          {children}
        </span>
        <Spinner
          size="sm"
          aria-hidden="true"
          className="order-first shrink-0 peer-[:not(:has(>svg))]/label:absolute peer-[:not(:has(>svg))]/label:inset-0 peer-[:not(:has(>svg))]/label:m-auto peer-[:not(:has(>svg))]/label:size-4"
        />
      </>
    ) : (
      children
    )
    return (
      <Comp
        data-slot="button"
        data-attr={dataAttr ?? props['data-testid']}
        className={cn(
          buttonVariants({ variant, size }),
          showSpinner && 'relative',
          className
        )}
        ref={ref}
        disabled={disabled || undefined}
        {...props}
        aria-disabled={showSpinner || ariaDisabled || undefined}
        aria-busy={showSpinner || ariaBusy || undefined}
        onClick={
          showSpinner
            ? (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault()
            : onClick
        }
      >
        {content}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
