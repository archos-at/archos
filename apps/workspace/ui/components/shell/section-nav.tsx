'use client'

/**
 * Section nav for a settings tier: a sticky rail beside the content on `lg` and
 * up, a horizontally scrolling strip below that.
 *
 * Written once for the organization tier and lifted here when the project
 * settings needed the same thing, so the two tiers move between their sections
 * the same way and a token retune reaches both. The caller decides which
 * sections exist and in which order; this only draws them and works out which
 * one is current.
 *
 * Labels are always visible: a settings surface is visited rarely and should
 * not ask anyone to decode icons. Switching `replace`s the URL, because the
 * sections are a switcher, not a stack: Back leaves the tier in one step instead
 * of walking every section that was looked at.
 */

import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { motion, springGlide } from '@/components/motion'
import { HorizontalScroll } from '@/components/ui/horizontal-scroll'
import { CountPill } from '@/components/ui/count-pill'

export interface SectionNavItem {
  key: string
  href: string
  icon: LucideIcon
  label: string
  /** A quiet count after the label (mail waiting); none at zero. `countLabel` is what a screen reader hears. */
  count?: number | null
  countLabel?: string
}

export interface SectionNavProps {
  /** Accessible name of the `<nav>`. */
  label: string
  /** Visible sections, in reading order. */
  items: readonly SectionNavItem[]
  /**
   * The tier's root href. It matches only exactly, because a prefix test would
   * light it up on every section beneath it.
   */
  rootHref: string
  /** Shared-layout id of the active pill; one per tier, so two navs never trade it. */
  pillId: string
  /**
   * `rail` (default): a sticky rail beside the content from `lg`, a strip
   * below. `tabs`: the strip at every width, above the content, for a tier
   * whose pages are wide dashboards rather than forms.
   */
  orientation?: 'rail' | 'tabs'
  /**
   * Where the desktop rail sticks. The organization tier scrolls the whole
   * shell, under its header; a project section scrolls its own body, under
   * nothing.
   */
  railTopClassName?: string
  /** The path to mark the current section by, for a `/dev` preview that renders a page at its own URL. */
  pathname?: string
  /**
   * The strip on a track of the one grey, the open section a white thumb on it, as every choice in Dateien
   * (`ToggleGroup segmented`). Where tonal presses stand beside the tabs (Dateien's tools), an open tab filled with
   * the same grey read as one more press, and the presses as a second group of tabs (2026-11-10 review).
   */
  track?: boolean
  /**
   * On a phone an unchosen tab of the track is its glyph alone (its name stays its accessible name), and the open
   * one names the place: four German labels ran 470px wide on a 358px line and the last was cut („Of“).
   */
  compactOnPhone?: boolean
  'data-testid'?: string
}

/**
 * Sections match their own route and anything nested under it, on a path
 * boundary: a bare `startsWith` would also mark `/x/access` active on a sibling
 * such as `/x/access-log`.
 */
export function isSectionActive(pathname: string | null, href: string, rootHref: string): boolean {
  if (!pathname) return false
  if (href === rootHref) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SectionNav({
  label,
  items,
  rootHref,
  pillId,
  orientation = 'rail',
  railTopClassName = 'lg:top-24',
  pathname: pathnameOverride,
  track = false,
  compactOnPhone = false,
  'data-testid': testId,
}: SectionNavProps): JSX.Element {
  const currentPathname = usePathname()
  const pathname = pathnameOverride ?? currentPathname

  return (
    <nav aria-label={label} data-testid={testId}>
      {/* Mobile / tablet: a scrolling strip. */}
      <SectionStrip
        label={label}
        items={items}
        pillId={pillId}
        isActive={(href) => isSectionActive(pathname, href, rootHref)}
        className={cn(orientation === 'rail' && 'lg:hidden')}
        track={track}
        compactOnPhone={compactOnPhone}
      />

      {/* Desktop: a sticky rail beside the content. */}
      {orientation === 'rail' && (
        <ul className={cn('hidden lg:sticky lg:flex lg:flex-col lg:gap-0.5', railTopClassName)}>
          {items.map((item) => (
            <li key={item.key}>
              <SectionNavLink
                item={item}
                active={isSectionActive(pathname, item.href, rootHref)}
                pillId={pillId}
                variant="rail"
              />
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}

/**
 * The strip: sections in a row that scrolls inside its own container, so the
 * page body never scrolls horizontally. The edge that hides sections fades
 * (`HorizontalScroll`), so the cut reads as "more this way" instead of as the
 * end of the list; entries are 44px tall under a finger; and the current one is
 * brought into view. Lifted out of `SectionNav` so a tier with a rail of its own
 * (the platform's grouped one) gets the same strip.
 */
export function SectionStrip({
  label,
  items,
  pillId,
  isActive,
  className,
  track = false,
  compactOnPhone = false,
}: {
  label: string
  items: readonly SectionNavItem[]
  pillId: string
  isActive: (href: string) => boolean
  className?: string
  /** See {@link SectionNavProps.track}. */
  track?: boolean
  /** See {@link SectionNavProps.compactOnPhone}. */
  compactOnPhone?: boolean
}): JSX.Element {
  const pathname = usePathname()
  const stripRef = useRef<HTMLDivElement>(null)

  // The current section in view. A strip that opens on its sixth entry used
  // to show the first three and leave the reader to guess where they were.
  // `scrollLeft`, not `scrollIntoView`: the latter also scrolls every scrolling
  // ancestor, and on a phone that is the page.
  useEffect(() => {
    const strip = stripRef.current
    const scroller = strip?.firstElementChild
    const current = strip?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!(scroller instanceof HTMLElement) || !current) return
    // The nearest scroll that shows the open tab whole, not the centre: centred, both ends showed fragments of
    // their tabs („ı Dateien“); this way the row starts on its first tab unless the open one lies past the edge.
    const right = current.offsetLeft + current.offsetWidth
    if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth
    else if (current.offsetLeft < scroller.scrollLeft) scroller.scrollLeft = current.offsetLeft
  }, [pathname])

  return (
    <div ref={stripRef} className={className}>
      {/* A fade, no chevron: on a phone the chevron sat on the third tab's glyph; the cut tab says the row scrolls (iOS). */}
      <HorizontalScroll aria-label={label} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ul className={cn('flex', track ? 'mb-2 w-fit rounded-control bg-desk p-0.5' : 'gap-1 pb-2')}>
          {items.map((item) => (
            <li key={item.key} className="shrink-0">
              <SectionNavLink
                item={item}
                active={isActive(item.href)}
                pillId={pillId}
                variant={track ? 'track' : 'strip'}
                compactOnPhone={compactOnPhone}
              />
            </li>
          ))}
        </ul>
      </HorizontalScroll>
    </div>
  )
}

function SectionNavLink({
  item,
  active,
  pillId,
  variant,
  compactOnPhone = false,
}: {
  item: SectionNavItem
  active: boolean
  pillId: string
  compactOnPhone?: boolean
  /** `track`: a strip entry on the grey track, 28px so the track is the row's 32px; the open one a white thumb. */
  variant: 'strip' | 'track' | 'rail'
}): JSX.Element {
  const Icon = item.icon
  const onTrack = variant === 'track'
  return (
    <Link
      href={item.href}
      replace
      aria-current={active ? 'page' : undefined}
      // On the track the keyboard's ring is drawn inside the tab: the strip scrolls sideways and clips one outside it.
      data-focus-inset={onTrack ? '' : undefined}
      title={compactOnPhone && !active ? item.label : undefined}
      className={cn(
        // `relative isolate` + pill `-z-10` is the app-sidebar rail pattern:
        // the active surface glides on `springGlide` below the ink.
        'duration-quick focus-visible:ring-ring/60 relative isolate items-center rounded-control text-[13px] leading-5 transition-colors ease-out focus-visible:outline-none focus-visible:ring-2',
        // The strip's entries sit 4px apart, so under a finger each grows to
        // 44px rather than borrowing a catchment from its neighbour.
        // One band, not two: on the track the ring lies in the tab with the page's outline (`data-focus-inset`), beside
        // the content it lies under that outline, 2px off the row (`FOCUS_RING`'s geometry).
        onTrack ? 'focus-visible:ring-inset' : 'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        variant === 'rail'
          ? 'flex gap-2 px-3 py-2 pointer-coarse:min-h-11'
          : cn('inline-flex gap-1.5 px-3 pointer-coarse:min-h-11 pointer-coarse:px-3.5', onTrack ? 'py-1 md:@max-[44rem]/section:px-2.5' : 'py-1.5'),
        active
          ? 'text-secondary-foreground font-medium'
          : cn(
              'text-muted-foreground',
              // Under the pointer an unchosen tab takes ink and the pointer's fill, one step down from its plane, on the
              // track as beside the content: ink alone was the faintest answer in the app (V5, 2026-11-12).
              'hover:bg-hover hover:text-foreground'
            )
      )}
    >
      {active && (
        <motion.span
          layoutId={pillId}
          aria-hidden
          data-slot="section-nav-pill"
          className={cn('absolute inset-0 -z-10 rounded-[inherit]', onTrack ? 'bg-sheet shadow-thumb' : 'bg-selected')}
          transition={springGlide}
        />
      )}
      {/* Beside the rail in a narrow section (a tablet) the places keep their names and give up their glyphs: glyphs
          alone were four boxes to guess, and a strip that scrolled cut „Papierkorb“ off (review of 2026-11-10, finding 2). */}
      <Icon className={cn('size-4 shrink-0', onTrack && 'md:@max-[44rem]/section:hidden')} aria-hidden />
      {/* A phone names only the open place. */}
      <span className={cn(compactOnPhone && !active && 'phone:sr-only')}>{item.label}</span>
      {/* `null` is a count still on its way: its width is held (an invisible pill), so the tabs after it do not move
          when it lands. `undefined` is a tab without a count. */}
      {item.count === null && (
        // A pill of one digit's width and no text to read: white on a grey surface, grey on the white thumb.
        <CountPill tone="muted" aria-hidden className={cn(onTrack ? !active && 'bg-background' : 'bg-background')}>
          <span className="invisible before:content-['8']" />
        </CountPill>
      )}
      {item.count != null && item.count > 0 && (
        // White on a grey surface (the open tab's fill, or the track under an unchosen one), as everything on grey is:
        // grey on grey hid the pill. On the white thumb it is the one grey.
        <CountPill tone="muted" count={item.count} aria-label={item.countLabel} title={item.countLabel} className={cn(active !== onTrack && 'bg-background')} />
      )}
    </Link>
  )
}
