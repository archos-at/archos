'use client'

import * as React from 'react'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'
import { toggleVariants } from '@/components/ui/toggle'
import { motion, springGlide } from '@/components/motion'

type ToggleGroupContextValue = VariantProps<typeof toggleVariants> & {
  segmented: boolean
  groupValue: string | string[] | undefined
  pillId: string
}

const ToggleGroupContext = React.createContext<ToggleGroupContextValue>({
  size: 'default',
  variant: 'default',
  segmented: false,
  groupValue: undefined,
  pillId: 'toggle-pill',
})

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
    VariantProps<typeof toggleVariants> & {
      segmented?: boolean
    }
>(
  (
    {
      className,
      variant,
      size,
      segmented = false,
      children,
      value,
      defaultValue,
      onValueChange,
      ...props
    },
    ref
  ) => {
    type Value = string | string[] | undefined
    const pillId = React.useId()
    const [uncontrolled, setUncontrolled] = React.useState<Value>(defaultValue)
    const resolved: Value = value !== undefined ? value : uncontrolled
    const handleValueChange = React.useCallback(
      (next: string | string[]) => {
        if (value === undefined) setUncontrolled(next)
        ;(onValueChange as ((next: string | string[]) => void) | undefined)?.(next)
      },
      [value, onValueChange]
    )
    const rootProps = {
      ...props,
      value: resolved,
      onValueChange: handleValueChange,
      ...(value === undefined ? { defaultValue } : null),
    } as React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
    return (
      <ToggleGroupPrimitive.Root
        ref={ref}
        data-slot="toggle-group"
        className={cn(
          'flex items-center',
          segmented
            ? // A segment cluster HUGS its segments. `flex` alone is
              'w-fit max-w-full gap-0 overflow-x-auto scrollbar-hide rounded-control bg-desk p-0.5'
            : 'flex-wrap gap-1.5',
          className
        )}
        {...rootProps}
      >
        <ToggleGroupContext.Provider
          value={{ variant, size, segmented, groupValue: resolved, pillId }}
        >
          {children}
        </ToggleGroupContext.Provider>
      </ToggleGroupPrimitive.Root>
    )
  }
)
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

const SEGMENTED_PILL_BG: Record<string, string> = {
  default: 'bg-sheet shadow-thumb',
  outline: 'bg-card',
  inverted: 'bg-foreground',
}

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>
>(({ className, children, variant, size, value, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext)
  const resolvedVariant = context.variant ?? variant ?? 'default'
  const isActive =
    context.segmented &&
    value !== undefined &&
    (Array.isArray(context.groupValue)
      ? context.groupValue.includes(value)
      : context.groupValue === value)
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      value={value}
      data-slot="toggle-group-item"
      data-focus-inset={context.segmented ? '' : undefined}
      className={cn(
        toggleVariants({
          variant: context.variant ?? variant,
          size: context.size ?? size,
        }),
        context.segmented &&
          'relative isolate hover:bg-transparent data-[state=off]:hover:bg-hover data-[state=on]:bg-transparent data-[state=on]:shadow-none focus-visible:ring-inset focus-visible:ring-offset-0',
        'shrink-0',
        className
      )}
      {...props}
    >
      {isActive && (
        <motion.span
          layoutId={context.pillId}
          aria-hidden
          data-slot="toggle-pill"
          data-pill-id={context.pillId}
          className={cn(
            'absolute inset-0 -z-10 rounded-[inherit]',
            SEGMENTED_PILL_BG[resolvedVariant] ?? SEGMENTED_PILL_BG.default
          )}
          transition={springGlide}
        />
      )}
      {children}
    </ToggleGroupPrimitive.Item>
  )
})
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem }
