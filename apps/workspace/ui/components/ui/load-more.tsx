'use client'

import type { JSX } from 'react'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useInView } from '@/hooks/use-in-view'
import { cn } from '@/lib/utils'

export interface LoadMoreProps {
  hasMore: boolean
  loading: boolean
  failed?: boolean
  onLoadMore: () => void
  loadMoreLabel: string
  loadingLabel: string
  failedLabel: string
  rootMargin?: string
  auto?: boolean
  className?: string
}

export function LoadMore({
  hasMore,
  loading,
  failed = false,
  onLoadMore,
  loadMoreLabel,
  loadingLabel,
  failedLabel,
  rootMargin = '600px 0px',
  auto = true,
  className,
}: LoadMoreProps): JSX.Element | null {
  const [sentinel, inView] = useInView<HTMLDivElement>({ rootMargin })

  useEffect(() => {
    if (auto && inView && hasMore && !loading && !failed) onLoadMore()
  }, [auto, inView, hasMore, loading, failed, onLoadMore])

  if (!hasMore && !loading) return null

  return (
    <div ref={sentinel} className={cn('flex flex-col items-center gap-2 py-4', className)} data-testid="load-more">
      {loading ? (
        <span className="text-muted-foreground inline-flex items-center gap-2 text-xs" role="status">
          <Spinner size="xs" aria-hidden />
          {loadingLabel}
        </span>
      ) : (
        <>
          {failed && <p className="text-muted-foreground text-xs">{failedLabel}</p>}
          <Button type="button" variant="secondary" size="sm" onClick={onLoadMore} data-testid="load-more-button">
            {loadMoreLabel}
          </Button>
        </>
      )}
    </div>
  )
}
