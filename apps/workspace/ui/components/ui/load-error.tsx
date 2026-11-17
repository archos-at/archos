'use client'

import * as React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { BusyButton } from '@/components/ui/busy-button'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'

export interface LoadErrorProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode
  description?: React.ReactNode
  onRetry?: () => unknown
  retrying?: boolean
  actions?: React.ReactNode
}

export const LoadError = React.forwardRef<HTMLDivElement, LoadErrorProps>(
  ({ title, description, onRetry, retrying, actions, ...props }, ref) => {
    const t = useTranslations(commonCopy)
    const [pending, setPending] = React.useState(false)
    const busy = retrying ?? pending

    const retry = (): void => {
      const result = onRetry?.()
      if (!(result instanceof Promise)) return
      setPending(true)
      void result.catch(() => undefined).finally(() => setPending(false))
    }

    return (
      <Alert ref={ref} variant="destructive" data-slot="load-error" {...props}>
        <AlertTriangle aria-hidden />
        <AlertTitle className="line-clamp-none">{title ?? t('loadError.title')}</AlertTitle>
        {description || onRetry || actions ? (
          <AlertDescription>
            {description ? <p>{description}</p> : null}
            {onRetry || actions ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {onRetry ? (
                  <BusyButton
                    variant="secondary"
                    size="sm"
                    busy={busy}
                    busyLabel={t('loadError.retrying')}
                    icon={<RefreshCw aria-hidden />}
                    onClick={retry}
                    data-testid="load-error-retry"
                  >
                    {t('loadError.retry')}
                  </BusyButton>
                ) : null}
                {actions}
              </div>
            ) : null}
          </AlertDescription>
        ) : null}
      </Alert>
    )
  }
)
LoadError.displayName = 'LoadError'
