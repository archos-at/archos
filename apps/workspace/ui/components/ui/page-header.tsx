import type { JSX } from 'react'
import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * PageHeader — the single, documented page-title block every content page opens
 * with (see `design-language.md` §"Component patterns"). One primitive so
 * the title stays on-spec (`text-page-title`, 20/28/500) instead of the
 * drifted copies each page hand-rolled.
 *
 * @example
 * <PageHeader
 *   title={t('title')}
 *   subtitle={t('subtitle')}
 *   action={<Button>New project</Button>}
 * />
 */
export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /**
   * Keep the subtitle on a phone. Off by default: there the tab bar and the page
   * say where this is. On for a page the tab bar does not name, whose sentence
   * says what the page is for („Mein Gedächtnis“: what is kept about you).
   */
  subtitleOnPhone?: boolean
  /** Optional primary action rendered on the right of the header row. */
  action?: React.ReactNode
  /**
   * Where the page is, above the title, small and muted (12/16, `text-meta`): the project a tab belongs to, so the
   * title can name the place itself („E-Mail-Eingang“, not „Dateien“ over the inbox).
   */
  crumb?: React.ReactNode
  /** Classes for the crumb's line: `max-md:hidden` where the widths without a rail start the page with its title. */
  crumbClassName?: string
  /** What starts the title's line, before the title: a way back (a phone's ←), on the title's edge. */
  titleStart?: React.ReactNode
  /** Where `titleStart` is shown (`md:hidden`): an empty slot still took the line's gap and moved the title 8px in. */
  titleStartClassName?: string
  /**
   * What ends the title's line, at every width: a glyph that belongs to the header (the phone's search, a page's
   * one ⋯). A 44px target hangs into the line's height, so it costs the header none.
   */
  titleEnd?: React.ReactNode
  /** The action stays on the title's line at every width: a compact one (a single ⋯) that a phone need not stack. */
  actionInline?: boolean
  /** Classes for the title itself (`line-clamp-2` where a title can be a folder's sentence-long name). */
  titleClassName?: string
  /** The whole title as a tooltip, where `titleClassName` may cut it. */
  titleTooltip?: string
  /** Beside the title, on its first line's baseline: what the place holds („240 Elemente“). */
  titleAside?: React.ReactNode
}

/**
 * Title beside action, but only once there is width for both.
 *
 * This was an unconditional row with a `shrink-0` action, which is a rule that a
 * phone cannot keep: the action takes its natural width — a 256px search field,
 * a toggle group — and the title column absorbs every pixel of the shortfall.
 * At 390px the Historie subtitle wrapped to one word per line beside its search
 * box. `projects-grid` had already worked around it with a local `flex-col
 * items-start sm:flex-row`; the primitive is where that belongs, since six
 * project sections reach this through `ProjectSectionFrame` and inherited none
 * of it.
 *
 * `sm:` and not `pointer-coarse:` on purpose: whether a title and a search field
 * fit side by side is a question about width, not about the pointer (see the
 * axis note in `design-language.md`). Stacked, the action stretches so a
 * child's `w-full` has a real width to resolve against.
 */
const TITLE_ROW_CLASS =
  'flex min-w-0 flex-col items-stretch gap-3 phone:gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4'

/**
 * The floor the title column refuses to go below, and the reason the action can
 * shrink at all.
 *
 * Stacking fixed the phone. It did not fix the laptop, because in the row the
 * old rule still held: the action was `sm:shrink-0`, so it kept its natural
 * width at every width above 640px and the title column was still the only
 * thing that could give. Project → Dateien is the case that shows it — a view
 * toggle, four filter chips, a `lg:w-72` search field and an upload button want
 * about 1100px, and inside a sidebar the header gets ~900px — so at 900px the
 * Dateien subtitle rendered as a one-to-two-word column beside a row that had
 * spare capacity it would not use.
 *
 * Two changes, and they only work together. The title gets a minimum, so the
 * squeeze stops at something readable rather than at one word. The action stops
 * being `shrink-0`, so it is the side that yields once the title is at its
 * floor — and yielding is not damage there, because these action rows are
 * `flex-wrap`: they answer a narrower box with a second line. That wrap was
 * already written and was dead code, since `shrink-0` meant the box was never
 * narrower than its content.
 *
 * 14rem is two-thirds of the widest section subtitle at `text-sm`: enough for
 * three or four words a line, which reads as a paragraph. Below `sm` it does
 * not apply — the row is stacked there and the title already owns the width.
 */
const TITLE_COLUMN_CLASS = 'min-w-0 sm:min-w-56'

/**
 * A page's title: 20/28/500 (`text-page-title`), 16/24/500 on a phone. For the few pages whose header the primitive
 * cannot lay out (the projects list's three-cell grid, the intake wizard's eyebrow row), so their title is the same
 * as every other page's. It was `text-xl font-medium` there while `PageHeader` set 24/600, and the app's titles read
 * in two weights. `font-medium` holds 500 on a phone, where the title takes the section's size and would otherwise
 * take the section's 600. `tests/brand-literals.spec.ts` („page titles“) fails an h1 that sets its own size.
 */
export const PAGE_TITLE_CLASS = 'text-page-title font-medium phone:text-section'

export function PageHeader({
  title,
  subtitle,
  subtitleOnPhone = false,
  action,
  crumb,
  crumbClassName,
  titleStart,
  titleStartClassName,
  titleEnd,
  actionInline = false,
  titleClassName,
  titleTooltip,
  titleAside,
  className,
  ...props
}: PageHeaderProps): JSX.Element {
  // The aside follows the title's last word inline („Index C  2 Elemente“): beside a two-line title as a box it stood
  // at the far edge of the column, away from what it counts.
  const heading = (
    <h1 className={cn('min-w-0 flex-1 text-balance', PAGE_TITLE_CLASS, titleClassName)} title={titleTooltip}>
      {title}
      {titleAside && <span className="ml-2 whitespace-nowrap align-baseline font-normal">{titleAside}</span>}
    </h1>
  )
  return (
    <header className={cn('min-w-0', TITLE_ROW_CLASS, actionInline && 'flex-row items-center justify-between', className)} {...props}>
      <div className={TITLE_COLUMN_CLASS}>
        {/* On a phone the title is one compact line and the description is
            gone: the tab bar and the page already say where this is, and the
            sentence cost two lines of a 393px-wide screen on every tab. A
            ratchet in `page-header.spec.tsx` holds it. */}
        {crumb && (
          <p className={cn('text-meta text-muted-foreground mb-1 flex min-w-0 items-center gap-1', crumbClassName)} data-testid="page-header-crumb">
            {crumb}
          </p>
        )}
        {titleStart || titleEnd ? (
          // `items-start`: a way back stands on the title's first line when the title takes two (it floated beside
          // the second, centred on both).
          <div className="flex min-w-0 items-start gap-2" data-slot="page-header-title-line">
            {/* -10px each side: a 44px target on the title's 24px line. */}
            {titleStart && <div className={cn('-my-2.5 flex shrink-0 items-center', titleStartClassName)}>{titleStart}</div>}
            {heading}
            {titleEnd && <div className="-my-2.5 flex shrink-0 items-center">{titleEnd}</div>}
          </div>
        ) : (
          heading
        )}
        {subtitle && (
          <p className={cn('mt-1 text-pretty text-sm text-muted-foreground', !subtitleOnPhone && 'phone:hidden')}>{subtitle}</p>
        )}
      </div>
      {/* Inline, a 44px ⋯ hangs into the title's line height (-8px each side), so it costs the header no height. */}
      {action ? <div className={cn('min-w-0', actionInline && '-my-2 shrink-0')}>{action}</div> : null}
    </header>
  )
}
