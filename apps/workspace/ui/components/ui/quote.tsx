import type { JSX } from 'react'
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const quoteVariants = cva('min-w-0 break-words', {
  variants: {
    variant: {
      inline: 'ps-3 italic text-muted-foreground',
      excerpt: 'rounded-surface bg-muted/60 px-4 py-3 italic text-default',
      paraphrase: 'rounded-surface border border-dashed border-border px-4 py-3 not-italic text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'inline' },
})

export interface QuoteProps extends React.HTMLAttributes<HTMLElement>, VariantProps<typeof quoteVariants> {
  as?: 'blockquote' | 'p' | 'div' | 'span' | 'section'
}

export function Quote({ as: Comp = 'blockquote', variant, className, ...props }: QuoteProps): JSX.Element {
  return <Comp data-slot="quote" data-variant={variant ?? 'inline'} className={cn(quoteVariants({ variant }), className)} {...props} />
}

export { quoteVariants }
