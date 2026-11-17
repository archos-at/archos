'use client'

import type { JSX } from 'react'
import { type ReactNode } from 'react'
import { type LucideIcon } from 'lucide-react'
import { LoadError } from '@/components/ui/load-error'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { cn } from '@/lib/utils'

export interface SectionCardProps {
  title?: string
  description?: string
  action?: ReactNode
  error?: boolean
  errorMessage?: string
  onRetry?: () => void
  loading?: boolean
  refreshing?: boolean
  skeletonRows?: number
  empty?: boolean
  emptyIcon?: LucideIcon
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: ReactNode
  testId?: string
  children?: ReactNode
}

export function SectionCard({
  title,
  description,
  action,
  error = false,
  errorMessage,
  onRetry,
  loading = false,
  refreshing = false,
  skeletonRows = 3,
  empty = false,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  testId,
  children,
}: SectionCardProps): JSX.Element {
  const t = useTranslations(platformCopy)
  const busy = refreshing && !loading && !error
  const showAction = Boolean(action) && !loading && !error
  const hasHeader = Boolean(title || description || showAction || busy)

  const body = (): ReactNode => {
    if (error) {
      return (
        <LoadError
          title={errorMessage ?? t('loadError')}
          description={t('loadErrorHint')}
          onRetry={onRetry}
          retrying={loading}
        />
      )
    }
    if (loading) {
      return (
        <div className="flex flex-col gap-2" data-testid="section-loading">
          {Array.from({ length: skeletonRows }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      )
    }
    if (empty) {
      return (
        <EmptyState
          variant="bare"
          icon={emptyIcon}
          title={emptyTitle ?? t('empty.title')}
          description={emptyDescription}
          action={emptyAction}
        />
      )
    }
    return children
  }

  const resolved = !error && !loading && !empty

  return (
    <Card data-testid={testId}>
      {hasHeader ? (
        <CardHeader>
          {title || busy ? (
            <CardTitle className="flex min-w-0 items-center gap-2">
              {title ? <span className="min-w-0 truncate">{title}</span> : null}
              {busy ? (
                <Spinner
                  size="xs"
                  label={t('refreshing')}
                  className="text-muted-foreground"
                  data-testid="section-refreshing"
                />
              ) : null}
            </CardTitle>
          ) : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
          {showAction ? <CardAction>{action}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent
        aria-busy={busy || loading || undefined}
        className={cn(
          resolved && 'animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none',
          busy && 'duration-base opacity-70 transition-opacity'
        )}
      >
        {body()}
      </CardContent>
    </Card>
  )
}
