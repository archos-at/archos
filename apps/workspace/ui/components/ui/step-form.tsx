'use client'

import type { JSX } from 'react'
import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { PRESSABLE } from '@/components/ui/press'
import { cn } from '@/lib/utils'

export function StepHeading({ title, hint }: { title: string; hint: string }): JSX.Element {
  return (
    <div className="mb-4">
      <h2 className="text-foreground text-lg font-medium">{title}</h2>
      <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{hint}</p>
    </div>
  )
}

export function Advanced({
  label,
  summary,
  children,
  'data-testid': testId = 'wizard-advanced',
}: {
  label: string
  summary: string | null
  children: ReactNode
  'data-testid'?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-border mt-5 border-t pt-4">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            'text-muted-foreground hover:text-foreground flex w-full origin-left items-center gap-2 rounded-control text-sm outline-none',
            PRESSABLE,
            FOCUS_RING
          )}
          data-testid={testId}
        >
          <ChevronDown
            className={cn(
              'size-4 shrink-0 transition-transform duration-quick ease-out motion-reduce:transition-none',
              open && 'rotate-180',
            )}
            aria-hidden
          />
          {label}
          {summary && !open && (
            <span className="text-muted-foreground min-w-0 truncate text-xs">· {summary}</span>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="duration-base ease-out motion-reduce:animate-none">
        <div className="space-y-4 pt-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
