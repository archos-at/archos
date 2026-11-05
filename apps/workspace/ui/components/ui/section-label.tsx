import type { JSX } from 'react'
import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * SectionLabel — the ~10.5px eyebrow/section-label convention (sentence case,
 * medium weight, muted ink) from `design-language.md` §"Type ramp". It is not
 * set in capitals and carries no extra tracking: the wordmark is the only
 * element in capitals. One primitive so the hand-rolled eyebrows stop
 * drifting. Renders a `<span>` by default; pass `as` (e.g. `h2`, or `dt` in a
 * description list) when the label is the accessible heading for a section.
 *
 * @example
 * <SectionLabel>{t('project.eyebrow')}</SectionLabel>
 * <SectionLabel as="h2">{sectionLabel}</SectionLabel>
 */
export interface SectionLabelProps extends React.HTMLAttributes<HTMLElement> {
  /** Element to render. Defaults to `span`. */
  as?: 'span' | 'h2' | 'h3' | 'h4' | 'p' | 'div' | 'dt'
  /** Optional scan-target icon (preview rails, inspector sections). */
  icon?: LucideIcon
  children: React.ReactNode
}

export function SectionLabel({
  as: Comp = 'span',
  icon: Icon,
  className,
  children,
  ...props
}: SectionLabelProps): JSX.Element {
  return (
    <Comp
      className={cn(
        // `card-eyebrow` (app/globals.css) is the Eyebrow step of the card type
        // ramp, and it is the SAME spec as the design language's product-wide
        // eyebrow — so it is defined once, there, and this primitive adds the
        // muted ink. CalloutCard is the one place that reaches for the class
        // directly, because its eyebrow carries the tone's ink instead.
        'card-eyebrow text-muted-foreground',
        Icon && 'flex items-center gap-1.5',
        className,
      )}
      {...props}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {children}
    </Comp>
  )
}
