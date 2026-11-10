import type { JSX } from 'react'

import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { cn } from '@/lib/utils'

/**
 * Which project this is, on a phone: a quiet line, not a control.
 *
 * The project's name in the muted 13/20/500 of a name (`text-name`), on one
 * line, cut in the middle when it does not fit (the end of a name, „Baufeld
 * D12", tells sibling projects apart). It stands in the phone's top band and
 * over the chat's toolbar, whose route has no band. It was a 44px press that
 * opened the project list (`ProjectPill`); the selector is the first row of
 * „Mehr“ now, where the thumb is, and the top of every page gives its height
 * back to the page.
 */
export function ProjectCrumb({ name, className }: { name: string; className?: string }): JSX.Element {
  return (
    <p data-testid="project-crumb" className={cn('text-muted-foreground text-name flex min-w-0', className)}>
      <MiddleTruncate text={name} tail={12} />
    </p>
  )
}
