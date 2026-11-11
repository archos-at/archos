'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { useRouter } from 'next/navigation'

import { PageSheet } from '@/components/ui/page-sheet'
import { PAGE_SHEET_SKELETON_SLOT } from './page-sheet-skeleton'

/**
 * A {@link PageSheet} that IS a route.
 *
 * The org-level places (Archiv, Postfach) keep real URLs — shareable,
 * refreshable, palette-reachable — but present as sheets above wherever the
 * reader is standing. Next's intercepting-route pattern delivers that: a soft
 * navigation renders this inside the `(shell)/@overlay` slot while the previous
 * page keeps showing underneath; a hard load renders the same component from
 * the real page, standing alone.
 *
 * The two arrivals differ only in what "close" means, which is exactly the
 * `standalone` prop:
 *
 *  - intercepted (`standalone` false): the reader navigated here, so closing is
 *    `router.back()` — the URL and the page underneath both return to where
 *    they were, and forward re-opens the sheet (the browser history IS the
 *    sheet's state).
 *  - hard load (`standalone` true): there is no history entry to go back to
 *    that belongs to this app, so closing pushes the org home instead.
 *
 * Either way the navigation waits for `onExitComplete`: navigating on the
 * close click unmounts the route underneath the sheet mid-slide, which cuts
 * the exit off at whatever frame the router happened to reach. The page
 * beneath is already visible at the dimmed edges, so nothing is waiting on
 * the navigation except the URL.
 *
 * The sheet rises ONCE. The route's `loading.tsx` draws `PageSheetSkeleton`,
 * which rises as the sheet; when the route resolves, this takes over where the
 * skeleton stands, mid-rise if the route was quick, and finishes that rise
 * (`enterFrom`). It used to start again from the screen's foot, so every open
 * was two rises of one panel. A hard load never rises: nothing moves on a page
 * load. Only a route that resolved with no skeleton on screen (it was already
 * in the router's cache) plays the whole entrance itself.
 */

const AT_REST = { y: 0, scrim: 1 }

/**
 * Where the sheet's skeleton stands right now, or undefined when none is on
 * screen. Read while rendering, before the commit that removes the skeleton.
 */
function skeletonPlace(): { y: number; scrim: number } | undefined {
  if (typeof document === 'undefined' || typeof DOMMatrixReadOnly === 'undefined') return undefined
  const skeleton = document.querySelector(`[data-slot="${PAGE_SHEET_SKELETON_SLOT}"]`)
  const [scrim, panel] = skeleton?.children ?? []
  if (!scrim || !panel) return undefined
  const opacity = Number(getComputedStyle(scrim).opacity)
  return {
    y: new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42,
    scrim: Number.isFinite(opacity) ? opacity : 1,
  }
}

interface RoutePageSheetProps {
  title: string
  subtitle?: string
  closeLabel: string
  /** Hard-load variant: closing pushes `fallbackHref` instead of going back. */
  standalone?: boolean
  fallbackHref?: string
  headerActions?: React.ReactNode
  /** See {@link PageSheet} — content that owns its identity row hosts the close itself. */
  headerless?: boolean
  bodyClassName?: string
  children: React.ReactNode
}

export function RoutePageSheet({
  title,
  subtitle,
  closeLabel,
  standalone = false,
  fallbackHref = '/app/projects',
  headerActions,
  headerless,
  bodyClassName,
  children,
}: RoutePageSheetProps): JSX.Element {
  const router = useRouter()
  const [open, setOpen] = React.useState(true)
  const [enterFrom] = React.useState(() => (standalone ? AT_REST : skeletonPlace()))

  const handleOpenChange = React.useCallback((next: boolean) => {
    if (!next) setOpen(false)
  }, [])

  const handleExitComplete = React.useCallback(() => {
    if (standalone) router.push(fallbackHref)
    // Same guard as BackLink: with no history entry to return to, `back()`
    // would leave the app — push the fallback instead.
    else if (typeof window !== 'undefined' && window.history.length <= 1)
      router.push(fallbackHref)
    else router.back()
  }, [standalone, fallbackHref, router])

  return (
    <PageSheet
      open={open}
      onOpenChange={handleOpenChange}
      onExitComplete={handleExitComplete}
      enterFrom={enterFrom}
      title={title}
      subtitle={subtitle}
      closeLabel={closeLabel}
      headerActions={headerActions}
      headerless={headerless}
      bodyClassName={bodyClassName}
    >
      {children}
    </PageSheet>
  )
}
