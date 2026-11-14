'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

/** The brief's chevron, after its words: muted, turning as the section opens. */
export const BRIEF_CHEVRON = 'text-muted-foreground size-3.5 shrink-0 transition-transform duration-quick ease-out motion-reduce:transition-none'

/**
 * A secondary section of the brief, folded to its title and one line of what
 * it holds. The heading wraps the trigger (the disclosure pattern): a heading
 * inside a button is not one a screen reader can jump to.
 */
export function BriefDisclosure({
  id,
  title,
  summary,
  children,
}: {
  id: string
  title: string
  summary: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section aria-labelledby={id} data-testid={id} data-state={open ? 'open' : 'closed'}>
        <h3 id={id} className="m-0">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="hover:bg-hover focus-visible:ring-ring group flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left transition-colors duration-quick ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none pointer-coarse:min-h-11"
              data-testid={`${id}-toggle`}
            >
              <span className="text-muted-foreground min-w-28 shrink-0 text-xs" /* one column: summaries on one edge; muted, its value ink */>{title}</span>
              {/* What the section holds, while it is shut; open, the section says it itself. */}
              <span className="text-foreground min-w-0 truncate text-xs font-normal phone:line-clamp-2 phone:whitespace-normal" aria-hidden={open} /* as the brief's line: a phone wraps, never cuts */>
                {open ? '' : summary}
                <ChevronDown className={cn(BRIEF_CHEVRON, 'ml-1 hidden align-[-2px] phone:inline', open && 'rotate-180')} aria-hidden />
              </span>
              <ChevronDown className={cn(BRIEF_CHEVRON, 'phone:hidden', open && 'rotate-180')} aria-hidden />
            </button>
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent className="flex flex-col gap-2.5 px-4 pb-3">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  )
}
