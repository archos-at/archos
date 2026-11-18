import * as React from 'react'

import { FIELD_FOCUS_RING } from '@/components/ui/focus-ring'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      data-slot="input"
      ref={ref}
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground border-input flex h-10 w-full min-w-0 rounded-control border bg-input-background px-3.5 py-1 text-sm transition-[color,opacity] duration-quick ease-out motion-reduce:transition-none outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:text-base',
        FIELD_FOCUS_RING,
        'aria-invalid:border-destructive',
        className
      )}
      {...props}
    />
  )
})
Input.displayName = 'Input'

export { Input }
