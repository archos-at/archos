'use client'

import type { JSX } from 'react'
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ViewerSurface } from './viewer-surface'

export interface ViewerDockProps {
  lead?: ReactNode
  children: ReactNode
  trail?: ReactNode
  above?: ReactNode
  sheet?: ReactNode
  layout?: 'floating' | 'bar' | 'side'
  className?: string
}

export function ViewerDock({
  lead,
  children,
  trail,
  above,
  sheet,
  layout = 'floating',
  className,
}: ViewerDockProps): JSX.Element {
  if (layout !== 'floating') {
    const side = layout === 'side'
    return (
      <>
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-1.5 p-3',
            side && 'pl-24',
            className
          )}
        >
          {above}
          {sheet}
          {!side && (
            <ViewerSurface
              data-slot="viewer-dock-bar"
              className="pointer-events-auto flex w-full max-w-lg items-stretch gap-0.5 p-1"
            >
              {children}
            </ViewerSurface>
          )}
        </div>
        {side && (
          <div
            className={cn(
              'pointer-events-none absolute inset-y-0 left-3 z-20 flex items-center',
              className
            )}
          >
            <ViewerSurface
              data-slot="viewer-dock-column"
              className="pointer-events-auto flex w-[4.5rem] flex-col items-stretch gap-0.5 p-1"
            >
              {children}
            </ViewerSurface>
          </div>
        )}
      </>
    )
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-1.5 p-3 sm:p-4',
        className
      )}
    >
      {above}
      {sheet}
      {/*
        `w-full` rather than a shrink-to-fit row: at 390 px the pills are wider
        than the viewport, and a centred row that cannot scroll simply loses
        its ends. This way the bar scrolls, and the scrollbar itself is hidden
        because a visible one under a floating pill reads as a rendering
        artefact.

        `justify-center-safe`, not `justify-center`. A centred flex row that
        overflows a scroll container overflows in BOTH directions, and
        `scrollLeft` cannot go below zero — so the left end was unreachable by
        any gesture. On a phone that is the Home button, the one control the
        whole design calls "get me back". The safe alignment falls back to
        `start` exactly when the content does not fit.
      */}
      {/*
        The pointer is taken by the PILLS, not by this row. The row is
        `w-full` (see above), so `pointer-events-auto` here put a dead band the
        full width of the viewport across the bottom of the canvas — about
        68 px with a coarse pointer, which is 8 % of a portrait phone and 17 %
        of a landscape one where the building cannot be orbited at all, and
        where a horizontal drag scrolled the dock instead. Touch-scrolling the
        overflowing row still works: the scroll chain is walked up from
        whichever pill was hit, and does not care that this element declines
        the pointer itself.
      */}
      <div className="flex w-full max-w-full items-center justify-center-safe gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {lead && (
          <ViewerSurface className="pointer-events-auto flex shrink-0 items-center gap-1 p-1">
            {lead}
          </ViewerSurface>
        )}
        <ViewerSurface className="pointer-events-auto flex shrink-0 items-center gap-1 p-1">
          {children}
          {trail && (
            <>
              <ViewerDockSeparator />
              {trail}
            </>
          )}
        </ViewerSurface>
      </div>
    </div>
  )
}

export function ViewerDockSeparator(): JSX.Element {
  return <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-border" />
}
