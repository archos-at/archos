import type { JSX } from 'react'

import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { cn } from '@/lib/utils'

/**
 * Which project this is, on a phone, where no page header says it: a quiet
 * line, not a control.
 *
 * The project's name as a crumb (muted 12/16, `text-meta`, the page header's
 * crumb), on one line, cut in the middle when it does not fit (the end of a
 * name, „Baufeld D12", tells sibling projects apart). A page with a header
 * carries the same line as its `PageHeader` crumb (`ProjectSectionFrame`);
 * this atom is for the two places without one: over the chat's toolbar, and
 * the bare flows' line. It was a 44px press that opened the project list
 * (`ProjectPill`); the selector is the first row of „Mehr“ now.
 */
export function ProjectCrumb({ name, className }: { name: string; className?: string }): JSX.Element {
  return (
    <p data-testid="project-crumb" className={cn('text-muted-foreground text-meta flex min-w-0', className)}>
      <MiddleTruncate text={name} tail={12} />
    </p>
  )
}
