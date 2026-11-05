import * as React from 'react'

import { FIELD_FOCUS_RING } from '@/components/ui/focus-ring'
import { cn } from '@/lib/utils'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        data-slot="textarea"
        ref={ref}
        className={cn(
          // 16px on a coarse pointer, not below a breakpoint — see the note in
          // `input.tsx`: the viewport is the wrong axis for a soft-keyboard floor.
          'border-input placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full rounded-control border bg-input-background px-3.5 py-2.5 text-sm transition-[color,opacity] duration-quick ease-out motion-reduce:transition-none outline-none disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:text-base',
          FIELD_FOCUS_RING,
          'aria-invalid:border-destructive',
          className
        )}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
