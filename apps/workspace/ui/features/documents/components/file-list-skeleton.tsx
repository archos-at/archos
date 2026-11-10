'use client'

import type { JSX } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'

/**
 * The detail view, waiting.
 *
 * A card grid was drawn here whatever the reader had chosen, so running a search
 * from the list showed a wall of card skeletons and then snapped to a table —
 * a layout flash announcing a change that was never going to happen. Shaped like
 * the rows it stands in for, so what arrives lands where the placeholder was.
 */
export function FileListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="@container/filelist space-y-1 px-2 pb-4 pt-6 md:-mx-2 md:px-0" data-testid="file-list-skeleton">
      {/*
        THE COLUMN HEADINGS ARE PART OF THE SHAPE.
        This drew rows and no header, so the detail view's first frame was six
        grey lines that then jumped down by a header's height the moment the
        answer arrived — on the one view a reader chooses precisely because it
        is dense and stable. The headings are real words, not grey bars: they
        are known before the listing is, and they tell a reader what they are
        about to be looking at while they wait for it.
      */}
      <FileListSkeletonHeader />
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-2.5 px-2 py-1.5">
          <Skeleton className="h-3 w-8 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-4 w-16 shrink-0 rounded-full" />
          <Skeleton className="hidden h-4 w-20 shrink-0 rounded-full @3xl/filelist:block" />
          <Skeleton className="hidden h-3 w-12 shrink-0 @3xl/filelist:block" />
          <Skeleton className="hidden h-3 w-16 shrink-0 @4xl/filelist:block" />
        </div>
      ))}
    </div>
  )
}

/** The heading strip above the placeholder rows — same widths as the real columns. */
function FileListSkeletonHeader(): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <div className="text-muted-foreground flex items-center gap-2.5 px-2 pb-1.5 card-eyebrow" /* no line: the real header has none */>
      <span className="min-w-0 flex-1">{t('list.columns.name')}</span>
      <span className="hidden w-[120px] shrink-0 @3xl/filelist:block">{t('list.columns.approval')}</span>
      <span className="hidden w-[76px] shrink-0 text-right @5xl/filelist:block">{t('list.columns.pages')}</span>
      <span className="hidden w-[104px] shrink-0 text-right @3xl/filelist:block">{t('list.columns.size')}</span>
      <span className="hidden w-[120px] shrink-0 @4xl/filelist:block">{t('list.columns.added')}</span>
    </div>
  )
}
