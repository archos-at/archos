'use client'

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
  count?: number | null
  countLabel?: string
  /** The count stopped at a page: it reads „50+“, as the rail and the list say it. */
  countMore?: boolean
}

export interface SectionNavProps {
  label: string
  items: readonly SectionNavItem[]
  rootHref: string
  pillId: string
  orientation?: 'rail' | 'tabs'
  railTopClassName?: string
  pathname?: string
  track?: boolean
  compactOnPhone?: boolean
  'data-testid'?: string
}

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
  track?: boolean
  compactOnPhone?: boolean
}): JSX.Element {
  const pathname = usePathname()
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const strip = stripRef.current
    const scroller = strip?.firstElementChild
    const current = strip?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!(scroller instanceof HTMLElement) || !current) return
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
  variant: 'strip' | 'track' | 'rail'
}): JSX.Element {
  const Icon = item.icon
  const onTrack = variant === 'track'
  return (
    <Link
      href={item.href}
      replace
      aria-current={active ? 'page' : undefined}
      data-focus-inset={onTrack ? '' : undefined}
      title={compactOnPhone && !active ? item.label : undefined}
      className={cn(
        'duration-quick focus-visible:ring-ring/60 relative isolate items-center rounded-control text-sm transition-colors ease-out focus-visible:outline-none focus-visible:ring-2',
        onTrack ? 'focus-visible:ring-inset' : 'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        variant === 'rail'
          ? 'flex gap-2 px-3 py-2 pointer-coarse:min-h-11'
          : cn('inline-flex gap-1.5 px-3 pointer-coarse:min-h-11 pointer-coarse:px-3.5', onTrack ? 'py-1 md:@max-[44rem]/section:px-2.5' : 'py-1.5'),
        active
          ? 'text-secondary-foreground font-medium'
          : cn(
              'text-muted-foreground',
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
        <CountPill tone="muted" aria-hidden className={cn(onTrack ? !active && 'bg-background' : 'bg-background')}>
          <span className="invisible before:content-['8']" />
        </CountPill>
      )}
      {item.count != null && item.count > 0 && (
        <CountPill
          tone="muted"
          aria-label={item.countLabel}
          title={item.countLabel}
          className={cn(active !== onTrack && 'bg-background')}
          {...(item.countMore ? { children: <span aria-hidden>{`${item.count}+`}</span> } : { count: item.count })}
        />
      )}
    </Link>
  )
}
