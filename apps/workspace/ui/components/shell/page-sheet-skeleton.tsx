import type { JSX, ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { PAGE_SHEET_OVERLAY_CLASS, PAGE_SHEET_PANEL_CLASS, PAGE_SHEET_WINDOW_CLASS, type PageSheetSize } from '@/components/ui/page-sheet'

export const PAGE_SHEET_SKELETON_SLOT = 'page-sheet-skeleton'

export function PageSheetSkeleton({
  loadingLabel,
  size = 'page',
  children,
}: {
  loadingLabel: string
  size?: PageSheetSize
  children?: ReactNode
}): JSX.Element {
  if (size === 'window') {
    return (
      <div aria-busy="true" data-slot={PAGE_SHEET_SKELETON_SLOT}>
        <div className={`${PAGE_SHEET_OVERLAY_CLASS} animate-in fade-in-0 duration-base ease-entrance motion-reduce:animate-none`} aria-hidden />
        <div className={`${PAGE_SHEET_WINDOW_CLASS} animate-in fade-in-0 duration-base ease-entrance motion-reduce:animate-none`}>
          <span className="sr-only" role="status">
            {loadingLabel}
          </span>
          <div className="flex flex-col gap-5 p-6" aria-hidden>
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-9 w-full rounded-control" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="h-[92px] w-full rounded-[10px]" />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }
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
