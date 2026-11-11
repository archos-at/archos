import type { JSX, ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { PAGE_SHEET_OVERLAY_CLASS, PAGE_SHEET_PANEL_CLASS } from '@/components/ui/page-sheet'

/** How `RoutePageSheet` finds the skeleton it takes over from. */
export const PAGE_SHEET_SKELETON_SLOT = 'page-sheet-skeleton'

/**
 * The page sheet's loading state — the same scrim and panel geometry as
 * {@link import('@/components/ui/page-sheet').PageSheet}, drawn in plain divs
 * so a route-level `loading.tsx` (a server file) can render it without
 * mounting a dialog. No focus trap: the state lasts one server round-trip, and
 * trapping focus in a skeleton would fight the real sheet arriving.
 *
 * It ARRIVES like the sheet it stands in for — the same rise on the same
 * curve, in CSS since there is no client component here. The skeleton's rise
 * IS the sheet's arrival: `RoutePageSheet` sees this on screen
 * (`PAGE_SHEET_SKELETON_SLOT`) and takes over in place, without a rise of its
 * own. So the chrome here is the sheet's to the pixel (the grabber's band, the
 * title's and subtitle's line boxes, the close control), and the swap moves
 * nothing.
 *
 * `children` is the body: a place passes the shape of its own content, in its
 * own padding, so what loads lands where its skeleton stood. Without it, three
 * rows.
 *
 * `loadingLabel` is announced (`role="status"`), so the arrival is not silent
 * for a screen-reader user either.
 */
export function PageSheetSkeleton({ loadingLabel, children }: { loadingLabel: string; children?: ReactNode }): JSX.Element {
  return (
    <div aria-busy="true" data-slot={PAGE_SHEET_SKELETON_SLOT}>
      <div
        className={`${PAGE_SHEET_OVERLAY_CLASS} animate-in fade-in-0 duration-base ease-entrance motion-reduce:animate-none`}
        aria-hidden
      />
      {/* The wide (default) width — both route sheets that use this are wide. */}
      <div
        className={`${PAGE_SHEET_PANEL_CLASS} md:max-w-[1400px] animate-in slide-in-from-bottom duration-deliberate ease-entrance motion-reduce:animate-none`}
      >
        <span className="sr-only" role="status">
          {loadingLabel}
        </span>
        {/* The grabber band and header, in the sheet's own boxes. Inert here:
            there is nothing to pull or close yet. */}
        <div className="flex shrink-0 justify-center py-2 pointer-coarse:py-0" aria-hidden>
          <div className="flex h-4 w-14 items-center justify-center pointer-coarse:h-11">
            <div className="bg-muted-foreground/25 h-1 w-9" />
          </div>
        </div>
        <div className="border-border flex shrink-0 items-start justify-between gap-4 border-b px-4 pb-4 pt-2 pointer-coarse:pt-0 md:px-8 md:pb-5 md:pt-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex h-7 items-center">
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="flex h-5 items-center">
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          </div>
          <div className="size-9 shrink-0 pointer-coarse:size-11" />
        </div>
        {children ?? (
          <div className="min-h-0 flex-1 space-y-3 px-4 py-6 md:px-8">
            <Skeleton className="h-16 w-full rounded-control" />
            <Skeleton className="h-16 w-full rounded-control" />
            <Skeleton className="h-16 w-2/3 rounded-control" />
          </div>
        )}
      </div>
    </div>
  )
}
