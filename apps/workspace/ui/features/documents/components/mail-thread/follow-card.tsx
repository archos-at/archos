'use client'

/**
 * „Diesem E-Mail-Verlauf folgen“ as one card, wherever it is offered: the
 * „E-Mails“ tab of a Verlauf (`FollowControl`) and the E-Mail-Eingang's offer
 * after a filing (`FollowOffer`). Two hand-rolled copies had grown in the two
 * features, the same glyph, title, line and button on the same plate; a second
 * surface showing the same thing composes the same parts
 * (`design-language.md`, „Component layers“).
 *
 * Its own container decides the arrangement: in the narrow rail the actions
 * sit under the words, in the detail's width beside them.
 */

import type { HTMLAttributes, JSX, ReactNode } from 'react'
import { Repeat2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FollowCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** What the reader's follow is: „Diesem E-Mail-Verlauf folgen“, „Sie folgen … bis …“. */
  title: ReactNode
  /** One line under it: what following does, or why it cannot grow. */
  hint?: ReactNode
  /** The title is a status that changes under the reader (a follow just started). */
  titleRole?: 'status'
  titleTestId?: string
  /** The presses, beside the words where there is room. */
  actions?: ReactNode
  /** What follows under the card's head: who else follows. */
  children?: ReactNode
}

export function FollowCard({
  title,
  hint,
  titleRole,
  titleTestId,
  actions,
  children,
  className,
  ...props
}: FollowCardProps): JSX.Element {
  return (
    <section
      className={cn(
        'bg-card rounded-surface @container flex flex-col gap-2.5 border p-3',
        className
      )}
      {...props}
    >
      <div className="flex flex-col gap-2.5 @md:flex-row @md:items-center @md:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <Repeat2 className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p
              className="text-sm font-medium [overflow-wrap:anywhere]"
              role={titleRole}
              data-testid={titleTestId}
            >
              {title}
            </p>
            {hint}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 @md:shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/** The card's one line under the title. */
export function FollowCardHint({
  children,
  testId,
}: {
  children: ReactNode
  testId?: string
}): JSX.Element {
  return (
    <p className="text-muted-foreground text-xs leading-snug" data-testid={testId}>
      {children}
    </p>
  )
}
